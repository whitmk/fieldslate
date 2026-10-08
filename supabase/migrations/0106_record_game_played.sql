-- 0106: record_game_played — "Record where it was played".
--
-- A RETROACTIVE CORRECTION for a game that already happened somewhere other
-- than its schedule says. The usual case: an admin marked a game rained out,
-- left it parked, and the coaches played it on another day without telling
-- anyone. Also a game the coaches simply moved. The admin enters the date it
-- was played, the start time and the field; the game becomes an ordinary
-- `scheduled` game there and the rainout is cleared.
--
-- WHY A FUNCTION AND NOT A BROWSER UPDATE. Three things must happen in ONE
-- transaction, and two of them cannot be expressed as an RLS update at all:
--   1. THE FENCE IS HERE. A correction is allowed on a LOCKED division (the
--      0082 trigger already permits status / scheduled_at / venue_id there),
--      so the only thing stopping this from being a way around the lock for
--      FUTURE games is the played-date rule — and a rule checked only in a
--      form is not a fence. The date is checked against today IN THE ORG'S
--      TIMEZONE (profiles.timezone), never the database's UTC date and never
--      the browser's clock.
--   2. "SENT TO PARENTS" IS KEPT. clear_division_posted (0096) clears
--      `posted` on any game change except a note. A correction records what
--      already happened; it does not make the schedule parents received
--      stale in any way they could act on. So this function reads
--      posted/posted_at FIRST, runs the update (the statement trigger fires
--      and clears them), and writes them back. THE TRIGGER IS NOT MODIFIED —
--      every other edit still clears `posted` exactly as before, and the
--      harness proves both halves.
--   3. THE RECORD IS WRITTEN WITH THE CHANGE. The activity-log entry is
--      inserted in the same transaction, so a correction can never exist
--      without its record (the 2026-07 picker incidents could not be traced
--      for want of exactly that).
--
-- CHECKS, IN THIS ORDER (each raises; nothing is written on a refusal):
--   lock the game row → caller is an org member → the org is on Pro or
--   Elite → not interleague →
--   status is cancelled or scheduled → played date ≤ org-today and ≥ the
--   season's start date → the field belongs to the org.
--
-- INTERLEAGUE IS REFUSED OUTRIGHT. Our row is what the partner's token page
-- reads live, and an open makeup request would overwrite a correction when
-- the partner accepts it (accept_reschedule_request_by_token matches on the
-- game id only). Correcting an interleague game needs its own design; until
-- then it is refused here, and picker-guard.ts is not loosened either.
--
-- WHY THESE STATUSES ONLY. `cancelled` (rained out) and `scheduled` are the
-- two states a played game can be wrongly sitting in. `pending_interleague`
-- and `reschedule_pending` belong to a negotiation; `completed`,
-- `in_progress` and `postponed` have no writer today and are refused rather
-- than silently rewritten to `scheduled`.
--
-- SEASON START: a played date before the season's start date is refused. A
-- season with NO start date refuses every correction (fail closed — one
-- archived season has none, 2026-10-08).
--
-- THE TIME ARGUMENT IS TEXT, the bare wall-clock the app stores
-- ("2026-10-04T15:30" or with seconds). It is stored as that wall-clock at
-- +00, the house convention — converted explicitly, never through the
-- session timezone.
--
-- GATE: is_org_member. Every org member is an admin today; if a non-admin
-- role is ever added this must be restricted to admins with every other
-- is_org_member-gated write (CLAUDE.md).
--
-- PLAN: Pro or Elite, checked HERE as well as in the UI (the 0105 pattern —
-- set_public_schedule_enabled refuses a free org with plan_required). The UI
-- shows Free the upsell; this is what stops a direct call.
--
-- LOCKS: a row lock on the one game and on its division row (so posted
-- cannot be toggled between the read and the restore). No table locks. The
-- restore is a plain UPDATE of `divisions`; its only row trigger that could
-- fire on it (team_calendar_links_on_division_lock) is `UPDATE OF locked`.

create or replace function public.record_game_played(
  p_game_id      uuid,
  p_scheduled_at text,
  p_venue_id     uuid,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game        public.games%rowtype;
  v_league      public.leagues%rowtype;
  v_plan        text;
  v_tz          text;
  v_today       date;
  v_played_at   timestamptz;
  v_played_date date;
  v_division_id uuid;
  v_was_posted  boolean;
  v_posted_at   timestamptz;
  v_posted_kept boolean := false;
  v_reason      text;
  v_home        text;
  v_away        text;
  v_new_venue   text;
  v_old_venue   text;
  v_message     text;
begin
  -- 1. Lock the game row.
  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;

  -- 2. Membership, judged on the owning league's org (games has no owner).
  select * into v_league
  from public.leagues
  where id = v_game.league_id;

  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 2b. Plan: Pro or Elite.
  select p.plan into v_plan from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 3. Not interleague. See the header: refused outright, whatever its status.
  if v_game.interleague_org_id is not null then
    raise exception 'interleague_not_supported' using errcode = 'P0001';
  end if;

  -- 4. Eligible status.
  if v_game.status not in ('cancelled', 'scheduled') then
    raise exception 'status_not_eligible' using errcode = 'P0001';
  end if;

  -- 5. The played date: today or earlier IN THE ORG'S TIMEZONE, and on or
  --    after the season's start date. The date is the wall-clock date part of
  --    the argument — the same rule the browser applies.
  if p_scheduled_at is null
     or p_scheduled_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$' then
    raise exception 'invalid_scheduled_at' using errcode = 'P0001';
  end if;
  begin
    v_played_at := p_scheduled_at::timestamp at time zone 'UTC';
  exception when others then
    raise exception 'invalid_scheduled_at' using errcode = 'P0001';
  end;
  v_played_date := left(p_scheduled_at, 10)::date;

  select p.timezone into v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_tz is null then
    raise exception 'org_timezone_unknown' using errcode = 'P0001';
  end if;
  v_today := (now() at time zone v_tz)::date;

  if v_played_date > v_today then
    raise exception 'played_date_in_future' using errcode = 'P0001';
  end if;
  if v_league.start_date is null then
    raise exception 'season_has_no_start_date' using errcode = 'P0001';
  end if;
  if v_played_date < v_league.start_date then
    raise exception 'played_date_before_season' using errcode = 'P0001';
  end if;

  -- 6. The field belongs to the org. Any field in the org — not filtered by
  --    division, hours or occupancy (the form shows those as notices).
  select coalesce(loc.name || ' — ', '') || v.name into v_new_venue
  from public.venues v
  left join public.locations loc on loc.id = v.location_id
  where v.id = p_venue_id
    and v.owner_id = v_league.owner_id;
  if v_new_venue is null then
    raise exception 'venue_not_in_org' using errcode = 'P0001';
  end if;

  -- The reason: optional, trimmed, blank means none, 500 characters at most
  -- (the game-note limit).
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'reason_too_long' using errcode = 'P0001';
  end if;

  -- "Sent to parents": lock the division row and read the flag BEFORE the
  -- update. A game whose home team has no division has nothing to keep.
  select t.division_id into v_division_id
  from public.teams t
  where t.id = v_game.home_team_id;

  if v_division_id is not null then
    select d.posted, d.posted_at into v_was_posted, v_posted_at
    from public.divisions d
    where d.id = v_division_id
    for update;
  end if;

  -- The correction itself. The status condition is repeated in the WHERE as
  -- defence in depth; the row is locked, so it cannot have changed.
  update public.games
     set status = 'scheduled',
         scheduled_at = v_played_at,
         venue_id = p_venue_id
   where id = v_game.id
     and interleague_org_id is null
     and status in ('cancelled', 'scheduled');

  if not found then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  -- clear_division_posted has now fired (AFTER STATEMENT) and cleared the
  -- flag. Put it back exactly as it was, posted_at included.
  if coalesce(v_was_posted, false) then
    update public.divisions
       set posted = true, posted_at = v_posted_at
     where id = v_division_id;
    select d.posted into v_posted_kept from public.divisions d where d.id = v_division_id;
  end if;

  -- The activity-log record, same transaction. Dates and times are formatted
  -- from the stored wall-clock exactly as fmtGameDate / fmtGameTime do.
  select t.name into v_home from public.teams t where t.id = v_game.home_team_id;
  select t.name into v_away from public.teams t where t.id = v_game.away_team_id;
  select coalesce(loc.name || ' — ', '') || v.name into v_old_venue
  from public.venues v
  left join public.locations loc on loc.id = v.location_id
  where v.id = v_game.venue_id;

  v_message := format(
    '%s vs %s recorded as played %s at %s — %s (correction; %s %s at %s — %s)',
    coalesce(v_home, 'TBD'),
    coalesce(v_away, 'TBD'),
    to_char(v_played_at at time zone 'UTC', 'Dy, Mon FMDD'),
    to_char(v_played_at at time zone 'UTC', 'FMHH12:MI AM'),
    v_new_venue,
    case when v_game.status = 'cancelled' then 'was rained out' else 'was scheduled' end,
    to_char(v_game.scheduled_at at time zone 'UTC', 'Dy, Mon FMDD'),
    to_char(v_game.scheduled_at at time zone 'UTC', 'FMHH12:MI AM'),
    coalesce(v_old_venue, 'no field')
  );
  if v_reason is not null then
    v_message := v_message || '. Reason: ' || v_reason;
  end if;

  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_game.league_id, v_division_id, 'game_played_recorded', v_message);

  return jsonb_build_object(
    'game_id', v_game.id,
    'division_id', v_division_id,
    'previous_status', v_game.status,
    'previous_scheduled_at', v_game.scheduled_at,
    'previous_venue_id', v_game.venue_id,
    'scheduled_at', v_played_at,
    'venue_id', p_venue_id,
    'was_posted', coalesce(v_was_posted, false),
    'posted_kept', v_posted_kept
  );
end;
$$;

-- Revoke from PUBLIC and from each role (a role-level revoke alone is a silent
-- no-op while PUBLIC holds it, and this project's default privileges grant
-- some roles directly), then grant back exactly one.
revoke execute on function public.record_game_played(uuid, text, uuid, text)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.record_game_played(uuid, text, uuid, text)
  to authenticated;

-- Refuse to finish with a wrong privilege: the no-op form leaves no error.
do $check$
declare
  v_fn constant text := 'public.record_game_played(uuid, text, uuid, text)';
begin
  if not has_function_privilege('authenticated', v_fn, 'execute')
     or has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('service_role', v_fn, 'execute')
     or has_function_privilege('dashboard_readonly', v_fn, 'execute') then
    raise exception '0106: record_game_played privileges are wrong';
  end if;
end;
$check$;

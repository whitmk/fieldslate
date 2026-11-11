-- 0130 — Officials are emailed when their games change (2026-11-11, branch
-- feat/game-change-notices). Plan: docs/plans/game-change-followthrough.md,
-- "A. Email assigned officials when their game changes".
--
-- WHAT IT DOES
--   * An official assigned to a game that is moved (time or field), rained
--     out, given a makeup date, put back on (Remove Rainout), or deleted from
--     the schedule (regenerate, division/team/game delete — "taken off this
--     game") gets ONE email, 10–15 minutes later, covering every one of their
--     games that changed in that window. Upcoming games only, judged again
--     when the email is taken (league time).
--   * When a game's time changes or it comes back on, each official on it is
--     re-checked (blackout, another game at the same time, availability,
--     weekly limit). A problem is NEVER an unassignment: it goes to the
--     league's officials contact as one email per season and window, and the
--     official's own email says the new time overlaps another game.
--
-- GATES (all four, checked in the trigger; the take re-checks):
--   Elite · org_feature_on('official_signup') · a confirmed officials contact
--   email (official_signup_settings.contact_email; 0126) · the new setting
--   official_signup_settings.notify_game_changes (default true).
--
-- WHAT IT ADDS / CHANGES
--   1. official_outbox: coalesce_key + a partial unique index on it while
--      pending (one pending row per official, one per season for the
--      coordinator); kinds game_changes and assignment_conflicts; the
--      umpire CHECK lets assignment_conflicts go without one.
--      official_signup_settings.notify_game_changes. official_trigger_failures
--      (no personal data; RLS on, no role privilege).
--   2. Helpers, callable by no role: official_notice_on, official_field_label,
--      official_move_problem (official_block_reason's move-relevant reasons:
--      blackout, time_conflict, outside_availability, over_weekly_limit — the
--      0129 busy rule decides which other games count), official_change_entries,
--      official_conflict_entries, official_record_failure.
--   3. official_on_game_change — AFTER UPDATE OF scheduled_at, venue_id,
--      status on games. SECURITY DEFINER (the browser writes games and holds
--      nothing on the outbox). Never blocks the edit: a failure is recorded in
--      official_trigger_failures and swallowed. Its own trigger, never the
--      volunteer one (the fence; sim:volunteer-leaks).
--   4. official_on_game_delete — BEFORE DELETE on games, so the assignments
--      are still readable before game_umpires cascades. Queues a "removed"
--      entry carrying a snapshot (the game is gone by send time). NOT
--      swallowed: if it fails the delete fails, visibly.
--   5. record_game_played (0106) — re-created VERBATIM plus two lines around
--      its one games UPDATE that set fieldslate.official_notice_skip, with
--      is_local = true (reverted at transaction end, commit or rollback). A
--      correction records a game already played and never emails an
--      official. No browser path can set the setting (plan, checked
--      2026-11-10; the proof's SK1 keeps it so).
--   6. official_outbox_take (0124) — re-created VERBATIM plus: due
--      game_changes / assignment_conflicts rows with nothing left to say are
--      superseded (no_net_change: every game started, back where it was, or
--      no longer theirs; no_conflicts); rows queued before a gate went off are
--      superseded (notify_off); a game_changes row for an official with no
--      email fails no_email (it shows on the officials banner); the reply
--      gains `changes` and `conflicts`, worked out NOW; assignment_conflicts
--      goes to the officials contact.
--   7. official_email_problems / _ack (0128) — re-created verbatim plus the
--      officials' trigger failures (count; marked seen with the rest).
--   8. official_notice_state (the Settings line and the Officials page) and
--      set_official_notify_game_changes (the Settings toggle), authenticated.
--
-- LOCKS when applied:
--   * SHARE ROW EXCLUSIVE on games for the two CREATE TRIGGERs — game writes
--     wait for that statement (reads don't).
--   * ACCESS EXCLUSIVE on official_outbox and official_signup_settings (ADD
--     COLUMN with a constant default — no rewrite — and the CHECK swaps; both
--     tiny, no browser screen reads them directly).
--   * Nothing on profiles, leagues, game_umpires, umpires.
--
-- Deploy order: apply 0130 BEFORE the code reaches main — the Settings card
-- and the Officials page call official_notice_state, and the drain must know
-- the two new kinds before any row of them exists (an unknown kind fails).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Columns, tables, constraints
-- ────────────────────────────────────────────────────────────────────────────
alter table public.official_outbox
  add column coalesce_key text check (coalesce_key is null or length(coalesce_key) <= 100);
create unique index official_outbox_coalesce_pending_uniq
  on public.official_outbox (coalesce_key) where status = 'pending';

alter table public.official_outbox drop constraint official_outbox_kind_check;
alter table public.official_outbox add constraint official_outbox_kind_check check (kind in (
  'help_request', 'claim_confirmed', 'drop_confirmed', 'drop_notice', 'claims_digest',
  'game_changes', 'assignment_conflicts'));

-- The official's own emails name an official; the coordinator's digest and
-- conflict list don't (they list several).
alter table public.official_outbox drop constraint official_outbox_umpire_when_needed;
alter table public.official_outbox add constraint official_outbox_umpire_when_needed check (
  (kind in ('claims_digest', 'assignment_conflicts') and umpire_id is null)
  or (kind not in ('claims_digest', 'assignment_conflicts') and umpire_id is not null));

alter table public.official_signup_settings
  add column notify_game_changes boolean not null default true;

-- An officials trigger on games that failed. It never blocked the schedule
-- edit, but it must not fail quietly: the Officials page's email banner shows
-- the count. No personal data — the game, the SQLSTATE.
create table public.official_trigger_failures (
  id              bigint generated always as identity primary key,
  owner_id        uuid references public.profiles(id) on delete cascade,
  season_id       uuid references public.leagues(id) on delete cascade,
  game_id         uuid,
  trigger_name    text not null check (trigger_name in ('game_change')),
  error_code      text not null check (error_code ~ '^[0-9A-Z]{5}$'),
  at              timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index official_trigger_failures_season_idx on public.official_trigger_failures (season_id, at);
alter table public.official_trigger_failures enable row level security;
revoke all on table public.official_trigger_failures from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Helpers (callable by no role)
-- ────────────────────────────────────────────────────────────────────────────
-- The four gates. Elite · the officials feature · a confirmed officials
-- contact (the reply-to; never an account email) · the league's setting.
create or replace function public.official_notice_on(p_owner uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce((select p.plan = 'elite' from public.profiles p where p.id = p_owner), false)
     and public.org_feature_on(p_owner, 'official_signup')
     and exists (select 1 from public.official_signup_settings s
                  where s.owner_id = p_owner and s.contact_email is not null)
     and coalesce((select s.notify_game_changes from public.official_signup_settings s
                    where s.owner_id = p_owner), true);
$$;

-- A field as the emails show it ("Park — Field", or the field alone).
create or replace function public.official_field_label(p_venue_id uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when loc.name is null then v.name else loc.name || ' — ' || v.name end
    from public.venues v
    left join public.locations loc on loc.id = v.location_id
   where v.id = p_venue_id;
$$;

-- Why this official shouldn't be on this game NOW, or null — only the reasons
-- a move can change: blackout, another game at the same time, availability
-- window, weekly limit. Division, coach and conflict of interest don't change
-- when a game moves. A game that isn't on (official_game_busy) has no problem.
-- THE RULE is official_block_reason (0124); the bookings use 0129's busy rule.
create or replace function public.official_move_problem(p_umpire_id uuid, p_game_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cap      integer;
  v_status   text;
  v_start    timestamp;
  v_settings jsonb;
begin
  select g.status, (g.scheduled_at at time zone 'UTC')::timestamp, d.settings
    into v_status, v_start, v_settings
    from public.games g
    left join public.teams t on t.id = g.home_team_id
    left join public.divisions d on d.id = t.division_id
   where g.id = p_game_id;
  if v_start is null or not public.official_game_busy(v_status) then
    return null;
  end if;
  select u.max_games_per_week into v_cap from public.umpires u where u.id = p_umpire_id;

  return public.official_block_reason(
    false,
    true,
    (select coalesce(array_agg(b.date), '{}'::date[]) from public.official_blackouts b where b.umpire_id = p_umpire_id),
    false,
    false,
    v_start,
    public.official_game_minutes(v_settings),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'start', to_char((g2.scheduled_at at time zone 'UTC')::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
              'minutes', public.official_game_minutes(d2.settings))), '[]'::jsonb)
       from public.game_umpires gu2
       join public.games g2 on g2.id = gu2.game_id
       left join public.teams t2 on t2.id = g2.home_team_id
       left join public.divisions d2 on d2.id = t2.division_id
      where gu2.umpire_id = p_umpire_id and gu2.game_id <> p_game_id and public.official_game_busy(g2.status)),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'day', a.day_of_week, 'start', to_char(a.start_time, 'HH24:MI'), 'end', to_char(a.end_time, 'HH24:MI'))), '[]'::jsonb)
       from public.official_availability a where a.umpire_id = p_umpire_id),
    v_cap
  );
end;
$$;

-- What a game_changes row still has to say, worked out NOW (at take). An
-- entry is dropped when its game has started (league time), when the game is
-- back where it was (same start, field, and on or off), or when the official
-- is no longer on it. A removal is said from its snapshot unless that start
-- has passed. Never another official's name. Ordered by start.
create or replace function public.official_change_entries(p_payload jsonb, p_owner uuid, p_umpire_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with now_ as (
    select public.official_org_now(p_owner) as t
  ), e as (
    select c.key as gu_key, c.value as v
      from jsonb_each(coalesce(p_payload -> 'changes', '{}'::jsonb)) c
  ), removed as (
    select (e.v -> 'removed') || jsonb_build_object('change', 'removed', 'game_umpire_id', e.gu_key) as j
      from e cross join now_
     where e.v ? 'removed'
       and (e.v -> 'removed' ->> 'start')::timestamp > now_.t
  ), changed as (
    select public.official_game_json(g.id, gu.role)
           || jsonb_build_object(
                'change', 'changed',
                'game_umpire_id', gu.id,
                'cancelled', not public.official_game_busy(g.status),
                'was', jsonb_build_object(
                  'start', e.v -> 'was' ->> 'start',
                  'field', public.official_field_label((e.v -> 'was' ->> 'venue_id')::uuid),
                  'cancelled', not public.official_game_busy(e.v -> 'was' ->> 'status')),
                'problem', public.official_move_problem(gu.umpire_id, g.id)) as j
      from e
      cross join now_
      join public.game_umpires gu on gu.id::text = e.gu_key and gu.umpire_id = p_umpire_id
      join public.games g on g.id = gu.game_id
     where not (e.v ? 'removed')
       and (g.scheduled_at at time zone 'UTC')::timestamp > now_.t
       and not (to_char((g.scheduled_at at time zone 'UTC')::timestamp, 'YYYY-MM-DD"T"HH24:MI') = e.v -> 'was' ->> 'start'
                and g.venue_id is not distinct from (e.v -> 'was' ->> 'venue_id')::uuid
                and public.official_game_busy(g.status) = public.official_game_busy(e.v -> 'was' ->> 'status'))
  )
  select coalesce(jsonb_agg(x.j order by x.j ->> 'start', x.j ->> 'game_umpire_id'), '[]'::jsonb)
    from (select j from removed union all select j from changed) x;
$$;

-- What an assignment_conflicts row still has to say, worked out NOW: each
-- assignment still on its game, the game on and not started, and still a
-- problem. For a clash, the official's other game is named too.
create or replace function public.official_conflict_entries(p_payload jsonb, p_owner uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with now_ as (
    select public.official_org_now(p_owner) as t
  ), x as (
    select gu.id as gu_id, gu.umpire_id, gu.role, g.id as game_id, g.scheduled_at, u.name as official_name,
           public.official_move_problem(gu.umpire_id, g.id) as problem
      from jsonb_object_keys(coalesce(p_payload -> 'entries', '{}'::jsonb)) k
      cross join now_
      join public.game_umpires gu on gu.id::text = k
      join public.games g on g.id = gu.game_id
      join public.umpires u on u.id = gu.umpire_id
     where (g.scheduled_at at time zone 'UTC')::timestamp > now_.t
  )
  select coalesce(jsonb_agg(
           public.official_game_json(x.game_id, x.role)
           || jsonb_build_object(
                'game_umpire_id', x.gu_id,
                'official_name', x.official_name,
                'problem', x.problem,
                'other', case when x.problem = 'time_conflict' then (
                  select public.official_game_json(g2.id, gu2.role)
                    from public.game_umpires gu2
                    join public.games g2 on g2.id = gu2.game_id
                    left join public.teams t2 on t2.id = g2.home_team_id
                    left join public.divisions d2 on d2.id = t2.division_id
                    join public.games g on g.id = x.game_id
                    left join public.teams t on t.id = g.home_team_id
                    left join public.divisions d on d.id = t.division_id
                   where gu2.umpire_id = x.umpire_id and gu2.game_id <> x.game_id
                     and public.official_game_busy(g2.status)
                     and g2.scheduled_at < g.scheduled_at + make_interval(mins => public.official_game_minutes(d.settings))
                     and g.scheduled_at < g2.scheduled_at + make_interval(mins => public.official_game_minutes(d2.settings))
                   order by g2.scheduled_at, gu2.id
                   limit 1) end)
           order by x.scheduled_at, x.official_name, x.gu_id), '[]'::jsonb)
    from x
   where x.problem is not null;
$$;

create or replace function public.official_record_failure(p_season_id uuid, p_game_id uuid, p_sqlstate text)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.official_trigger_failures (owner_id, season_id, game_id, trigger_name, error_code)
  select l.owner_id, l.id, p_game_id, 'game_change', coalesce(nullif(p_sqlstate, ''), 'XX000')
    from public.leagues l where l.id = p_season_id;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. A game changed
-- ────────────────────────────────────────────────────────────────────────────
-- One pending row per official (coalesce_key 'changes:<umpire>'): the payload
-- maps each assignment to the FIRST state seen in this window (`was`: start,
-- field, status — ids only), and every change restarts the 10-minute hold,
-- which soaks up "rain out, then set the makeup" in one sitting. The email
-- compares now with `was` when it is taken. Never blocks the edit.
create or replace function public.official_on_game_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_was   jsonb;
begin
  -- record_game_played (0106) records a game already played: nobody is told.
  if current_setting('fieldslate.official_notice_skip', true) = 'on' then
    return null;
  end if;
  if not exists (select 1 from public.game_umpires gu where gu.game_id = new.id) then
    return null;
  end if;

  begin
    select l.owner_id into v_owner from public.leagues l where l.id = new.league_id and l.archived_at is null;
    if v_owner is null or not public.official_notice_on(v_owner) then
      return null;
    end if;
    if (new.scheduled_at at time zone 'UTC')::timestamp <= public.official_org_now(v_owner)
       and (old.scheduled_at at time zone 'UTC')::timestamp <= public.official_org_now(v_owner) then
      return null;
    end if;
    -- Only what an official acts on: a new time, a new field, or the game
    -- going off or back on (0129's rule). A reschedule_pending flip at the
    -- same time and field is not one.
    if new.scheduled_at is not distinct from old.scheduled_at
       and new.venue_id is not distinct from old.venue_id
       and public.official_game_busy(new.status) = public.official_game_busy(old.status) then
      return null;
    end if;

    v_was := jsonb_build_object(
      'start', to_char((old.scheduled_at at time zone 'UTC')::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
      'venue_id', old.venue_id,
      'status', old.status);

    insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload, coalesce_key, next_attempt_at)
    select v_owner, new.league_id, gu.umpire_id, 'game_changes',
           jsonb_build_object('changes', jsonb_build_object(gu.id::text, jsonb_build_object('was', v_was))),
           'changes:' || gu.umpire_id, now() + interval '10 minutes'
      from public.game_umpires gu
     where gu.game_id = new.id
    on conflict (coalesce_key) where status = 'pending' do update
       set payload = jsonb_set(public.official_outbox.payload, '{changes}',
                               (excluded.payload -> 'changes') || coalesce(public.official_outbox.payload -> 'changes', '{}'::jsonb)),
           next_attempt_at = greatest(public.official_outbox.next_attempt_at, excluded.next_attempt_at);

    -- The re-check — never an unassignment. When the game is on and its time
    -- changed, or it came back on (a rainout removed, a makeup set), each
    -- official on it is checked; problems go to the officials contact.
    if public.official_game_busy(new.status)
       and (not public.official_game_busy(old.status) or new.scheduled_at is distinct from old.scheduled_at) then
      insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload, coalesce_key, next_attempt_at)
      select v_owner, new.league_id, null, 'assignment_conflicts',
             jsonb_build_object('entries', jsonb_object_agg(gu.id::text, jsonb_build_object('game_id', new.id))),
             'conflicts:' || new.league_id, now() + interval '10 minutes'
        from public.game_umpires gu
       where gu.game_id = new.id
         and public.official_move_problem(gu.umpire_id, new.id) is not null
      having count(*) > 0
      on conflict (coalesce_key) where status = 'pending' do update
         set payload = jsonb_set(public.official_outbox.payload, '{entries}',
                                 coalesce(public.official_outbox.payload -> 'entries', '{}'::jsonb) || (excluded.payload -> 'entries')),
             next_attempt_at = greatest(public.official_outbox.next_attempt_at, excluded.next_attempt_at);
    end if;
    return null;
  exception when others then
    -- Never block the schedule edit, never fail quietly (the work above is
    -- already rolled back to this block's savepoint).
    perform public.official_record_failure(new.league_id, new.id, sqlstate);
    raise warning 'official_on_game_change: % %', sqlstate, sqlerrm;
    return null;
  end;
end;
$$;

create trigger official_on_game_change
  after update of scheduled_at, venue_id, status on public.games
  for each row
  when (old.scheduled_at is distinct from new.scheduled_at
        or old.venue_id is distinct from new.venue_id
        or old.status is distinct from new.status)
  execute function public.official_on_game_change();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. A game deleted — "taken off this game"
-- ────────────────────────────────────────────────────────────────────────────
-- BEFORE DELETE, so the assignments are still there (game_umpires cascades
-- after). Upcoming games only; the entry carries a snapshot (the game, and
-- maybe its teams, are gone by send time) and replaces any earlier entry for
-- the same assignment — a move then a delete reads as one "Taken off". There
-- is no reattach: a regenerate's new games have no officials. NOT swallowed.
create or replace function public.official_on_game_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if not exists (select 1 from public.game_umpires gu where gu.game_id = old.id) then
    return old;
  end if;
  -- An archived season (a season delete needs one) has no officials mail.
  select l.owner_id into v_owner from public.leagues l where l.id = old.league_id and l.archived_at is null;
  if v_owner is null or not public.official_notice_on(v_owner) then
    return old;
  end if;
  if (old.scheduled_at at time zone 'UTC')::timestamp <= public.official_org_now(v_owner) then
    return old;
  end if;

  insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload, coalesce_key, next_attempt_at)
  select v_owner, old.league_id, gu.umpire_id, 'game_changes',
         jsonb_build_object('changes', jsonb_build_object(gu.id::text,
           jsonb_build_object('removed', public.official_game_json(old.id, gu.role) - 'game_id'))),
         'changes:' || gu.umpire_id, now() + interval '10 minutes'
    from public.game_umpires gu
   where gu.game_id = old.id
  on conflict (coalesce_key) where status = 'pending' do update
     set payload = jsonb_set(public.official_outbox.payload, '{changes}',
                             coalesce(public.official_outbox.payload -> 'changes', '{}'::jsonb) || (excluded.payload -> 'changes')),
         next_attempt_at = greatest(public.official_outbox.next_attempt_at, excluded.next_attempt_at);
  return old;
end;
$$;

create trigger official_on_game_delete
  before delete on public.games
  for each row
  execute function public.official_on_game_delete();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. record_game_played — 0106 verbatim plus the two skip lines
-- ────────────────────────────────────────────────────────────────────────────
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

  -- 0130: a correction records a game already played — no official is
  -- emailed about it. Transaction-local (is_local = true) and reset right
  -- after the one UPDATE, so nothing later in the transaction is skipped.
  perform set_config('fieldslate.official_notice_skip', 'on', true);

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

  perform set_config('fieldslate.official_notice_skip', '', true);

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

-- ────────────────────────────────────────────────────────────────────────────
-- 6. The take — 0124 verbatim plus the game-change kinds
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.official_outbox_take(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 100);
  v_rows  jsonb;
begin
  -- A drain that died mid-send: due again after 10 minutes (the send's
  -- idempotency key stops a second delivery).
  update public.official_outbox set status = 'pending', locked_at = null
   where status = 'sending' and locked_at < now() - interval '10 minutes';

  -- Rows that must not be sent fail, visibly.
  update public.official_outbox o set status = 'failed', error = 'feature_off', payload = o.payload - 'token'
   where o.status = 'pending' and not public.org_feature_on(o.owner_id, 'official_signup');
  update public.official_outbox o set status = 'failed', error = 'no_contact_email', payload = o.payload - 'token'
   where o.status = 'pending'
     and not exists (select 1 from public.official_signup_settings s
                      where s.owner_id = o.owner_id and s.contact_email is not null);

  -- 0130: game-change notices. Queued before a gate went off (Elite, the
  -- league's setting): superseded. Nothing left to say when due (every game
  -- started, back where it was, or no longer theirs; no clash left):
  -- superseded. An official with no email: failed, so the banner lists them.
  update public.official_outbox o set status = 'superseded', error = 'notify_off'
   where o.status = 'pending' and o.kind in ('game_changes', 'assignment_conflicts')
     and not public.official_notice_on(o.owner_id);
  update public.official_outbox o set status = 'superseded', error = 'no_net_change'
   where o.status = 'pending' and o.next_attempt_at <= now() and o.kind = 'game_changes'
     and jsonb_array_length(public.official_change_entries(o.payload, o.owner_id, o.umpire_id)) = 0;
  update public.official_outbox o set status = 'superseded', error = 'no_conflicts'
   where o.status = 'pending' and o.next_attempt_at <= now() and o.kind = 'assignment_conflicts'
     and jsonb_array_length(public.official_conflict_entries(o.payload, o.owner_id)) = 0;
  update public.official_outbox o set status = 'failed', error = 'no_email'
   where o.status = 'pending' and o.next_attempt_at <= now() and o.kind = 'game_changes'
     and not exists (select 1 from public.umpires u
                      where u.id = o.umpire_id and nullif(btrim(coalesce(u.email, '')), '') is not null);

  with due as (
    select o.id from public.official_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
     order by o.next_attempt_at, o.id
     limit v_limit
       for update skip locked
  ), took as (
    update public.official_outbox o
       set status = 'sending', locked_at = now(), attempts = o.attempts + 1
      from due where o.id = due.id
    returning o.id, o.owner_id, o.season_id, o.umpire_id, o.kind, o.payload, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'kind', t.kind,
           'payload', t.payload - 'token',
           'attempts', t.attempts,
           'to', case when t.kind in ('drop_notice', 'claims_digest', 'assignment_conflicts') then s.contact_email else btrim(u.email) end,
           'league_name', p.org_name,
           'reply_to', s.contact_email,
           'season_name', l.name,
           'official_name', u.name,
           'youth', coalesce(u.designation = 'youth', false),
           'link_token', t.payload ->> 'token',
           'game', case when t.kind in ('claim_confirmed', 'drop_confirmed', 'drop_notice')
                        then public.official_game_json((t.payload ->> 'game_id')::uuid, t.payload ->> 'role') end,
           'spots', case when t.kind = 'help_request' then (
                      select coalesce(jsonb_agg(sp order by sp ->> 'start'), '[]'::jsonb)
                        from (select sp from jsonb_array_elements(public.official_open_spots(t.umpire_id)) sp
                               where sp -> 'problem' = 'null'::jsonb
                               order by sp ->> 'start' limit 20) q) end,
           'claims', case when t.kind = 'claims_digest' then (
                       select coalesce(jsonb_agg(public.official_game_json(gu.game_id, gu.role)
                                                 || jsonb_build_object('official_name', uu.name)
                                                 order by g.scheduled_at, uu.name), '[]'::jsonb)
                         from public.game_umpires gu
                         join public.games g on g.id = gu.game_id
                         join public.umpires uu on uu.id = gu.umpire_id
                        where gu.id in (select (jsonb_array_elements_text(t.payload -> 'claim_ids'))::uuid)) end,
           'changes', case when t.kind = 'game_changes'
                           then public.official_change_entries(t.payload, t.owner_id, t.umpire_id) end,
           'conflicts', case when t.kind = 'assignment_conflicts'
                             then public.official_conflict_entries(t.payload, t.owner_id) end
         ) order by t.id), '[]'::jsonb)
    into v_rows
    from took t
    join public.profiles p on p.id = t.owner_id
    join public.leagues l on l.id = t.season_id
    left join public.umpires u on u.id = t.umpire_id
    left join public.official_signup_settings s on s.owner_id = t.owner_id;

  return v_rows;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. The officials email banner — 0128 verbatim plus trigger failures
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.official_email_problems(p_season_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  v_owner := public.official_signup_gate(p_season_id, false);
  return jsonb_build_object(
    'timezone', (select p.timezone from public.profiles p where p.id = v_owner),
    'failed', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id,
               'kind', o.kind,
               'error', o.error,
               'at', o.created_at,
               'official_name', u.name,
               'to_contact', o.kind in ('drop_notice', 'claims_digest', 'assignment_conflicts'),
               'game', case when o.payload ? 'game_id'
                            then public.official_game_json((o.payload ->> 'game_id')::uuid, o.payload ->> 'role') end
             ) order by o.created_at desc, o.id desc), '[]'::jsonb)
        from public.official_outbox o
        left join public.umpires u on u.id = o.umpire_id
       where o.season_id = p_season_id and o.status = 'failed' and o.acknowledged_at is null),
    'waiting', (
      select jsonb_build_object(
               'count', count(*),
               'reason', case when bool_or(o.error = 'quota_monthly') then 'quota_monthly' else 'quota_daily' end,
               'until', max(o.next_attempt_at))
        from public.official_outbox o
       where o.season_id = p_season_id and o.status = 'pending'
         and o.error in ('quota_daily', 'quota_monthly')),
    'trigger_failures', (
      select count(*) from public.official_trigger_failures f
       where f.season_id = p_season_id and f.acknowledged_at is null)
  );
end;
$$;

create or replace function public.official_email_problems_ack(p_season_id uuid, p_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
  v_f integer;
begin
  perform public.official_signup_gate(p_season_id, true);
  update public.official_outbox
     set acknowledged_at = now()
   where season_id = p_season_id and status = 'failed' and acknowledged_at is null
     and id = any (coalesce(p_ids, '{}'::bigint[]));
  get diagnostics v_n = row_count;
  -- 0130: the trigger failures are shown as one count, so they are marked
  -- seen together.
  update public.official_trigger_failures
     set acknowledged_at = now()
   where season_id = p_season_id and acknowledged_at is null;
  get diagnostics v_f = row_count;
  return jsonb_build_object('acknowledged', v_n, 'trigger_failures', v_f);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. The league's switch (Settings) and what the Officials page says
-- ────────────────────────────────────────────────────────────────────────────
-- Whether officials are emailed when games change, and if not, why. Members.
create or replace function public.official_notice_state(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan    text;
  v_contact text;
  v_notify  boolean;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  select s.contact_email, s.notify_game_changes into v_contact, v_notify
    from public.official_signup_settings s where s.owner_id = p_org_id;
  return jsonb_build_object(
    'elite', coalesce(v_plan = 'elite', false),
    'feature', public.org_feature_on(p_org_id, 'official_signup'),
    'contact_confirmed', v_contact is not null,
    'notify', coalesce(v_notify, true),
    'on', public.official_notice_on(p_org_id));
end;
$$;

-- The Settings toggle. Its proposed row passes every CHECK on its own (the
-- 0125 rule): enabled defaults false, so contact_when_on holds.
create or replace function public.set_official_notify_game_changes(p_org_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(p_org_id, 'official_signup') then raise exception 'feature_off' using errcode = 'P0001'; end if;
  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is distinct from 'elite' then raise exception 'plan_required' using errcode = 'P0001'; end if;
  if p_on is null then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  insert into public.official_signup_settings (owner_id, notify_game_changes, updated_by)
  values (p_org_id, p_on, auth.uid())
  on conflict (owner_id) do update
     set notify_game_changes = excluded.notify_game_changes, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('notify', p_on);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Privileges (revoke from PUBLIC, then grant back — the house rule)
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.official_notice_on(uuid)                         from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_field_label(uuid)                       from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_move_problem(uuid, uuid)                from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_change_entries(jsonb, uuid, uuid)       from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_conflict_entries(jsonb, uuid)           from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_record_failure(uuid, uuid, text)        from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_on_game_change()                        from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_on_game_delete()                        from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.record_game_played(uuid, text, uuid, text)       from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_outbox_take(integer)                    from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_email_problems(uuid)                    from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_email_problems_ack(uuid, bigint[])      from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_notice_state(uuid)                      from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_official_notify_game_changes(uuid, boolean)  from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.record_game_played(uuid, text, uuid, text)      to authenticated;
grant execute on function public.official_outbox_take(integer)                   to service_role;
grant execute on function public.official_email_problems(uuid)                   to authenticated;
grant execute on function public.official_email_problems_ack(uuid, bigint[])     to authenticated;
grant execute on function public.official_notice_state(uuid)                     to authenticated;
grant execute on function public.set_official_notify_game_changes(uuid, boolean) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Verify, or the whole migration rolls back
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  f text;
  r text;
  v_none text[] := array[
    'public.official_notice_on(uuid)', 'public.official_field_label(uuid)',
    'public.official_move_problem(uuid, uuid)', 'public.official_change_entries(jsonb, uuid, uuid)',
    'public.official_conflict_entries(jsonb, uuid)', 'public.official_record_failure(uuid, uuid, text)',
    'public.official_on_game_change()', 'public.official_on_game_delete()'];
  v_auth text[] := array[
    'public.record_game_played(uuid, text, uuid, text)', 'public.official_email_problems(uuid)',
    'public.official_email_problems_ack(uuid, bigint[])', 'public.official_notice_state(uuid)',
    'public.set_official_notify_game_changes(uuid, boolean)'];
begin
  foreach f in array v_none || v_auth || array['public.official_outbox_take(integer)'] loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0130 verify: PUBLIC can execute %', f;
    end if;
    foreach r in array array['anon', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception '0130 verify: % can execute %', r, f; end if;
    end loop;
  end loop;
  foreach f in array v_none loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0130 verify: % must be callable by no role', f;
    end if;
  end loop;
  foreach f in array v_auth loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0130 verify: % must be authenticated only', f;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.official_outbox_take(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.official_outbox_take(integer)', 'EXECUTE') then
    raise exception '0130 verify: official_outbox_take must be service_role only';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.official_on_game_change()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.official_on_game_delete()'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.official_move_problem(uuid, uuid)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.official_notice_on(uuid)'::regprocedure) then
    raise exception '0130 verify: triggers DEFINER, helpers INVOKER';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.games'::regclass and not tgisinternal
         and tgname in ('official_on_game_change', 'official_on_game_delete') and tgenabled = 'O') <> 2 then
    raise exception '0130 verify: both games triggers present and enabled';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('official_outbox_take', 'record_game_played', 'official_email_problems',
                               'official_email_problems_ack', 'official_move_problem')
             group by proname having count(*) > 1) then
    raise exception '0130 verify: an overload was left behind';
  end if;
end $v$;

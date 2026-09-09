-- Occupancy context for the three interleague reschedule routes.
--
-- THE PROBLEM. Three server routes write a game's new time after gating only
-- the VENUE'S HOURS (gateRescheduleVenue -> get_game_venue_context_for_gate).
-- None of them checks whether the field is already TAKEN at that time, so any
-- of them can drop a game straight on top of an existing one:
--   src/app/api/interleague/games/[id]/resolve/route.ts        (authenticated)
--   src/app/api/interleague/reschedule/[id]/respond/route.ts   (authenticated)
--   src/app/api/reschedule/[token]/respond/route.ts            (ANONYMOUS)
--
-- WHY THIS IS AN RPC AT ALL. The token route serves a partner league that is
-- not authenticated as an org member. `anon` has NO table-level grant on
-- `games`, `venues` or `divisions` — a direct read raises 42501 (verified
-- against the live catalog), not an empty result. So the token path cannot
-- compute occupancy without a security-definer read. The two authenticated
-- routes could read `games` under RLS, but they call the same functions here
-- so all three paths share ONE occupancy source and cannot drift.
--
-- THESE FUNCTIONS EMIT; THEY DO NOT DECIDE. The overlap predicate stays in
-- TypeScript (candidateClearsSpan / spansOverlap in
-- src/lib/schedule/reschedule-slots.ts) — the same code the reschedule picker
-- runs. Re-implementing half-open overlap + arriving-team buffer in SQL would
-- be a SECOND model of venue collision in a codebase that already has eleven,
-- and the two would drift silently. Same split as
-- get_game_venue_context_for_gate (emits venue rows) + gateVenueProposal
-- (decides), and the same rule the 0087 location work followed.
--
-- DURATION IS EMITTED AS A PROJECTED KEY, NEVER AS `settings`. divisions.settings
-- also holds the division's full teams[] array with coach metadata; emitting it
-- per occupied game would ship that blob once per row (the +479KB trap recorded
-- in CLAUDE.md for the Schedule page's games query). Only
-- settings->'game_duration' and settings->'buffer_minutes' cross the wire, and
-- TypeScript applies the fallback policy via the picker's own
-- durationFromSettings — so no sixteenth duration model is created here.
--
-- ── Why TWO functions and not one with a nullable token ──────────────────────
--
-- The token variant takes ONLY the token. It derives BOTH the game id and the
-- time being checked from the request row, so an anonymous caller cannot name a
-- game at all. A single function with a nullable p_token would still have to
-- accept a caller-supplied p_game_id on the token path in order to validate it
-- against the token — reintroducing exactly the parameter that makes venue
-- enumeration possible, and leaving the "did I remember to compare them"
-- check as the only thing standing between anon and another org's schedule.
-- Deriving is strictly stronger than comparing. The two functions also carry
-- different gates (org membership vs token) and different grants
-- (authenticated vs authenticated+anon), so splitting them keeps each grant
-- as narrow as its gate.
--
-- ── The token gate RAISES; it must never return an empty set ─────────────────
--
-- This codebase has two token-RPC conventions:
--   * READ-ONLY lookups (get_reschedule_request_by_token,
--     get_interleague_schedule_by_token, get_interleague_invite_by_token)
--     `return null` when the token does not resolve.
--   * MUTATING responders (accept_/decline_/counter_reschedule_request_by_token)
--     `raise exception ... using errcode = 'P0001'`.
-- This function is read-only in shape but it is an AUTHORIZATION GATE, and an
-- empty occupancy list reads downstream as "the field is free". Returning null
-- or an empty array on a bad token would fail OPEN — worse than having no gate,
-- because the caller would be told the slot is clear. It therefore follows the
-- MUTATING convention and raises, deliberately against its own read-only shape.
--
-- ── Scope of the occupancy read ─────────────────────────────────────────────
--
-- DATE-BOUNDED, NEVER LEAGUE-BOUNDED. Occupancy is same-date-keyed, so the
-- target date is a sufficient superset. Filtering by league_id would HIDE a
-- concurrent season's game at the same field on the same date — a game that
-- genuinely occupies it. Only one league currently uses these venues, so that
-- bug would be invisible today and wrong later. Same reasoning as
-- occupancyWindow() in reschedule-slots.ts.
--
-- SELF-EXCLUSION IS IN THE WHERE CLAUSE (`g.id <> v_game_id`), not applied by
-- the caller afterwards. A game must never be found to conflict with itself,
-- and doing it server-side means no caller can forget.
--
-- Cancelled games are excluded (they hold no field). pending_interleague games
-- are INCLUDED — a proposed game genuinely occupies the field, which is the
-- same call the week-by-field grid and the picker's occupancy read both make.
--
-- Row-cap note: these return a jsonb scalar, so PostgREST's silent 1000-row cap
-- does not apply (it caps table reads, not a function's json return).

-- ── Shared shape ────────────────────────────────────────────────────────────
--
--   {
--     "game_id":      uuid,
--     "venue_id":     uuid | null,   -- null => no field to contend for; skip
--     "venue_name":   text | null,
--     "scheduled_at": "YYYY-MM-DDTHH:MM:SS",   -- the time being checked
--     "game_duration":  numeric | null,  -- moving game's own division
--     "buffer_minutes": numeric | null,  -- moving game's own division
--     "occupied": [
--       { "game_id": uuid,
--         "scheduled_at": "YYYY-MM-DDTHH:MM:SS",
--         "game_duration": numeric | null,     -- THAT game's own division
--         "label": text }                      -- for the plain-English message
--     ]
--   }
--
-- Times are emitted as UTC wall-clock ISO text, NOT as timestamptz. `games`
-- rows store the admin's intended wall clock tagged +00, and every comparison
-- downstream is on the DATE and TIME SUBSTRINGS (the house convention — see
-- game-days.ts's header). Emitting a bare timestamptz would render in the
-- database's configured zone and silently shift the substring.

-- ── Internal: build the payload once, shared by both entry points ───────────
create or replace function public.build_game_occupancy_context(
  p_game_id uuid,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_game       public.games%rowtype;
  v_venue_name text;
  v_duration   numeric;
  v_buffer     numeric;
  v_target_day date;
  v_occupied   jsonb;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found then
    return null;
  end if;

  -- The moving game's own division supplies BOTH numbers: its span length and
  -- the separation it requires around itself. The buffer belongs to the
  -- ARRIVING team — see candidateClearsSpan's header for why it is not the
  -- existing game's and not max() of the two.
  select (d.settings->>'game_duration')::numeric,
         (d.settings->>'buffer_minutes')::numeric
  into v_duration, v_buffer
  from public.teams t
  join public.divisions d on d.id = t.division_id
  where t.id = v_game.home_team_id;

  if v_game.venue_id is not null then
    select v.name into v_venue_name
    from public.venues v where v.id = v_game.venue_id;
  end if;

  v_target_day := (p_scheduled_at at time zone 'UTC')::date;

  -- Only look for neighbours when there is actually a field to contend for.
  -- Keyed on venue_id being present, NOT on is_away: those coincide on every
  -- live row today, but the condition that makes occupancy meaningless is the
  -- ABSENT VENUE. Keying on is_away would silently skip a game that has a real
  -- field the day the two diverge.
  if v_game.venue_id is null then
    v_occupied := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'game_id', x.id,
               'scheduled_at', to_char(x.scheduled_at at time zone 'UTC',
                                       'YYYY-MM-DD"T"HH24:MI:SS'),
               'game_duration', x.game_duration,
               'label', x.label
             ) order by x.scheduled_at, x.id
           ), '[]'::jsonb)
    into v_occupied
    from (
      select g.id,
             g.scheduled_at,
             (d.settings->>'game_duration')::numeric as game_duration,
             coalesce(ht.name, 'A game')
               || case
                    when at.name is not null then ' vs ' || at.name
                    when g.external_team_name is not null
                      then ' vs ' || g.external_team_name
                    else ''
                  end as label
        from public.games g
        left join public.teams ht on ht.id = g.home_team_id
        left join public.teams at on at.id = g.away_team_id
        left join public.divisions d on d.id = ht.division_id
       where g.venue_id = v_game.venue_id
         and g.id <> v_game.id            -- self-exclusion, server-side
         and g.status <> 'cancelled'
         and (g.scheduled_at at time zone 'UTC')::date = v_target_day
    ) x;
  end if;

  return jsonb_build_object(
    'game_id',        v_game.id,
    'venue_id',       v_game.venue_id,
    'venue_name',     v_venue_name,
    'scheduled_at',   to_char(p_scheduled_at at time zone 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS'),
    'game_duration',  v_duration,
    'buffer_minutes', v_buffer,
    'occupied',       v_occupied
  );
end;
$$;

-- Internal helper only: both public entry points gate BEFORE calling it, so it
-- must not be independently reachable.
revoke all on function public.build_game_occupancy_context(uuid, timestamptz) from public;
revoke all on function public.build_game_occupancy_context(uuid, timestamptz) from anon;
revoke all on function public.build_game_occupancy_context(uuid, timestamptz) from authenticated;

-- ── Authenticated entry point ───────────────────────────────────────────────
-- Gate: org membership on the game's league, the same gate every other
-- authenticated guard in the 0078/0079/0081/0084 family uses.
create or replace function public.get_game_occupancy_context(
  p_game_id uuid,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select l.owner_id into v_owner_id
  from public.games g
  join public.leagues l on l.id = g.league_id
  where g.id = p_game_id;

  if v_owner_id is null then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  return public.build_game_occupancy_context(p_game_id, p_scheduled_at);
end;
$$;

revoke all on function public.get_game_occupancy_context(uuid, timestamptz) from public;
revoke all on function public.get_game_occupancy_context(uuid, timestamptz) from anon;
grant execute on function public.get_game_occupancy_context(uuid, timestamptz) to authenticated;

-- ── Token entry point ───────────────────────────────────────────────────────
-- Gate: the reschedule token itself, resolved exactly the way
-- accept_reschedule_request_by_token resolves it. The caller supplies NOTHING
-- but the token: the game id and the time being checked are both read off the
-- request row, so there is no caller-supplied game id to enumerate with and
-- nothing to compare.
create or replace function public.get_reschedule_occupancy_by_token(
  p_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req public.interleague_reschedule_requests%rowtype;
begin
  select * into v_req
  from public.interleague_reschedule_requests
  where token = p_token;

  -- RAISE, never `return null` / empty. See the header: an empty occupancy set
  -- reads downstream as "the field is free", so a soft failure here would fail
  -- OPEN on a bad token.
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = 'P0001';
  end if;
  if v_req.proposed_scheduled_at is null then
    raise exception 'invalid_proposal' using errcode = 'P0001';
  end if;

  return public.build_game_occupancy_context(
    v_req.game_id,
    v_req.proposed_scheduled_at
  );
end;
$$;

revoke all on function public.get_reschedule_occupancy_by_token(text) from public;
grant execute on function public.get_reschedule_occupancy_by_token(text) to anon;
grant execute on function public.get_reschedule_occupancy_by_token(text) to authenticated;

-- 0129 — One rule for "is this official busy?" (2026-11-10, branch
-- fix/official-busy-rule). Plan: docs/plans/game-change-followthrough.md,
-- "Step 1 — the cancelled-game busy rule".
--
-- THE RULE (decided 2026-11-10): an official is busy for a game unless the
-- game is `cancelled` (rained out) or `postponed`. A BLOCKLIST, so a status
-- added to games later counts as busy by default, and a null status is busy
-- (a wrongly busy official is a warning; a wrongly free one is double-booked).
-- Before 0129 five places decided this, three ways: the database and
-- auto-assign skipped cancelled games only; the manual save check, the assign
-- picker and record-where-played counted every game, cancelled included.
--
-- WHAT IT ADDS
--   1. official_game_busy(status) — the ONE rule. Immutable, callable by no
--      role; the SECURITY DEFINER functions reach it as their owner.
--   2. official_slot_problem — re-created VERBATIM from 0124 with only its
--      bookings filter swapped (`g2.status <> 'cancelled'` →
--      `public.official_game_busy(g2.status)`). It serves the sign-up page's
--      open spots, claims and insert_official_assignments (auto-assign's
--      write re-check): overlap AND the weekly limit.
--   3. official_bookings(season, umpire ids) — the app's ONE read of
--      officials' busy games (the manual save check, both assign-picker
--      rosters, record-where-played and auto-assign call it; none keeps a
--      status test). SECURITY DEFINER; the caller must be an owner or admin
--      of the season's org — checked by ROLE, not just membership, so a
--      non-admin member role added later can't read it by default (today
--      organization_members.role is CHECKed to owner/admin; verified
--      2026-11-10: owner 23, admin 3). NOT plan-gated: assigning officials
--      from the schedule is open to every plan. Only the season's officials;
--      busy games only. EXECUTE authenticated only.
--
-- NOT CHANGED, by decision: the sign-up page's "my games" list
-- (official_signup_page, `g.status <> 'cancelled'`) — a display list.
--
-- LOCKS when applied: none on any table (CREATE OR REPLACE FUNCTION takes
-- only the function's catalog row).
--
-- Deploy order: apply 0129 BEFORE the code reaches main — the app calls
-- official_bookings.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The rule
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.official_game_busy(p_status text)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  -- THE rule: busy unless cancelled (rained out) or postponed. A blocklist —
  -- any other status, a new one or null, is busy.
  select p_status is null or p_status not in ('cancelled', 'postponed');
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. official_slot_problem — 0124's body with the bookings filter swapped
-- ────────────────────────────────────────────────────────────────────────────
-- Why this official can't take `p_role` on this game, or null. With
-- p_claim = true (a link claim) it also requires: a scheduled game that has
-- not started, a LOCKED division, and one of the division's real slots.
create or replace function public.official_slot_problem(
  p_umpire_id uuid,
  p_game_id   uuid,
  p_role      text,
  p_claim     boolean
)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_season    uuid;
  v_team      uuid;
  v_cap       integer;
  v_g_league  uuid;
  v_status    text;
  v_home      uuid;
  v_away      uuid;
  v_start     timestamp;
  v_div       uuid;
  v_locked    boolean;
  v_needed    integer;
  v_settings  jsonb;
  v_owner     uuid;
  v_minutes   integer;
begin
  select u.season_id, u.team_id, u.max_games_per_week into v_season, v_team, v_cap
    from public.umpires u where u.id = p_umpire_id;
  if v_season is null then return 'no_official'; end if;

  select g.league_id, g.status, g.home_team_id, g.away_team_id,
         (g.scheduled_at at time zone 'UTC')::timestamp, t.division_id
    into v_g_league, v_status, v_home, v_away, v_start, v_div
    from public.games g left join public.teams t on t.id = g.home_team_id
   where g.id = p_game_id;
  if v_g_league is null or v_g_league <> v_season then return 'no_game'; end if;

  select d.locked, d.umpires_per_game, d.settings into v_locked, v_needed, v_settings
    from public.divisions d where d.id = v_div;
  if v_div is null or coalesce(v_needed, 0) = 0 then return 'no_slot'; end if;

  if coalesce(p_claim, false) then
    select l.owner_id into v_owner from public.leagues l where l.id = v_season;
    if v_status <> 'scheduled' then return 'not_open'; end if;
    if v_start <= public.official_org_now(v_owner) then return 'started'; end if;
    if not coalesce(v_locked, false) then return 'unpublished'; end if;
    if not exists (select 1 from public.official_division_slots(v_season, v_needed) s where s.role_name = p_role) then
      return 'no_slot';
    end if;
  end if;

  if exists (select 1 from public.game_umpires gu where gu.game_id = p_game_id and gu.role = p_role)
     or (select count(*) from public.game_umpires gu where gu.game_id = p_game_id) >= v_needed then
    return 'slot_taken';
  end if;

  v_minutes := public.official_game_minutes(v_settings);

  return public.official_block_reason(
    exists (select 1 from public.game_umpires gu where gu.game_id = p_game_id and gu.umpire_id = p_umpire_id),
    not exists (select 1 from public.official_divisions od where od.umpire_id = p_umpire_id)
      or exists (select 1 from public.official_divisions od where od.umpire_id = p_umpire_id and od.division_id = v_div),
    (select coalesce(array_agg(b.date), '{}'::date[]) from public.official_blackouts b where b.umpire_id = p_umpire_id),
    v_team is not null and (v_team = v_home or v_team = v_away),
    exists (select 1 from public.official_conflicts c
             where c.umpire_id = p_umpire_id and (c.team_id = v_home or (v_away is not null and c.team_id = v_away))),
    v_start,
    v_minutes,
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

-- ────────────────────────────────────────────────────────────────────────────
-- 3. The app's one read of officials' busy games
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.official_bookings(p_season_id uuid, p_umpire_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select l.owner_id into v_owner from public.leagues l where l.id = p_season_id;
  if v_owner is null then
    raise exception 'season_not_found' using errcode = 'P0002';
  end if;
  -- Owners and admins only, by role (not just membership).
  if not exists (select 1 from public.organization_members m
                  where m.org_id = v_owner and m.user_id = auth.uid() and m.role in ('owner', 'admin')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'game_umpire_id', gu.id,
             'umpire_id', gu.umpire_id,
             'game_id', g.id,
             -- As stored, in UTC with an explicit offset: the app reads the
             -- wall clock from this string (eligibility.ts), never a zone.
             'scheduled_at', to_char(g.scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00',
             'minutes', public.official_game_minutes(d.settings),
             'home', ht.name,
             'away', at.name
           ) order by gu.umpire_id, g.scheduled_at, gu.id), '[]'::jsonb)
      from public.game_umpires gu
      join public.umpires u on u.id = gu.umpire_id and u.season_id = p_season_id
      join public.games g on g.id = gu.game_id
      left join public.teams ht on ht.id = g.home_team_id
      left join public.teams at on at.id = g.away_team_id
      left join public.divisions d on d.id = ht.division_id
     where gu.umpire_id = any (coalesce(p_umpire_ids, '{}'::uuid[]))
       and public.official_game_busy(g.status)
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Privileges (revoke from PUBLIC, then grant back — the house rule)
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.official_game_busy(text)                  from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_slot_problem(uuid, uuid, text, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_bookings(uuid, uuid[])           from public, anon, authenticated, service_role, dashboard_readonly;
grant  execute on function public.official_bookings(uuid, uuid[])           to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Verify, or the whole migration rolls back
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  f text;
  r text;
begin
  if public.official_game_busy('cancelled') or public.official_game_busy('postponed')
     or not public.official_game_busy('scheduled') or not public.official_game_busy('reschedule_pending')
     or not public.official_game_busy('pending_interleague') or not public.official_game_busy('completed')
     or not public.official_game_busy('in_progress') or not public.official_game_busy('zz_new_status')
     or not public.official_game_busy(null) then
    raise exception '0129 verify: official_game_busy must be busy unless cancelled or postponed';
  end if;
  if exists (select 1 from pg_proc where oid = 'public.official_game_busy(text)'::regprocedure and (prosecdef or provolatile <> 'i'))
     or (select prosecdef from pg_proc where oid = 'public.official_slot_problem(uuid, uuid, text, boolean)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.official_bookings(uuid, uuid[])'::regprocedure) then
    raise exception '0129 verify: busy and slot_problem INVOKER, bookings DEFINER';
  end if;
  foreach f in array array['public.official_game_busy(text)', 'public.official_slot_problem(uuid, uuid, text, boolean)',
                           'public.official_bookings(uuid, uuid[])'] loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0129 verify: PUBLIC can execute %', f;
    end if;
    foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0129 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;
  if has_function_privilege('authenticated', 'public.official_game_busy(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.official_slot_problem(uuid, uuid, text, boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.official_bookings(uuid, uuid[])', 'EXECUTE') then
    raise exception '0129 verify: only official_bookings is callable, by authenticated';
  end if;
end $v$;

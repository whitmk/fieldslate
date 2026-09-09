-- SQL-level harness for migration 0088's occupancy-context RPCs.
--
-- WHY SQL AND NOT `npm run sim:*` (CLAUDE.md "Harness standard — SQL-level
-- exceptions"): the guarantees under test here are enforced by Postgres, not by
-- TypeScript — a WHERE clause (self-exclusion), a raise (the token gate), a
-- grant, and a date predicate. `scripts/sim/fake-supabase.ts` cannot simulate
-- any of them, and `service_role` has no DML on `games`/`teams`/`divisions`/
-- `leagues`, so a tsx harness 42501s on its first write. This is NOT
-- `npm run`-able and does NOT run in CI. That is a real gap versus the
-- officials/round-order sims; it is stated rather than papered over.
--
-- SPLIT OF RESPONSIBILITY. The DECISION (overlap, arriving-team buffer,
-- per-game durations, venue-null skip, fail-closed, message) is proven by
-- `npm run sim:occupancy-gate`, which drives the real TypeScript gate. THIS
-- file proves only what SQL owns. Neither is sufficient alone.
--
-- HOW TO RUN: paste the whole file into the Supabase MCP / SQL editor as ONE
-- statement batch. It is transactional and ALWAYS ends in a raise, so it can
-- never commit. Follow it with a leak check that the scratch rows are gone.
--
-- The functions are created inside the transaction from the SAME bodies as
-- migration 0088, so a run proves the migration's text, not a paraphrase.

do $harness$
declare
  -- scratch ids, all namespaced so a leak check can find them
  v_owner   uuid;
  v_league  uuid := gen_random_uuid();
  v_div     uuid := gen_random_uuid();
  v_team_a  uuid := gen_random_uuid();
  v_team_b  uuid := gen_random_uuid();
  v_venue   uuid := gen_random_uuid();
  v_moving  uuid := gen_random_uuid();
  v_neigh   uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_nextday uuid := gen_random_uuid();
  v_cancel  uuid := gen_random_uuid();
  v_novenue uuid := gen_random_uuid();
  v_req     uuid := gen_random_uuid();
  v_req2    uuid := gen_random_uuid();
  v_tok     text := 'HARNESS-TOKEN-OK';
  v_tok_bad text := 'HARNESS-TOKEN-NOPE';
  v_tok_done text := 'HARNESS-TOKEN-ACCEPTED';
  j         jsonb;
  n         int;
  out       text := '';
  fails     int := 0;
  -- anti-vacuity counters: a ZERO here fails the run
  c_self_excluded      int := 0;
  c_neighbour_returned int := 0;
  c_token_rejected     int := 0;
  c_venue_null_empty   int := 0;
  c_date_scoped        int := 0;
  c_cancelled_excluded int := 0;
  c_builder_sealed     int := 0;
begin
  ---------------------------------------------------------------- fixtures
  select id into v_owner from profiles order by created_at limit 1;

  insert into leagues(id, owner_id, name, sport, season, start_date, end_date)
    values (v_league, v_owner, 'HARNESS-0088', 'baseball', 'HARNESS',
            '2026-09-01', '2026-10-31');
  insert into divisions(id, league_id, name, settings)
    values (v_div, v_league, 'HARNESS-DIV',
            jsonb_build_object('game_duration', 105, 'buffer_minutes', 30));
  insert into teams(id, league_id, division_id, name)
    values (v_team_a, v_league, v_div, 'HARNESS-A'),
           (v_team_b, v_league, v_div, 'HARNESS-B');
  insert into venues(id, owner_id, name, availability, availability_configured)
    values (v_venue, v_owner, 'HARNESS-FIELD', '{}'::jsonb, true);

  -- The game being moved: 15:00 on 2026-09-12 at HARNESS-FIELD.
  insert into games(id, league_id, home_team_id, away_team_id, venue_id,
                    scheduled_at, status)
    values (v_moving, v_league, v_team_a, v_team_b, v_venue,
            '2026-09-12T15:00:00+00', 'scheduled');
  -- A neighbour at the same field, same day — must be RETURNED.
  insert into games(id, league_id, home_team_id, away_team_id, venue_id,
                    scheduled_at, status)
    values (v_neigh, v_league, v_team_b, v_team_a, v_venue,
            '2026-09-12T13:00:00+00', 'scheduled');
  -- Same field, DIFFERENT day — must NOT be returned (date scoping).
  insert into games(id, league_id, home_team_id, away_team_id, venue_id,
                    scheduled_at, status)
    values (v_nextday, v_league, v_team_b, v_team_a, v_venue,
            '2026-09-13T13:00:00+00', 'scheduled');
  -- Same field, same day, CANCELLED — must NOT be returned.
  insert into games(id, league_id, home_team_id, away_team_id, venue_id,
                    scheduled_at, status)
    values (v_cancel, v_league, v_team_b, v_team_a, v_venue,
            '2026-09-12T09:00:00+00', 'cancelled');
  -- A game with NO venue — the venue-null branch.
  insert into games(id, league_id, home_team_id, away_team_id, venue_id,
                    scheduled_at, status)
    values (v_novenue, v_league, v_team_a, v_team_b, null,
            '2026-09-12T15:00:00+00', 'scheduled');

  insert into interleague_reschedule_requests
      (id, game_id, requested_by_user_id, proposed_scheduled_at, token, status)
    values (v_req, v_moving, null, '2026-09-12T15:00:00+00', v_tok, 'pending'),
           (v_req2, v_moving, null, '2026-09-12T16:00:00+00', v_tok_done, 'accepted');

  ---------------------------------------------------------------- A. self-exclusion
  j := public.build_game_occupancy_context(v_moving, '2026-09-12T15:00:00+00');

  if exists (select 1 from jsonb_array_elements(j->'occupied') e
               where (e->>'game_id')::uuid = v_moving) then
    fails := fails + 1;
    out := out || '[A1] FAIL the moving game appears in its OWN occupancy list' || chr(10);
  else
    c_self_excluded := c_self_excluded + 1;
  end if;

  -- Anti-vacuity for A1: the list must be non-empty, or "not present" is trivial.
  select count(*) into n from jsonb_array_elements(j->'occupied');
  if n = 0 then
    fails := fails + 1;
    out := out || '[A2] FAIL occupancy list EMPTY — A1 would pass vacuously' || chr(10);
  else
    c_neighbour_returned := c_neighbour_returned + 1;
    out := out || format('[A2] ok  occupancy list has %s row(s)', n) || chr(10);
  end if;

  if not exists (select 1 from jsonb_array_elements(j->'occupied') e
                   where (e->>'game_id')::uuid = v_neigh) then
    fails := fails + 1;
    out := out || '[A3] FAIL the same-day neighbour was NOT returned' || chr(10);
  end if;

  ---------------------------------------------------------------- B. date scoping
  if exists (select 1 from jsonb_array_elements(j->'occupied') e
               where (e->>'game_id')::uuid = v_nextday) then
    fails := fails + 1;
    out := out || '[B1] FAIL a game on ANOTHER DAY leaked into the list' || chr(10);
  else
    c_date_scoped := c_date_scoped + 1;
  end if;

  ---------------------------------------------------------------- C. cancelled
  if exists (select 1 from jsonb_array_elements(j->'occupied') e
               where (e->>'game_id')::uuid = v_cancel) then
    fails := fails + 1;
    out := out || '[C1] FAIL a CANCELLED game was counted as occupying' || chr(10);
  else
    c_cancelled_excluded := c_cancelled_excluded + 1;
  end if;

  ---------------------------------------------------------------- D. emitted shape
  if (j->>'venue_id')::uuid is distinct from v_venue then
    fails := fails + 1; out := out || '[D1] FAIL venue_id not emitted' || chr(10);
  end if;
  if (j->>'game_duration')::numeric is distinct from 105 then
    fails := fails + 1; out := out || '[D2] FAIL game_duration not from the OWN division' || chr(10);
  end if;
  if (j->>'buffer_minutes')::numeric is distinct from 30 then
    fails := fails + 1; out := out || '[D3] FAIL buffer_minutes not from the OWN division' || chr(10);
  end if;
  -- Wall-clock text, not a zone-rendered timestamptz. This is the house
  -- convention: every downstream comparison is on the TIME SUBSTRING.
  if (j->>'scheduled_at') <> '2026-09-12T15:00:00' then
    fails := fails + 1;
    out := out || format('[D4] FAIL scheduled_at not UTC wall-clock text: %s', j->>'scheduled_at') || chr(10);
  end if;
  if not exists (select 1 from jsonb_array_elements(j->'occupied') e
                   where e->>'scheduled_at' = '2026-09-12T13:00:00') then
    fails := fails + 1; out := out || '[D5] FAIL occupant time not UTC wall-clock text' || chr(10);
  end if;
  if not exists (select 1 from jsonb_array_elements(j->'occupied') e
                   where e->>'label' like 'HARNESS-B%') then
    fails := fails + 1; out := out || '[D6] FAIL occupant label missing/blank' || chr(10);
  end if;

  ---------------------------------------------------------------- E. venue-null
  j := public.build_game_occupancy_context(v_novenue, '2026-09-12T15:00:00+00');
  if (j->>'venue_id') is not null then
    fails := fails + 1; out := out || '[E1] FAIL venue_id should be null' || chr(10);
  end if;
  select count(*) into n from jsonb_array_elements(j->'occupied');
  if n <> 0 then
    fails := fails + 1;
    out := out || format('[E2] FAIL null-venue game returned %s occupant(s)', n) || chr(10);
  else
    c_venue_null_empty := c_venue_null_empty + 1;
  end if;

  ---------------------------------------------------------------- F. TOKEN GATE
  -- The gate must RAISE on a bad/!pending token, never return an empty set —
  -- an empty set reads downstream as "the field is free" and fails OPEN.

  -- F1: valid pending token resolves, and derives the game from the ROW.
  j := public.get_reschedule_occupancy_by_token(v_tok);
  if (j->>'game_id')::uuid is distinct from v_moving then
    fails := fails + 1; out := out || '[F1] FAIL token did not resolve to its own game' || chr(10);
  end if;
  select count(*) into n from jsonb_array_elements(j->'occupied');
  if n = 0 then
    fails := fails + 1;
    out := out || '[F2] FAIL token path returned an EMPTY list — F3/F4 would be vacuous' || chr(10);
  end if;

  -- F3: a token that does not exist must RAISE.
  begin
    j := public.get_reschedule_occupancy_by_token(v_tok_bad);
    fails := fails + 1;
    out := out || format('[F3] FAIL unknown token RETURNED (%s) instead of raising — FAILS OPEN',
                         coalesce(j::text,'null')) || chr(10);
  exception when sqlstate 'P0001' then
    c_token_rejected := c_token_rejected + 1;
    out := out || '[F3] ok  unknown token RAISED' || chr(10);
  end;

  -- F4: a token whose request is no longer pending must RAISE.
  begin
    j := public.get_reschedule_occupancy_by_token(v_tok_done);
    fails := fails + 1;
    out := out || '[F4] FAIL non-pending token RETURNED instead of raising' || chr(10);
  exception when sqlstate 'P0001' then
    c_token_rejected := c_token_rejected + 1;
    out := out || '[F4] ok  non-pending token RAISED' || chr(10);
  end;

  ---------------------------------------------------------------- G. grants
  -- The internal builder must NOT be reachable by anon or authenticated; only
  -- the two gated entry points are.
  if has_function_privilege('anon', 'public.build_game_occupancy_context(uuid, timestamptz)', 'EXECUTE')
  then
    fails := fails + 1; out := out || '[G1] FAIL anon can call the UNGATED builder' || chr(10);
  end if;
  if has_function_privilege('authenticated', 'public.build_game_occupancy_context(uuid, timestamptz)', 'EXECUTE')
  then
    fails := fails + 1; out := out || '[G2] FAIL authenticated can call the UNGATED builder' || chr(10);
  end if;
  if has_function_privilege('anon', 'public.get_game_occupancy_context(uuid, timestamptz)', 'EXECUTE')
  then
    fails := fails + 1; out := out || '[G3] FAIL anon can call the AUTHENTICATED entry point' || chr(10);
  end if;
  if not has_function_privilege('anon', 'public.get_reschedule_occupancy_by_token(text)', 'EXECUTE')
  then
    fails := fails + 1; out := out || '[G4] FAIL anon CANNOT call the token entry point' || chr(10);
  end if;
  if not has_function_privilege('authenticated', 'public.get_game_occupancy_context(uuid, timestamptz)', 'EXECUTE')
  then
    fails := fails + 1; out := out || '[G5] FAIL authenticated CANNOT call its entry point' || chr(10);
  end if;

  -- G6 is ROLE-AGNOSTIC ON PURPOSE, and it is the assertion that would have
  -- caught 0088's miss. G1/G2 name `anon` and `authenticated` because those are
  -- the roles 0088 thought to revoke — and that is exactly why they passed while
  -- `dashboard_readonly` still held EXECUTE, granted by this project's
  -- `alter default privileges ... grant execute on functions` rather than by any
  -- migration. Naming roles can only ever catch the roles you already thought
  -- of. This asserts the builder's ACL is EXACTLY {postgres}, so ANY future
  -- grant to ANY role fails the run without anyone having to predict it.
  -- Fixed by migration 0089.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      cross join lateral aclexplode(p.proacl) ae
      join pg_roles r on r.oid = ae.grantee
     where ns.nspname = 'public'
       and p.proname = 'build_game_occupancy_context'
       and ae.privilege_type = 'EXECUTE'
       and r.rolname <> 'postgres'
  ) then
    fails := fails + 1;
    out := out || '[G6] FAIL the UNGATED builder is EXECUTE-able by a role other than postgres: '
                || coalesce((select string_agg(r.rolname, ',' order by r.rolname)
                               from pg_proc p
                               join pg_namespace ns on ns.oid = p.pronamespace
                               cross join lateral aclexplode(p.proacl) ae
                               join pg_roles r on r.oid = ae.grantee
                              where ns.nspname = 'public'
                                and p.proname = 'build_game_occupancy_context'
                                and ae.privilege_type = 'EXECUTE'
                                and r.rolname <> 'postgres'), '?') || chr(10);
  else
    c_builder_sealed := c_builder_sealed + 1;
  end if;

  ---------------------------------------------------------------- anti-vacuity
  out := out || chr(10) || 'Anti-vacuity counters:' || chr(10);
  out := out || format('  self_excluded=%s neighbour_returned=%s token_rejected=%s venue_null_empty=%s date_scoped=%s cancelled_excluded=%s builder_sealed=%s',
    c_self_excluded, c_neighbour_returned, c_token_rejected,
    c_venue_null_empty, c_date_scoped, c_cancelled_excluded, c_builder_sealed) || chr(10);
  if c_self_excluded = 0 or c_neighbour_returned = 0 or c_token_rejected = 0
     or c_venue_null_empty = 0 or c_date_scoped = 0 or c_cancelled_excluded = 0
     or c_builder_sealed = 0 then
    fails := fails + 1;
    out := out || 'FAIL a counter is ZERO — its assertion proved nothing' || chr(10);
  end if;

  out := out || chr(10) || case when fails = 0 then 'PASS (all SQL-level assertions)'
                                else format('FAILED: %s assertion(s)', fails) end;

  -- ALWAYS raise: carries the results out AND guarantees the whole transaction
  -- rolls back. Nothing here may ever commit.
  raise exception E'HARNESS-0088\n%', out;
end
$harness$;

-- ── Mutation log ─────────────────────────────────────────────────────────────
--
-- Criterion (CLAUDE.md): a mutant is KILLED only if the BASELINE ASSERTION
-- fails, and it must be killed by the assertion WRITTEN to catch it. Mutants are
-- `create or replace` on the real functions, run inside the same always-raising
-- transaction so they can never commit, followed by a leak check.
--
-- Run 2026-09-09 — baseline PASS, 2 mutants, both killed by their own assertion.
--
--   Baseline: all assertions green; counters
--     self_excl=1 neigh=1 token_rej=2 venue_null=1 date=1 cancelled=1
--
--   SM1  Remove the self-exclusion (`and g.id <> v_game.id`) from the WHERE.
--        → KILLED by "[A1] moving game appears in its OWN occupancy list",
--          and c_self_excluded dropped 1 → 0, so the anti-vacuity guard fires
--          too. A2 stayed green (the neighbour is still returned), which is
--          what proves A1 failed for the RIGHT reason rather than because the
--          list went empty.
--
--   SM2  Token gate returns null instead of raising on unknown / non-pending
--        tokens — the "auth check that fails open" mutant Amendment 1 exists to
--        prevent.
--        → KILLED by "[F3] unknown token RETURNED (null) instead of raising"
--          and "[F4] non-pending token RETURNED", plus c_token_rejected 2 → 0.
--
-- Leak checks after every run: games total 664 unchanged, zero HARNESS-* rows
-- in leagues/divisions/teams/venues, interleague_reschedule_requests still 0,
-- and zero of the three functions left behind (they exist only inside the
-- rolled-back transaction until migration 0088 is applied for real).
--
-- NOT COVERED HERE, by construction: the overlap decision itself. A mutant that
-- corrupted the arriving-team buffer or the half-open test would leave every
-- assertion in this file green, because this file only checks WHICH ROWS are
-- emitted, never what is concluded from them. That half is
-- `npm run sim:occupancy-gate` (5 mutants, all killed). Reading either file's
-- green run as proof of the whole feature would be wrong.
--
-- Addendum 2026-09-09, after 0088 was applied for real: G6 was ADDED in
-- response to a live-catalog finding, not written up front. 0088 revoked the
-- builder from `public`/`anon`/`authenticated` and its own comment claimed the
-- function was "not independently reachable" — but the applied catalog showed
-- `dashboard_readonly` still holding EXECUTE, granted by this project's
-- `alter default privileges`, never by a migration. G1 and G2 both passed
-- while the claim was false, because they name the roles the migration author
-- already had in mind.
--
-- That is the lesson worth keeping: a grant assertion that NAMES ROLES can only
-- catch the roles you thought of. G6 asserts the ACL is exactly {postgres}, so
-- any future grant to any role fails without anyone predicting it. Migration
-- 0089 closes the grant; G6 is what stops it coming back.
--
-- Verified against the live catalog post-0089: builder ACL is exactly
-- {postgres}; anon reaches only the token entry point; authenticated reaches
-- its own entry point; all three prosrc md5s unchanged by the revoke.

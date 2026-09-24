-- SQL-level harness for migration 0093 (single-game delete keeps a live
-- interleague negotiation).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): what is under
-- test is block conditions inside a SECURITY DEFINER function. The fake
-- Supabase client cannot run them and service_role has no DML on
-- games/teams/divisions/leagues. NOT `npm run`-able, NOT in CI.
--
-- HOW TO RUN: one batch, this file alone (0093 is applied). To run it BEFORE
-- applying, prepend the text of
--   supabase/migrations/0093_delete_game_negotiation_guard.sql
-- The DO block ALWAYS raises, so the whole batch rolls back. Leak check
-- afterwards: live md5(prosrc) of both functions unchanged, zero HARNESS-0093
-- rows, games total unchanged.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE TRUTH TABLE BELOW IS THE SINGLE SOURCE FOR *BOTH* DEFINITIONS OF
-- "PROTECTED", AND ITS FORMATTING IS LOAD-BEARING.
--
-- Two doors guard the same rows: this RPC (SQL,
-- public.is_protected_interleague_game) and the REGENERATE delete (TypeScript,
-- isProtectedInterleagueGame in src/lib/schedule/generate-schedule.ts). Neither
-- can be derived from the other, so both are asserted against the SAME table:
--   * pass 0 of this harness runs every row through the SQL function;
--   * `npm run sim:regenerate-pending-guard` READS THIS FILE, parses the rows
--     between the BEGIN/END markers, and runs each through the TypeScript one.
--
-- CONSEQUENCE, AND IT IS DELIBERATE: the TypeScript side parses TEXT. What that
-- does and does not tolerate was MEASURED, not assumed:
--   fine      re-indenting or reflowing the ROWS (the pattern ignores
--             whitespace and line breaks) — but each MARKER must stay alone on
--             its own line;
--   BREAKS    renaming, removing or duplicating a marker line; adding a column;
--             changing the literal style.
-- Every one of those is a FAILURE on the TypeScript side, never a skip, so a
-- tidy-up cannot quietly switch the cross-check off. If you change the row
-- format, change the parser in the same commit.
--
-- THE TABLE ITSELF LIVES ONLY IN THE `values` BLOCK INSIDE THE DO BLOCK BELOW,
-- between the TRUTH-TABLE-BEGIN / TRUTH-TABLE-END markers. An earlier draft of
-- this file ALSO carried a commented copy up here "for readability" — which
-- made two copies that could disagree, the exact failure this design exists to
-- prevent, and the TypeScript parser silently read BOTH (22 rows instead of
-- 11). One copy. Read it below.
--
-- Columns: status, is_interleague, has_external_team_name,
--          has_proposed_scheduled_at, has_request, expected_protected
-- ─────────────────────────────────────────────────────────────────────────────
--
-- MUTANTS (CLAUDE.md: killed by the assertion written to catch it, not merely
-- by something). A mutant whose replace() changes nothing FAILS the run.
--   DM1 the new block reason removed              → target D1
--   DM2 count-first replaced by a fail-OPEN read  → target D3
--   DM3 the SQL predicate DRIFTS from the shared table (drops the
--       proposed_scheduled_at arm)                → target T1

do $harness$
declare
  v_owner    uuid;
  v_league   uuid := gen_random_uuid();
  v_div      uuid := gen_random_uuid();
  v_team     uuid := gen_random_uuid();
  v_venue    uuid := gen_random_uuid();
  v_org      uuid := gen_random_uuid();
  g_untouched uuid := gen_random_uuid();
  g_counter   uuid := gen_random_uuid();
  g_proposed  uuid := gen_random_uuid();
  g_request   uuid := gen_random_uuid();
  g_resched   uuid := gen_random_uuid();
  j          jsonb;
  out        text := '';
  total_fail int := 0;
  f          text[];
  bad        int;
  m_fn   text[] := array[
    'public.delete_game_if_unblocked(uuid)',
    'public.delete_game_if_unblocked(uuid)',
    'public.is_protected_interleague_game(text,uuid,text,timestamptz,boolean)'
  ];
  m_old  text[] := array[
    E'    v_reasons := v_reasons || to_jsonb(''interleague_negotiation''::text);',
    E'  select count(*) into v_open_requests\n    from public.interleague_reschedule_requests\n   where game_id = p_game_id;',
    E'    else p_external_team_name is not null\n      or p_proposed_scheduled_at is not null\n      or coalesce(p_has_request, false)'
  ];
  m_new  text[] := array[
    E'    v_reasons := v_reasons;',
    E'  v_open_requests := 0;',
    E'    else p_external_team_name is not null\n      or coalesce(p_has_request, false)'
  ];
  m_tag  text[] := array['D1', 'D3', 'T1'];
  m_name text[] := array[
    'DM1 the interleague_negotiation reason is never added',
    'DM2 the request count is assumed zero instead of read (fail-OPEN)',
    'DM3 the SQL predicate drifts from the shared truth table'
  ];
  orig_def   text;
  mut_def    text;
  pass       int;
  -- anti-vacuity counters (baseline pass only): a ZERO fails the run
  c_protected_blocked   int := 0;  -- a protected game really was refused
  c_unprotected_deleted int := 0;  -- an untouched pending game really was deleted
  c_truth_rows          int := 0;  -- truth-table rows actually evaluated
  c_multi_reason        int := 0;  -- a blocked response carried MORE than one reason
begin
  ---------------------------------------------------------------- fixtures
  -- delete_game_if_unblocked gates on is_org_member(auth.uid()), and this
  -- harness runs with no JWT, so the claim is set the way team-delete-sim.sql
  -- does it. Transaction-local (the `true`), so it dies with the rollback.
  select owner_id into v_owner from public.leagues where owner_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  insert into leagues(id, owner_id, name, sport, season, start_date, end_date)
    values (v_league, v_owner, 'HARNESS-0093', 'baseball', 'HARNESS', '2026-09-01', '2026-11-30');
  insert into divisions(id, league_id, name, settings, locked)
    values (v_div, v_league, 'HARNESS-0093-DIV', '{"game_duration": 90}'::jsonb, false);
  insert into teams(id, league_id, division_id, name)
    values (v_team, v_league, v_div, 'HARNESS-0093-T');
  insert into venues(id, owner_id, name, availability, availability_configured)
    values (v_venue, v_owner, 'HARNESS-0093-FIELD', '{}'::jsonb, true);
  insert into interleague_orgs(id, owner_id, name, admin_email)
    values (v_org, v_owner, 'HARNESS-0093-ORG', 'harness-0093@example.invalid');

  -- (No non-interleague fixture: games_opponent_required needs an away team or
  -- an org, and nothing here asserts on a plain game — the truth table covers
  -- the not-interleague rows directly.)

  for pass in 0 .. array_length(m_fn, 1) loop
    -- FIXTURES ARE REBUILT EVERY PASS. A mutant that fails to block DELETES the
    -- game it was asked about, which would leave later passes asserting against
    -- rows that no longer exist — the tally would then read as kills earned by
    -- missing fixtures rather than by the guard. (First run of this harness
    -- aborted outright for exactly that reason, at D3's call on a row DM1 had
    -- just deleted.)
    delete from public.games where league_id = v_league;
    insert into games(id, league_id, home_team_id, venue_id, scheduled_at, status,
                      interleague_org_id, is_away, external_team_name, proposed_scheduled_at)
    values
      (g_untouched, v_league, v_team, v_venue, '2026-10-03T10:00:00+00', 'pending_interleague', v_org, false, null,      null),
      (g_counter,   v_league, v_team, v_venue, '2026-10-10T10:00:00+00', 'pending_interleague', v_org, false, 'Rockies', null),
      (g_proposed,  v_league, v_team, v_venue, '2026-10-17T10:00:00+00', 'pending_interleague', v_org, false, null,      '2026-10-18T13:00:00+00'),
      (g_request,   v_league, v_team, v_venue, '2026-10-24T10:00:00+00', 'pending_interleague', v_org, false, null,      null),
      (g_resched,   v_league, v_team, v_venue, '2026-10-31T10:00:00+00', 'reschedule_pending',  v_org, false, 'Rockies', null);
    -- The request-row case: a HOST proposal awaiting the partner. Deleting this
    -- game is what cascades their token away.
    insert into interleague_reschedule_requests(game_id, token, requested_by_user_id,
                                                proposed_scheduled_at, status)
      values (g_request, 'HARNESS-0093-REQ', v_owner, '2026-10-25T13:00:00+00', 'pending');

    if pass > 0 then
      orig_def := pg_get_functiondef(m_fn[pass]::regprocedure);
      mut_def  := replace(orig_def, m_old[pass], m_new[pass]);
      if mut_def = orig_def then
        total_fail := total_fail + 1;
        out := out || format(E'STALE %s: replace() matched nothing\n', m_name[pass]);
        continue;
      end if;
      execute mut_def;
    end if;
    f := array[]::text[];

    ------------------------------------------------- T1: the truth table
    -- Every row, through the REAL SQL predicate. Booleans are turned into the
    -- column values they stand for.
    select count(*) into bad
    from (values
    -- TRUTH-TABLE-BEGIN
      ('pending_interleague',  true,  false, false, false, false),  -- untouched invite: still deletable
      ('pending_interleague',  true,  true,  false, false, true),   -- partner countered
      ('pending_interleague',  true,  false, true,  false, true),   -- their proposed time is on the row
      ('pending_interleague',  true,  false, false, true,  true),   -- a reschedule request exists
      ('pending_interleague',  true,  true,  true,  true,  true),   -- all three at once
      ('reschedule_pending',   true,  false, false, false, true),   -- accepted, change outstanding (0079)
      ('scheduled',            true,  true,  false, true,  false),  -- accepted+live: interleague_accepted covers it
      ('cancelled',            true,  true,  false, true,  false),  -- not this predicate's business
      ('completed',            true,  true,  false, true,  false),  -- result_recorded covers it
      ('pending_interleague',  false, true,  true,  true,  false),  -- not interleague at all
      ('reschedule_pending',   false, false, false, true,  false)   -- ditto, even with a request row
    -- TRUTH-TABLE-END
    ) as t(status, is_il, has_ext, has_prop, has_req, expected)
    where public.is_protected_interleague_game(
            t.status,
            case when t.is_il then v_org else null end,
            case when t.has_ext then 'Rockies' else null end,
            case when t.has_prop then '2026-10-18T13:00:00+00'::timestamptz else null end,
            t.has_req
          ) is distinct from t.expected;
    if bad > 0 then f := f || 'T1'::text;
    elsif pass = 0 then
      select count(*) into c_truth_rows from (values
        (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11)
      ) x;
    end if;

    ------------------------------------------- D1: protected games are refused
    foreach j in array array[
      to_jsonb(g_counter::text), to_jsonb(g_proposed::text),
      to_jsonb(g_request::text), to_jsonb(g_resched::text)
    ] loop
      declare
        r jsonb;
      begin
        -- EVERY call is exception-safe. The RPC raises P0001 for
        -- game_not_found / not_authorized, and an uncaught raise aborts the
        -- whole DO block — printing a stack trace instead of the assertions
        -- that had already failed. A crash is not a kill.
        begin
          r := public.delete_game_if_unblocked((j #>> '{}')::uuid);
        exception when sqlstate 'P0001' then
          r := jsonb_build_object('rpc_error', SQLERRM);
        end;
        if coalesce((r->>'blocked')::boolean, false) then
          if pass = 0 then c_protected_blocked := c_protected_blocked + 1; end if;
          -- The reason must be NAMED; a refusal for some other reason is not
          -- this guard working.
          if (j #>> '{}') <> g_resched::text
             and not (r->'reasons' ? 'interleague_negotiation') then
            f := f || 'D1'::text;
          end if;
          -- g_resched is ALSO interleague_accepted: all conditions are
          -- evaluated, so both must be listed.
          if (j #>> '{}') = g_resched::text then
            if not (r->'reasons' ? 'interleague_negotiation')
               or not (r->'reasons' ? 'interleague_accepted') then
              f := f || 'D2'::text;
            elsif pass = 0 then c_multi_reason := c_multi_reason + 1;
            end if;
          end if;
        else
          f := f || 'D1'::text;
        end if;
      end;
    end loop;

    ---------------------------- D3: the request-bearing game specifically
    -- Isolated because DM2 (fail-open count) only shows up here: the other
    -- three protected games are protected by COLUMNS, which no count can miss.
    declare
      r3 jsonb;
    begin
      begin
        r3 := public.delete_game_if_unblocked(g_request);
      exception when sqlstate 'P0001' then
        r3 := jsonb_build_object('rpc_error', SQLERRM);
      end;
      if not coalesce((r3->>'blocked')::boolean, false)
         or not (r3->'reasons' ? 'interleague_negotiation') then
        f := f || 'D3'::text;
      end if;
    end;

    ------------------------------- D4: an UNTOUCHED pending game still deletes
    -- The carve-out this guard must preserve: a dead invite cannot strand a
    -- row. Runs LAST among the delete checks and is rolled back with the rest.
    declare
      r4 jsonb;
    begin
      begin
        r4 := public.delete_game_if_unblocked(g_untouched);
      exception when sqlstate 'P0001' then
        r4 := jsonb_build_object('rpc_error', SQLERRM);
      end;
      if coalesce((r4->>'deleted')::boolean, false) then
        if pass = 0 then c_unprotected_deleted := c_unprotected_deleted + 1; end if;
      else
        f := f || 'D4'::text;
      end if;
      -- No re-insert needed: the next pass rebuilds every fixture.
    end;

    ------------------------------------------------------------ record pass
    if pass = 0 then
      if cardinality(f) > 0 then
        total_fail := total_fail + cardinality(f);
        out := out || format(E'BASELINE FAIL %s\n', f);
      else
        out := out || E'BASELINE PASS\n';
      end if;
    else
      if m_tag[pass] = any(f) then
        out := out || format(E'KILLED  %s — by %s (all failures: %s)\n', m_name[pass], m_tag[pass], f);
      else
        total_fail := total_fail + 1;
        out := out || format(E'SURVIVED %s — target %s not among failures %s\n', m_name[pass], m_tag[pass], f);
      end if;
      execute orig_def;  -- restore before the next pass
    end if;
  end loop;

  ---------------------------------------------------------------- counters
  if c_protected_blocked   = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_protected_blocked\n'; end if;
  if c_unprotected_deleted = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_unprotected_deleted\n'; end if;
  if c_truth_rows          = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_truth_rows\n'; end if;
  if c_multi_reason        = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_multi_reason\n'; end if;
  out := out || format(E'counters protected_blocked=%s unprotected_deleted=%s truth_rows=%s multi_reason=%s\n',
    c_protected_blocked, c_unprotected_deleted, c_truth_rows, c_multi_reason);
  out := out || case when total_fail = 0 then 'RESULT PASS' else format('RESULT FAIL (%s)', total_fail) end;

  -- ALWAYS raise: carries results out and rolls the whole batch back.
  raise exception E'HARNESS-0093\n%', out;
end
$harness$;

-- ── Run log ──────────────────────────────────────────────────────────────────
--
-- 2026-09-24, run AFTER 0093 was applied (this file alone, via the Supabase
-- MCP):
--   BASELINE PASS
--   KILLED  DM1 interleague_negotiation never added — by D1 (all {D1,D1,D1,D2,D3})
--   KILLED  DM2 request count assumed zero (fail-OPEN) — by D3 (all {D1,D3})
--   KILLED  DM3 SQL predicate drifts from the table — by T1 (all {T1,D1})
--   counters protected_blocked=4 unprotected_deleted=1 truth_rows=11
--            multi_reason=1
--   RESULT PASS
--
-- Leak check immediately after: md5(prosrc) of delete_game_if_unblocked still
-- fc9bd43f0572635f17e2657f2cbc6dc4 and of is_protected_interleague_game still
-- b019f83b0a425f168e2ac0caf20b1958 (both equal to the repo file's bodies, so
-- every mutant's create-or-replace rolled back); zero HARNESS-0093 leagues /
-- orgs / venues / request rows; games total 663 unchanged.
--
-- TWO THINGS THE FIRST RUN GOT WRONG, both fixed above and worth knowing:
--   1. A mutant that fails to block DELETES the game it was asked about, so
--      the next assertion called the RPC on a missing row, got an uncaught
--      P0001, and aborted the whole DO block — printing a stack trace instead
--      of the failures already recorded. Every RPC call is now wrapped in its
--      own exception block, and fixtures are rebuilt at the START of each pass.
--      A crash is not a kill.
--   2. The cross-check probe exposed that this file once held TWO copies of the
--      truth table (a commented one in the header, plus the live one), which
--      the TypeScript parser read as 22 rows across both. Exactly the drift
--      this design exists to prevent. One copy now, and the parser demands
--      exactly one marker line of each kind.

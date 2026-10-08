-- SQL-level proof for migration 0107 (delete_playoff_bracket and
-- replace_playoff_games — delete a playoff bracket; rebuild one safely).
--
-- WHY SQL: the behavior is two SECURITY DEFINER functions' refusals, grants
-- exercised as `anon` and `authenticated`, the FK cascade, a transaction that
-- must roll back whole, and a count that must equal what the public reader
-- (0105) actually returns. NOT `npm run`-able, NOT in CI (CLAUDE.md, "Harness
-- standard — SQL-level exceptions").
--
-- THIS HARNESS APPLIES 0107 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK, so it runs BEFORE the migration is applied. The text proven is the
-- repo file: the build script substitutes it for the placeholder below.
--
-- HOW TO RUN: `npx tsx scripts/sim/playoff-bracket-delete-build.ts > <file>`,
-- send the output as ONE batch through the Supabase MCP (one batch = one
-- transaction), read the raised message, then run the leak check at the
-- bottom.
--
-- EVERY PASS IS ITS OWN ROLLED-BACK SUB-TRANSACTION. The baseline and each
-- mutant start from the same fixtures: a pass raises its results out, which
-- undoes every write it (and its mutant) made.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: about a second)
--   Creating the functions takes no table lock. Row locks on the FIXTURE rows
--   and on the test org's existing T-Ball bracket and its 7 games (deleted
--   inside a pass, rolled back) — that blocks result entry / edits on that
--   one test bracket for the run, nothing else. The test org owner's
--   `profiles` ROW (plan switched for PL1, rolled back) — blocks writes to
--   that one row. A `public_schedule_links` row is INSERTED for the test org
--   (it has none; rolled back). Locking the fixture divisions fires
--   team_calendar_links_on_division_lock, which inserts calendar-link rows
--   for the fixture teams (rolled back).
--   lock_timeout = 3s; statement_timeout = 60s.
--
-- ROWS TOUCHED (all rolled back): the test org "SRALL" only (owner
-- aa21d01c-66dc-4c37-b15c-7b743c557eea) — two fixture seasons, four
-- divisions, nine teams, one field, three fixture brackets and their games,
-- the EXISTING T-Ball bracket in its "Fall 2026" season (adceb235…, 7 games,
-- 2 with results, in a LOCKED division — it is deleted inside each pass), a
-- public link row, activity-log rows, and the owner's profiles.plan. One field
-- is created in the "test" org (owner bbf9afe1-9e62-41e0-becc-895085bfc9d6,
-- not a member of SRALL) to be the wrong-org field, and that owner is the
-- non-member caller. NOTHING belonging to Santa Rosa American Little League
-- is written or passed to either function: the SRALL owner is also an admin
-- there, so its 50/70 bracket (c903bbb7…) is fingerprinted before the run and
-- after every pass (RL1) and is never a function argument.
--
-- ASSERTIONS (in order; a mutant must die FIRST at its own tag)
--   P1   privileges: both functions authenticated only; not anon /
--        service_role / dashboard_readonly / PUBLIC; SECURITY DEFINER
--   AN1  anon cannot call either; a non-member is refused (42501
--        not_authorized) by both, at commit; nothing written
--   PL1  a non-Elite (Pro) org is refused plan_required by both, preview and
--        commit; nothing written
--   VL1  replace refuses bad input before writing: no games, a non-numeric or
--        duplicate game number, a malformed team id, a team from another
--        season, another org's field, an unknown format, a missing settings
--        key, a cross-division opponent outside the season; nothing written
--   PV1  delete PREVIEW writes nothing and returns the confirm's counts
--        (fixture bracket A: 3 games, 2 dated, 0 results, 2 public; T-Ball:
--        7, 7, 2, 7)
--   PV2  replace PREVIEW writes nothing and returns the counts before and
--        after (A: 3 games now, 4 new, 2 public now, 2 public after)
--   PUB1 "on the public schedule" equals the dated rows the 0105 reader
--        actually returns, for every bracket; an unlocked division's bracket
--        (B) counts 0 in both functions; a disabled link counts 0
--   RB1  a bracket WITH RESULTS cannot be rebuilt: preview and commit both
--        return blocked / results_entered; nothing written
--   AT1  a rebuild whose LAST game will not insert (an impossible date) fails
--        and leaves everything as it was: the old games (same ids), the
--        settings, the status; no log row
--   RB2  a rebuild in a LOCKED division succeeds: settings replaced, old games
--        gone, exactly the new games (status scheduled, no scores, ids from
--        the bracket row), status active; a DRAFT bracket with no games is
--        generated the same way; other brackets untouched
--   DL1  deleting a bracket WITH RESULTS in a LOCKED division succeeds: the
--        bracket row and all 7 of its games gone, every other bracket
--        byte-identical, exactly 1 bracket and 7 games fewer in the table
--   RL1  the real league's 50/70 bracket is byte-identical (checked last in
--        every pass, so a leak there can never hide behind another failure)
--   LG1  exactly one log row per write, none for a preview or refusal:
--        playoff_bracket_rebuilt (A), playoff_bracket_generated (C),
--        playoff_bracket_deleted (T-Ball), with the counts in the message
--
-- MUTANTS (each rewrites a REAL function inside its own rolled-back block;
-- KILLED only if the FIRST failure is its own tag)
--   MU1a delete: membership gate removed           → AN1
--   MU1b replace: membership gate removed          → AN1
--   MU2a delete: plan gate removed                 → PL1
--   MU2b replace: plan gate removed                → PL1
--   MU3  replace: result block removed             → RB1
--   MU4a delete: preview commits                   → PV1
--   MU4b replace: preview commits                  → PV2
--   MU5  delete removes the games but not the bracket row → DL1
--   MU6a replace: log skipped                      → LG1
--   MU6b delete: log skipped                       → LG1
--   MU7  replace deletes without inserting         → RB2
--   MU8  EXECUTE left on PUBLIC                    → P1
--   MU9  delete: public count ignores the lock     → PUB1
--   MU10 replace: lock gates the rebuild           → RB2
--   MU11 delete: lock gates the delete             → DL1
--
-- RUN LOG: see the bottom of this file after the run.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

create temp table h107_fx on commit drop as
select
  'aa21d01c-66dc-4c37-b15c-7b743c557eea'::uuid as org,
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as nonmember,
  'adceb235-a279-454f-a9a9-1f301ff93c5e'::uuid as p_tball,
  'c903bbb7-3e4a-4536-95e4-a677abb45192'::uuid as p_real,
  (now() at time zone 'America/Los_Angeles')::date as today_la,
  gen_random_uuid() as v1, gen_random_uuid() as v_foreign,
  gen_random_uuid() as s1, gen_random_uuid() as s2,
  gen_random_uuid() as div_a, gen_random_uuid() as div_b, gen_random_uuid() as div_c, gen_random_uuid() as div_x,
  gen_random_uuid() as a1, gen_random_uuid() as a2, gen_random_uuid() as a3, gen_random_uuid() as a4,
  gen_random_uuid() as b1, gen_random_uuid() as b2, gen_random_uuid() as c1, gen_random_uuid() as c2,
  gen_random_uuid() as x1,
  gen_random_uuid() as p_a, gen_random_uuid() as p_b, gen_random_uuid() as p_c,
  ''::text as real_fp;

-- The real league's bracket, fingerprinted before anything else happens.
update h107_fx set real_fp = md5(
  coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p where p.id = h107_fx.p_real), '') || '#' ||
  coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g where g.playoff_id = h107_fx.p_real), ''));

-- Fixtures. Divisions are locked AFTER their teams exist.
insert into public.venues (id, owner_id, name)
select v1, org, 'ZZ107 Perry' from h107_fx union all
select v_foreign, nonmember, 'ZZ107 Foreign Field' from h107_fx;

insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
select s1, 'ZZ107 Season', 'Baseball', 'Fall 2026', org, today_la - 30, today_la + 30 from h107_fx union all
select s2, 'ZZ107 Other',  'Baseball', 'Fall 2026', org, today_la - 30, today_la + 30 from h107_fx;

insert into public.divisions (id, league_id, name, settings)
select div_a, s1, 'ZZ107 Majors',  '{"game_duration": 120}'::jsonb from h107_fx union all
select div_b, s1, 'ZZ107 Minors',  '{"game_duration": 90}'::jsonb from h107_fx union all
select div_c, s1, 'ZZ107 Rookies', '{"game_duration": 90}'::jsonb from h107_fx union all
select div_x, s2, 'ZZ107 Elsewhere', '{"game_duration": 90}'::jsonb from h107_fx;

insert into public.teams (id, league_id, division_id, name)
select a1, s1, div_a, 'ZZ107 Expos' from h107_fx union all
select a2, s1, div_a, 'ZZ107 Bears' from h107_fx union all
select a3, s1, div_a, 'ZZ107 Cubs' from h107_fx union all
select a4, s1, div_a, 'ZZ107 Twins' from h107_fx union all
select b1, s1, div_b, 'ZZ107 Mets' from h107_fx union all
select b2, s1, div_b, 'ZZ107 Royals' from h107_fx union all
select c1, s1, div_c, 'ZZ107 Owls' from h107_fx union all
select c2, s1, div_c, 'ZZ107 Hawks' from h107_fx union all
select x1, s2, div_x, 'ZZ107 Strangers' from h107_fx;

-- Bracket A (div_a, LOCKED): 3 games, 2 dated, no results.
-- Bracket B (div_b, UNLOCKED): 1 dated game, no results.
-- Bracket C (div_c, LOCKED): draft, no games.
insert into public.playoffs (id, league_id, division_id, format, seeding, status)
select p_a, s1, div_a, 'single_elimination', '[]'::jsonb, 'active' from h107_fx union all
select p_b, s1, div_b, 'single_elimination', '[]'::jsonb, 'active' from h107_fx union all
select p_c, s1, div_c, 'single_elimination', '[]'::jsonb, 'draft'  from h107_fx;

insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number,
                                  home_team_id, away_team_id, venue_id, scheduled_date, start_time)
select p_a, s1, div_a, 'R1', 2, a1, a2, v1, today_la + 3, '09:00'::time from h107_fx union all
select p_a, s1, div_a, 'R1', 3, a3, a4, v1, today_la + 3, '12:00'::time from h107_fx union all
select p_a, s1, div_a, 'F',  4, null::uuid, null::uuid, null::uuid, null::date, null::time from h107_fx union all
select p_b, s1, div_b, 'F',  1, b1, b2, v1, today_la + 4, '09:00'::time from h107_fx;

update public.divisions d set locked = true from h107_fx fx where d.id in (fx.div_a, fx.div_c);

-- The test org has no public link; give it one so "on the public schedule"
-- has something to be.
insert into public.public_schedule_links (org_id) select org from h107_fx;

-- Calls one function as a user (or anon). 'OK <json>' or 'ERR <sqlstate> <message>'.
create function pg_temp.h107_call(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_j   jsonb;
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute 'select ' || p_sql into v_j;
    v_out := 'OK ' || v_j::text;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

create function pg_temp.h107_del(p_role text, p_uid uuid, p_id uuid, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h107_call(p_role, p_uid, format('public.delete_playoff_bracket(%L::uuid, %L::boolean)', p_id, p_commit))
$fn$;

create function pg_temp.h107_rep(p_role text, p_uid uuid, p_id uuid, p_settings jsonb, p_games jsonb, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h107_call(p_role, p_uid, format('public.replace_playoff_games(%L::uuid, %L::jsonb, %L::jsonb, %L::boolean)',
    p_id, p_settings, p_games, p_commit))
$fn$;

-- Fingerprint of brackets and their games.
create function pg_temp.h107_snap(p_ids uuid[])
returns text language sql as $fn$
  select md5(
    coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p where p.id = any(p_ids)), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g where g.playoff_id = any(p_ids)), ''))
$fn$;

create function pg_temp.h107_logs()
returns integer language sql as $fn$
  select count(*)::integer from public.activity_log where event_type like 'playoff_bracket_%'
$fn$;

create function pg_temp.h107_j(p_txt text)
returns jsonb language sql immutable as $fn$
  select case when p_txt like 'OK %' then substr(p_txt, 4)::jsonb end
$fn$;

-- Dated playoff rows the public reader returns for one bracket.
create function pg_temp.h107_reader_count(p_org uuid, p_playoff uuid)
returns integer
language plpgsql
as $fn$
declare
  v_tok text;
  v_r   jsonb;
begin
  select token into v_tok from public.public_schedule_links where org_id = p_org;
  v_r := public.get_league_schedule_by_token(v_tok);
  if v_r ->> 'status' <> 'ok' then
    return -1;
  end if;
  return (select count(*)::integer
            from jsonb_array_elements(v_r -> 'seasons') s,
                 jsonb_array_elements(s -> 'playoff_games') g
           where (g ->> 'playoff_id')::uuid = p_playoff
             and nullif(g ->> 'scheduled_date', '') is not null);
end;
$fn$;

-- The assertions. Returns {fails, notes}. Never throws: a crash is recorded
-- as a failure after the ones already collected, so they always print.
create function pg_temp.h107_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx        h107_fx%rowtype;
  v_fails   text[] := array[]::text[];
  v_notes   text[] := array[]::text[];
  v_fns     constant text[] := array['public.delete_playoff_bracket(uuid, boolean)',
                                     'public.replace_playoff_games(uuid, jsonb, jsonb, boolean)'];
  v_fn      text;
  v_txt     text;
  v_j       jsonb;
  v_plan    text;
  v_set     jsonb;
  v_games   jsonb;
  v_snap    text;
  v_snap2   text;
  v_all     uuid[];
  v_others  uuid[];
  v_n       integer;
  v_m       integer;
  v_logs0   integer;
  v_po      public.playoffs%rowtype;
  v_old_ids uuid[];
  v_msg     text;
  v_tball_div uuid;
  v_p       uuid;
  v_ok      boolean;
begin
  select * into fx from h107_fx;
  v_all := array[fx.p_a, fx.p_b, fx.p_c, fx.p_tball];
  v_logs0 := pg_temp.h107_logs();
  select division_id into v_tball_div from public.playoffs where id = fx.p_tball;

  -- A valid settings object and payload for bracket A.
  v_set := jsonb_build_object(
    'format', 'round_robin',
    'seeding', jsonb_build_array(jsonb_build_object('team_id', fx.a1, 'team_name', 'ZZ107 Expos')),
    'start_date', to_char(fx.today_la + 5, 'YYYY-MM-DD'),
    'end_date', to_char(fx.today_la + 12, 'YYYY-MM-DD'),
    'playing_days', jsonb_build_array('Sa'),
    'day_windows', jsonb_build_object('Sa', jsonb_build_object('start', '09:00', 'end', '17:00')),
    'venue_assignments', jsonb_build_array(jsonb_build_object('venue_id', fx.v1)),
    'cross_division_enabled', false,
    'cross_division_opponent_id', null);
  v_games := jsonb_build_array(
    jsonb_build_object('round', 'RR1', 'game_number', 1, 'home_team_id', fx.a1, 'away_team_id', fx.a2,
      'venue_id', fx.v1, 'scheduled_date', to_char(fx.today_la + 5, 'YYYY-MM-DD'), 'start_time', '09:00'),
    jsonb_build_object('round', 'RR1', 'game_number', 2, 'home_team_id', fx.a3, 'away_team_id', fx.a4,
      'venue_id', fx.v1, 'scheduled_date', to_char(fx.today_la + 5, 'YYYY-MM-DD'), 'start_time', '12:00'),
    jsonb_build_object('round', 'RR2', 'game_number', 3, 'home_team_id', fx.a1, 'away_team_id', fx.a3,
      'venue_id', null, 'scheduled_date', null, 'start_time', null),
    jsonb_build_object('round', 'RR2', 'game_number', 4, 'home_team_id', fx.a2, 'away_team_id', fx.a4,
      'venue_id', null, 'scheduled_date', null, 'start_time', null));

  begin
    -- ── P1 ──────────────────────────────────────────────────────────────────
    foreach v_fn in array v_fns loop
      if not has_function_privilege('authenticated', v_fn, 'execute')
         or has_function_privilege('anon', v_fn, 'execute')
         or has_function_privilege('service_role', v_fn, 'execute')
         or has_function_privilege('dashboard_readonly', v_fn, 'execute')
         or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = v_fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
         or not (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
        v_fails := array_append(v_fails, 'P1: privileges wrong (or not SECURITY DEFINER) on ' || v_fn);
      end if;
    end loop;

    v_snap := pg_temp.h107_snap(v_all);

    -- ── AN1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h107_del('anon', null, fx.p_a, true);
    if v_txt not like 'ERR 42501%' then
      v_fails := array_append(v_fails, 'AN1: anon called delete: ' || v_txt);
    end if;
    v_txt := pg_temp.h107_rep('anon', null, fx.p_a, v_set, v_games, true);
    if v_txt not like 'ERR 42501%' then
      v_fails := array_append(v_fails, 'AN1: anon called replace: ' || v_txt);
    end if;
    v_txt := pg_temp.h107_del('authenticated', fx.nonmember, fx.p_a, true);
    if v_txt not like 'ERR 42501%not_authorized%' then
      v_fails := array_append(v_fails, 'AN1: a non-member was not refused by delete: ' || v_txt);
    end if;
    v_txt := pg_temp.h107_rep('authenticated', fx.nonmember, fx.p_a, v_set, v_games, true);
    if v_txt not like 'ERR 42501%not_authorized%' then
      v_fails := array_append(v_fails, 'AN1: a non-member was not refused by replace: ' || v_txt);
    end if;
    if pg_temp.h107_snap(v_all) <> v_snap or pg_temp.h107_logs() <> v_logs0 then
      v_fails := array_append(v_fails, 'AN1: a refused call wrote something');
    end if;

    -- ── PL1 ─────────────────────────────────────────────────────────────────
    select plan into v_plan from public.profiles where id = fx.org;
    update public.profiles set plan = 'pro' where id = fx.org;
    v_ok := true;
    foreach v_txt in array array[
      pg_temp.h107_del('authenticated', fx.org, fx.p_a, false),
      pg_temp.h107_del('authenticated', fx.org, fx.p_a, true),
      pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set, v_games, false),
      pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set, v_games, true)] loop
      if v_txt not like 'ERR P0001 plan_required%' then
        v_fails := array_append(v_fails, 'PL1: a Pro org was not refused: ' || v_txt);
      end if;
    end loop;
    update public.profiles set plan = v_plan where id = fx.org;
    if pg_temp.h107_snap(v_all) <> v_snap or pg_temp.h107_logs() <> v_logs0 then
      v_fails := array_append(v_fails, 'PL1: a Pro org''s refused call wrote something');
    end if;

    -- ── VL1 ─────────────────────────────────────────────────────────────────
    for v_txt, v_msg in
      select * from (values
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set, '[]'::jsonb, true), 'no_games'),
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set,
           jsonb_set(v_games, '{1,game_number}', '1'::jsonb), true), 'invalid_games'),
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set,
           jsonb_set(v_games, '{0,game_number}', '"one"'::jsonb), true), 'invalid_games'),
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set,
           jsonb_set(v_games, '{0,home_team_id}', '"nope"'::jsonb), true), 'invalid_games'),
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set,
           jsonb_set(v_games, '{3,away_team_id}', to_jsonb(fx.x1)), true), 'team_not_in_season'),
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set,
           jsonb_set(v_games, '{1,venue_id}', to_jsonb(fx.v_foreign)), true), 'venue_not_in_org'),
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a,
           jsonb_set(v_set, '{format}', '"triple_elimination"'::jsonb), v_games, true), 'invalid_settings'),
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set - 'seeding', v_games, true), 'invalid_settings'),
        (pg_temp.h107_rep('authenticated', fx.org, fx.p_a,
           jsonb_set(jsonb_set(v_set, '{cross_division_enabled}', 'true'::jsonb),
                     '{cross_division_opponent_id}', to_jsonb(fx.div_x)), v_games, true), 'invalid_settings')
      ) t(res, want)
    loop
      if v_txt not like 'ERR P0001 ' || v_msg || '%' then
        v_fails := array_append(v_fails, format('VL1: expected %s, got %s', v_msg, v_txt));
      end if;
    end loop;
    if pg_temp.h107_snap(v_all) <> v_snap or pg_temp.h107_logs() <> v_logs0 then
      v_fails := array_append(v_fails, 'VL1: a refused rebuild wrote something');
    end if;

    -- ── PV1 ─────────────────────────────────────────────────────────────────
    v_j := pg_temp.h107_j(pg_temp.h107_del('authenticated', fx.org, fx.p_a, false));
    if v_j is null or (v_j ->> 'committed')::boolean or (v_j ->> 'games')::int <> 3
       or (v_j ->> 'dated_games')::int <> 2 or (v_j ->> 'games_with_results')::int <> 0
       or (v_j ->> 'public_games')::int <> 2 then
      v_fails := array_append(v_fails, 'PV1: preview counts for A wrong: ' || coalesce(v_j::text, 'error'));
    end if;
    v_j := pg_temp.h107_j(pg_temp.h107_del('authenticated', fx.org, fx.p_tball, false));
    if v_j is null or (v_j ->> 'committed')::boolean or (v_j ->> 'games')::int <> 7
       or (v_j ->> 'dated_games')::int <> 7 or (v_j ->> 'games_with_results')::int <> 2
       or (v_j ->> 'public_games')::int <> 7 or (v_j ->> 'blocked')::boolean then
      v_fails := array_append(v_fails, 'PV1: preview counts for T-Ball wrong: ' || coalesce(v_j::text, 'error'));
    end if;
    if pg_temp.h107_snap(v_all) <> v_snap or pg_temp.h107_logs() <> v_logs0 then
      v_fails := array_append(v_fails, 'PV1: a delete preview wrote something');
    end if;

    -- ── PV2 ─────────────────────────────────────────────────────────────────
    v_j := pg_temp.h107_j(pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set, v_games, false));
    if v_j is null or (v_j ->> 'committed')::boolean or (v_j ->> 'blocked')::boolean
       or (v_j ->> 'games')::int <> 3 or (v_j ->> 'new_games')::int <> 4
       or (v_j ->> 'new_dated_games')::int <> 2 or (v_j ->> 'public_games')::int <> 2
       or (v_j ->> 'public_games_after')::int <> 2 or (v_j ->> 'status') <> 'active' then
      v_fails := array_append(v_fails, 'PV2: replace preview for A wrong: ' || coalesce(v_j::text, 'error'));
    end if;
    if pg_temp.h107_snap(v_all) <> v_snap or pg_temp.h107_logs() <> v_logs0 then
      v_fails := array_append(v_fails, 'PV2: a replace preview wrote something');
    end if;

    -- ── PUB1 ────────────────────────────────────────────────────────────────
    foreach v_p in array array[fx.p_a, fx.p_b, fx.p_c, fx.p_tball] loop
      v_n := pg_temp.h107_reader_count(fx.org, v_p);
      v_m := (pg_temp.h107_j(pg_temp.h107_del('authenticated', fx.org, v_p, false)) ->> 'public_games')::int;
      if v_m is distinct from v_n then
        v_fails := array_append(v_fails, format('PUB1: delete says %s on the public schedule, the reader returns %s (bracket %s)', v_m, v_n, v_p));
      end if;
    end loop;
    v_j := pg_temp.h107_j(pg_temp.h107_rep('authenticated', fx.org, fx.p_b,
             v_set, jsonb_build_array(jsonb_build_object('round', 'F', 'game_number', 1, 'home_team_id', fx.b1,
               'away_team_id', fx.b2, 'venue_id', fx.v1, 'scheduled_date', to_char(fx.today_la + 4, 'YYYY-MM-DD'),
               'start_time', '09:00')), false));
    if v_j is null or (v_j ->> 'public_games')::int <> 0 or (v_j ->> 'public_games_after')::int <> 0
       or (v_j ->> 'dated_games')::int <> 1 then
      v_fails := array_append(v_fails, 'PUB1: an unlocked division''s bracket counted as public by replace: ' || coalesce(v_j::text, 'error'));
    end if;
    update public.public_schedule_links set enabled = false where org_id = fx.org;
    v_m := (pg_temp.h107_j(pg_temp.h107_del('authenticated', fx.org, fx.p_tball, false)) ->> 'public_games')::int;
    v_n := (pg_temp.h107_j(pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set, v_games, false)) ->> 'public_games_after')::int;
    update public.public_schedule_links set enabled = true where org_id = fx.org;
    if v_m is distinct from 0 or v_n is distinct from 0 then
      v_fails := array_append(v_fails, format('PUB1: with the link OFF, delete counts %s and replace-after counts %s (want 0, 0)', v_m, v_n));
    end if;

    -- ── RB1 ─────────────────────────────────────────────────────────────────
    v_set := jsonb_set(v_set, '{format}', '"double_elimination"'::jsonb);
    for v_txt in
      select pg_temp.h107_rep('authenticated', fx.org, fx.p_tball, v_set,
        jsonb_build_array(jsonb_build_object('round', 'GF', 'game_number', 1)), c)
        from unnest(array[false, true]) c
    loop
      v_j := pg_temp.h107_j(v_txt);
      if v_j is null or not (v_j ->> 'blocked')::boolean or (v_j ->> 'committed')::boolean
         or not (v_j -> 'reasons') ? 'results_entered' or (v_j ->> 'games_with_results')::int <> 2 then
        v_fails := array_append(v_fails, 'RB1: a bracket with results was not blocked: ' || v_txt);
      end if;
    end loop;
    if pg_temp.h107_snap(v_all) <> v_snap or pg_temp.h107_logs() <> v_logs0 then
      v_fails := array_append(v_fails, 'RB1: a blocked rebuild wrote something');
    end if;
    v_set := jsonb_set(v_set, '{format}', '"round_robin"'::jsonb);

    -- ── AT1 ─────────────────────────────────────────────────────────────────
    v_snap2 := pg_temp.h107_snap(array[fx.p_b]);
    select array_agg(id order by id) into v_old_ids from public.playoff_games where playoff_id = fx.p_b;
    v_txt := pg_temp.h107_rep('authenticated', fx.org, fx.p_b,
      jsonb_set(v_set, '{format}', '"double_elimination"'::jsonb),
      jsonb_build_array(
        jsonb_build_object('round', 'F', 'game_number', 1, 'home_team_id', fx.b1, 'away_team_id', fx.b2,
          'venue_id', fx.v1, 'scheduled_date', to_char(fx.today_la + 6, 'YYYY-MM-DD'), 'start_time', '10:00'),
        jsonb_build_object('round', 'F', 'game_number', 2, 'home_team_id', fx.b2, 'away_team_id', fx.b1,
          'venue_id', fx.v1, 'scheduled_date', '2026-02-30', 'start_time', '10:00')),
      true);
    if v_txt not like 'ERR %' then
      v_fails := array_append(v_fails, 'AT1: a rebuild with an impossible date succeeded: ' || v_txt);
    end if;
    if pg_temp.h107_snap(array[fx.p_b]) <> v_snap2
       or (select array_agg(id order by id) from public.playoff_games where playoff_id = fx.p_b) is distinct from v_old_ids
       or pg_temp.h107_logs() <> v_logs0 then
      v_fails := array_append(v_fails, 'AT1: a failed rebuild left a change behind (games, settings, status or log)');
    end if;
    v_notes := array_append(v_notes, 'AT1 refusal: ' || v_txt);

    -- ── RB2 ─────────────────────────────────────────────────────────────────
    v_snap2 := pg_temp.h107_snap(array[fx.p_b, fx.p_tball]);
    select array_agg(id) into v_old_ids from public.playoff_games where playoff_id = fx.p_a;
    v_txt := pg_temp.h107_rep('authenticated', fx.org, fx.p_a, v_set, v_games, true);
    v_j := pg_temp.h107_j(v_txt);
    select * into v_po from public.playoffs where id = fx.p_a;
    if v_j is null or not (v_j ->> 'committed')::boolean or (v_j ->> 'blocked')::boolean then
      v_fails := array_append(v_fails, 'RB2: rebuilding a bracket in a locked division failed: ' || v_txt);
    elsif v_po.format <> 'round_robin' or v_po.status <> 'active'
       or v_po.playing_days <> array['Sa'] or v_po.start_date <> fx.today_la + 5
       or v_po.venue_assignments <> v_set -> 'venue_assignments' or v_po.seeding <> v_set -> 'seeding' then
      v_fails := array_append(v_fails, 'RB2: settings not replaced: ' || row_to_json(v_po)::text);
    elsif exists (select 1 from public.playoff_games where id = any(v_old_ids))
       or (select count(*) from public.playoff_games where playoff_id = fx.p_a) <> 4
       or exists (select 1 from public.playoff_games where playoff_id = fx.p_a
                   and (status <> 'scheduled' or home_score is not null or away_score is not null
                        or winner_id is not null or league_id <> fx.s1 or division_id <> fx.div_a))
       or (select count(*) from public.playoff_games where playoff_id = fx.p_a and scheduled_date = fx.today_la + 5
             and start_time = '12:00' and home_team_id = fx.a3 and game_number = 2 and round = 'RR1') <> 1 then
      v_fails := array_append(v_fails, 'RB2: the bracket does not hold exactly the new games');
    elsif (v_j ->> 'public_games_after')::int <> 2 or pg_temp.h107_reader_count(fx.org, fx.p_a) <> 2 then
      v_fails := array_append(v_fails, 'RB2: public counts after the rebuild wrong: ' || v_txt);
    end if;
    -- A draft bracket with no games is generated the same way.
    v_txt := pg_temp.h107_rep('authenticated', fx.org, fx.p_c,
      jsonb_set(v_set, '{format}', '"single_elimination"'::jsonb),
      jsonb_build_array(jsonb_build_object('round', 'F', 'game_number', 1, 'home_team_id', fx.c1, 'away_team_id', fx.c2)),
      true);
    if v_txt not like 'OK %' or (select status from public.playoffs where id = fx.p_c) <> 'active'
       or (select count(*) from public.playoff_games where playoff_id = fx.p_c) <> 1 then
      v_fails := array_append(v_fails, 'RB2: generating a draft bracket failed: ' || v_txt);
    end if;
    if pg_temp.h107_snap(array[fx.p_b, fx.p_tball]) <> v_snap2 then
      v_fails := array_append(v_fails, 'RB2: a rebuild changed another bracket');
    end if;

    -- ── DL1 ─────────────────────────────────────────────────────────────────
    v_others := array(select id from public.playoffs where id <> fx.p_tball);
    v_snap2 := pg_temp.h107_snap(v_others);
    v_n := (select count(*) from public.playoffs);
    v_m := (select count(*) from public.playoff_games);
    if not (select locked from public.divisions where id = v_tball_div) then
      v_notes := array_append(v_notes, 'DL1 VACUOUS: the T-Ball division is not locked');
    end if;
    v_txt := pg_temp.h107_del('authenticated', fx.org, fx.p_tball, true);
    v_j := pg_temp.h107_j(v_txt);
    if v_j is null or not (v_j ->> 'committed')::boolean or (v_j ->> 'games_with_results')::int <> 2 then
      v_fails := array_append(v_fails, 'DL1: deleting a bracket with results in a locked division failed: ' || v_txt);
    elsif exists (select 1 from public.playoffs where id = fx.p_tball)
       or exists (select 1 from public.playoff_games where playoff_id = fx.p_tball) then
      v_fails := array_append(v_fails, 'DL1: the bracket row or its games survived the delete');
    elsif (select count(*) from public.playoffs) <> v_n - 1
       or (select count(*) from public.playoff_games) <> v_m - 7
       or pg_temp.h107_snap(v_others) <> v_snap2 then
      v_fails := array_append(v_fails, 'DL1: the delete touched something other than the one bracket and its 7 games');
    end if;

    -- ── RL1 ─────────────────────────────────────────────────────────────────
    if pg_temp.h107_snap(array[fx.p_real]) <> fx.real_fp then
      v_fails := array_append(v_fails, 'RL1: THE REAL LEAGUE''S BRACKET CHANGED');
    end if;

    -- ── LG1 ─────────────────────────────────────────────────────────────────
    if pg_temp.h107_logs() - v_logs0 <> 3 then
      v_fails := array_append(v_fails, format('LG1: %s log rows for 3 writes', pg_temp.h107_logs() - v_logs0));
    end if;
    select message into v_msg from public.activity_log
     where event_type = 'playoff_bracket_rebuilt' and league_id = fx.s1 and division_id = fx.div_a;
    if v_msg is distinct from 'ZZ107 Majors playoff bracket rebuilt (round robin, 3 games replaced with 4, 2 dated)' then
      v_fails := array_append(v_fails, 'LG1: rebuild log wrong: ' || coalesce(v_msg, 'missing'));
    end if;
    select message into v_msg from public.activity_log
     where event_type = 'playoff_bracket_generated' and league_id = fx.s1 and division_id = fx.div_c;
    if v_msg is distinct from 'ZZ107 Rookies playoff bracket generated (single elimination, 1 game, 0 dated)' then
      v_fails := array_append(v_fails, 'LG1: generate log wrong: ' || coalesce(v_msg, 'missing'));
    end if;
    select message into v_msg from public.activity_log
     where event_type = 'playoff_bracket_deleted' and division_id = v_tball_div;
    if v_msg is distinct from 'T-Ball playoff bracket deleted (double elimination, 7 games, 2 with results, 7 dated)' then
      v_fails := array_append(v_fails, 'LG1: delete log wrong: ' || coalesce(v_msg, 'missing'));
    end if;
  exception when others then
    v_fails := array_append(v_fails, 'CRASH: ' || sqlstate || ' ' || sqlerrm);
  end;

  return jsonb_build_object('fails', to_jsonb(v_fails), 'notes', to_jsonb(v_notes));
end;
$fn$;

do $h107$
declare
  v_out   text := E'\n';
  v_m     jsonb;
  v_first text;
  v_tag   text;
  v_def   text;
  v_mut   text;
  m       record;
  v_del   constant text := 'public.delete_playoff_bracket(uuid, boolean)';
  v_rep   constant text := 'public.replace_playoff_games(uuid, jsonb, jsonb, boolean)';
begin
  execute $mig107$
-- @@MIGRATION_0107@@
$mig107$;

  -- Baseline, in its own rolled-back block like every mutant.
  begin
    v_m := pg_temp.h107_assert();
    raise exception 'H107_RESULT %', v_m::text;
  exception when others then
    if sqlerrm like 'H107_RESULT %' then
      v_m := substr(sqlerrm, 13)::jsonb;
      v_out := v_out || format(E'BASELINE failures (%s): %s\nNOTES: %s\n',
        jsonb_array_length(v_m -> 'fails'), v_m -> 'fails', v_m -> 'notes');
    else
      v_out := v_out || format(E'BASELINE CRASH %s %s\n', sqlstate, sqlerrm);
    end if;
  end;

  for m in
    select * from (values
      ('MU1a', 'delete: membership gate removed', 'AN1', v_del,
        $a$if not public.is_org_member(v_league.owner_id) then$a$, $a$if false then$a$, null::text, null::text),
      ('MU1b', 'replace: membership gate removed', 'AN1', v_rep,
        $a$if not public.is_org_member(v_league.owner_id) then$a$, $a$if false then$a$, null, null),
      ('MU2a', 'delete: plan gate removed', 'PL1', v_del,
        $a$if v_plan is null or v_plan <> 'elite' then$a$, $a$if false then$a$, null, null),
      ('MU2b', 'replace: plan gate removed', 'PL1', v_rep,
        $a$if v_plan is null or v_plan <> 'elite' then$a$, $a$if false then$a$, null, null),
      ('MU3', 'replace: result block removed', 'RB1', v_rep,
        $a$if v_results > 0 then$a$, $a$if false then$a$, null, null),
      ('MU4a', 'delete: preview commits', 'PV1', v_del,
        $a$if p_commit then$a$, $a$if true then$a$, null, null),
      ('MU4b', 'replace: preview commits', 'PV2', v_rep,
        $a$if p_commit then$a$, $a$if true then$a$, null, null),
      ('MU5', 'delete removes the games but not the bracket row', 'DL1', v_del,
        $a$delete from public.playoffs where id = v_po.id;$a$,
        $a$delete from public.playoff_games where playoff_id = v_po.id;$a$, null, null),
      ('MU6a', 'replace: log skipped', 'LG1', v_rep,
        $a$values (v_po.league_id, v_po.division_id, v_event, v_message);$a$,
        $a$select v_po.league_id, v_po.division_id, v_event, v_message where false;$a$, null, null),
      ('MU6b', 'delete: log skipped', 'LG1', v_del,
        $a$values (v_po.league_id, v_po.division_id, 'playoff_bracket_deleted', v_message);$a$,
        $a$select v_po.league_id, v_po.division_id, 'playoff_bracket_deleted', v_message where false;$a$, null, null),
      ('MU7', 'replace deletes without inserting', 'RB2', v_rep,
        $a$    insert into public.playoff_games
      (playoff_id,$a$, $a$    /* MU7: insert removed
      (playoff_id,$a$,
        $a$      from jsonb_array_elements(p_games) e;
$a$, $a$      from jsonb_array_elements(p_games) e; */
$a$),
      ('MU8', 'EXECUTE left on PUBLIC', 'P1', null,
        null, $a$grant execute on function public.delete_playoff_bracket(uuid, boolean) to public$a$, null, null),
      ('MU9', 'delete: public count ignores the lock', 'PUB1', v_del,
        $a$     and d.locked
$a$, $a$
$a$, null, null),
      ('MU10', 'replace: the lock gates the rebuild', 'RB2', v_rep,
        $a$  if p_commit then
    update public.playoffs$a$,
        $a$  if p_commit and exists (select 1 from public.divisions d where d.id = v_po.division_id and d.locked) then
    raise exception 'division_locked' using errcode = 'P0001';
  end if;
  if p_commit then
    update public.playoffs$a$, null, null),
      ('MU11', 'delete: the lock gates the delete', 'DL1', v_del,
        $a$  if p_commit then
    delete from public.playoffs$a$,
        $a$  if p_commit and exists (select 1 from public.divisions d where d.id = v_po.division_id and d.locked) then
    raise exception 'division_locked' using errcode = 'P0001';
  end if;
  if p_commit then
    delete from public.playoffs$a$, null, null)
    ) as t(id, what, target, fn, find, repl, find2, repl2)
  loop
    begin
      if m.fn is null then
        execute m.repl;
      else
        v_def := pg_get_functiondef(m.fn::regprocedure);
        if position(m.find in v_def) = 0
           or (m.find2 is not null and position(m.find2 in v_def) = 0) then
          raise exception 'MUTANT_NOOP';
        end if;
        v_mut := replace(v_def, m.find, m.repl);
        if m.find2 is not null then
          v_mut := replace(v_mut, m.find2, m.repl2);
        end if;
        execute v_mut;
      end if;
      v_m := pg_temp.h107_assert();
      raise exception 'H107_RESULT %', v_m::text;
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm like 'H107_RESULT %' then
        v_m := substr(sqlerrm, 13)::jsonb;
        v_first := v_m -> 'fails' ->> 0;
        v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
        v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s); first: %s\n',
          m.id, m.what,
          case when v_first is null then 'SURVIVED'
               when v_tag = m.target then 'KILLED'
               else 'KILLED AT THE WRONG ASSERTION' end,
          v_tag, m.target, jsonb_array_length(v_m -> 'fails'), left(coalesce(v_first, ''), 160));
      else
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  v_out := v_out || format(E'prosrc md5 delete_playoff_bracket: %s\nprosrc md5 replace_playoff_games: %s\n',
    (select md5(prosrc) from pg_proc where oid = v_del::regprocedure),
    (select md5(prosrc) from pg_proc where oid = v_rep::regprocedure));

  raise exception '%', v_out;
end;
$h107$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname in ('delete_playoff_bracket', 'replace_playoff_games')) as fns_must_be_0,
--   (select count(*) from leagues where name like 'ZZ107%') + (select count(*) from venues where name like 'ZZ107%')
--     + (select count(*) from activity_log where event_type like 'playoff_bracket_%') as fixtures_must_be_0,
--   (select count(*) from public_schedule_links where org_id = 'aa21d01c-66dc-4c37-b15c-7b743c557eea') as test_link_must_be_0,
--   (select plan from profiles where id = 'aa21d01c-66dc-4c37-b15c-7b743c557eea') as test_plan_elite,
--   (select count(*) from playoff_games where playoff_id = 'adceb235-a279-454f-a9a9-1f301ff93c5e') as tball_games_7,
--   (select count(*) from playoff_games where playoff_id = 'c903bbb7-3e4a-4536-95e4-a677abb45192') as real_games_5;

-- ── RUN LOG ─────────────────────────────────────────────────────────────────
-- 2026-10-08 — against production, test org "SRALL" fixtures + its T-Ball
-- bracket only (plus one field in the "test" org as the wrong-org field),
-- rolled back. No other active client backend before either run.
-- Run 1: GREEN. BASELINE failures (0). 15/15 mutants KILLED at their own
--   tag — but the per-mutant lines printed every failure, so the output was
--   truncated in the middle and MU2b / MU3's lines could not be read. The
--   mutant line was changed to print the count and the FIRST failure only,
--   and the batch was run again unchanged otherwise.
-- Run 2: GREEN.
--   BASELINE failures (0): []
--   NOTE: AT1 refusal: ERR 22008 date/time field value out of range:
--     "2026-02-30" (the insert failed AFTER the delete; everything stood)
--   MU1a → KILLED [AN1]   MU1b → KILLED [AN1]   MU2a → KILLED [PL1]
--   MU2b → KILLED [PL1]   MU3  → KILLED [RB1]   MU4a → KILLED [PV1]
--   MU4b → KILLED [PV2]   MU5  → KILLED [DL1]   MU6a → KILLED [LG1]
--   MU6b → KILLED [LG1]   MU7  → KILLED [RB2]   MU8  → KILLED [P1]
--   MU9  → KILLED [PUB1]  MU10 → KILLED [RB2]   MU11 → KILLED [DL1]
--   prosrc md5 inside the batch: delete_playoff_bracket
--   f628628e93de210df18a7869cdb85e0f, replace_playoff_games
--   ae2a1f70a09a3396f398dc1bdca9fbba — both equal to the bodies computed
--   from the repo file.
-- Leak check after: functions 0, ZZ107 fixtures + playoff_bracket_* log rows
-- 0, test org public link 0, test org plan elite, T-Ball bracket 7 games,
-- real league 50/70 bracket 5 games, playoffs 4.
-- 0107 NOT APPLIED — waiting on the founder's timing.

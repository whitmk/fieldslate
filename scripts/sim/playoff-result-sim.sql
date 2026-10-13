-- SQL-level proof for migration 0108 (enter_playoff_result and
-- clear_playoff_result — enter and clear a playoff result, one advancement
-- rule for both).
--
-- WHY SQL: the behavior is two SECURITY DEFINER functions' refusals, grants
-- exercised as `anon` and `authenticated`, row-count checks that only a real
-- UPDATE can exercise, and an advancement rule that must agree with
-- advancement.ts. NOT `npm run`-able, NOT in CI (CLAUDE.md, "Harness standard
-- — SQL-level exceptions").
--
-- THIS HARNESS APPLIES 0108 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK, so it runs BEFORE the migration is applied. The text proven is the
-- repo file: the build script substitutes it for the placeholder below.
--
-- HOW TO RUN: `npx tsx scripts/sim/playoff-result-build.ts > <file>`, send the
-- output as ONE batch through the Supabase MCP (one batch = one transaction),
-- read the raised message, then run the leak check at the bottom.
--
-- EVERY PASS IS ITS OWN ROLLED-BACK SUB-TRANSACTION. The baseline and each
-- mutant start from the same fixtures: a pass raises its results out, which
-- undoes every write it (and its mutant) made. The assertions run IN ORDER
-- and later ones build on the bracket state earlier ones leave behind.
--
-- THE CROSS-CHECK TABLE. The block between the XC-TABLE-BEGIN / XC-TABLE-END
-- marker lines is the ONE copy of the expected advancement for 4-, 6- (byes)
-- and 8-team single-elimination brackets: (teams, round, game number, home
-- seed, away seed, target game number, target slot). This harness builds the
-- brackets from it and requires playoff_single_elim_target to return every
-- target (XC1). `npm run sim:playoff-result` PARSES THE SAME BLOCK OUT OF THIS
-- FILE, requires the bracket layout to equal buildSingleElimination's output
-- and computeSingleElimAdvancement to return every target. Change either rule
-- alone and its side goes red. Keep each marker alone on its line, one row
-- per line; never add a second copy of the table anywhere.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: one to two seconds)
--   Creating functions takes no table lock. CREATE TRIGGER on playoff_games
--   (the zero-row hook, rolled back) takes SHARE ROW EXCLUSIVE on
--   playoff_games for the whole run: it blocks result entry, game edits and
--   bracket writes in every org for the run, not reads. Row locks on the
--   fixture rows. The test org owner's `profiles` ROW (plan switched for PL1,
--   rolled back) — blocks writes to that one row. A `public_schedule_links`
--   row is INSERTED for the test org (it has none; rolled back). Locking the
--   fixture division fires team_calendar_links_on_division_lock, which inserts
--   calendar-link rows for its teams (rolled back).
--   lock_timeout = 3s; statement_timeout = 60s.
--
-- ROWS TOUCHED (all rolled back): the test org "SRALL" only (owner
-- aa21d01c-66dc-4c37-b15c-7b743c557eea) — one fixture season, five divisions,
-- 22 teams, five fixture brackets and their games, a public link row,
-- activity-log rows, and the owner's profiles.plan. The "test" org owner
-- (bbf9afe1-9e62-41e0-becc-895085bfc9d6, not a member of SRALL) is the
-- non-member caller and nothing of theirs is written. The test org's three
-- existing brackets (AAA, AA, T-Ball) are fingerprinted and never a function
-- argument (OT1). NOTHING belonging to Santa Rosa American Little League
-- (owner 8fde72f9-cd5a-43ad-91e3-db14fb6fbcc4) is written or passed to any
-- function; its playoffs, playoff games and playoff log rows are
-- fingerprinted before the run and after every pass (RL1, checked last).
--
-- ASSERTIONS (in order; a mutant must die FIRST at its own tag)
--   P1   privileges: enter/clear authenticated only (not anon / service_role /
--        dashboard_readonly / PUBLIC), SECURITY DEFINER, search_path pinned;
--        the two helpers callable by no role
--   AN1  anon cannot call either; a non-member is refused (42501
--        not_authorized) by both; nothing written
--   PL1  a non-Elite (Pro) org is refused plan_required by both; nothing
--        written
--   XC1  playoff_single_elim_target returns exactly the table's target and
--        slot for every game of the 4-, 6- and 8-team brackets
--   DE1  double elimination is refused by both (format_not_supported)
--   VL1  enter refuses a tie, a negative score, a game missing a team; clear
--        refuses a game with no result; nothing written
--   EN1  enter writes the result (status, scores, winner) and puts the winner
--        in the table's slot of the next game; an EDIT flipping the winner
--        replaces this game's previous winner in that slot; the reply is
--        committed and echoes the game id
--   PV1  clear's PREVIEW writes nothing and names the result and the team
--        that would be removed from which game
--   PUB1 on_public_schedule: true for a locked division's dated next game
--        with an enabled link; false for an unlocked division
--   LK1  clearing in a LOCKED division succeeds
--   BY1  a team seeded into round 2 by a BYE is never moved by entering or
--        clearing the round-1 game that feeds the same game
--   RT1  enter → clear → enter a different winner leaves the bracket exactly
--        as entering the second winner directly (status, scores, winners,
--        every slot)
--   CL1  clear returns the game to scheduled with no scores and no winner;
--        the reply is committed and echoes the game id
--   CL2  clear removes this game's winner from the next game's slot, and
--        only that slot
--   LB1  a game whose next game has a result can be neither cleared nor
--        edited (blocked / next_game_has_result, naming that game; nothing
--        written); clearing latest-round-first then works
--   ZR1  a clear whose UPDATE changes zero rows raises nothing_saved and
--        writes nothing (never a committed reply)
--   ZR2  the same for enter
--   RR1  round robin: enter and clear touch only that game
--   OT1  the test org's existing brackets are byte-identical
--   LG1  exactly one log row per committed enter/clear
--        (playoff_result_entered / playoff_result_cleared), none otherwise
--   RL1  the real league's playoff rows and playoff log rows are unchanged
--
-- MUTANTS (each rewrites a REAL function inside its own rolled-back block;
-- KILLED only if the FIRST failure is its own tag)
--   MU1a enter: membership gate removed                    → AN1
--   MU1b clear: membership gate removed                    → AN1
--   MU2a enter: plan gate removed (non-Elite allowed)      → PL1
--   MU2b clear: plan gate removed (non-Elite allowed)      → PL1
--   MU3  helper: slot parity flipped (cross-check skew)    → XC1
--   MU4  clear: double elimination allowed                 → DE1
--   MU5  clear: preview commits                            → PV1
--   MU6  clear: the lock gates the clear                   → LK1
--   MU7  clear empties the OTHER slot (bye team removed)   → BY1
--   MU8  clear leaves the winner in the next game
--        (round-trip drift)                                → RT1
--   MU9  clear empties home slots only (next game's slot
--        not cleared)                                      → CL2
--   MU10 clear leaves the status completed                 → CL1
--   MU11 clear allowed while the next game has a result    → LB1
--   MU12 enter: edit allowed while the next game has one   → LB1
--   MU13 clear: zero-row write reported as success         → ZR1
--   MU14 enter: zero-row write reported as success         → ZR2
--   MU15 clear: log skipped                                → LG1
--   MU16 EXECUTE left on PUBLIC                            → P1
--
-- RUN LOG: see the bottom of this file after the run.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

-- @@MIGRATION_0108@@

create temp table h108_fx on commit drop as
select
  'aa21d01c-66dc-4c37-b15c-7b743c557eea'::uuid as org,
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as nonmember,
  '8fde72f9-cd5a-43ad-91e3-db14fb6fbcc4'::uuid as real_org,
  array['79cb7d31-0c05-4ee6-a81f-27c3567a7aed', '78c500e5-2466-42e7-8164-7655e640ce9b',
        'adceb235-a279-454f-a9a9-1f301ff93c5e']::uuid[] as existing,
  (now() at time zone 'America/Los_Angeles')::date as today_la,
  gen_random_uuid() as s1,
  gen_random_uuid() as d4, gen_random_uuid() as d6, gen_random_uuid() as d8,
  gen_random_uuid() as drr, gen_random_uuid() as dde,
  gen_random_uuid() as p4, gen_random_uuid() as p6, gen_random_uuid() as p8,
  gen_random_uuid() as prr, gen_random_uuid() as pde,
  gen_random_uuid() as rr_a, gen_random_uuid() as rr_b,
  gen_random_uuid() as de_a, gen_random_uuid() as de_b,
  ''::text as real_fp, ''::text as existing_fp;

-- The cross-check table — see the header. ONE copy; the TypeScript sim reads it.
create temp table h108_xc (n integer, round text, game_number integer, home_seed integer,
                           away_seed integer, target_number integer, target_field text) on commit drop;
insert into h108_xc (n, round, game_number, home_seed, away_seed, target_number, target_field) values
-- XC-TABLE-BEGIN
  (4, 'R1', 1, 1, 4, 3, 'home_team_id'),
  (4, 'R1', 2, 2, 3, 3, 'away_team_id'),
  (4, 'F', 3, null, null, null, null),
  (6, 'R1', 2, 4, 5, 5, 'away_team_id'),
  (6, 'R1', 4, 3, 6, 6, 'away_team_id'),
  (6, 'SF', 5, 1, null, 7, 'home_team_id'),
  (6, 'SF', 6, 2, null, 7, 'away_team_id'),
  (6, 'F', 7, null, null, null, null),
  (8, 'R1', 1, 1, 8, 5, 'home_team_id'),
  (8, 'R1', 2, 4, 5, 5, 'away_team_id'),
  (8, 'R1', 3, 2, 7, 6, 'home_team_id'),
  (8, 'R1', 4, 3, 6, 6, 'away_team_id'),
  (8, 'SF', 5, null, null, 7, 'home_team_id'),
  (8, 'SF', 6, null, null, 7, 'away_team_id'),
  (8, 'F', 7, null, null, null, null)
-- XC-TABLE-END
;

-- Seeded teams for the three elimination brackets.
create temp table h108_team on commit drop as
select v.n, s.seed, gen_random_uuid() as id
  from (values (4), (6), (8)) v(n), lateral generate_series(1, v.n) s(seed);

-- Fingerprints taken before anything else happens.
update h108_fx set
  real_fp = md5(
    coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p
               join public.leagues l on l.id = p.league_id where l.owner_id = h108_fx.real_org), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g
               join public.leagues l on l.id = g.league_id where l.owner_id = h108_fx.real_org), '') || '#' ||
    coalesce((select string_agg(a.id::text, '|' order by a.id) from public.activity_log a
               join public.leagues l on l.id = a.league_id
              where l.owner_id = h108_fx.real_org and a.event_type like 'playoff_%'), '')),
  existing_fp = md5(
    coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p where p.id = any(h108_fx.existing)), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g where g.playoff_id = any(h108_fx.existing)), ''));

-- Fixtures. The 6-team division is locked AFTER its teams exist.
insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
select s1, 'ZZ108 Season', 'Baseball', 'Fall 2026', org, today_la - 30, today_la + 30 from h108_fx;

insert into public.divisions (id, league_id, name, settings)
select d4,  s1, 'ZZ108 Four',   '{"game_duration": 90}'::jsonb from h108_fx union all
select d6,  s1, 'ZZ108 Six',    '{"game_duration": 90}'::jsonb from h108_fx union all
select d8,  s1, 'ZZ108 Eight',  '{"game_duration": 90}'::jsonb from h108_fx union all
select drr, s1, 'ZZ108 Robin',  '{"game_duration": 90}'::jsonb from h108_fx union all
select dde, s1, 'ZZ108 Double', '{"game_duration": 90}'::jsonb from h108_fx;

insert into public.teams (id, league_id, division_id, name)
select t.id, fx.s1, case t.n when 4 then fx.d4 when 6 then fx.d6 else fx.d8 end,
       format('ZZ108 n%s S%s', t.n, t.seed)
  from h108_team t, h108_fx fx;
insert into public.teams (id, league_id, division_id, name)
select rr_a, s1, drr, 'ZZ108 RR A' from h108_fx union all
select rr_b, s1, drr, 'ZZ108 RR B' from h108_fx union all
select de_a, s1, dde, 'ZZ108 DE A' from h108_fx union all
select de_b, s1, dde, 'ZZ108 DE B' from h108_fx;

insert into public.playoffs (id, league_id, division_id, format, seeding, status)
select p4,  s1, d4,  'single_elimination', '[]'::jsonb, 'active' from h108_fx union all
select p6,  s1, d6,  'single_elimination', '[]'::jsonb, 'active' from h108_fx union all
select p8,  s1, d8,  'single_elimination', '[]'::jsonb, 'active' from h108_fx union all
select prr, s1, drr, 'round_robin',        '[]'::jsonb, 'active' from h108_fx union all
select pde, s1, dde, 'double_elimination', '[]'::jsonb, 'active' from h108_fx;

-- The elimination brackets, straight from the table. The 6-team bracket's
-- semifinals and final are dated (the public-schedule case).
insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number,
                                  home_team_id, away_team_id, scheduled_date, start_time)
select case x.n when 4 then fx.p4 when 6 then fx.p6 else fx.p8 end, fx.s1,
       case x.n when 4 then fx.d4 when 6 then fx.d6 else fx.d8 end,
       x.round, x.game_number,
       (select t.id from h108_team t where t.n = x.n and t.seed = x.home_seed),
       (select t.id from h108_team t where t.n = x.n and t.seed = x.away_seed),
       case when x.n = 6 and x.round in ('SF', 'F') then fx.today_la + 3 end,
       case when x.n = 6 and x.round in ('SF', 'F') then '09:00'::time end
  from h108_xc x, h108_fx fx;

insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number,
                                  home_team_id, away_team_id)
select prr, s1, drr, 'RR1', 1, rr_a, rr_b from h108_fx union all
select prr, s1, drr, 'RR2', 2, rr_b, rr_a from h108_fx union all
select pde, s1, dde, 'GF',  2, de_a, de_b from h108_fx;
insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number,
                                  home_team_id, away_team_id, home_score, away_score, winner_id, status)
select pde, s1, dde, 'WB-R1', 1, de_a, de_b, 3, 1, de_a, 'completed' from h108_fx;

update public.divisions d set locked = true from h108_fx fx where d.id = fx.d6;

insert into public.public_schedule_links (org_id) select org from h108_fx;

-- The zero-row hook: an UPDATE of the game named in h108.skip is silently
-- skipped (no error, zero rows) — what a refused or vanished row looks like.
create function public.zz108_skip_update()
returns trigger
language plpgsql
as $fn$
begin
  if current_setting('h108.skip', true) = new.id::text then
    return null;
  end if;
  return new;
end;
$fn$;
create trigger zz108_skip_update before update on public.playoff_games
  for each row execute function public.zz108_skip_update();

-- Calls one function as a user (or anon). 'OK <json>' or 'ERR <sqlstate> <message>'.
create function pg_temp.h108_call(p_role text, p_uid uuid, p_sql text)
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

create function pg_temp.h108_enter(p_role text, p_uid uuid, p_game uuid, p_h integer, p_a integer)
returns text language sql as $fn$
  select pg_temp.h108_call(p_role, p_uid, format('public.enter_playoff_result(%L::uuid, %L::integer, %L::integer)', p_game, p_h, p_a))
$fn$;

create function pg_temp.h108_clear(p_role text, p_uid uuid, p_game uuid, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h108_call(p_role, p_uid, format('public.clear_playoff_result(%L::uuid, %L::boolean)', p_game, p_commit))
$fn$;

create function pg_temp.h108_j(p_txt text)
returns jsonb language sql immutable as $fn$
  select case when p_txt like 'OK %' then substr(p_txt, 4)::jsonb end
$fn$;

-- A game by bracket and number.
create function pg_temp.h108_g(p_playoff uuid, p_number integer)
returns uuid language sql as $fn$
  select id from public.playoff_games where playoff_id = p_playoff and game_number = p_number
$fn$;

-- A team by bracket size and seed.
create function pg_temp.h108_t(p_n integer, p_seed integer)
returns uuid language sql as $fn$
  select id from h108_team where n = p_n and seed = p_seed
$fn$;

-- Full fingerprint of brackets and their games ("nothing written").
create function pg_temp.h108_snap(p_ids uuid[])
returns text language sql as $fn$
  select md5(
    coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p where p.id = any(p_ids)), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g where g.playoff_id = any(p_ids)), ''))
$fn$;

-- A bracket's result state, without timestamps (the round trip compares it).
create function pg_temp.h108_state(p_playoff uuid)
returns text language sql as $fn$
  select string_agg(concat_ws(',', g.round, g.game_number, g.home_team_id, g.away_team_id,
                              g.home_score, g.away_score, g.winner_id, g.status), ' | ' order by g.game_number)
    from public.playoff_games g where g.playoff_id = p_playoff
$fn$;

create function pg_temp.h108_logs()
returns integer language sql as $fn$
  select count(*)::integer from public.activity_log where event_type like 'playoff_result_%'
$fn$;

-- The assertions. Returns {fails, notes}. Never throws: a crash is recorded
-- as a failure after the ones already collected, so they always print.
create function pg_temp.h108_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx        h108_fx%rowtype;
  v_fails   text[] := array[]::text[];
  v_notes   text[] := array[]::text[];
  v_entry   constant text[] := array['public.enter_playoff_result(uuid, integer, integer)',
                                     'public.clear_playoff_result(uuid, boolean)'];
  v_helpers constant text[] := array['public.playoff_round_order(text)',
                                     'public.playoff_single_elim_target(uuid)'];
  v_fn      text;
  v_txt     text;
  v_txt2    text;
  v_j       jsonb;
  v_snap    text;
  v_all     uuid[];
  v_commits integer := 0;
  v_logs0   integer;
  v_x       record;
  v_tid     uuid;
  v_tfield  text;
  v_expect  uuid;
  v_g       public.playoff_games%rowtype;
  v_a       text;
  v_b       text;
  v_calls   text;
  v_ok      boolean;
begin
  select * into fx from h108_fx;
  v_all := array[fx.p4, fx.p6, fx.p8, fx.prr, fx.pde];
  v_logs0 := pg_temp.h108_logs();
  begin
    -- ── P1 ──────────────────────────────────────────────────────────────────
    foreach v_fn in array v_entry loop
      if not has_function_privilege('authenticated', v_fn, 'execute')
         or has_function_privilege('anon', v_fn, 'execute')
         or has_function_privilege('service_role', v_fn, 'execute')
         or has_function_privilege('dashboard_readonly', v_fn, 'execute')
         or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = v_fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
         or not (select prosecdef from pg_proc where oid = v_fn::regprocedure)
         or not coalesce((select 'search_path=public, pg_temp' = any(proconfig) from pg_proc where oid = v_fn::regprocedure), false) then
        v_fails := array_append(v_fails, 'P1: privileges wrong (or not SECURITY DEFINER, or search_path not pinned) on ' || v_fn);
      end if;
    end loop;
    foreach v_fn in array v_helpers loop
      if has_function_privilege('authenticated', v_fn, 'execute')
         or has_function_privilege('anon', v_fn, 'execute')
         or has_function_privilege('service_role', v_fn, 'execute')
         or has_function_privilege('dashboard_readonly', v_fn, 'execute') then
        v_fails := array_append(v_fails, 'P1: helper callable by a role: ' || v_fn);
      end if;
    end loop;

    -- ── AN1 ─────────────────────────────────────────────────────────────────
    v_snap := pg_temp.h108_snap(v_all);
    v_txt := pg_temp.h108_enter('anon', null, pg_temp.h108_g(fx.p8, 1), 5, 2);
    if v_txt not like 'ERR 42501%' then
      v_fails := array_append(v_fails, 'AN1: anon enter not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h108_clear('anon', null, pg_temp.h108_g(fx.pde, 1), true);
    if v_txt not like 'ERR 42501%' then
      v_fails := array_append(v_fails, 'AN1: anon clear not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h108_enter('authenticated', fx.nonmember, pg_temp.h108_g(fx.p8, 1), 5, 2);
    if v_txt not like 'ERR 42501%not_authorized%' then
      v_fails := array_append(v_fails, 'AN1: non-member enter not refused: ' || v_txt);
    end if;
    -- Clear needs a game with a result to get past its own checks; the double
    -- elimination game has one, and membership is checked before the format.
    v_txt := pg_temp.h108_clear('authenticated', fx.nonmember, pg_temp.h108_g(fx.pde, 1), true);
    if v_txt not like 'ERR 42501%not_authorized%' then
      v_fails := array_append(v_fails, 'AN1: non-member clear not refused: ' || v_txt);
    end if;
    if pg_temp.h108_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'AN1: a refused call wrote something');
    end if;

    -- ── PL1 ─────────────────────────────────────────────────────────────────
    update public.profiles set plan = 'pro' where id = fx.org;
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 1), 5, 2);
    if v_txt not like 'ERR P0001%plan_required%' then
      v_fails := array_append(v_fails, 'PL1: Pro enter not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.pde, 1), true);
    if v_txt not like 'ERR P0001%plan_required%' then
      v_fails := array_append(v_fails, 'PL1: Pro clear not refused: ' || v_txt);
    end if;
    update public.profiles set plan = 'elite' where id = fx.org;
    if pg_temp.h108_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'PL1: a refused call wrote something');
    end if;

    -- ── XC1 ─────────────────────────────────────────────────────────────────
    for v_x in select * from h108_xc order by n, game_number loop
      v_tid := null; v_tfield := null;
      select t.target_id, t.target_field into v_tid, v_tfield
        from public.playoff_single_elim_target(
          pg_temp.h108_g(case v_x.n when 4 then fx.p4 when 6 then fx.p6 else fx.p8 end, v_x.game_number)) t;
      v_expect := case when v_x.target_number is null then null
                       else pg_temp.h108_g(case v_x.n when 4 then fx.p4 when 6 then fx.p6 else fx.p8 end,
                                           v_x.target_number) end;
      if v_tid is distinct from v_expect or v_tfield is distinct from v_x.target_field then
        v_fails := array_append(v_fails, format('XC1: %s-team game %s → got (%s, %s), table says (game %s, %s)',
          v_x.n, v_x.game_number,
          coalesce((select game_number::text from public.playoff_games where id = v_tid), 'none'),
          coalesce(v_tfield, 'none'), coalesce(v_x.target_number::text, 'none'), coalesce(v_x.target_field, 'none')));
      end if;
    end loop;
    if (select count(*) from h108_xc) <> 15 or (select count(*) from h108_xc where target_number is not null) <> 12 then
      v_fails := array_append(v_fails, 'XC1: the table is not the 15 games / 12 targets it was written with');
    end if;

    -- ── DE1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.pde, 2), 4, 1);
    if v_txt not like 'ERR P0001%format_not_supported%' then
      v_fails := array_append(v_fails, 'DE1: double-elimination enter not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.pde, 1), true);
    if v_txt not like 'ERR P0001%format_not_supported%' then
      v_fails := array_append(v_fails, 'DE1: double-elimination clear not refused: ' || v_txt);
    end if;
    if pg_temp.h108_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'DE1: a refused call wrote something');
    end if;

    -- ── VL1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 1), 3, 3);
    if v_txt not like 'ERR P0001%tied_score%' then
      v_fails := array_append(v_fails, 'VL1: a tie not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 1), -1, 2);
    if v_txt not like 'ERR P0001%invalid_scores%' then
      v_fails := array_append(v_fails, 'VL1: a negative score not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 7), 1, 0);
    if v_txt not like 'ERR P0001%teams_missing%' then
      v_fails := array_append(v_fails, 'VL1: a game missing teams not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p8, 1), false);
    if v_txt not like 'ERR P0001%no_result%' then
      v_fails := array_append(v_fails, 'VL1: clearing a game with no result not refused: ' || v_txt);
    end if;
    if pg_temp.h108_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'VL1: a refused call wrote something');
    end if;

    -- ── EN1 ─────────────────────────────────────────────────────────────────
    -- 8-team game 1 (S1 v S8), home wins → game 5 home; game 2 (S4 v S5)
    -- away wins → game 5 away; then game 2 EDITED so home wins → S4 replaces S5.
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 1), 5, 2);
    v_j := pg_temp.h108_j(v_txt);
    if v_j is null or (v_j ->> 'committed') <> 'true' or (v_j ->> 'game_id')::uuid <> pg_temp.h108_g(fx.p8, 1)
       or (v_j -> 'advanced' ->> 'game_number') <> '5' or (v_j -> 'advanced' ->> 'field') <> 'home_team_id' then
      v_fails := array_append(v_fails, 'EN1: enter game 1 reply wrong: ' || v_txt);
    else
      v_commits := v_commits + 1;
    end if;
    select * into v_g from public.playoff_games where id = pg_temp.h108_g(fx.p8, 1);
    if v_g.status <> 'completed' or v_g.home_score is distinct from 5 or v_g.away_score is distinct from 2
       or v_g.winner_id is distinct from pg_temp.h108_t(8, 1) then
      v_fails := array_append(v_fails, 'EN1: game 1 row wrong after enter: ' || v_g::text);
    end if;
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 2), 1, 6);
    if pg_temp.h108_j(v_txt) ->> 'committed' = 'true' then v_commits := v_commits + 1; end if;
    select * into v_g from public.playoff_games where id = pg_temp.h108_g(fx.p8, 5);
    if v_g.home_team_id is distinct from pg_temp.h108_t(8, 1) or v_g.away_team_id is distinct from pg_temp.h108_t(8, 5) then
      v_fails := array_append(v_fails, 'EN1: game 5 slots wrong after games 1 and 2: ' || v_g::text || ' / ' || v_txt);
    end if;
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 2), 6, 1);
    v_j := pg_temp.h108_j(v_txt);
    if v_j is null or (v_j ->> 'committed') <> 'true' or (v_j ->> 'was_edit') <> 'true' then
      v_fails := array_append(v_fails, 'EN1: edit of game 2 reply wrong: ' || v_txt);
    else
      v_commits := v_commits + 1;
    end if;
    select * into v_g from public.playoff_games where id = pg_temp.h108_g(fx.p8, 5);
    if v_g.home_team_id is distinct from pg_temp.h108_t(8, 1) or v_g.away_team_id is distinct from pg_temp.h108_t(8, 4) then
      v_fails := array_append(v_fails, 'EN1: the edit did not replace S5 with S4 in game 5: ' || v_g::text);
    end if;

    -- ── PV1 ─────────────────────────────────────────────────────────────────
    v_snap := pg_temp.h108_snap(v_all);
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p8, 2), false);
    v_j := pg_temp.h108_j(v_txt);
    if pg_temp.h108_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'PV1: the preview wrote something');
    end if;
    if v_j is null or (v_j ->> 'committed') <> 'false' or (v_j ->> 'blocked') <> 'false'
       or (v_j ->> 'game_id')::uuid <> pg_temp.h108_g(fx.p8, 2)
       or (v_j ->> 'home_score') <> '6' or (v_j ->> 'away_score') <> '1'
       or (v_j ->> 'winner_name') <> 'ZZ108 n8 S4'
       or (v_j -> 'removed' ->> 'game_number') <> '5' or (v_j -> 'removed' ->> 'team_name') <> 'ZZ108 n8 S4'
       or (v_j ->> 'on_public_schedule') <> 'false' then
      v_fails := array_append(v_fails, 'PV1: preview reply wrong: ' || v_txt);
    end if;

    -- ── PUB1 ────────────────────────────────────────────────────────────────
    -- 6-team game 2 (S4 v S5), away wins → game 5 (dated, locked division) away.
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p6, 2), 2, 7);
    if pg_temp.h108_j(v_txt) ->> 'committed' = 'true' then v_commits := v_commits + 1;
    else v_fails := array_append(v_fails, 'PUB1: enter on the 6-team bracket failed: ' || v_txt); end if;
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p6, 2), false);
    if pg_temp.h108_j(v_txt) ->> 'on_public_schedule' is distinct from 'true' then
      v_fails := array_append(v_fails, 'PUB1: a locked, dated next game with a link is not on the public schedule: ' || v_txt);
    end if;

    -- ── LK1 ─────────────────────────────────────────────────────────────────
    if not (select locked from public.divisions where id = fx.d6) then
      v_fails := array_append(v_fails, 'LK1: the fixture division is not locked (vacuous)');
    end if;
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p6, 2), true);
    if pg_temp.h108_j(v_txt) ->> 'committed' is distinct from 'true'
       or (select winner_id from public.playoff_games where id = pg_temp.h108_g(fx.p6, 2)) is not null then
      v_fails := array_append(v_fails, 'LK1: clearing in a locked division did not commit: ' || v_txt);
    else
      v_commits := v_commits + 1;
    end if;

    -- ── BY1 ─────────────────────────────────────────────────────────────────
    -- Seeds 1 and 2 sit in games 5 and 6 (home) by a bye. Game 2 was entered
    -- and cleared above (feeds game 5 away); now game 4 (S3 v S6) feeds game 6.
    v_ok := (select home_team_id from public.playoff_games where id = pg_temp.h108_g(fx.p6, 5)) = pg_temp.h108_t(6, 1);
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p6, 4), 5, 0);
    if pg_temp.h108_j(v_txt) ->> 'committed' = 'true' then v_commits := v_commits + 1; end if;
    v_ok := v_ok and (select home_team_id from public.playoff_games where id = pg_temp.h108_g(fx.p6, 6)) = pg_temp.h108_t(6, 2);
    v_txt2 := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p6, 4), true);
    if pg_temp.h108_j(v_txt2) ->> 'committed' = 'true' then v_commits := v_commits + 1; end if;
    v_ok := v_ok
      and (select home_team_id from public.playoff_games where id = pg_temp.h108_g(fx.p6, 5)) = pg_temp.h108_t(6, 1)
      and (select home_team_id from public.playoff_games where id = pg_temp.h108_g(fx.p6, 6)) = pg_temp.h108_t(6, 2);
    if not coalesce(v_ok, false) then
      v_fails := array_append(v_fails, 'BY1: a bye-seeded team left its seat: ' || pg_temp.h108_state(fx.p6)
        || ' / ' || v_txt || ' / ' || v_txt2);
    end if;

    -- ── RT1 ─────────────────────────────────────────────────────────────────
    -- 4-team game 1 (S1 v S4) feeds game 3 home. Path A: S1 wins, cleared,
    -- then S4 wins. Path B: S4 wins directly. Each path rolls itself back.
    begin
      v_calls := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p4, 1), 3, 1)
        || ' ; ' || pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p4, 1), true)
        || ' ; ' || pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p4, 1), 1, 4);
      raise exception 'H108_RT %', jsonb_build_object('state', pg_temp.h108_state(fx.p4), 'calls', v_calls)::text;
    exception when others then
      if sqlerrm like 'H108_RT %' then v_a := substr(sqlerrm, 9); else v_a := 'CRASH ' || sqlerrm; end if;
    end;
    begin
      v_calls := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p4, 1), 1, 4);
      raise exception 'H108_RT %', jsonb_build_object('state', pg_temp.h108_state(fx.p4), 'calls', v_calls)::text;
    exception when others then
      if sqlerrm like 'H108_RT %' then v_b := substr(sqlerrm, 9); else v_b := 'CRASH ' || sqlerrm; end if;
    end;
    -- Nested, not OR'd: SQL does not promise to short-circuit, and a CRASH
    -- text cast to jsonb would surface as a crash instead of as RT1.
    if v_a like 'CRASH%' or v_b like 'CRASH%' then
      v_ok := false;
    else
      v_ok := (v_a::jsonb ->> 'state') is not distinct from (v_b::jsonb ->> 'state')
              and (v_b::jsonb ->> 'state') like '%' || pg_temp.h108_t(4, 4)::text || '%';
    end if;
    if not coalesce(v_ok, false) then
      v_fails := array_append(v_fails, 'RT1: enter → clear → enter differs from entering directly: A=' || v_a || ' B=' || v_b);
    end if;

    -- ── CL1 / CL2 ───────────────────────────────────────────────────────────
    -- 8-team game 2 (S4 won, in game 5 AWAY) is cleared.
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p8, 2), true);
    v_j := pg_temp.h108_j(v_txt);
    select * into v_g from public.playoff_games where id = pg_temp.h108_g(fx.p8, 2);
    if v_j is null or (v_j ->> 'committed') <> 'true' or (v_j ->> 'game_id')::uuid <> v_g.id
       or v_g.status <> 'scheduled' or v_g.home_score is not null or v_g.away_score is not null
       or v_g.winner_id is not null then
      v_fails := array_append(v_fails, 'CL1: the cleared game is not back to scheduled with no result: ' || v_g::text || ' / ' || v_txt);
    else
      v_commits := v_commits + 1;
    end if;
    select * into v_g from public.playoff_games where id = pg_temp.h108_g(fx.p8, 5);
    if v_g.away_team_id is not null or v_g.home_team_id is distinct from pg_temp.h108_t(8, 1) then
      v_fails := array_append(v_fails, 'CL2: game 5 should keep S1 home and have no away team: ' || v_g::text);
    end if;

    -- ── LB1 ─────────────────────────────────────────────────────────────────
    -- Re-enter game 2 (S4), play game 5 (S1 beats S4 → game 7 home). Game 1
    -- can now be neither cleared nor edited; game 5 then game 1 clear fine.
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 2), 3, 0);
    if pg_temp.h108_j(v_txt) ->> 'committed' = 'true' then v_commits := v_commits + 1; end if;
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 5), 2, 1);
    if pg_temp.h108_j(v_txt) ->> 'committed' = 'true' then v_commits := v_commits + 1;
    else v_fails := array_append(v_fails, 'LB1: setup enter of game 5 failed: ' || v_txt); end if;
    v_snap := pg_temp.h108_snap(v_all);
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p8, 1), true);
    v_j := pg_temp.h108_j(v_txt);
    if v_j is null or (v_j ->> 'blocked') <> 'true' or (v_j ->> 'committed') <> 'false'
       or (v_j ->> 'reason') <> 'next_game_has_result' or (v_j -> 'next_game' ->> 'game_number') <> '5' then
      v_fails := array_append(v_fails, 'LB1: clearing game 1 under a played game 5 was not blocked: ' || v_txt);
    end if;
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 1), 0, 1);
    v_j := pg_temp.h108_j(v_txt);
    if v_j is null or (v_j ->> 'blocked') <> 'true' or (v_j ->> 'reason') <> 'next_game_has_result'
       or (v_j -> 'next_game' ->> 'game_number') <> '5' then
      v_fails := array_append(v_fails, 'LB1: editing game 1 under a played game 5 was not blocked: ' || v_txt);
    end if;
    if pg_temp.h108_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'LB1: a blocked call wrote something');
    end if;
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p8, 5), true);
    if pg_temp.h108_j(v_txt) ->> 'committed' = 'true' then v_commits := v_commits + 1; end if;
    v_txt2 := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p8, 1), true);
    if pg_temp.h108_j(v_txt2) ->> 'committed' = 'true' then v_commits := v_commits + 1; end if;
    if (select home_team_id from public.playoff_games where id = pg_temp.h108_g(fx.p8, 7)) is not null
       or (select home_team_id from public.playoff_games where id = pg_temp.h108_g(fx.p8, 5)) is not null
       or (select winner_id from public.playoff_games where id = pg_temp.h108_g(fx.p8, 1)) is not null then
      v_fails := array_append(v_fails, 'LB1: clearing latest-round-first did not work: ' || v_txt || ' / ' || v_txt2);
    end if;

    -- ── ZR1 ─────────────────────────────────────────────────────────────────
    -- Game 2 still has S4's result. Its UPDATE is made to change zero rows.
    v_snap := pg_temp.h108_snap(v_all);
    perform set_config('h108.skip', pg_temp.h108_g(fx.p8, 2)::text, true);
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.p8, 2), true);
    perform set_config('h108.skip', '', true);
    if v_txt not like 'ERR P0001%nothing_saved%' or pg_temp.h108_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'ZR1: a zero-row clear was not refused as nothing_saved: ' || v_txt);
    end if;

    -- ── ZR2 ─────────────────────────────────────────────────────────────────
    perform set_config('h108.skip', pg_temp.h108_g(fx.p8, 3)::text, true);
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.p8, 3), 4, 2);
    perform set_config('h108.skip', '', true);
    if v_txt not like 'ERR P0001%nothing_saved%' or pg_temp.h108_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'ZR2: a zero-row enter was not refused as nothing_saved: ' || v_txt);
    end if;

    -- ── RR1 ─────────────────────────────────────────────────────────────────
    v_a := pg_temp.h108_state(fx.prr);
    v_txt := pg_temp.h108_enter('authenticated', fx.org, pg_temp.h108_g(fx.prr, 1), 2, 5);
    v_j := pg_temp.h108_j(v_txt);
    if v_j is null or (v_j ->> 'committed') <> 'true' or v_j -> 'advanced' <> 'null'::jsonb then
      v_fails := array_append(v_fails, 'RR1: round-robin enter reply wrong: ' || v_txt);
    else
      v_commits := v_commits + 1;
    end if;
    v_txt := pg_temp.h108_clear('authenticated', fx.org, pg_temp.h108_g(fx.prr, 1), true);
    v_j := pg_temp.h108_j(v_txt);
    if v_j is null or (v_j ->> 'committed') <> 'true' or v_j -> 'removed' <> 'null'::jsonb then
      v_fails := array_append(v_fails, 'RR1: round-robin clear reply wrong: ' || v_txt);
    else
      v_commits := v_commits + 1;
    end if;
    if pg_temp.h108_state(fx.prr) <> v_a then
      v_fails := array_append(v_fails, 'RR1: round robin not back where it started: ' || pg_temp.h108_state(fx.prr));
    end if;

    -- ── OT1 ─────────────────────────────────────────────────────────────────
    if md5(
         coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p where p.id = any(fx.existing)), '') || '#' ||
         coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g where g.playoff_id = any(fx.existing)), ''))
       <> fx.existing_fp then
      v_fails := array_append(v_fails, 'OT1: the test org''s existing brackets changed');
    end if;

    -- ── LG1 ─────────────────────────────────────────────────────────────────
    if pg_temp.h108_logs() - v_logs0 <> v_commits then
      v_fails := array_append(v_fails, format('LG1: %s log rows for %s committed calls', pg_temp.h108_logs() - v_logs0, v_commits));
    end if;
    if (select count(*) from public.activity_log where event_type = 'playoff_result_entered') = 0
       or (select count(*) from public.activity_log where event_type = 'playoff_result_cleared') = 0 then
      v_fails := array_append(v_fails, 'LG1: one of the two event types never logged (vacuous)');
    end if;
    v_notes := array_append(v_notes, format('committed calls counted: %s', v_commits));
  exception when others then
    v_fails := array_append(v_fails, 'CRASH: ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ── RL1 (always, last) ────────────────────────────────────────────────────
  if md5(
       coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p
                  join public.leagues l on l.id = p.league_id where l.owner_id = fx.real_org), '') || '#' ||
       coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g
                  join public.leagues l on l.id = g.league_id where l.owner_id = fx.real_org), '') || '#' ||
       coalesce((select string_agg(a.id::text, '|' order by a.id) from public.activity_log a
                  join public.leagues l on l.id = a.league_id
                 where l.owner_id = fx.real_org and a.event_type like 'playoff_%'), ''))
     <> fx.real_fp then
    v_fails := array_append(v_fails, 'RL1: the real league''s playoff rows changed');
  end if;

  return jsonb_build_object('fails', to_jsonb(v_fails), 'notes', to_jsonb(v_notes));
end;
$fn$;

do $h108$
declare
  v_out   text := E'\n';
  v_m     jsonb;
  v_first text;
  v_tag   text;
  v_def   text;
  v_mut   text;
  v_enter constant text := 'public.enter_playoff_result(uuid, integer, integer)';
  v_clear constant text := 'public.clear_playoff_result(uuid, boolean)';
  v_help  constant text := 'public.playoff_single_elim_target(uuid)';
  m       record;
begin
  -- Baseline.
  begin
    v_m := pg_temp.h108_assert();
    raise exception 'H108_RESULT %', v_m::text;
  exception when others then
    if sqlerrm like 'H108_RESULT %' then
      v_m := substr(sqlerrm, 13)::jsonb;
      v_out := v_out || format(E'BASELINE failures (%s): %s\nNOTES: %s\n',
        jsonb_array_length(v_m -> 'fails'), v_m -> 'fails', v_m -> 'notes');
    else
      v_out := v_out || format(E'BASELINE CRASH %s %s\n', sqlstate, sqlerrm);
    end if;
  end;

  for m in
    select * from (values
      ('MU1a', 'enter: membership gate removed', 'AN1', v_enter,
        $a$if not public.is_org_member(v_league.owner_id) then$a$, $a$if false then$a$, null::text, null::text),
      ('MU1b', 'clear: membership gate removed', 'AN1', v_clear,
        $a$if not public.is_org_member(v_league.owner_id) then$a$, $a$if false then$a$, null, null),
      ('MU2a', 'enter: plan gate removed', 'PL1', v_enter,
        $a$if v_plan is null or v_plan <> 'elite' then$a$, $a$if false then$a$, null, null),
      ('MU2b', 'clear: plan gate removed', 'PL1', v_clear,
        $a$if v_plan is null or v_plan <> 'elite' then$a$, $a$if false then$a$, null, null),
      ('MU3', 'helper: slot parity flipped (cross-check skew)', 'XC1', v_help,
        $a$case when v_pos % 2 = 0 then 'home_team_id' else 'away_team_id' end$a$,
        $a$case when v_pos % 2 = 0 then 'away_team_id' else 'home_team_id' end$a$, null, null),
      ('MU4', 'clear: double elimination allowed', 'DE1', v_clear,
        $a$if v_po.format is distinct from 'single_elimination' and v_po.format is distinct from 'round_robin' then$a$,
        $a$if false then$a$, null, null),
      ('MU5', 'clear: preview commits', 'PV1', v_clear,
        $a$  if p_commit then
    update$a$, $a$  if true then
    update$a$, null, null),
      ('MU6', 'clear: the lock gates the clear', 'LK1', v_clear,
        $a$  if p_commit then
    update$a$,
        $a$  if p_commit and exists (select 1 from public.divisions d where d.id = v_po.division_id and d.locked) then
    raise exception 'division_locked' using errcode = 'P0001';
  end if;
  if p_commit then
    update$a$, null, null),
      ('MU7', 'clear empties the other slot (bye team removed)', 'BY1', v_clear,
        $a$set home_team_id = case when v_field = 'home_team_id' then null else home_team_id end,
             away_team_id = case when v_field = 'away_team_id' then null else away_team_id end,$a$,
        $a$set home_team_id = case when v_field = 'away_team_id' then null else home_team_id end,
             away_team_id = case when v_field = 'home_team_id' then null else away_team_id end,$a$, null, null),
      ('MU8', 'clear leaves the winner in the next game (round-trip drift)', 'RT1', v_clear,
        $a$    if v_remove then
      update$a$, $a$    if false then
      update$a$, null, null),
      ('MU9', 'clear empties home slots only', 'CL2', v_clear,
        $a$             away_team_id = case when v_field = 'away_team_id' then null else away_team_id end,$a$,
        $a$             away_team_id = away_team_id,$a$, null, null),
      ('MU10', 'clear leaves the status completed', 'CL1', v_clear,
        $a$           status     = 'scheduled',$a$, $a$           status     = status,$a$, null, null),
      ('MU11', 'clear allowed while the next game has a result', 'LB1', v_clear,
        $a$      if v_target.status = 'completed' or v_target.home_score is not null$a$,
        $a$      if false and v_target.home_score is not null$a$, null, null),
      ('MU12', 'enter: edit allowed while the next game has a result', 'LB1', v_enter,
        $a$      if v_target.status = 'completed' or v_target.home_score is not null$a$,
        $a$      if false and v_target.home_score is not null$a$, null, null),
      ('MU13', 'clear: zero-row write reported as success', 'ZR1', v_clear,
        $a$    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;

    if v_remove then$a$,
        $a$    get diagnostics v_rows = row_count;

    if v_remove then$a$, null, null),
      ('MU14', 'enter: zero-row write reported as success', 'ZR2', v_enter,
        $a$  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  -- 8.$a$,
        $a$  get diagnostics v_rows = row_count;

  -- 8.$a$, null, null),
      ('MU15', 'clear: log skipped', 'LG1', v_clear,
        $a$    values (v_po.league_id, v_po.division_id, 'playoff_result_cleared', v_message);$a$,
        $a$    select v_po.league_id, v_po.division_id, 'playoff_result_cleared', v_message where false;$a$, null, null),
      ('MU16', 'EXECUTE left on PUBLIC', 'P1', null,
        null, $a$grant execute on function public.enter_playoff_result(uuid, integer, integer) to public$a$, null, null)
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
      v_m := pg_temp.h108_assert();
      raise exception 'H108_RESULT %', v_m::text;
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm like 'H108_RESULT %' then
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

  v_out := v_out || format(E'prosrc md5 enter_playoff_result: %s\nprosrc md5 clear_playoff_result: %s\n'
                           'prosrc md5 playoff_single_elim_target: %s\nprosrc md5 playoff_round_order: %s\n',
    (select md5(prosrc) from pg_proc where oid = v_enter::regprocedure),
    (select md5(prosrc) from pg_proc where oid = v_clear::regprocedure),
    (select md5(prosrc) from pg_proc where oid = v_help::regprocedure),
    (select md5(prosrc) from pg_proc where oid = 'public.playoff_round_order(text)'::regprocedure));

  raise exception '%', v_out;
end;
$h108$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname in ('enter_playoff_result', 'clear_playoff_result',
--      'playoff_single_elim_target', 'playoff_round_order', 'zz108_skip_update')) as fns_must_be_0,
--   (select count(*) from pg_trigger where tgname = 'zz108_skip_update') as trigger_must_be_0,
--   (select count(*) from leagues where name like 'ZZ108%')
--     + (select count(*) from activity_log where event_type like 'playoff_result_%') as fixtures_must_be_0,
--   (select count(*) from public_schedule_links where org_id = 'aa21d01c-66dc-4c37-b15c-7b743c557eea') as test_link_must_be_0,
--   (select plan from profiles where id = 'aa21d01c-66dc-4c37-b15c-7b743c557eea') as test_plan_elite,
--   (select count(*) from playoffs) as playoffs_3;

-- ── RUN LOG ─────────────────────────────────────────────────────────────────
-- Not run yet. 0108 NOT APPLIED — waiting on the founder's timing for both
-- the proof run and the apply.

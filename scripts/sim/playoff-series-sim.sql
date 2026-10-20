-- SQL-level proof for migration 0114 (playoff series: series_by_round,
-- series_game, the not_needed status, playoff_check_series,
-- playoff_series_place, the log helpers, and the series rules in
-- replace_playoff_games, playoff_write_stage, enter_playoff_result,
-- clear_playoff_result, delete_playoff_bracket, the public reader and
-- season_last_day).
--
-- WHY SQL: SECURITY DEFINER refusals, grants exercised as `anon` and
-- `authenticated`, constraints, row locks and counted writes only a real
-- database can exercise. NOT `npm run`-able, NOT in CI (CLAUDE.md, "Harness
-- standard — SQL-level exceptions").
--
-- THIS HARNESS APPLIES 0114 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK, so it runs BEFORE the migration is applied. The build script
-- (playoff-series-build.ts) substitutes the repo file for the placeholder.
-- Before the migration runs it fingerprints every existing bracket and game on
-- their pre-0114 columns, so OT1 can prove the ALTERs left them untouched.
--
-- HOW TO RUN: `npx tsx scripts/sim/playoff-series-build.ts > <file>`, send the
-- output as ONE batch through the Supabase MCP (one batch = one transaction),
-- read the raised message, then run the leak check at the bottom. The 0107,
-- 0108, 0112 and 0113 proofs are re-run against 0114 too:
-- `npx tsx scripts/sim/playoff-series-build.ts 0107` (/ 0108 / 0112 / 0113).
--
-- EVERY PASS IS ITS OWN ROLLED-BACK SUB-TRANSACTION. The baseline and each
-- mutant start from the same fixtures; the assertions run IN ORDER and later
-- ones build on the state earlier ones leave.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: a few seconds)
--   ACCESS EXCLUSIVE on `playoffs` and `playoff_games` (the migration's
--   ALTERs) for the WHOLE run: every read and write of either table — the
--   Playoffs page, the public schedule reader, auto-archive's and the snack
--   shack's playoff reads — waits until it ends. Row locks on the fixture
--   rows. A `public_schedule_links` row for the "test" org (it has none).
--   Locking the fixture divisions fires team_calendar_links_on_division_lock
--   (calendar-link rows for their teams; rolled back).
--   lock_timeout = 3s; statement_timeout = 120s.
--
-- ROWS TOUCHED (all rolled back): the "test" proof org only (owner
-- bbf9afe1-9e62-41e0-becc-895085bfc9d6, whitmellonking@, org name "test") — one
-- fixture season, two divisions, twelve teams, three fixture brackets and
-- their games, activity-log rows, a public schedule link. The "SRALL" test org
-- owner (aa21d01c…, not a member of "test") is the non-member caller and
-- nothing of theirs is written. NOTHING belonging to Santa Rosa American
-- Little League (owner 8fde72f9-cd5a-43ad-91e3-db14fb6fbcc4) is written or
-- passed to any function (RL1, checked last).
--
-- THE FIXTURE (the mockup's Majors, docs/mockups/playoff-series.html): six
-- teams — 1 Expos, 2 Bears, 3 Lions, 4 Mets, 5 Pirates, 6 Royals. Round 1 is
-- single games (Game 2: Mets v Pirates; Game 4: Lions v Royals); the
-- Semifinals (positions 5 and 6) and the Final (7) are best of 3. Expos and
-- Bears have byes and sit in their Semifinal's home slot in all three games.
-- Semifinal 2's Game 3 is dated T+40, after the season's end date (T+30), so
-- season_last_day moves when it becomes not needed. "T" = today in the org's
-- timezone. A second division holds a two-stage pair (T1–T6) whose Stage 2 has
-- the same series rounds.
--
-- ASSERTIONS (in order; a mutant must die FIRST at its own tag)
--   P1   privileges: the six helpers callable by no role; the entry points
--        authenticated only; the reader anon + authenticated; DEFINER flags
--   IX1  playoff_if_needed answers every row of the IFNEEDED-TABLE (the same
--        rows `npm run sim:playoff-series` runs through seriesGameTag)
--   SC1  schema: a duplicate (playoff, round, game number, series game) is
--        refused (23505); series_game 8 is refused (23514); 'not_needed' is a
--        valid status; existing games are all series game 1, none not needed
--   GN1  replace_playoff_games refuses, writing nothing: series in a round
--        robin, a series missing its game 3, a length that disagrees with
--        series_by_round, series_game 8, a series for a round that isn't
--        there, a duplicate game; then builds the bracket: 11 rows, the
--        series_by_round stored. LD0: season_last_day counts the T+40 game
--   AN1  a non-member and anon are refused; nothing written
--   EN1  Round 1 winners move into every game of their Semifinal; home
--        alternates by true seed (Expos v Mets: Expos home in 1 and 3)
--   OR1  Game 3 before Game 2 is refused (series_order); nothing written
--   DC1  Bears win Semifinal 2 2–0: its Game 3 becomes not needed; Bears go
--        into every game of the Final, in the second slot, no home decided
--   NN1  a not-needed game takes no result; nothing written
--   LT1  an earlier result can't be changed while a later one stands
--   PUB1 the public reader leaves the not-needed game out and emits
--        series_game and series_length
--   IF1  the reader's if_needed flag, end to end: at 0–0 only Game 3 of each
--        best of 3; at 1–0 Game 3 still; at 1–1 Game 3 is NOT if needed (it
--        will be played) and is still listed
--   KY1  every public playoff game carries exactly the reader's keys — no
--        score, no winner, nothing about where a series stands
--   LD1  season_last_day no longer counts the not-needed game
--   HM1  Expos win Semifinal 1: its Game 3 not needed; the Final alternates
--        (Expos 1 home in games 1 and 3, Bears 2 in game 2)
--   CL1  clearing Semifinal 1's deciding game: the preview writes nothing and
--        names the game coming back and Expos leaving the Final; the commit
--        restores the bracket exactly (round trip)
--   CL2  only the latest result in a series can be cleared
--   FL1  an edit that flips Semifinal 2's Game 2 un-decides it: Game 3 back,
--        Bears out of the Final; Bears then win Game 3 and go back in
--   NX1  once the Final has a result, a Semifinal result can be neither
--        changed nor cleared; nothing written
--   TS1  two-stage: a Stage 2 payload with one seed in two series is refused;
--        a series Stage 2 builds; seeding fills every game of a series; a
--        Round 1 winner joins its Semifinal with home alternating by the
--        seeds the admin gave
--   DL1  delete's preview counts the not-needed game and leaves it off the
--        public count
--   LG1  the log names the round and the teams, never a stored game number
--   OT1  every bracket and game outside the fixtures is byte-identical on its
--        pre-0114 columns
--   RL1  the real league's playoff rows and log rows are unchanged
--
-- MUTANTS (each rewrites a REAL function inside its own rolled-back block;
-- KILLED only if the FIRST failure is its own tag)
--   MU1  place: home doesn't alternate                         → EN1
--   MU2  place: the lower seed is home in game 1               → EN1
--   MU3  check_series: series shape not checked                → GN1
--   MU4  check_series: series allowed outside single elim.     → GN1
--   MU5  enter: results don't have to go in order              → OR1
--   MU6  enter: a decided series cancels nothing               → DC1
--   MU7  enter: a not-needed game takes a result               → NN1
--   MU8  enter: an earlier result changes under a later one    → LT1
--   MU9  reader: not-needed games shown                        → PUB1
--   MU10 season_last_day counts not-needed games               → LD1
--   MU11 clear: the not-needed game isn't brought back         → CL1
--   MU12 clear: the winner stays in the next round             → CL1
--   MU13 clear: an earlier result cleared under a later one    → CL2
--   MU14 enter: an un-deciding edit leaves the winner on       → FL1
--   MU15 enter: a series result changes under a played Final   → NX1
--   MU16 clear: a series result cleared under a played Final   → NX1
--   MU17 write_stage: a seed in two series accepted            → TS1
--   MU18 delete: not-needed games on the public count          → DL1
--   MU19 EXECUTE on playoff_series_place granted to PUBLIC     → P1
--   MU20 enter: the log names the stored game number           → LG1
--   MU21 if_needed: by position, the results ignored           → IX1
--   MU22 reader: the results not passed to the flag            → IF1
--   MU23 reader: a score emitted beside the flag               → KY1
--   MU24 EXECUTE on playoff_if_needed granted to anon          → P1
--
-- RUN LOG: see the bottom of this file after the run.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '120s', true);

-- Before the migration: every existing bracket and game on the columns they
-- have today (OT1 compares the same columns afterwards).
create temp table h114_before on commit drop as
select
  md5(coalesce((select string_agg(row(p.id, p.league_id, p.division_id, p.format, p.status, p.seeding,
                                       p.stage, p.parent_playoff_id, p.advance_count, p.seeded_at,
                                       p.stage1_changes, p.updated_at)::text, '|' order by p.id)
                 from public.playoffs p), '')) as po_fp,
  md5(coalesce((select string_agg(row(g.id, g.playoff_id, g.round, g.game_number, g.home_team_id,
                                       g.away_team_id, g.winner_id, g.home_score, g.away_score, g.status,
                                       g.scheduled_date, g.start_time, g.venue_id, g.seed_home, g.seed_away,
                                       g.updated_at)::text, '|' order by g.id)
                 from public.playoff_games g), '')) as games_fp;

-- @@MIGRATION_0114@@

create temp table h114_fx on commit drop as
select
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as org,
  'aa21d01c-66dc-4c37-b15c-7b743c557eea'::uuid as nonmember,
  '8fde72f9-cd5a-43ad-91e3-db14fb6fbcc4'::uuid as real_org,
  (now() at time zone (select timezone from public.profiles
                        where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6'))::date as t,
  gen_random_uuid() as s1,
  gen_random_uuid() as d6, gen_random_uuid() as dt,
  gen_random_uuid() as p6, gen_random_uuid() as pt1, gen_random_uuid() as pt2,
  ''::text as real_fp, ''::text as token;

-- Teams: 'M' the Majors (seed order), 'T' the two-stage division.
create temp table h114_team on commit drop as
select 'M'::text as k, s.seed, gen_random_uuid() as id,
       'ZZ114 ' || (array['Expos', 'Bears', 'Lions', 'Mets', 'Pirates', 'Royals'])[s.seed] as name
  from generate_series(1, 6) s(seed)
union all
select 'T', s.seed, gen_random_uuid(), 'ZZ114 T' || s.seed
  from generate_series(1, 6) s(seed);

update h114_fx set real_fp = md5(
    coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p
               join public.leagues l on l.id = p.league_id where l.owner_id = h114_fx.real_org), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g
               join public.leagues l on l.id = g.league_id where l.owner_id = h114_fx.real_org), '') || '#' ||
    coalesce((select string_agg(a.id::text, '|' order by a.id) from public.activity_log a
               join public.leagues l on l.id = a.league_id
              where l.owner_id = h114_fx.real_org and a.event_type like 'playoff_%'), ''));

-- The Majors bracket, as the planner lays it out (series_game on every game
-- of a series; the single games carry none). day = days after T.
create temp table h114_plan (round text, game_number integer, series_game integer,
                             home_seed integer, away_seed integer, day integer) on commit drop;
insert into h114_plan values
  ('R1', 2, null, 4, 5, 1),
  ('R1', 4, null, 3, 6, 1),
  ('SF', 5, 1, 1, null, 2), ('SF', 5, 2, 1, null, 3), ('SF', 5, 3, 1, null, 4),
  ('SF', 6, 1, 2, null, 2), ('SF', 6, 2, 2, null, 3), ('SF', 6, 3, 2, null, 40),
  ('F', 7, 1, null, null, 5), ('F', 7, 2, null, null, 6), ('F', 7, 3, null, null, 7);

-- Fixtures.
insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
select s1, 'ZZ114 Season', 'Baseball', 'Fall 2026', org, t - 30, t + 30 from h114_fx;
insert into public.divisions (id, league_id, name, settings)
select d6, s1, 'ZZ114 Majors', '{"game_duration": 120}'::jsonb from h114_fx union all
select dt, s1, 'ZZ114 Two',    '{"game_duration": 120}'::jsonb from h114_fx;
insert into public.teams (id, league_id, division_id, name)
select tm.id, fx.s1, case tm.k when 'M' then fx.d6 else fx.dt end, tm.name from h114_team tm, h114_fx fx;
insert into public.playoffs (id, league_id, division_id, format, seeding, status)
select p6, s1, d6, 'single_elimination', '[]'::jsonb, 'draft' from h114_fx union all
select pt1, s1, dt, 'round_robin', '[]'::jsonb, 'draft' from h114_fx;
insert into public.playoffs (id, league_id, division_id, format, seeding, status, stage, parent_playoff_id, advance_count)
select pt2, s1, dt, 'single_elimination', '[]'::jsonb, 'draft', 2, pt1, 6 from h114_fx;
update public.divisions d set locked = true from h114_fx fx where d.id in (fx.d6, fx.dt);
with k as (
  insert into public.public_schedule_links (org_id, enabled) select org, true from h114_fx
  on conflict (org_id) do update set enabled = true
  returning token)
update h114_fx set token = (select token from k);

-- The public "If needed" rule, one row per case: series length, game k, the
-- series' outcomes game 1 first ('A' won by game 1's home-slot team, 'B' by
-- the other, 'R' a result with no winner, '-' no result, 'x' not needed) and
-- the expected flag. `npm run sim:playoff-series` parses THIS block and runs
-- every row through seriesGameTag (series.ts). One copy — never a second.
create temp table h114_ifneeded on commit drop as
select * from (values
-- IFNEEDED-TABLE-BEGIN
  ('A1', 1, 1, '-', false),
  ('B1', 3, 1, '---', false),
  ('B2', 3, 2, '---', false),
  ('B3', 3, 3, '---', true),
  ('B4', 3, 2, 'A--', false),
  ('B5', 3, 3, 'A--', true),
  ('B6', 3, 3, 'B--', true),
  ('B7', 3, 3, 'AB-', false),
  ('B8', 3, 3, 'BA-', false),
  ('B9', 3, 3, 'AAx', false),
  ('B10', 3, 1, 'A--', false),
  ('B11', 3, 3, 'R--', false),
  ('C1', 5, 3, '-----', false),
  ('C2', 5, 4, '-----', true),
  ('C3', 5, 5, '-----', true),
  ('C4', 5, 4, 'AA---', true),
  ('C5', 5, 4, 'AB---', false),
  ('C6', 5, 5, 'AB---', true),
  ('C7', 5, 5, 'AAB--', true),
  ('C8', 5, 5, 'AABB-', false),
  ('C9', 5, 4, 'AAAxx', false),
  ('D1', 7, 4, '-------', false),
  ('D2', 7, 5, '-------', true),
  ('D3', 7, 6, 'ABAB---', false),
  ('D4', 7, 7, 'ABAB---', true),
  ('D5', 7, 7, 'AAAB---', true)
-- IFNEEDED-TABLE-END
) as t(case_id, series_length, k, outcomes, expect_if_needed);

-- The public reader's flags for one bracket, as 'SF5.3=true …' in bracket order.
create function pg_temp.h114_flags(p_token text, p_playoff uuid)
returns text
language plpgsql
as $fn$
declare r text; j jsonb;
begin
  r := pg_temp.h114_call('anon', null, format('public.get_league_schedule_by_token(%L)', p_token));
  j := pg_temp.h114_j(r);
  return (select string_agg((pg ->> 'round') || (pg ->> 'game_number') || '.' || (pg ->> 'series_game')
                            || '=' || coalesce(pg ->> 'if_needed', 'null'), ' '
                            order by (pg ->> 'game_number')::int, (pg ->> 'series_game')::int)
            from jsonb_array_elements(coalesce(j -> 'seasons', '[]'::jsonb)) s,
                 jsonb_array_elements(s -> 'playoff_games') pg
           where pg ->> 'playoff_id' = p_playoff::text);
end;
$fn$;

-- Calls one function as a user (or anon). 'OK <json>' or 'ERR <sqlstate> <message>'.
create function pg_temp.h114_call(p_role text, p_uid uuid, p_sql text)
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
    execute 'select to_jsonb(' || p_sql || ')' into v_j;
    v_out := 'OK ' || coalesce(v_j::text, 'null');
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

create function pg_temp.h114_j(p_txt text)
returns jsonb language sql immutable as $fn$
  select case when p_txt like 'OK %' then substr(p_txt, 4)::jsonb end
$fn$;

-- As the "test" owner.
create function pg_temp.h114_enter(p_game uuid, p_h integer, p_a integer)
returns text language sql as $fn$
  select pg_temp.h114_call('authenticated', (select org from h114_fx),
    format('public.enter_playoff_result(%L::uuid, %L::integer, %L::integer)', p_game, p_h, p_a))
$fn$;
create function pg_temp.h114_clear(p_game uuid, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h114_call('authenticated', (select org from h114_fx),
    format('public.clear_playoff_result(%L::uuid, %L::boolean)', p_game, p_commit))
$fn$;

-- A game by bracket, game number and game of its series.
create function pg_temp.h114_g(p_playoff uuid, p_number integer, p_k integer)
returns uuid language sql as $fn$
  select id from public.playoff_games where playoff_id = p_playoff and game_number = p_number and series_game = p_k
$fn$;

-- A team's label: 'M4', 'T6', or '-'.
create function pg_temp.h114_lbl(p_id uuid)
returns text language sql as $fn$
  select coalesce((select tm.k || tm.seed from h114_team tm where tm.id = p_id), '-')
$fn$;

-- One series' slots, game by game: 'M1/M4,M4/M1,M1/M4'.
create function pg_temp.h114_rows(p_playoff uuid, p_number integer)
returns text language sql as $fn$
  select string_agg(pg_temp.h114_lbl(g.home_team_id) || '/' || pg_temp.h114_lbl(g.away_team_id), ',' order by g.series_game)
    from public.playoff_games g where g.playoff_id = p_playoff and g.game_number = p_number
$fn$;

-- Everything about a bracket and its games ("nothing written").
create function pg_temp.h114_snap(p_ids uuid[])
returns text language sql as $fn$
  select md5(
    coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p where p.id = any(p_ids)), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g where g.playoff_id = any(p_ids)), ''))
$fn$;

-- A bracket's state without timestamps (the round trip compares it).
create function pg_temp.h114_state(p_playoff uuid)
returns text language sql as $fn$
  select string_agg(concat_ws(',', g.round, g.game_number, g.series_game, g.home_team_id, g.away_team_id,
                              g.home_score, g.away_score, g.winner_id, g.status), ' | '
                    order by g.game_number, g.series_game)
    from public.playoff_games g where g.playoff_id = p_playoff
$fn$;

-- The Majors payload and settings.
create function pg_temp.h114_payload()
returns jsonb language sql as $fn$
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'round', p.round, 'game_number', p.game_number, 'series_game', p.series_game,
           'home_team_id', (select id from h114_team where k = 'M' and seed = p.home_seed),
           'away_team_id', (select id from h114_team where k = 'M' and seed = p.away_seed),
           'scheduled_date', ((select t from h114_fx) + p.day)::text, 'start_time', '09:00'))
         order by p.game_number, p.series_game)
    from h114_plan p
$fn$;
create function pg_temp.h114_settings(p_series jsonb)
returns jsonb language sql as $fn$
  select jsonb_build_object(
    'format', 'single_elimination',
    'seeding', (select jsonb_agg(jsonb_build_object('team_id', id, 'team_name', name) order by seed)
                  from h114_team where k = 'M'),
    'playing_days', '[]'::jsonb, 'day_windows', '{}'::jsonb, 'venue_assignments', '[]'::jsonb,
    'cross_division_enabled', false, 'games_per_team_per_day', 1,
    'start_date', ((select t from h114_fx) + 1)::text, 'end_date', ((select t from h114_fx) + 40)::text,
    'series_by_round', p_series)
$fn$;
create function pg_temp.h114_replace(p_settings jsonb, p_games jsonb, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h114_call('authenticated', (select org from h114_fx),
    format('public.replace_playoff_games(%L::uuid, %L::jsonb, %L::jsonb, %L::boolean)',
           (select p6 from h114_fx), p_settings, p_games, p_commit))
$fn$;

-- The two-stage payloads. Stage 2's series rows carry seeds as the planner
-- lays them out (a bye seed in every game of its Semifinal).
create function pg_temp.h114_ts_settings1()
returns jsonb language sql as $fn$
  select jsonb_build_object(
    'format', 'round_robin',
    'seeding', (select jsonb_agg(jsonb_build_object('team_id', id, 'team_name', name) order by seed)
                  from h114_team where k = 'T'),
    'playing_days', '[]'::jsonb, 'day_windows', '{}'::jsonb, 'venue_assignments', '[]'::jsonb,
    'games_per_team_per_day', 1, 'end_date', ((select t from h114_fx) + 1)::text)
$fn$;
create function pg_temp.h114_ts_games1()
returns jsonb language sql as $fn$
  select jsonb_agg(jsonb_build_object('round', 'RR1', 'game_number', n,
           'home_team_id', (select id from h114_team where k = 'T' and seed = 2 * n - 1),
           'away_team_id', (select id from h114_team where k = 'T' and seed = 2 * n)) order by n)
    from generate_series(1, 3) n
$fn$;
create function pg_temp.h114_ts_settings2()
returns jsonb language sql as $fn$
  select jsonb_build_object(
    'format', 'single_elimination', 'seeding', '[]'::jsonb, 'advance_count', 6,
    'playing_days', '[]'::jsonb, 'day_windows', '{}'::jsonb, 'venue_assignments', '[]'::jsonb,
    'games_per_team_per_day', 1, 'start_date', ((select t from h114_fx) + 2)::text,
    'series_by_round', '{"SF": 3, "F": 3}'::jsonb)
$fn$;
create function pg_temp.h114_ts_games2(p_bad boolean)
returns jsonb language sql as $fn$
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'round', p.round, 'game_number', p.game_number, 'series_game', p.series_game,
           -- p_bad: Semifinal 2's Game 2 carries seed 1 too (seed 1 in two series).
           'seed_home', case when p_bad and p.game_number = 6 and p.series_game = 2 then 1 else p.home_seed end,
           'seed_away', p.away_seed,
           'scheduled_date', ((select t from h114_fx) + 2 + p.day)::text, 'start_time', '09:00'))
         order by p.game_number, p.series_game)
    from h114_plan p
$fn$;
create function pg_temp.h114_two(p_bad boolean, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h114_call('authenticated', (select org from h114_fx),
    format('public.replace_two_stage_games(%L::uuid, %L::jsonb, %L::jsonb, %L::uuid, %L::jsonb, %L::jsonb, %L::boolean)',
           (select pt1 from h114_fx), pg_temp.h114_ts_settings1(), pg_temp.h114_ts_games1(),
           (select pt2 from h114_fx), pg_temp.h114_ts_settings2(), pg_temp.h114_ts_games2(p_bad), p_commit))
$fn$;

-- ── The assertions ──────────────────────────────────────────────────────────
create function pg_temp.h114_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx      record;
  v_f     text[] := '{}';
  v_n     text[] := '{}';
  r       text;
  r2      text;
  j       jsonb;
  v_snap  text;
  v_st    text;
  v_t     text;
  v_pl    jsonb;
  v_set   jsonb;
  v_order uuid[];
  v_pub   jsonb;
  v_calls integer := 0;
begin
  select * into fx from h114_fx;

  -- P1 ───────────────────────────────────────────────────────────────────────
  select string_agg(format('%s %s=%s', t.fn, ro, has_function_privilege(ro, t.fn, 'EXECUTE')), '; ') into v_t
    from (values
      ('public.season_last_day(uuid)', ''),
      ('public.playoff_check_series(text, jsonb, jsonb)', ''),
      ('public.playoff_series_place(public.playoffs, text, integer, text, uuid, uuid)', ''),
      ('public.playoff_round_title(uuid, text)', ''),
      ('public.playoff_round_in_sentence(uuid, text)', ''),
      ('public.playoff_game_title(uuid, text, integer, integer)', ''),
      ('public.playoff_if_needed(integer, integer, text)', ''),
      ('public.playoff_write_stage(public.playoffs, uuid, jsonb, jsonb, integer, boolean)', ''),
      ('public.replace_playoff_games(uuid, jsonb, jsonb, boolean)', 'authenticated'),
      ('public.delete_playoff_bracket(uuid, boolean)', 'authenticated'),
      ('public.enter_playoff_result(uuid, integer, integer)', 'authenticated'),
      ('public.clear_playoff_result(uuid, boolean)', 'authenticated'),
      ('public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)', 'authenticated'),
      ('public.get_league_schedule_by_token(text)', 'anon,authenticated')
    ) t(fn, allowed),
    unnest(array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']) ro
   where has_function_privilege(ro, t.fn, 'EXECUTE') <> (ro = any (string_to_array(t.allowed, ',')));
  if v_t is not null then
    v_f := v_f || ('P1: wrong EXECUTE — ' || v_t);
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and p.proname in ('playoff_check_series', 'playoff_series_place', 'playoff_round_title',
                                  'playoff_round_in_sentence', 'playoff_game_title', 'season_last_day',
                                  'playoff_write_stage', 'playoff_if_needed'))
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and not p.prosecdef
                   and p.proname in ('replace_playoff_games', 'delete_playoff_bracket', 'enter_playoff_result',
                                     'clear_playoff_result', 'replace_two_stage_games', 'get_league_schedule_by_token')) then
    v_f := v_f || 'P1: a SECURITY DEFINER flag is wrong'::text;
  end if;

  -- IX1 ──────────────────────────────────────────────────────────────────────
  select string_agg(format('%s got %s', c.case_id,
                           public.playoff_if_needed(c.series_length, c.k, c.outcomes)), '; ') into v_t
    from h114_ifneeded c
   where public.playoff_if_needed(c.series_length, c.k, c.outcomes) is distinct from c.expect_if_needed;
  if v_t is not null or (select count(*) from h114_ifneeded) < 20 then
    v_f := v_f || ('IX1: playoff_if_needed disagrees with the table — ' || coalesce(v_t, 'too few rows'));
  end if;

  -- SC1 ──────────────────────────────────────────────────────────────────────
  begin
    insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, series_game)
    values (fx.p6, fx.s1, fx.d6, 'F', 99, 1), (fx.p6, fx.s1, fx.d6, 'F', 99, 1);
    v_f := v_f || 'SC1: a duplicate (playoff, round, game number, series game) was accepted'::text;
    raise exception 'H114_UNDO';
  exception when unique_violation then null;
            when others then if sqlerrm <> 'H114_UNDO' then v_f := v_f || ('SC1: duplicate slot — ' || sqlerrm); end if;
  end;
  begin
    insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, series_game)
    values (fx.p6, fx.s1, fx.d6, 'F', 99, 8);
    v_f := v_f || 'SC1: series_game 8 was accepted'::text;
    raise exception 'H114_UNDO';
  exception when check_violation then null;
            when others then if sqlerrm <> 'H114_UNDO' then v_f := v_f || ('SC1: series_game 8 — ' || sqlerrm); end if;
  end;
  begin
    insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, series_game, status)
    values (fx.p6, fx.s1, fx.d6, 'F', 99, 1, 'not_needed');
    raise exception 'H114_UNDO';
  exception when others then
    if sqlerrm <> 'H114_UNDO' then v_f := v_f || ('SC1: not_needed refused — ' || sqlerrm); end if;
  end;
  if exists (select 1 from public.playoff_games g
              where g.playoff_id not in (fx.p6, fx.pt1, fx.pt2) and (g.series_game <> 1 or g.status = 'not_needed'))
     or exists (select 1 from public.playoffs p
                 where p.id not in (fx.p6, fx.pt1, fx.pt2) and p.series_by_round <> '{}'::jsonb) then
    v_f := v_f || 'SC1: an existing game or bracket is not single-game'::text;
  end if;

  -- GN1 ──────────────────────────────────────────────────────────────────────
  v_pl := pg_temp.h114_payload();
  v_set := pg_temp.h114_settings('{"SF": 3, "F": 3}'::jsonb);
  v_snap := pg_temp.h114_snap(array[fx.p6]);
  r := pg_temp.h114_replace(v_set || '{"format": "round_robin"}'::jsonb, v_pl, false);
  if r not like 'ERR P0001 invalid_settings%' then v_f := v_f || ('GN1: series in a round robin — ' || r); end if;
  r := pg_temp.h114_replace(v_set, (select jsonb_agg(e) from jsonb_array_elements(v_pl) e
                                     where not (e ->> 'game_number' = '6' and e ->> 'series_game' = '3')), false);
  if r not like 'ERR P0001 invalid_games%' then v_f := v_f || ('GN1: a series missing its game 3 — ' || r); end if;
  r := pg_temp.h114_replace(pg_temp.h114_settings('{"SF": 5, "F": 3}'::jsonb), v_pl, false);
  if r not like 'ERR P0001 invalid_games%' then v_f := v_f || ('GN1: 3 games where series_by_round says 5 — ' || r); end if;
  r := pg_temp.h114_replace(v_set, (select jsonb_agg(case when e ->> 'game_number' = '5' and e ->> 'series_game' = '3'
                                                          then e || '{"series_game": 8}'::jsonb else e end)
                                      from jsonb_array_elements(v_pl) e), false);
  if r not like 'ERR P0001 invalid_games%' then v_f := v_f || ('GN1: series_game 8 — ' || r); end if;
  r := pg_temp.h114_replace(pg_temp.h114_settings('{"SF": 3, "F": 3, "QF": 3}'::jsonb), v_pl, false);
  if r not like 'ERR P0001 invalid_settings%' then v_f := v_f || ('GN1: a series for a round that isn''t there — ' || r); end if;
  r := pg_temp.h114_replace(v_set, v_pl || jsonb_build_array(v_pl -> 0), false);
  if r not like 'ERR P0001 invalid_games%' then v_f := v_f || ('GN1: a duplicate game — ' || r); end if;
  if pg_temp.h114_snap(array[fx.p6]) <> v_snap then
    v_f := v_f || 'GN1: a refused payload wrote something'::text;
  end if;
  r := pg_temp.h114_replace(v_set, v_pl, true);
  j := pg_temp.h114_j(r);
  if j is null or (j ->> 'committed') <> 'true' then
    v_f := v_f || ('GN1: the series bracket did not build — ' || r);
  end if;
  if (select count(*) from public.playoff_games where playoff_id = fx.p6) <> 11
     or (select series_by_round from public.playoffs where id = fx.p6) <> '{"SF": 3, "F": 3}'::jsonb
     or (select string_agg(round || game_number || '.' || series_game, ' ' order by game_number, series_game)
           from public.playoff_games where playoff_id = fx.p6)
        <> 'R12.1 R14.1 SF5.1 SF5.2 SF5.3 SF6.1 SF6.2 SF6.3 F7.1 F7.2 F7.3' then
    v_f := v_f || ('GN1: rows or series_by_round wrong — ' ||
      coalesce((select string_agg(round || game_number || '.' || series_game, ' ' order by game_number, series_game)
                  from public.playoff_games where playoff_id = fx.p6), 'none'));
  end if;
  if public.season_last_day(fx.s1) is distinct from fx.t + 40 then
    v_f := v_f || format('GN1: LD0 season_last_day %s, expected %s (the T+40 game counts while needed)',
                         public.season_last_day(fx.s1), fx.t + 40);
  end if;

  -- AN1 ──────────────────────────────────────────────────────────────────────
  v_snap := pg_temp.h114_snap(array[fx.p6]);
  r := pg_temp.h114_call('authenticated', fx.nonmember,
         format('public.enter_playoff_result(%L::uuid, 6, 3)', pg_temp.h114_g(fx.p6, 2, 1)));
  if r not like 'ERR 42501%' then v_f := v_f || ('AN1: a non-member entered a result — ' || r); end if;
  r := pg_temp.h114_call('anon', null,
         format('public.enter_playoff_result(%L::uuid, 6, 3)', pg_temp.h114_g(fx.p6, 2, 1)));
  if r not like 'ERR 42501%' then v_f := v_f || ('AN1: anon entered a result — ' || r); end if;
  if pg_temp.h114_snap(array[fx.p6]) <> v_snap then v_f := v_f || 'AN1: something was written'::text; end if;

  -- EN1 ──────────────────────────────────────────────────────────────────────
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 2, 1), 6, 3); v_calls := v_calls + 1;
  j := pg_temp.h114_j(r);
  if j is null or (j ->> 'committed') <> 'true' or (j -> 'advanced' ->> 'round') is distinct from 'SF' then
    v_f := v_f || ('EN1: Mets'' Round 1 result — ' || r);
  end if;
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 4, 1), 2, 4); v_calls := v_calls + 1;
  if pg_temp.h114_j(r) is null then v_f := v_f || ('EN1: Royals'' Round 1 result — ' || r); end if;
  v_t := pg_temp.h114_rows(fx.p6, 5) || ' | ' || pg_temp.h114_rows(fx.p6, 6);
  if v_t <> 'M1/M4,M4/M1,M1/M4 | M2/M6,M6/M2,M2/M6' then
    v_f := v_f || ('EN1: Semifinal slots — ' || v_t);
  end if;

  -- OR1 ──────────────────────────────────────────────────────────────────────
  v_snap := pg_temp.h114_snap(array[fx.p6]);
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 5, 3), 5, 1);
  j := pg_temp.h114_j(r);
  if j is null or (j ->> 'reason') is distinct from 'series_order' or (j ->> 'previous_series_game') <> '2' then
    v_f := v_f || ('OR1: Game 3 before Game 2 — ' || r);
  end if;
  if pg_temp.h114_snap(array[fx.p6]) <> v_snap then v_f := v_f || 'OR1: something was written'::text; end if;

  -- DC1 ──────────────────────────────────────────────────────────────────────
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 6, 1), 4, 1); v_calls := v_calls + 1;
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 6, 2), 2, 3); v_calls := v_calls + 1;
  j := pg_temp.h114_j(r);
  if j is null or (j -> 'series' -> 'not_needed') <> '[3]'::jsonb
     or (j -> 'series' ->> 'winner_id') is distinct from (select id::text from h114_team where k = 'M' and seed = 2) then
    v_f := v_f || ('DC1: Bears deciding Semifinal 2 — ' || r);
  end if;
  if (select status from public.playoff_games where id = pg_temp.h114_g(fx.p6, 6, 3)) <> 'not_needed' then
    v_f := v_f || 'DC1: Semifinal 2 Game 3 is not marked not needed'::text;
  end if;
  v_t := pg_temp.h114_rows(fx.p6, 7);
  if v_t <> '-/M2,-/M2,-/M2' then v_f := v_f || ('DC1: Final slots — ' || v_t); end if;

  -- NN1 ──────────────────────────────────────────────────────────────────────
  v_snap := pg_temp.h114_snap(array[fx.p6]);
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 6, 3), 5, 1);
  j := pg_temp.h114_j(r);
  if j is null or (j ->> 'reason') is distinct from 'game_not_needed' then
    v_f := v_f || ('NN1: a not-needed game — ' || r);
  end if;
  if pg_temp.h114_snap(array[fx.p6]) <> v_snap then v_f := v_f || 'NN1: something was written'::text; end if;

  -- LT1 ──────────────────────────────────────────────────────────────────────
  v_snap := pg_temp.h114_snap(array[fx.p6]);
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 6, 1), 7, 1);
  j := pg_temp.h114_j(r);
  if j is null or (j ->> 'reason') is distinct from 'series_later_result' or (j ->> 'later_series_game') <> '2' then
    v_f := v_f || ('LT1: changing Game 1 under Game 2 — ' || r);
  end if;
  if pg_temp.h114_snap(array[fx.p6]) <> v_snap then v_f := v_f || 'LT1: something was written'::text; end if;

  -- PUB1 ─────────────────────────────────────────────────────────────────────
  r := pg_temp.h114_call('anon', null, format('public.get_league_schedule_by_token(%L)', fx.token));
  j := pg_temp.h114_j(r);
  select coalesce(jsonb_agg(pg), '[]'::jsonb) into v_pub
    from jsonb_array_elements(coalesce(j -> 'seasons', '[]'::jsonb)) s,
         jsonb_array_elements(s -> 'playoff_games') pg
   where s ->> 'id' = fx.s1::text and pg ->> 'playoff_id' = fx.p6::text;
  if jsonb_array_length(v_pub) <> 10
     or exists (select 1 from jsonb_array_elements(v_pub) pg where pg ->> 'id' = pg_temp.h114_g(fx.p6, 6, 3)::text)
     or not exists (select 1 from jsonb_array_elements(v_pub) pg
                     where pg ->> 'round' = 'SF' and pg ->> 'series_game' = '2' and pg ->> 'series_length' = '3')
     or not exists (select 1 from jsonb_array_elements(v_pub) pg
                     where pg ->> 'round' = 'R1' and pg ->> 'series_game' = '1' and pg ->> 'series_length' = '1') then
    v_f := v_f || format('PUB1: public rows %s; not-needed shown %s', jsonb_array_length(v_pub),
      exists (select 1 from jsonb_array_elements(v_pub) pg where pg ->> 'id' = pg_temp.h114_g(fx.p6, 6, 3)::text));
  end if;

  -- IF1 ──────────────────────────────────────────────────────────────────────
  -- 0–0 in Semifinal 1 and the Final; Semifinal 2 decided (its Game 3 gone).
  v_t := pg_temp.h114_flags(fx.token, fx.p6);
  if v_t is distinct from 'R12.1=false R14.1=false SF5.1=false SF5.2=false SF5.3=true SF6.1=false SF6.2=false F7.1=false F7.2=false F7.3=true' then
    v_f := v_f || ('IF1: flags at 0–0 — ' || coalesce(v_t, 'none'));
  end if;
  begin
    r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 5, 1), 5, 2);   -- Expos (home) win: 1–0
    v_t := pg_temp.h114_flags(fx.token, fx.p6);
    if position('SF5.2=false SF5.3=true' in coalesce(v_t, '')) = 0 then
      v_f := v_f || ('IF1: flags at 1–0 — ' || coalesce(v_t, 'none') || ' / ' || r);
    end if;
    r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 5, 2), 5, 3);   -- Mets (home in Game 2) win: 1–1
    v_t := pg_temp.h114_flags(fx.token, fx.p6);
    if position('SF5.3=false' in coalesce(v_t, '')) = 0 then
      v_f := v_f || ('IF1: at 1–1 Game 3 will be played, so it is not if needed — ' || coalesce(v_t, 'none') || ' / ' || r);
    end if;
    raise exception 'H114_UNDO';
  exception when others then
    if sqlerrm <> 'H114_UNDO' then
      v_f := v_f || ('IF1: crashed — ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- KY1 ──────────────────────────────────────────────────────────────────────
  -- The reader's keys, exactly. Round 1 and Semifinal 2 hold scores and
  -- winners right now; none of it may leave.
  select string_agg(distinct z.ks, ' | ') into v_t
    from (select (select string_agg(k, ',' order by k) from jsonb_object_keys(pg) k) as ks
            from jsonb_array_elements(v_pub) pg) z;
  if v_t is distinct from 'away_team,division_id,format,game_number,home_team,id,if_needed,playoff_id,round,scheduled_date,seed_away,seed_home,series_game,series_length,stage,start_time,status,venue'
     or v_pub::text ~ '(score|winner|wins|lead)' then
    v_f := v_f || ('KY1: a public playoff game carries other keys — ' || coalesce(v_t, 'none'));
  end if;

  -- LD1 ──────────────────────────────────────────────────────────────────────
  if public.season_last_day(fx.s1) is distinct from fx.t + 30 then
    v_f := v_f || format('LD1: season_last_day %s, expected %s (the not-needed T+40 game must not count)',
                         public.season_last_day(fx.s1), fx.t + 30);
  end if;

  -- HM1 ──────────────────────────────────────────────────────────────────────
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 5, 1), 5, 2); v_calls := v_calls + 1;
  v_st := pg_temp.h114_state(fx.p6);
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 5, 2), 3, 6); v_calls := v_calls + 1;
  j := pg_temp.h114_j(r);
  if j is null or (j -> 'series' -> 'not_needed') <> '[3]'::jsonb then
    v_f := v_f || ('HM1: Expos deciding Semifinal 1 — ' || r);
  end if;
  v_t := pg_temp.h114_rows(fx.p6, 7);
  if v_t <> 'M1/M2,M2/M1,M1/M2' then v_f := v_f || ('HM1: Final slots — ' || v_t); end if;

  -- CL1 ──────────────────────────────────────────────────────────────────────
  v_snap := pg_temp.h114_snap(array[fx.p6]);
  r := pg_temp.h114_clear(pg_temp.h114_g(fx.p6, 5, 2), false);
  j := pg_temp.h114_j(r);
  if j is null or (j ->> 'committed') <> 'false' or (j ->> 'blocked') <> 'false'
     or jsonb_array_length(j -> 'series' -> 'restored') <> 1
     or (j -> 'series' -> 'restored' -> 0 ->> 'series_game') <> '3'
     or (j -> 'removed' ->> 'team_name') is distinct from 'ZZ114 Expos' then
    v_f := v_f || ('CL1: the clear preview — ' || r);
  end if;
  if pg_temp.h114_snap(array[fx.p6]) <> v_snap then v_f := v_f || 'CL1: the preview wrote something'::text; end if;
  r := pg_temp.h114_clear(pg_temp.h114_g(fx.p6, 5, 2), true); v_calls := v_calls + 1;
  if pg_temp.h114_j(r) is null or (pg_temp.h114_j(r) ->> 'committed') <> 'true' then
    v_f := v_f || ('CL1: the clear — ' || r);
  end if;
  if pg_temp.h114_state(fx.p6) is distinct from v_st then
    v_f := v_f || ('CL1: the round trip left the bracket different — Semifinal 1 ' ||
      (select string_agg(status, ',' order by series_game) from public.playoff_games
        where playoff_id = fx.p6 and game_number = 5) || '; Final ' || pg_temp.h114_rows(fx.p6, 7));
  end if;

  -- CL2 ──────────────────────────────────────────────────────────────────────
  v_snap := pg_temp.h114_snap(array[fx.p6]);
  r := pg_temp.h114_clear(pg_temp.h114_g(fx.p6, 6, 1), true);
  j := pg_temp.h114_j(r);
  if j is null or (j ->> 'reason') is distinct from 'series_later_result' then
    v_f := v_f || ('CL2: clearing Game 1 under Game 2 — ' || r);
  end if;
  if pg_temp.h114_snap(array[fx.p6]) <> v_snap then v_f := v_f || 'CL2: something was written'::text; end if;

  -- FL1 ──────────────────────────────────────────────────────────────────────
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 6, 2), 5, 1); v_calls := v_calls + 1;
  j := pg_temp.h114_j(r);
  if j is null or (j -> 'series' -> 'restored') <> '[3]'::jsonb or (j -> 'series' ->> 'winner_id') is not null then
    v_f := v_f || ('FL1: the flip — ' || r);
  end if;
  if (select status from public.playoff_games where id = pg_temp.h114_g(fx.p6, 6, 3)) <> 'scheduled' then
    v_f := v_f || 'FL1: Semifinal 2 Game 3 did not come back'::text;
  end if;
  v_t := pg_temp.h114_rows(fx.p6, 7);
  if v_t <> '-/-,-/-,-/-' then v_f := v_f || ('FL1: Bears still in the Final — ' || v_t); end if;
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 6, 3), 5, 0); v_calls := v_calls + 1;
  v_t := pg_temp.h114_rows(fx.p6, 7);
  if v_t <> '-/M2,-/M2,-/M2' then v_f := v_f || ('FL1: Bears back in the Final — ' || v_t || ' ' || r); end if;

  -- NX1 ──────────────────────────────────────────────────────────────────────
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 5, 2), 3, 6); v_calls := v_calls + 1;
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 7, 1), 3, 2); v_calls := v_calls + 1;
  if pg_temp.h114_j(r) is null or (pg_temp.h114_j(r) ->> 'committed') <> 'true' then
    v_f := v_f || ('NX1: the Final''s Game 1 — ' || r);
  end if;
  v_snap := pg_temp.h114_snap(array[fx.p6]);
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.p6, 5, 2), 3, 7);
  r2 := pg_temp.h114_clear(pg_temp.h114_g(fx.p6, 5, 2), false);
  if coalesce(pg_temp.h114_j(r) ->> 'reason', '') <> 'next_game_has_result'
     or coalesce(pg_temp.h114_j(r2) ->> 'reason', '') <> 'next_game_has_result' then
    v_f := v_f || ('NX1: a Semifinal result under a played Final — enter ' || r || ' / clear ' || r2);
  end if;
  if pg_temp.h114_snap(array[fx.p6]) <> v_snap then v_f := v_f || 'NX1: something was written'::text; end if;

  -- TS1 ──────────────────────────────────────────────────────────────────────
  v_snap := pg_temp.h114_snap(array[fx.pt1, fx.pt2]);
  r := pg_temp.h114_two(true, false);
  if r not like 'ERR P0001 invalid_games%' then v_f := v_f || ('TS1: seed 1 in two series — ' || r); end if;
  if pg_temp.h114_snap(array[fx.pt1, fx.pt2]) <> v_snap then v_f := v_f || 'TS1: a refused payload wrote something'::text; end if;
  r := pg_temp.h114_two(false, true);
  if pg_temp.h114_j(r) is null or (pg_temp.h114_j(r) ->> 'committed') <> 'true' then
    v_f := v_f || ('TS1: the two-stage build — ' || r);
  end if;
  select array_agg(id order by seed desc) into v_order from h114_team where k = 'T';  -- seed 1 = T6
  r := pg_temp.h114_call('authenticated', fx.org,
         format('public.seed_playoff_stage(%L::uuid, %L::uuid[], true)', fx.pt2, v_order));
  if pg_temp.h114_j(r) is null or (pg_temp.h114_j(r) ->> 'committed') <> 'true' then
    v_f := v_f || ('TS1: seeding — ' || r);
  end if;
  v_t := pg_temp.h114_rows(fx.pt2, 5) || ' | ' || pg_temp.h114_rows(fx.pt2, 2);
  if v_t <> 'T6/-,T6/-,T6/- | T3/T2' then v_f := v_f || ('TS1: seeded slots — ' || v_t); end if;
  r := pg_temp.h114_enter(pg_temp.h114_g(fx.pt2, 2, 1), 6, 3); v_calls := v_calls + 1;
  v_t := pg_temp.h114_rows(fx.pt2, 5);
  if v_t <> 'T6/T3,T3/T6,T6/T3' then v_f := v_f || ('TS1: Stage 2 Semifinal 1 after Round 1 — ' || v_t || ' ' || r); end if;

  -- DL1 ──────────────────────────────────────────────────────────────────────
  r := pg_temp.h114_call('authenticated', fx.org, format('public.delete_playoff_bracket(%L::uuid, false)', fx.p6));
  j := pg_temp.h114_j(r);
  if j is null or (j ->> 'games') <> '11' or (j ->> 'not_needed_games') <> '1' or (j ->> 'public_games') <> '10' then
    v_f := v_f || ('DL1: the delete preview — ' || r);
  end if;

  -- LG1 ──────────────────────────────────────────────────────────────────────
  if not exists (select 1 from public.activity_log a where a.league_id = fx.s1 and a.event_type = 'playoff_result_entered'
                  and a.message = 'ZZ114 Majors playoffs: Round 1 — ZZ114 Mets 6, ZZ114 Pirates 3 — ZZ114 Mets won; ZZ114 Mets moved into the Semifinals')
     or not exists (select 1 from public.activity_log a where a.league_id = fx.s1 and a.event_type = 'playoff_result_entered'
                     and a.message = 'ZZ114 Majors playoffs: Semifinals, game 2 of 3 — ZZ114 Mets 3, ZZ114 Expos 6 — ZZ114 Expos won; ZZ114 Expos won the series and moved into the Final')
     or not exists (select 1 from public.activity_log a where a.league_id = fx.s1 and a.event_type = 'playoff_result_cleared'
                     and a.message = 'ZZ114 Majors playoffs: result cleared for Semifinals, game 2 of 3 — was ZZ114 Mets 3, ZZ114 Expos 6 (ZZ114 Expos won); the series is undecided again — ZZ114 Expos removed from the Final')
     or exists (select 1 from public.activity_log a where a.league_id = fx.s1
                 and a.event_type in ('playoff_result_entered', 'playoff_result_cleared')
                 and a.message ~ 'Game [0-9]+ \(') then
    v_f := v_f || ('LG1: log rows — ' || coalesce((select string_agg(a.message, ' || ' order by a.created_at, a.id)
      from public.activity_log a where a.league_id = fx.s1 and a.event_type in ('playoff_result_entered', 'playoff_result_cleared')), 'none'));
  end if;

  -- OT1 ──────────────────────────────────────────────────────────────────────
  if (select md5(coalesce(string_agg(row(p.id, p.league_id, p.division_id, p.format, p.status, p.seeding,
                                          p.stage, p.parent_playoff_id, p.advance_count, p.seeded_at,
                                          p.stage1_changes, p.updated_at)::text, '|' order by p.id), ''))
        from public.playoffs p where p.id not in (fx.p6, fx.pt1, fx.pt2)) <> (select po_fp from h114_before)
     or (select md5(coalesce(string_agg(row(g.id, g.playoff_id, g.round, g.game_number, g.home_team_id,
                                             g.away_team_id, g.winner_id, g.home_score, g.away_score, g.status,
                                             g.scheduled_date, g.start_time, g.venue_id, g.seed_home, g.seed_away,
                                             g.updated_at)::text, '|' order by g.id), ''))
           from public.playoff_games g where g.playoff_id not in (fx.p6, fx.pt1, fx.pt2)) <> (select games_fp from h114_before) then
    v_f := v_f || 'OT1: an existing bracket or game changed'::text;
  end if;

  -- RL1 ──────────────────────────────────────────────────────────────────────
  if md5(
    coalesce((select string_agg(p::text, '|' order by p.id) from public.playoffs p
               join public.leagues l on l.id = p.league_id where l.owner_id = fx.real_org), '') || '#' ||
    coalesce((select string_agg(g::text, '|' order by g.id) from public.playoff_games g
               join public.leagues l on l.id = g.league_id where l.owner_id = fx.real_org), '') || '#' ||
    coalesce((select string_agg(a.id::text, '|' order by a.id) from public.activity_log a
               join public.leagues l on l.id = a.league_id
              where l.owner_id = fx.real_org and a.event_type like 'playoff_%'), '')) <> fx.real_fp then
    v_f := v_f || 'RL1: the real league''s playoff rows changed'::text;
  end if;

  v_n := v_n || format('committed result calls: %s', v_calls);
  return jsonb_build_object('fails', to_jsonb(v_f), 'notes', to_jsonb(v_n));
end;
$fn$;

-- ── Baseline + mutants ──────────────────────────────────────────────────────
do $h114$
declare
  v_out   text := E'\n';
  v_m     jsonb;
  v_first text;
  v_tag   text;
  v_def   text;
  v_mut   text;
  v_enter constant text := 'public.enter_playoff_result(uuid, integer, integer)';
  v_clear constant text := 'public.clear_playoff_result(uuid, boolean)';
  v_place constant text := 'public.playoff_series_place(public.playoffs, text, integer, text, uuid, uuid)';
  v_check constant text := 'public.playoff_check_series(text, jsonb, jsonb)';
  m       record;
begin
  -- Baseline.
  begin
    v_m := pg_temp.h114_assert();
    raise exception 'H114_RESULT %', v_m::text;
  exception when others then
    if sqlerrm like 'H114_RESULT %' then
      v_m := substr(sqlerrm, 13)::jsonb;
      v_out := v_out || format(E'BASELINE failures (%s): %s\nNOTES: %s\n',
        jsonb_array_length(v_m -> 'fails'), v_m -> 'fails', v_m -> 'notes');
    else
      v_out := v_out || format(E'BASELINE CRASH %s %s\n', sqlstate, sqlerrm);
    end if;
  end;

  for m in
    select * from (values
      ('MU1', 'place: home doesn''t alternate', 'EN1', v_place,
        $a$      v_home := case when r.series_game % 2 = 1 then v_top else v_low end;
      v_away := case when r.series_game % 2 = 1 then v_low else v_top end;$a$,
        $a$      v_home := v_top;
      v_away := v_low;$a$, null::text, null::text),
      ('MU2', 'place: the lower seed is home in game 1', 'EN1', v_place,
        $a$    if v_sb is not null and (v_sa is null or v_sb < v_sa) then$a$,
        $a$    if v_sb is not null and (v_sa is null or v_sb > v_sa) then$a$, null, null),
      ('MU3', 'check_series: series shape not checked', 'GN1', v_check,
        $a$              where x.c <> coalesce((p_series ->> x.r)::integer, 1) or x.m <> x.c) then$a$,
        $a$              where false) then$a$, null, null),
      ('MU4', 'check_series: series allowed outside single elimination', 'GN1', v_check,
        $a$     or (p_series <> '{}'::jsonb and p_format is distinct from 'single_elimination')$a$,
        $a$     or false$a$, null, null),
      ('MU5', 'enter: results don''t have to go in order', 'OR1', v_enter,
        $a$g.series_game = v_k - 1 and not ($a$, $a$g.series_game = v_k - 1 and false and not ($a$, null, null),
      ('MU6', 'enter: a decided series cancels nothing', 'DC1', v_enter,
        $a$           set status = 'not_needed', updated_at = now()$a$,
        $a$           set updated_at = now()$a$, null, null),
      ('MU7', 'enter: a not-needed game takes a result', 'NN1', v_enter,
        $a$  if v_game.status = 'not_needed' then
    return jsonb_build_object($a$, $a$  if false then
    return jsonb_build_object($a$,
        $a$  if v_before is not null and not v_had_result then$a$, $a$  if false then$a$),
      ('MU8', 'enter: an earlier result changes under a later one', 'LT1', v_enter,
        $a$      if v_blocker is not null then
        return jsonb_build_object(
          'committed', false, 'blocked', true, 'reason', 'series_later_result',$a$,
        $a$      if false then
        return jsonb_build_object(
          'committed', false, 'blocked', true, 'reason', 'series_later_result',$a$, null, null),
      ('MU9', 'reader: not-needed games shown', 'PUB1', 'public.get_league_schedule_by_token(text)',
        $a$               and pg.status <> 'not_needed'$a$, $a$               and true$a$, null, null),
      ('MU10', 'season_last_day counts not-needed games', 'LD1', 'public.season_last_day(uuid)',
        $a$
                 and pg.status <> 'not_needed'))$a$, $a$))$a$, null, null),
      ('MU11', 'clear: the not-needed game isn''t brought back', 'CL1', v_clear,
        $a$      update public.playoff_games g
         set status = 'scheduled', updated_at = now()$a$,
        $a$      update public.playoff_games g
         set updated_at = now()$a$, null, null),
      ('MU12', 'clear: the winner stays in the next round', 'CL1', v_clear,
        $a$    if v_series_remove then
      perform public.playoff_series_place$a$,
        $a$    if false then
      perform public.playoff_series_place$a$, null, null),
      ('MU13', 'clear: an earlier result cleared under a later one', 'CL2', v_clear,
        $a$    if v_blocker is not null then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'series_later_result',$a$,
        $a$    if false then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'series_later_result',$a$, null, null),
      ('MU14', 'enter: an un-deciding edit leaves the winner in the next round', 'FL1', v_enter,
        $a$  if v_series_mode and v_t_id is not null and v_before is distinct from v_after then$a$,
        $a$  if v_series_mode and v_t_id is not null and v_after is not null and v_before is distinct from v_after then$a$, null, null),
      ('MU15', 'enter: a series result changes under a played Final', 'NX1', v_enter,
        $a$    if found then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_game_has_result',$a$,
        $a$    if false then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_game_has_result',$a$, null, null),
      ('MU16', 'clear: a series result cleared under a played Final', 'NX1', v_clear,
        $a$    if found then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_game_has_result',$a$,
        $a$    if false then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_game_has_result',$a$, null, null),
      ('MU17', 'write_stage: a seed in two series accepted', 'TS1',
        'public.playoff_write_stage(public.playoffs, uuid, jsonb, jsonb, integer, boolean)',
        $a$    if v_seeds is distinct from array(select generate_series(1, v_adv)) or v_bad > 0 then$a$,
        $a$    if v_seeds is distinct from array(select generate_series(1, v_adv)) then$a$, null, null),
      ('MU18', 'delete: not-needed games on the public count', 'DL1', 'public.delete_playoff_bracket(uuid, boolean)',
        $a$     and g.status <> 'not_needed'
     and d.locked
     and exists (select 1 from public.playoffs po$a$,
        $a$     and d.locked
     and exists (select 1 from public.playoffs po$a$, null, null),
      ('MU19', 'EXECUTE on playoff_series_place granted to PUBLIC', 'P1', null,
        null, $a$grant execute on function public.playoff_series_place(public.playoffs, text, integer, text, uuid, uuid) to public$a$, null, null),
      ('MU20', 'enter: the log names the stored game number', 'LG1', v_enter,
        $a$public.playoff_game_title(v_po.id, v_game.round, v_game.game_number, v_k),
    coalesce(v_home_name, 'Home'), p_home_score$a$,
        $a$format('Game %s', v_game.game_number),
    coalesce(v_home_name, 'Home'), p_home_score$a$, null, null),
      ('MU21', 'if_needed: by position, the results ignored', 'IX1', 'public.playoff_if_needed(integer, integer, text)',
        $a$  return v_a + v_before >= v_need or v_b + v_before >= v_need;$a$,
        $a$  return p_k > v_need;$a$, null, null),
      ('MU22', 'reader: the results not passed to the flag', 'IF1', 'public.get_league_schedule_by_token(text)',
        $a$when s.winner_id is null then 'R'$a$, $a$when true then '-'$a$, null, null),
      ('MU23', 'reader: a score emitted beside the flag', 'KY1', 'public.get_league_schedule_by_token(text)',
        $a$'if_needed',      public.playoff_if_needed($a$,
        $a$'home_score', pg.home_score, 'if_needed',      public.playoff_if_needed($a$, null, null),
      ('MU24', 'EXECUTE on playoff_if_needed granted to anon', 'P1', null,
        null, $a$grant execute on function public.playoff_if_needed(integer, integer, text) to anon$a$, null, null)
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
      v_m := pg_temp.h114_assert();
      raise exception 'H114_RESULT %', v_m::text;
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm like 'H114_RESULT %' then
        v_m := substr(sqlerrm, 13)::jsonb;
        v_first := v_m -> 'fails' ->> 0;
        v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
        v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s); first: %s\n',
          m.id, m.what,
          case when v_first is null then 'SURVIVED'
               when v_tag = m.target then 'KILLED'
               else 'KILLED AT THE WRONG ASSERTION' end,
          v_tag, m.target, jsonb_array_length(v_m -> 'fails'), left(coalesce(v_first, ''), 200));
      else
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  v_out := v_out || (select string_agg('prosrc md5 ' || p.proname || ': ' || md5(p.prosrc), E'\n' order by p.proname)
                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public'
                        and p.proname in ('season_last_day', 'playoff_check_series', 'playoff_series_place',
                                          'playoff_round_title', 'playoff_round_in_sentence', 'playoff_game_title',
                                          'replace_playoff_games', 'delete_playoff_bracket', 'enter_playoff_result',
                                          'clear_playoff_result', 'get_league_schedule_by_token',
                                          'playoff_write_stage', 'replace_two_stage_games', 'playoff_if_needed'));

  raise exception '%', v_out;
end;
$h114$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from information_schema.columns where table_name = 'playoff_games' and column_name = 'series_game')
--     + (select count(*) from information_schema.columns where table_name = 'playoffs' and column_name = 'series_by_round')
--     + (select count(*) from pg_proc where proname in ('playoff_check_series', 'playoff_series_place',
--          'playoff_round_title', 'playoff_round_in_sentence', 'playoff_game_title',
--          'playoff_if_needed')) as zero_before_apply,
--   (select count(*) from leagues where name like 'ZZ114%')
--     + (select count(*) from teams where name like 'ZZ114%') as fixtures_must_be_0,
--   (select count(*) from public_schedule_links where org_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as test_link_must_be_0,
--   (select count(*) from playoffs) as playoffs_5,
--   (select count(*) from playoff_games) as playoff_games_18;

-- ── RUN LOG ─────────────────────────────────────────────────────────────────
-- 2026-10-20 — against production, "test" proof org (owner bbf9afe1…) fixtures
-- only (the mockup's Majors bracket + a two-stage pair), rolled back. A dry
-- run of the migration alone came first: it compiled, its verify block passed
-- and every md5 matched the file.
-- Run 1: GREEN. BASELINE failures (0); 12 committed calls. 20/20 KILLED at
--   their own tag (MU1–MU20, targets as listed in the header). prosrc md5
--   inside the batch equal to the repo file's bodies, all thirteen:
--     clear_playoff_result        f60c353245d685861b3f3d01456d61e9
--     delete_playoff_bracket      0c788c4b4996dc656655e5d9f1e26ead
--     enter_playoff_result        bf336bf9b03690df35fa12d025f84dae
--     get_league_schedule_by_token 58de6c61e0b3a29bd3392352b2408718
--     playoff_check_series        ad4168131434ce72dfe75b43c3c41a32
--     playoff_game_title          3c362c4ecafd99e7385e0f98d483b74d
--     playoff_round_in_sentence   4a0911e0564055cd621d901f85343a75
--     playoff_round_title         0f80e431da34b6767c3b501a41a498ae
--     playoff_series_place        874da41d419f49600b68f6122d9432e1
--     playoff_write_stage         d43764d1042f4e98bac7cb5fb277c56b
--     replace_playoff_games       2e62187822aa292d6b95c77ec27f293b
--     replace_two_stage_games     265add03389e1c1129297948157273bd
--     season_last_day             48e6d5504f19349a0bae92edc34c014d
--   Leak check after: new columns, helpers and fixtures 0; test link 0;
--   playoffs 5, games 18; live enter still 0113's (0602516b…), live
--   season_last_day still 0112's (da8e4785…).
-- Regressions, same day, each with 0114 in place of its own migration
-- (`playoff-series-build.ts 0107|0108|0112|0113`), each followed by a clean
-- leak check:
--   0108: BASELINE 0 (14 committed calls); 18/18 KILLED at their own tag;
--     md5 enter/clear = bf336bf9… / f60c3532… (0114's); helpers unchanged.
--   0107: BASELINE 0; 15/15 KILLED at their own tag; md5 delete/replace =
--     0c788c4b… / 2e621878… (0114's). Its RL1 is VACUOUS today — see its log.
--   0112: BASELINE 0, 12 cases (K and L new: not-needed playoff dates);
--     12/12 KILLED at their own tag (FM12 new); md5s = 0114's, team calendar
--     reader unchanged (45f822d6…).
--   0113: BASELINE 0; 23/23 KILLED at their own tag; md5s = 0114's for the
--     seven it re-creates, 0113's for seed/acknowledge/apply. Its SC1/OT1
--     check was re-targeted first (0113 is live now) — see its log.
-- 2026-10-20 (later) — the public "If needed" flag (playoff_if_needed + the
-- reader's if_needed key; IX1, IF1, KY1; MU21–MU24 added). Live had 19 playoff
-- games by then (one more than the first run; OT1 fingerprints whatever is
-- there). No other active backend.
-- Run 1: GREEN. BASELINE failures (0); 12 committed calls. 24/24 KILLED at
--   their own tag, incl. MU21 → [IX1] (B7, B8, B11, C5, C8, D3 flipped),
--   MU22 → [IF1] (at 1–1 Game 3 still read "if needed"), MU23 → [KY1] (the
--   home_score key), MU24 → [P1]. prosrc md5 inside the batch = the repo
--   file's, all fourteen: the thirteen above unchanged except
--     get_league_schedule_by_token 93db2cf6a40749d38a057be0f1a0737f
--   plus playoff_if_needed 25f7d7ee376edbed65a91d5d68862e20.
--   Leak check after: new columns, helpers and fixtures 0; test link 0;
--   playoffs 5, games 19; live reader still 0113's (ee9d9bb3…), live
--   season_last_day still 0112's (da8e4785…).
-- 0114 NOT APPLIED — held for the founder's go.

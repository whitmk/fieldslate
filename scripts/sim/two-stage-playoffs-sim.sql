-- SQL-level proof for migration 0113 (two-stage playoffs: the stage columns,
-- replace_two_stage_games, seed_playoff_stage, acknowledge_stage_seeds, and
-- the changes to replace_playoff_games, delete_playoff_bracket,
-- enter_playoff_result, clear_playoff_result and the public reader).
--
-- WHY SQL: SECURITY DEFINER refusals, grants exercised as `anon` and
-- `authenticated`, constraints, row locks and counted writes only a real
-- database can exercise. NOT `npm run`-able, NOT in CI (CLAUDE.md, "Harness
-- standard — SQL-level exceptions").
--
-- THIS HARNESS APPLIES 0113 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK, so it runs BEFORE the migration is applied. The build script
-- (two-stage-playoffs-build.ts) substitutes the repo file for the placeholder.
-- Before the migration runs it snapshots every existing bracket and playoff
-- game, so SC1/OT1 can prove the ALTERs left them byte-identical.
--
-- HOW TO RUN: `npx tsx scripts/sim/two-stage-playoffs-build.ts > <file>`, send
-- the output as ONE batch through the Supabase MCP (one batch = one
-- transaction), read the raised message, then run the leak check at the
-- bottom. The 0107 and 0108 proofs are re-run against 0113 too:
-- `npx tsx scripts/sim/two-stage-playoffs-build.ts 0107` / `0108`.
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
--   rows. The "test" org owner's `profiles` ROW (plan switched for PL1, rolled
--   back). A `public_schedule_links` row for the "test" org if it has none.
--   Locking the fixture division fires team_calendar_links_on_division_lock
--   (inserts calendar-link rows for its teams; rolled back).
--   lock_timeout = 3s; statement_timeout = 120s.
--
-- ROWS TOUCHED (all rolled back): the "test" proof org only (owner
-- bbf9afe1-9e62-41e0-becc-895085bfc9d6, whitmellonking@, org name "test") — one
-- fixture season, three divisions, ten teams, one field, three fixture
-- brackets and their games, activity-log rows, the owner's profiles.plan. The
-- "SRALL" test org owner (aa21d01c…, not a member of "test") is the
-- non-member caller and nothing of theirs is written. NOTHING belonging to
-- Santa Rosa American Little League (owner 8fde72f9-cd5a-43ad-91e3-db14fb6fbcc4)
-- is written or passed to any function (RL1, checked last).
--
-- THE FIXTURE (the mockup's Majors): seven teams — Bears, Expos, Giants,
-- Lions, Mets, Pirates, Royals — a 21-game round robin (pS1) and a top-6
-- bracket (pS2: Game 2 seeds 4 v 5, Game 4 seeds 3 v 6, Game 5 seed 1 v the
-- winner of 2, Game 6 seed 2 v the winner of 4, Game 7 the final). The seed
-- order used is the mockup's: Expos, Bears, Lions, Mets, Pirates, Royals,
-- Giants. pEq is a plain round-robin bracket in another division, written with
-- the SAME Stage 1 payload through replace_playoff_games (EQ1).
--
-- ASSERTIONS (in order; a mutant must die FIRST at its own tag)
--   P1   privileges: every entry point authenticated only (not anon /
--        service_role / dashboard_readonly / PUBLIC), SECURITY DEFINER; the
--        three new ones pin search_path; the two helpers callable by no role
--   SC1  schema: existing brackets and games byte-identical on their original
--        columns, every bracket stage 1 with defaults; a second Stage 1 in one
--        division is refused (23505); a Stage 2 without a parent (23514)
--   AN1  anon and a non-member are refused by the three new functions;
--        nothing written
--   PL1  a non-Elite (Pro) org is refused plan_required by all three
--   PR1  replace_two_stage_games refuses, writing nothing: a non-pair, a team
--        in a Stage 2 game, a missing seed, more advancing than teams, Stage 2
--        starting on Stage 1's last day, a seed in a Stage 1 game
--   GU1  replace_playoff_games refuses either half of the pair
--        (two_stage_pair) and a per-day limit of 3; a plain bracket still
--        builds and stores games_per_team_per_day
--   BL1  the build's PREVIEW writes nothing; the commit writes both stages
--        (Stage 1: 21 games with teams, no seeds; Stage 2: 5 games, no teams,
--        the layout's seeds, advance 6, unseeded), both active, one log row
--   EQ1  the two writers agree: pS1 and pEq hold identical settings and games
--   PUB1 the public reader emits stage and seeds for Stage 2 games
--   SD1  seeding is refused while a Stage 1 game without a result is dated
--        today; nothing written
--   SD2  "Seed anyway": rained-out, undated and past games are listed with
--        their reasons; the commit fills the slots IN PLACE (ids, dates,
--        times, fields unchanged), stores the order, logs
--   SD3  an order that isn't exactly Stage 1's teams is refused
--   SD4  re-seeding (Change seeds) rewrites the slots and empties the
--        recorded changes
--   CH1  a Stage 1 result entered or cleared after seeding flags Stage 2,
--        records the game with its score before and after (cleared → null
--        "now"), and logs; ties are still refused
--   CH2  a game changed twice keeps ONE entry: the first "was", the latest
--        "now"; other games' entries stay
--   AK1  "Seeds are still right" clears the flag AND the recorded changes,
--        and logs, once
--   RB2  a full rebuild is refused once Stage 1 has results; a Stage-2-only
--        rebuild moves the dates and re-applies the seeds (and keeps the
--        recorded changes), Stage 1 untouched
--   ST1  once Stage 2 has a result: Stage 1 enter and clear (preview and
--        commit), seeding and rebuilding are all refused, nothing written
--   DL1  deleting Stage 2 deletes both stages; the preview counts both
--   OT1  every bracket outside the fixtures is byte-identical
--   LG1  exactly the expected two-stage log rows
--   RL1  the real league's playoff rows and log rows are unchanged
--
-- MUTANTS (each rewrites a REAL function inside its own rolled-back block;
-- KILLED only if the FIRST failure is its own tag)
--   MU1  seed: membership gate removed                          → AN1
--   MU2  build: plan gate removed                               → PL1
--   MU3  build: teams accepted in Stage 2 games                 → PR1
--   MU4  replace_playoff_games: pair guard removed              → GU1
--   MU5  build: preview commits                                 → BL1
--   MU6  writer: per-day limit always 1                         → EQ1
--   MU7  reader: seeds not emitted                              → PUB1
--   MU8  seed: Stage 1 in-progress check removed                → SD1
--   MU9  seed: an undated game blocks seeding                   → SD2
--   MU10 apply: seed k gets the (k+1)th team (home slots)       → SD2
--   MU11 seed: a duplicate in the order accepted                → SD3
--   MU12 enter: no re-check flag after seeding                  → CH1
--   MU13 ack: the flag is not cleared                           → AK1
--   MU14 Stage-2-only rebuild drops the seeds                   → RB2
--   MU15 enter: Stage 1 not frozen once Stage 2 has a result    → ST1
--   MU16 clear: Stage 1 not frozen once Stage 2 has a result    → ST1
--   MU17 delete: Stage 2 alone deleted                          → DL1
--   MU18 EXECUTE left on PUBLIC (seed_playoff_stage)            → P1
--   MU19 enter: a second change overwrites the first "was"      → CH2
--   MU20 ack: the recorded changes are not emptied              → AK1
--   MU21 seed: the recorded changes are not emptied             → SD4
--   MU22 clear: the cleared game keeps its old score as "now"   → CH1
--   MU23 Stage-2-only rebuild drops the recorded changes        → RB2
--
-- RUN LOG: see the bottom of this file after the run.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '120s', true);

-- Every bracket and playoff game BEFORE the migration (SC1 / OT1).
create temp table h113_pre on commit drop as
select 'p'::text as kind, p.id, to_jsonb(p) as j from public.playoffs p
union all
select 'g', g.id, to_jsonb(g) from public.playoff_games g;

-- @@MIGRATION_0113@@

create temp table h113_fx on commit drop as
select
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as org,
  'aa21d01c-66dc-4c37-b15c-7b743c557eea'::uuid as nonmember,
  '8fde72f9-cd5a-43ad-91e3-db14fb6fbcc4'::uuid as real_org,
  (now() at time zone (select timezone from public.profiles
                        where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6'))::date as today,
  (select plan from public.profiles where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as plan0,
  gen_random_uuid() as s1,
  gen_random_uuid() as dm, gen_random_uuid() as dq, gen_random_uuid() as dp,
  gen_random_uuid() as ps1, gen_random_uuid() as ps2, gen_random_uuid() as peq,
  gen_random_uuid() as vf, gen_random_uuid() as other_team,
  ''::text as token, ''::text as real_fp,
  '{}'::jsonb as set1, '[]'::jsonb as g1, '{}'::jsonb as set2, '[]'::jsonb as g2;

-- The Majors teams, A–Z (k = 1 Bears … 7 Royals).
create temp table h113_team on commit drop as
select v.k, v.name, gen_random_uuid() as id
  from (values (1, 'Bears'), (2, 'Expos'), (3, 'Giants'), (4, 'Lions'),
               (5, 'Mets'), (6, 'Pirates'), (7, 'Royals')) v(k, name);

update h113_fx set real_fp = md5(
  coalesce((select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.playoffs p
             join public.leagues l on l.id = p.league_id where l.owner_id = h113_fx.real_org), '') || '#' ||
  coalesce((select string_agg(to_jsonb(g)::text, '|' order by g.id) from public.playoff_games g
             join public.leagues l on l.id = g.league_id where l.owner_id = h113_fx.real_org), '') || '#' ||
  coalesce((select string_agg(a.id::text, '|' order by a.id) from public.activity_log a
             join public.leagues l on l.id = a.league_id
            where l.owner_id = h113_fx.real_org and a.event_type like 'playoff_%'), ''));

insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
select s1, 'ZZ113 Season', 'Baseball', 'Fall 2026', org, today - 40, today + 40 from h113_fx;

insert into public.divisions (id, league_id, name, settings)
select dm, s1, 'ZZ113 Majors', '{"game_duration": 120}'::jsonb from h113_fx union all
select dq, s1, 'ZZ113 Twin',   '{"game_duration": 120}'::jsonb from h113_fx union all
select dp, s1, 'ZZ113 Plain',  '{"game_duration": 120}'::jsonb from h113_fx;

insert into public.teams (id, league_id, division_id, name)
select t.id, fx.s1, fx.dm, 'ZZ113 ' || t.name from h113_team t, h113_fx fx;
insert into public.teams (id, league_id, division_id, name)
select other_team, s1, dp, 'ZZ113 Other' from h113_fx;

insert into public.venues (id, owner_id, name)
select vf, org, 'ZZ113 Field' from h113_fx;

-- The pair and the plain twin, as the wizard inserts them (draft).
insert into public.playoffs (id, league_id, division_id, format, seeding, status)
select ps1, s1, dm, 'round_robin', '[]'::jsonb, 'draft' from h113_fx union all
select peq, s1, dq, 'round_robin', '[]'::jsonb, 'draft' from h113_fx;
insert into public.playoffs (id, league_id, division_id, format, seeding, status, stage, parent_playoff_id, advance_count)
select ps2, s1, dm, 'single_elimination', '[]'::jsonb, 'draft', 2, ps1, 6 from h113_fx;

update public.divisions d set locked = true from h113_fx fx where d.id = fx.dm;

insert into public.public_schedule_links (org_id) select org from h113_fx on conflict (org_id) do nothing;
update h113_fx set token = (select k.token from public.public_schedule_links k where k.org_id = h113_fx.org);

-- The payloads.
update h113_fx fx set
  set1 = jsonb_build_object(
    'format', 'round_robin',
    'seeding', (select jsonb_agg(jsonb_build_object('team_id', t.id, 'team_name', 'ZZ113 ' || t.name) order by t.k) from h113_team t),
    'start_date', fx.today - 29, 'end_date', fx.today - 1,
    'playing_days', '["Sa","Su"]'::jsonb, 'day_windows', '{}'::jsonb, 'venue_assignments', '[]'::jsonb,
    'cross_division_enabled', false, 'games_per_team_per_day', 2),
  g1 = (select jsonb_agg(jsonb_build_object(
          'round', 'RR' || ((p.n - 1) / 3 + 1), 'game_number', p.n,
          'home_team_id', p.home, 'away_team_id', p.away, 'venue_id', fx.vf,
          'scheduled_date', fx.today - 30 + p.n, 'start_time', '09:00') order by p.n)
          from (select row_number() over (order by a.k, b.k)::integer as n, a.id as home, b.id as away
                  from h113_team a join h113_team b on a.k < b.k) p),
  set2 = jsonb_build_object(
    'format', 'single_elimination', 'seeding', '[]'::jsonb,
    'start_date', fx.today + 5, 'end_date', fx.today + 20,
    'playing_days', '["Sa","Su"]'::jsonb, 'day_windows', '{}'::jsonb, 'venue_assignments', '[]'::jsonb,
    'cross_division_enabled', false, 'games_per_team_per_day', 1, 'advance_count', 6),
  g2 = jsonb_build_array(
    jsonb_build_object('round', 'R1', 'game_number', 2, 'seed_home', 4, 'seed_away', 5, 'venue_id', fx.vf, 'scheduled_date', fx.today + 5,  'start_time', '09:00'),
    jsonb_build_object('round', 'R1', 'game_number', 4, 'seed_home', 3, 'seed_away', 6, 'venue_id', fx.vf, 'scheduled_date', fx.today + 5,  'start_time', '11:30'),
    jsonb_build_object('round', 'SF', 'game_number', 5, 'seed_home', 1,                 'venue_id', fx.vf, 'scheduled_date', fx.today + 6,  'start_time', '10:00'),
    jsonb_build_object('round', 'SF', 'game_number', 6, 'seed_home', 2,                 'venue_id', fx.vf, 'scheduled_date', fx.today + 6,  'start_time', '12:30'),
    jsonb_build_object('round', 'F',  'game_number', 7,                                 'venue_id', fx.vf, 'scheduled_date', fx.today + 12, 'start_time', '09:00'));

-- Calls one function as a user (or anon). 'OK <json>' or 'ERR <sqlstate> <message>'.
create function pg_temp.h113_call(p_role text, p_uid uuid, p_sql text)
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
    v_out := 'OK ' || coalesce(v_j::text, 'null');
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

create function pg_temp.h113_two(p_role text, p_uid uuid, p_s1 uuid, p_set1 jsonb, p_g1 jsonb,
                                 p_s2 uuid, p_set2 jsonb, p_g2 jsonb, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h113_call(p_role, p_uid, format(
    'public.replace_two_stage_games(%L::uuid, %L::jsonb, %L::jsonb, %L::uuid, %L::jsonb, %L::jsonb, %L::boolean)',
    p_s1, p_set1, p_g1, p_s2, p_set2, p_g2, p_commit))
$fn$;

create function pg_temp.h113_seed(p_role text, p_uid uuid, p_s2 uuid, p_order uuid[], p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h113_call(p_role, p_uid, format('public.seed_playoff_stage(%L::uuid, %L::uuid[], %L::boolean)', p_s2, p_order, p_commit))
$fn$;

create function pg_temp.h113_ack(p_role text, p_uid uuid, p_s2 uuid)
returns text language sql as $fn$
  select pg_temp.h113_call(p_role, p_uid, format('public.acknowledge_stage_seeds(%L::uuid)', p_s2))
$fn$;

create function pg_temp.h113_rep(p_uid uuid, p_po uuid, p_set jsonb, p_g jsonb, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h113_call('authenticated', p_uid, format('public.replace_playoff_games(%L::uuid, %L::jsonb, %L::jsonb, %L::boolean)', p_po, p_set, p_g, p_commit))
$fn$;

create function pg_temp.h113_del(p_uid uuid, p_po uuid, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h113_call('authenticated', p_uid, format('public.delete_playoff_bracket(%L::uuid, %L::boolean)', p_po, p_commit))
$fn$;

create function pg_temp.h113_enter(p_uid uuid, p_game uuid, p_h integer, p_a integer)
returns text language sql as $fn$
  select pg_temp.h113_call('authenticated', p_uid, format('public.enter_playoff_result(%L::uuid, %L::integer, %L::integer)', p_game, p_h, p_a))
$fn$;

create function pg_temp.h113_clear(p_uid uuid, p_game uuid, p_commit boolean)
returns text language sql as $fn$
  select pg_temp.h113_call('authenticated', p_uid, format('public.clear_playoff_result(%L::uuid, %L::boolean)', p_game, p_commit))
$fn$;

create function pg_temp.h113_read(p_token text)
returns text language sql as $fn$
  select pg_temp.h113_call('anon', null, format('public.get_league_schedule_by_token(%L::text)', p_token))
$fn$;

create function pg_temp.h113_j(p_txt text)
returns jsonb language sql immutable as $fn$
  select case when p_txt like 'OK %' then substr(p_txt, 4)::jsonb end
$fn$;

create function pg_temp.h113_g(p_playoff uuid, p_number integer)
returns uuid language sql as $fn$
  select id from public.playoff_games where playoff_id = p_playoff and game_number = p_number
$fn$;

create function pg_temp.h113_t(p_name text)
returns uuid language sql as $fn$
  select id from h113_team where name = p_name
$fn$;

-- The order, by name.
create function pg_temp.h113_order(p_names text[])
returns uuid[] language sql as $fn$
  select array_agg(pg_temp.h113_t(n) order by o) from unnest(p_names) with ordinality u(n, o)
$fn$;

create function pg_temp.h113_snap(p_ids uuid[])
returns text language sql as $fn$
  select md5(
    coalesce((select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.playoffs p where p.id = any(p_ids)), '') || '#' ||
    coalesce((select string_agg(to_jsonb(g)::text, '|' order by g.id) from public.playoff_games g where g.playoff_id = any(p_ids)), ''))
$fn$;

-- A Stage 2 bracket's slots by name: "2:Mets-Pirates 4:Lions-Royals …".
create function pg_temp.h113_slots(p_playoff uuid)
returns text language sql as $fn$
  select string_agg(format('%s:%s-%s', g.game_number,
                           coalesce(replace(ht.name, 'ZZ113 ', ''), '_'), coalesce(replace(awt.name, 'ZZ113 ', ''), '_')),
                    ' ' order by g.game_number)
    from public.playoff_games g
    left join public.teams ht on ht.id = g.home_team_id
    left join public.teams awt on awt.id = g.away_team_id
   where g.playoff_id = p_playoff
$fn$;

-- Where and when each game is (seeding must never move it).
create function pg_temp.h113_where(p_playoff uuid)
returns text language sql as $fn$
  select string_agg(concat_ws(',', g.id, g.game_number, g.round, g.venue_id, g.scheduled_date, g.start_time), ' | ' order by g.game_number)
    from public.playoff_games g where g.playoff_id = p_playoff
$fn$;

-- A bracket's settings and games without ids or timestamps (EQ1).
create function pg_temp.h113_shape(p_playoff uuid)
returns text language sql as $fn$
  select concat_ws(' # ',
    (select concat_ws(',', p.format, p.seeding::text, p.start_date, p.end_date, p.playing_days::text,
                      p.day_windows::text, p.venue_assignments::text, p.cross_division_enabled,
                      p.cross_division_opponent_id, p.games_per_team_per_day, p.status)
       from public.playoffs p where p.id = p_playoff),
    (select string_agg(concat_ws(',', g.round, g.game_number, g.home_team_id, g.away_team_id, g.seed_home, g.seed_away,
                                 g.venue_id, g.scheduled_date, g.start_time, g.status, g.home_score, g.away_score, g.winner_id),
                       ' | ' order by g.game_number)
       from public.playoff_games g where g.playoff_id = p_playoff))
$fn$;

-- A recorded change, as text: "game:home>away was_home/was_away>now_home/now_away".
create function pg_temp.h113_change(p_stage2 uuid, p_game integer)
returns text language sql as $fn$
  select format('%s:%s>%s %s/%s>%s/%s', e ->> 'game_number',
                (select name from public.teams where id = (e ->> 'home_team_id')::uuid),
                (select name from public.teams where id = (e ->> 'away_team_id')::uuid),
                coalesce(e ->> 'was_home', '_'), coalesce(e ->> 'was_away', '_'),
                coalesce(e ->> 'now_home', '_'), coalesce(e ->> 'now_away', '_'))
    from public.playoffs p, jsonb_array_elements(p.stage1_changes) e
   where p.id = p_stage2 and (e ->> 'game_number')::integer = p_game
$fn$;

create function pg_temp.h113_logs(p_event text)
returns integer language sql as $fn$
  select count(*)::integer from public.activity_log a
   where a.event_type = p_event and a.league_id = (select s1 from h113_fx)
$fn$;

-- Existing brackets and games still byte-identical on their original columns.
create function pg_temp.h113_untouched()
returns integer language sql as $fn$
  select (select count(*)::integer from h113_pre pr
           where pr.kind = 'p' and not exists (
             select 1 from public.playoffs p
              where p.id = pr.id
                and (to_jsonb(p) - array['stage', 'parent_playoff_id', 'advance_count', 'games_per_team_per_day',
                                         'seeded_at', 'seeded_by', 'stage1_changed_at', 'stage1_changes']) = pr.j
                and p.stage = 1 and p.parent_playoff_id is null and p.advance_count is null
                and p.games_per_team_per_day = 1 and p.seeded_at is null and p.stage1_changed_at is null
                and p.stage1_changes = '[]'::jsonb))
       + (select count(*)::integer from h113_pre pr
           where pr.kind = 'g' and not exists (
             select 1 from public.playoff_games g
              where g.id = pr.id
                and (to_jsonb(g) - array['seed_home', 'seed_away', 'pool']) = pr.j
                and g.seed_home is null and g.seed_away is null and g.pool is null))
$fn$;

-- The assertions. Returns {fails, notes}. Never throws: a crash is recorded
-- as a failure after the ones already collected, so they always print.
create function pg_temp.h113_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx        h113_fx%rowtype;
  v_fails   text[] := array[]::text[];
  v_notes   text[] := array[]::text[];
  v_entry   constant text[] := array[
    'public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)',
    'public.seed_playoff_stage(uuid, uuid[], boolean)',
    'public.acknowledge_stage_seeds(uuid)',
    'public.replace_playoff_games(uuid, jsonb, jsonb, boolean)',
    'public.delete_playoff_bracket(uuid, boolean)',
    'public.enter_playoff_result(uuid, integer, integer)',
    'public.clear_playoff_result(uuid, boolean)'];
  v_helpers constant text[] := array[
    'public.playoff_write_stage(public.playoffs, uuid, jsonb, jsonb, integer, boolean)',
    'public.playoff_apply_seeds(uuid, uuid[])'];
  v_fn      text;
  v_txt     text;
  v_j       jsonb;
  v_snap    text;
  v_snap1   text;
  v_where   text;
  v_all     uuid[];
  v_pair    uuid[];
  v_n       integer;
  v_order   uuid[];
  v_bad     jsonb;
  v_g       jsonb;
  v_tmp     jsonb;
  v_g21     text;
begin
  select * into fx from h113_fx;
  v_all := array[fx.ps1, fx.ps2, fx.peq];
  v_pair := array[fx.ps1, fx.ps2];
  v_order := pg_temp.h113_order(array['Expos', 'Bears', 'Lions', 'Mets', 'Pirates', 'Royals', 'Giants']);
  begin
    -- ── P1 ──────────────────────────────────────────────────────────────────
    foreach v_fn in array v_entry loop
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
    foreach v_fn in array v_entry[1:3] loop
      if not coalesce((select 'search_path=public, pg_temp' = any(proconfig) from pg_proc where oid = v_fn::regprocedure), false) then
        v_fails := array_append(v_fails, 'P1: search_path not pinned on ' || v_fn);
      end if;
    end loop;
    foreach v_fn in array v_helpers loop
      if has_function_privilege('authenticated', v_fn, 'execute')
         or has_function_privilege('anon', v_fn, 'execute')
         or has_function_privilege('service_role', v_fn, 'execute')
         or has_function_privilege('dashboard_readonly', v_fn, 'execute')
         or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = v_fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
         or (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
        v_fails := array_append(v_fails, 'P1: helper callable by a role, or SECURITY DEFINER: ' || v_fn);
      end if;
    end loop;

    -- ── SC1 ─────────────────────────────────────────────────────────────────
    v_n := pg_temp.h113_untouched();
    if v_n <> 0 then
      v_fails := array_append(v_fails, format('SC1: %s existing bracket/game rows changed or lack the defaults', v_n));
    end if;
    if (select count(*) from h113_pre where kind = 'p') = 0 then
      v_fails := array_append(v_fails, 'SC1: no existing brackets to compare (vacuous)');
    end if;
    begin
      insert into public.playoffs (league_id, division_id, format, seeding, status)
      values (fx.s1, fx.dm, 'single_elimination', '[]'::jsonb, 'draft');
      v_fails := array_append(v_fails, 'SC1: a second Stage 1 bracket in one division was accepted');
    exception when unique_violation then
      null;
    end;
    begin
      insert into public.playoffs (league_id, division_id, format, seeding, status, stage, advance_count)
      values (fx.s1, fx.dp, 'single_elimination', '[]'::jsonb, 'draft', 2, 4);
      v_fails := array_append(v_fails, 'SC1: a Stage 2 without a parent was accepted');
    exception when check_violation then
      null;
    end;

    -- ── AN1 ─────────────────────────────────────────────────────────────────
    v_snap := pg_temp.h113_snap(v_all);
    v_txt := pg_temp.h113_two('anon', null, fx.ps1, fx.set1, fx.g1, fx.ps2, fx.set2, fx.g2, true);
    if v_txt not like 'ERR 42501%' then
      v_fails := array_append(v_fails, 'AN1: anon build not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_seed('anon', null, fx.ps2, v_order, true);
    if v_txt not like 'ERR 42501%' then
      v_fails := array_append(v_fails, 'AN1: anon seed not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_two('authenticated', fx.nonmember, fx.ps1, fx.set1, fx.g1, fx.ps2, fx.set2, fx.g2, true);
    if v_txt not like 'ERR 42501%not_authorized%' then
      v_fails := array_append(v_fails, 'AN1: non-member build not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_seed('authenticated', fx.nonmember, fx.ps2, v_order, true);
    if v_txt not like 'ERR 42501%not_authorized%' then
      v_fails := array_append(v_fails, 'AN1: non-member seed not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_ack('authenticated', fx.nonmember, fx.ps2);
    if v_txt not like 'ERR 42501%not_authorized%' then
      v_fails := array_append(v_fails, 'AN1: non-member acknowledge not refused: ' || v_txt);
    end if;
    if pg_temp.h113_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'AN1: a refused call wrote something');
    end if;

    -- ── PL1 ─────────────────────────────────────────────────────────────────
    update public.profiles set plan = 'pro' where id = fx.org;
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.ps2, fx.set2, fx.g2, true);
    if v_txt not like 'ERR P0001%plan_required%' then
      v_fails := array_append(v_fails, 'PL1: Pro build not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order, true);
    if v_txt not like 'ERR P0001%plan_required%' then
      v_fails := array_append(v_fails, 'PL1: Pro seed not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_ack('authenticated', fx.org, fx.ps2);
    if v_txt not like 'ERR P0001%plan_required%' then
      v_fails := array_append(v_fails, 'PL1: Pro acknowledge not refused: ' || v_txt);
    end if;
    update public.profiles set plan = 'elite' where id = fx.org;
    if pg_temp.h113_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'PL1: a refused call wrote something');
    end if;

    -- ── PR1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.peq, fx.set2, fx.g2, true);
    if v_txt not like 'ERR P0001%not_a_pair%' then
      v_fails := array_append(v_fails, 'PR1: a non-pair not refused: ' || v_txt);
    end if;
    v_bad := jsonb_set(fx.g2, '{0,home_team_id}', to_jsonb(pg_temp.h113_t('Mets')));
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.ps2, fx.set2, v_bad, true);
    if v_txt not like 'ERR P0001%invalid_games%' then
      v_fails := array_append(v_fails, 'PR1: a team in a Stage 2 game not refused: ' || v_txt);
    end if;
    v_bad := fx.g2 #- '{1,seed_away}';
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.ps2, fx.set2, v_bad, true);
    if v_txt not like 'ERR P0001%invalid_games%' then
      v_fails := array_append(v_fails, 'PR1: a missing seed not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.ps2,
                              jsonb_set(fx.set2, '{advance_count}', '8'), fx.g2, true);
    if v_txt not like 'ERR P0001%invalid_settings%' then
      v_fails := array_append(v_fails, 'PR1: 8 advancing of 7 not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.ps2,
                              jsonb_set(fx.set2, '{start_date}', to_jsonb(fx.today - 1)), fx.g2, true);
    if v_txt not like 'ERR P0001%stage_order%' then
      v_fails := array_append(v_fails, 'PR1: Stage 2 starting on Stage 1''s last day not refused: ' || v_txt);
    end if;
    v_bad := jsonb_set(fx.g1, '{0,seed_home}', '1');
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, v_bad, fx.ps2, fx.set2, fx.g2, true);
    if v_txt not like 'ERR P0001%invalid_games%' then
      v_fails := array_append(v_fails, 'PR1: a seed in a Stage 1 game not refused: ' || v_txt);
    end if;
    if pg_temp.h113_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'PR1: a refused build wrote something');
    end if;

    -- ── GU1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h113_rep(fx.org, fx.ps1, fx.set1, fx.g1, true);
    if v_txt not like 'ERR P0001%two_stage_pair%' then
      v_fails := array_append(v_fails, 'GU1: replace_playoff_games on Stage 1 not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_rep(fx.org, fx.ps2, fx.set2, fx.g2, true);
    if v_txt not like 'ERR P0001%two_stage_pair%' then
      v_fails := array_append(v_fails, 'GU1: replace_playoff_games on Stage 2 not refused: ' || v_txt);
    end if;
    if pg_temp.h113_snap(v_all) <> v_snap then
      v_fails := array_append(v_fails, 'GU1: a refused replace wrote something');
    end if;
    v_txt := pg_temp.h113_rep(fx.org, fx.peq, jsonb_set(fx.set1, '{games_per_team_per_day}', '3'), fx.g1, true);
    if v_txt not like 'ERR P0001%invalid_settings%' then
      v_fails := array_append(v_fails, 'GU1: a per-day limit of 3 not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_rep(fx.org, fx.peq, fx.set1, fx.g1, true);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'true'
       or (select games_per_team_per_day from public.playoffs where id = fx.peq) <> 2 then
      v_fails := array_append(v_fails, 'GU1: a plain round robin did not build with 2 a day: ' || v_txt);
    end if;

    -- ── BL1 ─────────────────────────────────────────────────────────────────
    v_snap1 := pg_temp.h113_snap(v_pair);
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.ps2, fx.set2, fx.g2, false);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'false'
       or (pg_temp.h113_j(v_txt) ->> 'new_stage2_games')::integer is distinct from 5
       or pg_temp.h113_snap(v_pair) <> v_snap1 then
      v_fails := array_append(v_fails, 'BL1: the preview wrote something or misreported: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.ps2, fx.set2, fx.g2, true);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'true' then
      v_fails := array_append(v_fails, 'BL1: the build did not commit: ' || v_txt);
    end if;
    if (select count(*) from public.playoff_games where playoff_id = fx.ps1
          and home_team_id is not null and away_team_id is not null and seed_home is null and seed_away is null) <> 21
       or (select status from public.playoffs where id = fx.ps1) <> 'active' then
      v_fails := array_append(v_fails, 'BL1: Stage 1 is not 21 games with teams and no seeds, active');
    end if;
    if (select string_agg(format('%s:%s/%s', game_number, coalesce(seed_home::text, '_'), coalesce(seed_away::text, '_')), ' ' order by game_number)
          from public.playoff_games where playoff_id = fx.ps2) is distinct from '2:4/5 4:3/6 5:1/_ 6:2/_ 7:_/_'
       or exists (select 1 from public.playoff_games where playoff_id = fx.ps2 and (home_team_id is not null or away_team_id is not null))
       or (select status from public.playoffs where id = fx.ps2) <> 'active'
       or (select advance_count from public.playoffs where id = fx.ps2) <> 6
       or (select seeding::text from public.playoffs where id = fx.ps2) <> '[]'
       or (select seeded_at from public.playoffs where id = fx.ps2) is not null then
      v_fails := array_append(v_fails, 'BL1: Stage 2 is not the seeded-number layout with no teams: ' ||
        coalesce((select string_agg(format('%s:%s/%s', game_number, seed_home, seed_away), ' ' order by game_number)
                    from public.playoff_games where playoff_id = fx.ps2), 'none'));
    end if;
    if pg_temp.h113_logs('playoff_two_stage_generated') <> 1 then
      v_fails := array_append(v_fails, 'BL1: not exactly one generated log row');
    end if;

    -- ── EQ1 ─────────────────────────────────────────────────────────────────
    if pg_temp.h113_shape(fx.ps1) is distinct from pg_temp.h113_shape(fx.peq) then
      v_fails := array_append(v_fails, 'EQ1: the two writers disagree: ' ||
        left(pg_temp.h113_shape(fx.ps1), 220) || ' VS ' || left(pg_temp.h113_shape(fx.peq), 220));
    end if;

    -- ── PUB1 ────────────────────────────────────────────────────────────────
    v_j := pg_temp.h113_j(pg_temp.h113_read(fx.token));
    select pg into v_g
      from jsonb_array_elements(coalesce(v_j -> 'seasons', '[]'::jsonb)) s,
           jsonb_array_elements(s -> 'playoff_games') pg
     where (s ->> 'id')::uuid = fx.s1 and (pg ->> 'playoff_id')::uuid = fx.ps2 and (pg ->> 'game_number')::integer = 2;
    select pg into v_tmp
      from jsonb_array_elements(coalesce(v_j -> 'seasons', '[]'::jsonb)) s,
           jsonb_array_elements(s -> 'playoff_games') pg
     where (s ->> 'id')::uuid = fx.s1 and (pg ->> 'playoff_id')::uuid = fx.ps1 and (pg ->> 'game_number')::integer = 1;
    if v_g is null
       or v_g ->> 'stage' is distinct from '2' or v_g ->> 'seed_home' is distinct from '4'
       or v_g ->> 'seed_away' is distinct from '5' or v_g -> 'home_team' <> 'null'::jsonb
       or v_tmp is null or v_tmp ->> 'stage' is distinct from '1' or v_tmp -> 'seed_home' <> 'null'::jsonb then
      v_fails := array_append(v_fails, 'PUB1: the reader does not emit stage and seeds: ' ||
        coalesce(v_g::text, 'no game 2') || ' / ' || coalesce(v_tmp::text, 'no RR game 1'));
    end if;

    -- ── SD1 ─────────────────────────────────────────────────────────────────
    -- Results for RR games 1–18; game 19 is today with none.
    update public.playoff_games
       set status = 'completed', home_score = 5, away_score = 3, winner_id = home_team_id
     where playoff_id = fx.ps1 and game_number <= 18;
    update public.playoff_games set scheduled_date = fx.today where playoff_id = fx.ps1 and game_number = 19;
    v_snap1 := pg_temp.h113_snap(v_pair);
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order, true);
    if pg_temp.h113_j(v_txt) ->> 'reason' is distinct from 'stage1_in_progress'
       or pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'false'
       or pg_temp.h113_snap(v_pair) <> v_snap1 then
      v_fails := array_append(v_fails, 'SD1: seeding not refused while a game is still to come: ' || v_txt);
    end if;

    -- ── SD2 ─────────────────────────────────────────────────────────────────
    -- 19 rained out, 20 undated, 21 past with no result → "Seed anyway".
    update public.playoff_games set status = 'cancelled' where playoff_id = fx.ps1 and game_number = 19;
    update public.playoff_games set scheduled_date = null where playoff_id = fx.ps1 and game_number = 20;
    v_snap1 := pg_temp.h113_snap(v_pair);
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order, false);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'false'
       or (select string_agg(format('%s:%s', n ->> 'game_number', n ->> 'reason'), ' ' order by (n ->> 'game_number')::integer)
             from jsonb_array_elements(pg_temp.h113_j(v_txt) -> 'never_played') n)
          is distinct from '19:rained_out 20:no_date 21:past'
       or pg_temp.h113_snap(v_pair) <> v_snap1 then
      v_fails := array_append(v_fails, 'SD2: the preview does not list the never-played games, or wrote: ' || v_txt);
    end if;
    v_where := pg_temp.h113_where(fx.ps2);
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order, true);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'true' then
      v_fails := array_append(v_fails, 'SD2: Seed anyway did not commit: ' || v_txt);
    end if;
    if pg_temp.h113_slots(fx.ps2) is distinct from '2:Mets-Pirates 4:Lions-Royals 5:Expos-_ 6:Bears-_ 7:_-_' then
      v_fails := array_append(v_fails, 'SD2: the slots are not the mockup''s: ' || coalesce(pg_temp.h113_slots(fx.ps2), 'none'));
    end if;
    if pg_temp.h113_where(fx.ps2) is distinct from v_where then
      v_fails := array_append(v_fails, 'SD2: seeding moved a game (id, number, round, field, date or time changed)');
    end if;
    if (select jsonb_array_length(seeding) from public.playoffs where id = fx.ps2) <> 7
       or (select seeding -> 0 ->> 'team_id' from public.playoffs where id = fx.ps2) <> pg_temp.h113_t('Expos')::text
       or (select seeded_at from public.playoffs where id = fx.ps2) is null
       or pg_temp.h113_logs('playoff_stage_seeded') <> 1
       or not exists (select 1 from public.activity_log where event_type = 'playoff_stage_seeded'
                         and league_id = fx.s1 and message like '%never played: RR Game 19 (rained out), RR Game 20 (no date), RR Game 21 (no result)%') then
      v_fails := array_append(v_fails, 'SD2: the order, seeded_at or the log row is wrong');
    end if;

    -- ── SD3 ─────────────────────────────────────────────────────────────────
    v_snap1 := pg_temp.h113_snap(v_pair);
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order[1:6] || v_order[1], true);
    if v_txt not like 'ERR P0001%invalid_order%' then
      v_fails := array_append(v_fails, 'SD3: a duplicate not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order[1:6], true);
    if v_txt not like 'ERR P0001%invalid_order%' then
      v_fails := array_append(v_fails, 'SD3: a missing team not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order[1:6] || fx.other_team, true);
    if v_txt not like 'ERR P0001%invalid_order%' then
      v_fails := array_append(v_fails, 'SD3: a team from outside Stage 1 not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order || fx.other_team, true);
    if v_txt not like 'ERR P0001%invalid_order%' then
      v_fails := array_append(v_fails, 'SD3: an extra team not refused: ' || v_txt);
    end if;
    if pg_temp.h113_snap(v_pair) <> v_snap1 then
      v_fails := array_append(v_fails, 'SD3: a refused order wrote something');
    end if;

    -- ── SD4 ─────────────────────────────────────────────────────────────────
    update public.playoffs set stage1_changed_at = now(), stage1_changes = '[{"game_number": 99}]'::jsonb where id = fx.ps2;
    v_order := pg_temp.h113_order(array['Expos', 'Bears', 'Mets', 'Lions', 'Pirates', 'Royals', 'Giants']);
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order, true);
    if (select stage1_changes from public.playoffs where id = fx.ps2) <> '[]'::jsonb
       or (select stage1_changed_at from public.playoffs where id = fx.ps2) is not null then
      v_fails := array_append(v_fails, 'SD4: re-seeding did not empty the recorded changes and the flag');
    end if;
    if pg_temp.h113_j(v_txt) ->> 'reseed' is distinct from 'true'
       or pg_temp.h113_slots(fx.ps2) is distinct from '2:Lions-Pirates 4:Mets-Royals 5:Expos-_ 6:Bears-_ 7:_-_'
       or pg_temp.h113_logs('playoff_stage_seeded') <> 2 then
      v_fails := array_append(v_fails, 'SD4: re-seeding did not rewrite the slots: ' || coalesce(pg_temp.h113_slots(fx.ps2), 'none') || ' / ' || v_txt);
    end if;

    -- ── CH1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h113_enter(fx.org, pg_temp.h113_g(fx.ps1, 21), 4, 4);
    if v_txt not like 'ERR P0001%tied_score%' then
      v_fails := array_append(v_fails, 'CH1: a tie not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_enter(fx.org, pg_temp.h113_g(fx.ps1, 21), 6, 2);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'true'
       or pg_temp.h113_j(v_txt) ->> 'stage2_recheck' is distinct from 'true'
       or (select stage1_changed_at from public.playoffs where id = fx.ps2) is null
       or pg_temp.h113_logs('playoff_stage1_changed_after_seeding') <> 1 then
      v_fails := array_append(v_fails, 'CH1: a result entered after seeding did not flag Stage 2: ' || v_txt);
    end if;
    v_g21 := pg_temp.h113_change(fx.ps2, 21);
    if v_g21 is distinct from format('21:%s>%s _/_>6/2',
         (select name from public.teams t join public.playoff_games g on g.home_team_id = t.id where g.id = pg_temp.h113_g(fx.ps1, 21)),
         (select name from public.teams t join public.playoff_games g on g.away_team_id = t.id where g.id = pg_temp.h113_g(fx.ps1, 21)))
       or (select jsonb_array_length(stage1_changes) from public.playoffs where id = fx.ps2) <> 1 then
      v_fails := array_append(v_fails, 'CH1: the entered result was not recorded as no result → 6-2: ' || coalesce(v_g21, 'none'));
    end if;
    update public.playoffs set stage1_changed_at = null where id = fx.ps2;
    v_txt := pg_temp.h113_clear(fx.org, pg_temp.h113_g(fx.ps1, 21), true);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'true'
       or (select stage1_changed_at from public.playoffs where id = fx.ps2) is null
       or pg_temp.h113_logs('playoff_stage1_changed_after_seeding') <> 2 then
      v_fails := array_append(v_fails, 'CH1: a result cleared after seeding did not flag Stage 2: ' || v_txt);
    end if;
    if right(coalesce(pg_temp.h113_change(fx.ps2, 21), ''), 8) <> ' _/_>_/_'  -- literal compare: in LIKE, _ is a wildcard
       or (select jsonb_array_length(stage1_changes) from public.playoffs where id = fx.ps2) <> 1 then
      v_fails := array_append(v_fails, 'CH1: the cleared result was not recorded with no "now": ' || coalesce(pg_temp.h113_change(fx.ps2, 21), 'none'));
    end if;

    -- ── CH2 ─────────────────────────────────────────────────────────────────
    -- Game 1 was entered 5-3 by the fixture. Changed twice: one entry, the
    -- first "was" (5/3), the latest "now" (1/4); game 21's entry stays.
    v_txt := pg_temp.h113_enter(fx.org, pg_temp.h113_g(fx.ps1, 1), 2, 6);
    v_txt := v_txt || ' ; ' || pg_temp.h113_enter(fx.org, pg_temp.h113_g(fx.ps1, 1), 1, 4);
    if pg_temp.h113_change(fx.ps2, 1) not like '1:% 5/3>1/4'
       or (select jsonb_array_length(stage1_changes) from public.playoffs where id = fx.ps2) <> 2
       or pg_temp.h113_change(fx.ps2, 21) is null then
      v_fails := array_append(v_fails, 'CH2: a twice-changed game is not one entry 5/3>1/4 beside game 21: ' ||
        coalesce(pg_temp.h113_change(fx.ps2, 1), 'none') || ' / ' || v_txt);
    end if;

    -- ── AK1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h113_ack('authenticated', fx.org, fx.ps2);
    if pg_temp.h113_j(v_txt) ->> 'cleared' is distinct from 'true'
       or (select stage1_changed_at from public.playoffs where id = fx.ps2) is not null
       or pg_temp.h113_logs('playoff_stage_seeds_kept') <> 1 then
      v_fails := array_append(v_fails, 'AK1: Seeds are still right did not clear the flag: ' || v_txt);
    end if;
    if (select stage1_changes from public.playoffs where id = fx.ps2) <> '[]'::jsonb then
      v_fails := array_append(v_fails, 'AK1: Seeds are still right left the recorded changes');
    end if;
    v_txt := pg_temp.h113_ack('authenticated', fx.org, fx.ps2);
    if pg_temp.h113_j(v_txt) ->> 'cleared' is distinct from 'false' or pg_temp.h113_logs('playoff_stage_seeds_kept') <> 1 then
      v_fails := array_append(v_fails, 'AK1: a second acknowledge did something: ' || v_txt);
    end if;

    -- ── RB2 ─────────────────────────────────────────────────────────────────
    v_snap1 := pg_temp.h113_snap(v_pair);
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, fx.set1, fx.g1, fx.ps2, fx.set2, fx.g2, true);
    if pg_temp.h113_j(v_txt) -> 'reasons' ->> 0 is distinct from 'results_entered' or pg_temp.h113_snap(v_pair) <> v_snap1 then
      v_fails := array_append(v_fails, 'RB2: a full rebuild with Stage 1 results not refused: ' || v_txt);
    end if;
    update public.playoffs set stage1_changed_at = now(), stage1_changes = '[{"game_number": 98}]'::jsonb where id = fx.ps2;
    v_snap1 := pg_temp.h113_snap(array[fx.ps1]);
    v_bad := (select jsonb_agg(jsonb_set(e, '{scheduled_date}', to_jsonb(((e ->> 'scheduled_date')::date + 1)))) from jsonb_array_elements(fx.g2) e);
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, null, null, fx.ps2,
                              jsonb_set(jsonb_set(fx.set2, '{start_date}', to_jsonb(fx.today + 6)), '{end_date}', to_jsonb(fx.today + 21)), v_bad, true);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'true'
       or pg_temp.h113_j(v_txt) ->> 'keeps_seeds' is distinct from 'true'
       or pg_temp.h113_slots(fx.ps2) is distinct from '2:Lions-Pirates 4:Mets-Royals 5:Expos-_ 6:Bears-_ 7:_-_'
       or (select scheduled_date from public.playoff_games where playoff_id = fx.ps2 and game_number = 2) <> fx.today + 6
       or (select seeded_at from public.playoffs where id = fx.ps2) is null
       or (select stage1_changes from public.playoffs where id = fx.ps2) <> '[{"game_number": 98}]'::jsonb
       or pg_temp.h113_snap(array[fx.ps1]) <> v_snap1
       or pg_temp.h113_logs('playoff_stage2_rebuilt') <> 1 then
      v_fails := array_append(v_fails, 'RB2: a Stage-2-only rebuild did not keep the seeds or touched Stage 1: ' ||
        coalesce(pg_temp.h113_slots(fx.ps2), 'none') || ' / ' || v_txt);
    end if;

    -- ── ST1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h113_enter(fx.org, pg_temp.h113_g(fx.ps2, 2), 4, 2);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'true' then
      v_fails := array_append(v_fails, 'ST1: a Stage 2 result did not enter: ' || v_txt);
    end if;
    v_snap1 := pg_temp.h113_snap(v_pair);
    v_txt := pg_temp.h113_enter(fx.org, pg_temp.h113_g(fx.ps1, 1), 1, 7);
    if pg_temp.h113_j(v_txt) ->> 'reason' is distinct from 'next_stage_started'
       or pg_temp.h113_j(v_txt) ->> 'stage2_game_number' is distinct from '2' then
      v_fails := array_append(v_fails, 'ST1: a Stage 1 edit not refused once Stage 2 started: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_clear(fx.org, pg_temp.h113_g(fx.ps1, 1), false);
    if pg_temp.h113_j(v_txt) ->> 'reason' is distinct from 'next_stage_started' then
      v_fails := array_append(v_fails, 'ST1: a Stage 1 clear preview not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_clear(fx.org, pg_temp.h113_g(fx.ps1, 1), true);
    if pg_temp.h113_j(v_txt) ->> 'reason' is distinct from 'next_stage_started' then
      v_fails := array_append(v_fails, 'ST1: a Stage 1 clear not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_seed('authenticated', fx.org, fx.ps2, v_order, true);
    if pg_temp.h113_j(v_txt) ->> 'reason' is distinct from 'bracket_started' then
      v_fails := array_append(v_fails, 'ST1: re-seeding not refused once Stage 2 started: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_two('authenticated', fx.org, fx.ps1, null, null, fx.ps2, fx.set2, fx.g2, true);
    if pg_temp.h113_j(v_txt) -> 'reasons' ->> 0 is distinct from 'stage2_started' then
      v_fails := array_append(v_fails, 'ST1: a rebuild not refused once Stage 2 started: ' || v_txt);
    end if;
    if pg_temp.h113_snap(v_pair) <> v_snap1 then
      v_fails := array_append(v_fails, 'ST1: a refused call wrote something');
    end if;

    -- ── DL1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h113_del(fx.org, fx.ps2, false);
    if pg_temp.h113_j(v_txt) ->> 'two_stage' is distinct from 'true'
       or (pg_temp.h113_j(v_txt) ->> 'games')::integer is distinct from 26
       or not exists (select 1 from public.playoffs where id = fx.ps2) then
      v_fails := array_append(v_fails, 'DL1: the preview does not count both stages: ' || v_txt);
    end if;
    v_txt := pg_temp.h113_del(fx.org, fx.ps2, true);
    if pg_temp.h113_j(v_txt) ->> 'committed' is distinct from 'true'
       or exists (select 1 from public.playoffs where id in (fx.ps1, fx.ps2))
       or exists (select 1 from public.playoff_games where playoff_id in (fx.ps1, fx.ps2))
       or pg_temp.h113_logs('playoff_bracket_deleted') <> 1 then
      v_fails := array_append(v_fails, 'DL1: deleting Stage 2 did not delete both stages: ' || v_txt);
    end if;

    -- ── OT1 ─────────────────────────────────────────────────────────────────
    v_n := pg_temp.h113_untouched();
    if v_n <> 0 then
      v_fails := array_append(v_fails, format('OT1: %s existing bracket/game rows changed', v_n));
    end if;

    -- ── LG1 ─────────────────────────────────────────────────────────────────
    if pg_temp.h113_logs('playoff_two_stage_generated') <> 1
       or pg_temp.h113_logs('playoff_two_stage_rebuilt') <> 0
       or pg_temp.h113_logs('playoff_stage2_rebuilt') <> 1
       or pg_temp.h113_logs('playoff_stage_seeded') <> 2
       or pg_temp.h113_logs('playoff_stage1_changed_after_seeding') <> 4
       or pg_temp.h113_logs('playoff_stage_seeds_kept') <> 1
       or pg_temp.h113_logs('playoff_result_entered') <> 4
       or pg_temp.h113_logs('playoff_result_cleared') <> 1
       or pg_temp.h113_logs('playoff_bracket_generated') <> 1
       or pg_temp.h113_logs('playoff_bracket_deleted') <> 1 then
      v_fails := array_append(v_fails, 'LG1: log rows: ' ||
        (select string_agg(event_type || '=' || n, ' ' order by event_type)
           from (select event_type, count(*) n from public.activity_log where league_id = fx.s1 group by event_type) x));
    end if;
  exception when others then
    v_fails := array_append(v_fails, 'CRASH: ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ── RL1 (last) ────────────────────────────────────────────────────────────
  if md5(
       coalesce((select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.playoffs p
                  join public.leagues l on l.id = p.league_id where l.owner_id = fx.real_org), '') || '#' ||
       coalesce((select string_agg(to_jsonb(g)::text, '|' order by g.id) from public.playoff_games g
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

do $h113$
declare
  v_out   text := E'\n';
  v_m     jsonb;
  v_first text;
  v_tag   text;
  v_def   text;
  v_mut   text;
  v_two   constant text := 'public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)';
  v_seed  constant text := 'public.seed_playoff_stage(uuid, uuid[], boolean)';
  v_ack   constant text := 'public.acknowledge_stage_seeds(uuid)';
  v_rep   constant text := 'public.replace_playoff_games(uuid, jsonb, jsonb, boolean)';
  v_del   constant text := 'public.delete_playoff_bracket(uuid, boolean)';
  v_enter constant text := 'public.enter_playoff_result(uuid, integer, integer)';
  v_clear constant text := 'public.clear_playoff_result(uuid, boolean)';
  v_rdr   constant text := 'public.get_league_schedule_by_token(text)';
  v_write constant text := 'public.playoff_write_stage(public.playoffs, uuid, jsonb, jsonb, integer, boolean)';
  v_apply constant text := 'public.playoff_apply_seeds(uuid, uuid[])';
  m       record;
begin
  -- Baseline.
  begin
    v_m := pg_temp.h113_assert();
    raise exception 'H113_RESULT %', v_m::text;
  exception when others then
    if sqlerrm like 'H113_RESULT %' then
      v_m := substr(sqlerrm, 13)::jsonb;
      v_out := v_out || format(E'BASELINE failures (%s): %s\nNOTES: %s\n',
        jsonb_array_length(v_m -> 'fails'), v_m -> 'fails', v_m -> 'notes');
    else
      v_out := v_out || format(E'BASELINE CRASH %s %s\n', sqlstate, sqlerrm);
    end if;
  end;

  for m in
    select * from (values
      ('MU1', 'seed: membership gate removed', 'AN1', v_seed,
        $a$if not public.is_org_member(v_league.owner_id) then$a$, $a$if false then$a$),
      ('MU2', 'build: plan gate removed', 'PL1', v_two,
        $a$if v_plan is null or v_plan <> 'elite' then$a$, $a$if false then$a$),
      ('MU3', 'build: teams accepted in Stage 2 games', 'PR1', v_write,
        $a$                where nullif(e ->> 'home_team_id', '') is not null or nullif(e ->> 'away_team_id', '') is not null) then$a$,
        $a$                where false) then$a$),
      ('MU4', 'replace_playoff_games: pair guard removed', 'GU1', v_rep,
        $a$if v_po.stage = 2 or exists (select 1 from public.playoffs c where c.parent_playoff_id = v_po.id) then$a$, $a$if false then$a$),
      ('MU5', 'build: preview commits', 'BL1', v_two,
        $a$  if not p_commit then$a$, $a$  if false then$a$),
      ('MU6', 'writer: per-day limit always 1', 'EQ1', v_write,
        $a$         games_per_team_per_day = v_per_day,$a$, $a$         games_per_team_per_day = 1,$a$),
      ('MU7', 'reader: seeds not emitted', 'PUB1', v_rdr,
        $a$'seed_home',      pg.seed_home,$a$, $a$'seed_home',      null::smallint,$a$),
      ('MU8', 'seed: Stage 1 in-progress check removed', 'SD1', v_seed,
        $a$  if v_today is null or v_upcoming > 0 then$a$, $a$  if false then$a$),
      ('MU9', 'seed: an undated game blocks seeding', 'SD2', v_seed,
        $a$g.status <> 'cancelled' and g.scheduled_date is not null
                             and g.scheduled_date >= v_today$a$,
        $a$g.status <> 'cancelled' and (g.scheduled_date is null
                             or g.scheduled_date >= v_today)$a$),
      ('MU10', 'apply: seed k gets the (k+1)th team (home slots)', 'SD2', v_apply,
        $a$then p_order[g.seed_home] else$a$, $a$then p_order[g.seed_home + 1] else$a$),
      ('MU11', 'seed: a duplicate in the order accepted', 'SD3', v_seed,
        $a$     or (select count(distinct x) from unnest(p_order) x) <> cardinality(p_order)
$a$, $a$$a$),
      ('MU12', 'enter: no re-check flag after seeding', 'CH1', v_enter,
        $a$       set stage1_changed_at = now(),
           stage1_changes$a$,
        $a$       set stage1_changes$a$),
      ('MU13', 'ack: the flag is not cleared', 'AK1', v_ack,
        $a$     set stage1_changed_at = null, stage1_changes = '[]'::jsonb, updated_at = now()$a$, $a$     set updated_at = now()$a$),
      ('MU14', 'Stage-2-only rebuild drops the seeds', 'RB2', v_two,
        $a$  if v_keep_seeds then
    select array_agg$a$, $a$  if false then
    select array_agg$a$),
      ('MU15', 'enter: Stage 1 not frozen once Stage 2 has a result', 'ST1', v_enter,
        $a$    if v_started is not null then$a$, $a$    if false then$a$),
      ('MU16', 'clear: Stage 1 not frozen once Stage 2 has a result', 'ST1', v_clear,
        $a$    if v_started is not null then$a$, $a$    if false then$a$),
      ('MU17', 'delete: Stage 2 alone deleted', 'DL1', v_del,
        $a$select coalesce(p.parent_playoff_id, p.id) into v_root$a$, $a$select p.id into v_root$a$),
      ('MU18', 'EXECUTE left on PUBLIC (seed_playoff_stage)', 'P1', null,
        null, $a$grant execute on function public.seed_playoff_stage(uuid, uuid[], boolean) to public$a$),
      ('MU19', 'enter: a second change overwrites the first "was"', 'CH2', v_enter,
        $a$'was_home', case when v_prev is null then to_jsonb(v_game.home_score) else v_prev -> 'was_home' end,$a$,
        $a$'was_home', to_jsonb(v_game.home_score),$a$),
      ('MU20', 'ack: the recorded changes are not emptied', 'AK1', v_ack,
        $a$stage1_changed_at = null, stage1_changes = '[]'::jsonb, updated_at$a$, $a$stage1_changed_at = null, updated_at$a$),
      ('MU21', 'seed: the recorded changes are not emptied', 'SD4', v_seed,
        $a$         stage1_changes = '[]'::jsonb,
$a$, $a$$a$),
      ('MU22', 'clear: the cleared game keeps its old score as "now"', 'CH1', v_clear,
        $a$'now_home', null, 'now_away', null$a$,
        $a$'now_home', to_jsonb(v_game.home_score), 'now_away', to_jsonb(v_game.away_score)$a$),
      ('MU23', 'Stage-2-only rebuild drops the recorded changes', 'RB2', v_two,
        $a$stage1_changes    = case when v_keep_seeds then v_s2.stage1_changes else '[]'::jsonb end,$a$,
        $a$stage1_changes    = '[]'::jsonb,$a$)
    ) as t(id, what, target, fn, find, repl)
  loop
    begin
      if m.fn is null then
        execute m.repl;
      else
        v_def := pg_get_functiondef(m.fn::regprocedure);
        if position(m.find in v_def) = 0 then
          raise exception 'MUTANT_NOOP';
        end if;
        v_mut := replace(v_def, m.find, m.repl);
        execute v_mut;
      end if;
      v_m := pg_temp.h113_assert();
      raise exception 'H113_RESULT %', v_m::text;
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm like 'H113_RESULT %' then
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

  v_out := v_out || (
    select string_agg(format('prosrc md5 %s: %s', p.proname, md5(p.prosrc)), E'\n' order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('replace_playoff_games', 'delete_playoff_bracket', 'enter_playoff_result',
                         'clear_playoff_result', 'get_league_schedule_by_token', 'playoff_write_stage',
                         'playoff_apply_seeds', 'replace_two_stage_games', 'seed_playoff_stage',
                         'acknowledge_stage_seeds')) || E'\n';

  raise exception '%', v_out;
end;
$h113$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname in ('replace_two_stage_games', 'seed_playoff_stage',
--      'acknowledge_stage_seeds', 'playoff_write_stage', 'playoff_apply_seeds')) as new_fns_must_be_0,
--   (select count(*) from information_schema.columns where table_name = 'playoffs' and column_name = 'stage') as stage_col_must_be_0,
--   (select count(*) from pg_constraint where conname = 'playoffs_league_id_division_id_key') as old_key_must_be_1,
--   (select count(*) from leagues where name like 'ZZ113%') + (select count(*) from venues where name like 'ZZ113%')
--     + (select count(*) from teams where name like 'ZZ113%') as fixtures_must_be_0,
--   (select count(*) from public_schedule_links where org_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as test_link,
--   (select plan from profiles where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as test_plan,
--   (select count(*) from playoffs) as playoffs_5;

-- ── RUN LOG ─────────────────────────────────────────────────────────────────
-- 2026-10-19 — run 1, against production, "test" proof org (owner bbf9afe1…)
-- fixtures only, rolled back.
--   BASELINE failures (0).
--   18/18 KILLED at their own tag (MU1–MU18, targets as listed in the header).
--   prosrc md5 inside the batch equal to the repo file's bodies, all ten:
--     replace_playoff_games      ed9dfa7180384bb21e5c111c376c5fe6
--     delete_playoff_bracket     585d1e3ef36b319624339e45d6e801c3
--     enter_playoff_result       d988edc57a2420c93f2d03498cbc2a8c
--     clear_playoff_result       b7c38f77dfd7c0361daa9af5d9a8b46b
--     get_league_schedule_by_token ee9d9bb385487fc0191f32249f5395bf
--     playoff_write_stage        554caf24ab8c8f554e60995f98e62665
--     playoff_apply_seeds        8d85207ccbe3eb4f341170c4928da0b4
--     replace_two_stage_games    c703303450a8917c8bc8ee0502946834
--     seed_playoff_stage         48d1bf84cd660de7e58de259739bfc87
--     acknowledge_stage_seeds    cbbda1b32a0c55d597ff19e1acec56ec
--   Leak check after: new functions 0, stage column 0, old unique key 1,
--   ZZ113 fixtures 0, test link 0, test plan elite, playoffs 5, games 16.
-- Regressions, same day: the 0107 and 0108 proofs re-run with 0113 in place
-- of their own migration (`two-stage-playoffs-build.ts 0107|0108`).
--   0107: first a CONTROL run against today's live functions — RED, 5 baseline
--     failures, all data drift in the shared T-Ball fixture (3 results, not
--     the 2 the assertions had typed in); see that file's RUN LOG. With the
--     counts read from the data: BASELINE 0, 15/15 KILLED at their own tag;
--     md5 delete/replace = 585d1e3e… / ed9dfa71…, equal to 0113.
--   0108: BASELINE 0 (14 committed calls), 18/18 KILLED at their own tag
--     (the same tags as its 2026-10-13 run 2); md5 enter/clear =
--     d988edc5… / b7c38f77…, equal to 0113; helpers unchanged
--     (0c2020eb… / abae9070…).
--   Leak check after both: fixtures, test functions and new functions 0; old
--   key present; test link 0; test plan elite; playoffs 5, games 16; live
--   enter/clear still a615f534… / e9e1908a… (0108's and 0112's).
-- 0113 NOT APPLIED — held for the founder's go.
-- 2026-10-20 — gap 1 (the re-check note names what changed): 0113 gains
-- `playoffs.stage1_changes`; enter/clear record each changed game (first
-- "was", latest "now"); seed, re-seed and acknowledge empty it; a
-- Stage-2-only rebuild keeping the seeds keeps it. New assertions CH2 and the
-- stage1_changes checks in SD4/CH1/AK1/RB2; mutants MU19–MU23.
--   Run 1: BASELINE 0; 22/23 KILLED at their own tag; MU22 (clear records the
--     old score as "now") SURVIVED — a HARNESS fault: CH1 tested the cleared
--     entry with LIKE '21:% _/_>_/_', and in LIKE `_` is a wildcard, so the
--     mutant's '_/_>6/2' matched. CH1 now compares the literal text.
--   Run 2: BASELINE failures (0); 23/23 KILLED at their own tag; prosrc md5
--     inside the batch: acknowledge_stage_seeds ae90374f…, clear_playoff_result
--     d9babbf9…, delete_playoff_bracket 585d1e3e…, enter_playoff_result
--     0602516b…, get_league_schedule_by_token ee9d9bb3…, playoff_apply_seeds
--     8d85207c…, playoff_write_stage 554caf24…, replace_playoff_games
--     ed9dfa71…, replace_two_stage_games a10e14cd…, seed_playoff_stage
--     fc71eae5… — all equal to the repo file's bodies.
--   Leak check after: new functions 0, new columns 0, old key 1, ZZ113
--   fixtures 0, test link 0, test plan elite, live enter/clear a615f534… /
--   e9e1908a…. Playoffs 6 / games 21 (was 5 / 16): the real league made a
--   5-game single-elimination bracket through the product at 13:02 UTC that
--   day — not this run; RL1 held in every pass.
-- Regressions, same day, against the gap-1 bodies: 0107 BASELINE 0, 15/15
-- KILLED at their own tag (md5 585d1e3e… / ed9dfa71…, unchanged); 0108
-- BASELINE 0 (14 committed calls), 18/18 KILLED at their own tag (md5
-- enter/clear 0602516b… / d9babbf9…, helpers 0c2020eb… / abae9070…). Both
-- batches applied the 0113 schema plus the functions their harness exercises
-- (0107: replace/delete; 0108: enter/clear), verbatim from the file. Leak
-- check after both clean.
-- 0113 NOT APPLIED — held for the founder's go.

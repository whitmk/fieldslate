-- PROOF for 0112 (the feeds' last day), run BEFORE the migration is applied.
-- Assemble with `npx tsx scripts/sim/feed-cutoff-build.ts > proof.sql`; send
-- the output as ONE execute_sql batch through the Supabase MCP. It applies
-- 0112 inside the batch, asserts, mutates, and ends in RAISE EXCEPTION, so
-- the whole batch ALWAYS rolls back. Fixtures live in the "test" org only
-- (owner bbf9afe1…, America/Los_Angeles, Elite, comped). No lock beyond the
-- function replacements and the fixture rows, held for the run (seconds).
--
-- WHAT IS PROVEN
--   LD-<case>  season_last_day matches every row of the ONE case table below
--              (sim:feed-cutoff parses the same block and runs it through
--              the TypeScript twin, seasonLastDay).
--   TC1..TC5   get_team_calendar_by_token: served 7 days past the LATER of
--              the end date and the last game (TC1 a game after the end date,
--              TC2 past the grace, TC3 the exact boundary — last+7 served,
--              last+8 expired, TC4 a playoff game after the end date, TC5 no
--              end date never cut off).
--   PS1..PS5   get_league_schedule_by_token: the same five seasons, shown or not.
--   D1         delete_playoff_bracket's preview counts the bracket's dated
--              game as on the public schedule.
--   R1, R2     replace_playoff_games' preview: "now" and "after" counts.
--   C1         clear_playoff_result's preview: on_public_schedule true.
--   P1, S1     season_last_day callable by NO role and SECURITY INVOKER; the
--              five functions' EXECUTE unchanged.
-- H0 (before 0112, not an assertion): the season with a game after its end
-- date is "expired" on the team feed and absent from the public schedule.
--
-- MUTANTS (killed only if the assertion written for it fails FIRST):
--   FM1 helper ignores regular-season games        → LD-C
--   FM2 helper ignores playoff games               → LD-D
--   FM3 helper drops the no-end-date guard          → LD-G
--   FM4 team feed back to end_date + 7              → TC1
--   FM5 team feed grace 6 days                      → TC3
--   FM6 public reader back to end_date + 7          → PS1
--   FM7 delete_playoff_bracket back                 → D1
--   FM8 replace_playoff_games "now" back            → R1
--   FM9 replace_playoff_games "after" back          → R2
--   FM10 clear_playoff_result back                  → C1
--   FM11 season_last_day granted to anon            → P1
--   FM12 helper counts not-needed playoff games     → LD-K   (0114)
--
-- ── RUN LOG ─────────────────────────────────────────────────────────────────
-- 2026-10-19 (dry run first): the fixtures and the case table alone, with only
-- the helper applied — showed the setup works and the gap is real (a season
-- with a game after its end date: feed "expired", absent from the public page).
-- 2026-10-19 run 1, full: GREEN. H0 expired / false as expected; baseline no
-- failures, 10 cases; 11/11 mutants KILLED at their own tag; md5s printed match
-- the file (season_last_day da8e4785…, get_team_calendar_by_token 45f822d6…,
-- get_league_schedule_by_token f5d53cef…, delete_playoff_bracket 3c65363c…,
-- replace_playoff_games 5cfe6b15…, clear_playoff_result e9e1908a…). Leak check
-- after: no ZZ112 rows, no season_last_day, no test-org link row, the five live
-- bodies back to their pre-0112 md5s, no other active backend.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '120s', true),
       set_config('check_function_bodies', 'off', true);

-- THE CASE TABLE — the only copy. Dates are plain "YYYY-MM-DD"; arrays are
-- Postgres array literals; NULL inside an array is an undated playoff game.
-- Keep each row on one line and each marker alone on its own line:
-- sim:feed-cutoff parses this block.
create temp table h112_cases as
select * from (values
-- LASTDAY-TABLE-BEGIN
  ('A', '2026-10-25', '{}', '{}', '{}', '2026-10-25'),
  ('B', '2026-10-25', '{2026-10-17}', '{2026-10-18}', '{}', '2026-10-25'),
  ('C', '2026-10-25', '{2026-10-17,2026-11-01}', '{}', '{}', '2026-11-01'),
  ('D', '2026-10-25', '{2026-10-17}', '{2026-11-07,NULL}', '{}', '2026-11-07'),
  ('E', '2026-10-25', '{2026-11-01}', '{2026-11-08}', '{}', '2026-11-08'),
  ('F', '2026-10-25', '{2026-11-09}', '{2026-11-08}', '{}', '2026-11-09'),
  ('G', NULL, '{2026-11-01}', '{2026-11-02}', '{}', NULL),
  ('H', '2026-10-25', '{2026-10-25}', '{}', '{}', '2026-10-25'),
  ('I', '2026-10-25', '{}', '{NULL}', '{}', '2026-10-25'),
  ('J', '2026-12-31', '{2027-01-02}', '{}', '{}', '2027-01-02'),
  ('K', '2026-10-25', '{2026-10-17}', '{2026-11-07}', '{2026-11-14}', '2026-11-07'),
  ('L', '2026-10-25', '{}', '{}', '{2026-11-14,2026-11-21}', '2026-10-25')
-- LASTDAY-TABLE-END
) as t(case_id, end_date, game_dates, playoff_dates, not_needed_dates, expect_last_day);

create function pg_temp.h112_try(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_val text;
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_val;
    v_out := 'OK ' || coalesce(v_val, 'null');
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

create function pg_temp.h112_feed(p_team uuid)
returns text
language plpgsql
as $fn$
declare
  v_tok text;
  v_res text;
begin
  select token into v_tok from public.team_calendar_links where team_id = p_team and status <> 'replaced';
  if v_tok is null then return 'NO-LINK'; end if;
  v_res := pg_temp.h112_try('anon', null, format('select public.get_team_calendar_by_token(%L)::text', v_tok));
  if v_res not like 'OK {%' then return v_res; end if;
  return (substr(v_res, 4)::jsonb) ->> 'status';
end;
$fn$;

create function pg_temp.h112_public_has(p_token text, p_league uuid)
returns text
language plpgsql
as $fn$
declare
  v_res text;
begin
  v_res := pg_temp.h112_try('anon', null, format('select public.get_league_schedule_by_token(%L)::text', p_token));
  if v_res not like 'OK {%' then return v_res; end if;
  return (exists (select 1 from jsonb_array_elements(coalesce(substr(v_res, 4)::jsonb -> 'seasons', '[]'::jsonb)) s
                   where s ->> 'id' = p_league::text))::text;
end;
$fn$;

create function pg_temp.h112_assert(fx jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_fails text[] := array[]::text[];
  r       record;
  v_got   date;
  v_res   text;
  v_j     jsonb;
  v_owner uuid := (fx ->> 'owner')::uuid;
  v_tok   text := fx ->> 'public_token';
  v_role  text;
  v_fn    record;
  v_cases int := 0;
begin
  -- LD: the case table through season_last_day.
  for r in select c.case_id, c.expect_last_day, l.league_id
             from h112_cases c join h112_case_league l using (case_id)
            order by c.case_id
  loop
    v_cases := v_cases + 1;
    v_got := public.season_last_day(r.league_id);
    if v_got is distinct from r.expect_last_day::date then
      v_fails := array_append(v_fails, format('LD-%s: got %s, expected %s', r.case_id, v_got, r.expect_last_day));
    end if;
  end loop;
  if v_cases < 10 then
    v_fails := array_append(v_fails, format('LD-count: only %s cases ran', v_cases));
  end if;

  -- TC: the team calendar feed.
  v_res := pg_temp.h112_feed((fx ->> 'team_ext')::uuid);
  if v_res <> 'ok' then v_fails := array_append(v_fails, 'TC1: a game after the end date — feed ' || v_res); end if;
  v_res := pg_temp.h112_feed((fx ->> 'team_gone')::uuid);
  if v_res <> 'expired' then v_fails := array_append(v_fails, 'TC2: 9 days past the last game — feed ' || v_res); end if;
  v_res := pg_temp.h112_feed((fx ->> 'team_edge7')::uuid);
  if v_res <> 'ok' then v_fails := array_append(v_fails, 'TC3: last game + 7 — feed ' || v_res); end if;
  v_res := pg_temp.h112_feed((fx ->> 'team_edge8')::uuid);
  if v_res <> 'expired' then v_fails := array_append(v_fails, 'TC3: last game + 8 — feed ' || v_res); end if;
  v_res := pg_temp.h112_feed((fx ->> 'team_po')::uuid);
  if v_res <> 'ok' then v_fails := array_append(v_fails, 'TC4: a playoff game after the end date — feed ' || v_res); end if;
  v_res := pg_temp.h112_feed((fx ->> 'team_null')::uuid);
  if v_res <> 'ok' then v_fails := array_append(v_fails, 'TC5: no end date — feed ' || v_res); end if;

  -- PS: the public schedule.
  v_res := pg_temp.h112_public_has(v_tok, (fx ->> 'lg_ext')::uuid);
  if v_res <> 'true' then v_fails := array_append(v_fails, 'PS1: a game after the end date — shown ' || v_res); end if;
  v_res := pg_temp.h112_public_has(v_tok, (fx ->> 'lg_gone')::uuid);
  if v_res <> 'false' then v_fails := array_append(v_fails, 'PS2: past the grace — shown ' || v_res); end if;
  v_res := pg_temp.h112_public_has(v_tok, (fx ->> 'lg_edge7')::uuid);
  if v_res <> 'true' then v_fails := array_append(v_fails, 'PS3: last game + 7 — shown ' || v_res); end if;
  v_res := pg_temp.h112_public_has(v_tok, (fx ->> 'lg_edge8')::uuid);
  if v_res <> 'false' then v_fails := array_append(v_fails, 'PS3: last game + 8 — shown ' || v_res); end if;
  v_res := pg_temp.h112_public_has(v_tok, (fx ->> 'lg_po')::uuid);
  if v_res <> 'true' then v_fails := array_append(v_fails, 'PS4: a playoff game after the end date — shown ' || v_res); end if;
  v_res := pg_temp.h112_public_has(v_tok, (fx ->> 'lg_null')::uuid);
  if v_res <> 'true' then v_fails := array_append(v_fails, 'PS5: no end date — shown ' || v_res); end if;

  -- D1 / R1 / R2 / C1: the three mirrors, as the org's own admin.
  v_res := pg_temp.h112_try('authenticated', v_owner,
    format('select public.delete_playoff_bracket(%L::uuid, false)::text', fx ->> 'po_result'));
  if v_res not like 'OK {%' or (substr(v_res, 4)::jsonb ->> 'public_games')::int is distinct from 1 then
    v_fails := array_append(v_fails, 'D1: delete preview public_games — ' || left(v_res, 300));
  end if;

  v_res := pg_temp.h112_try('authenticated', v_owner,
    format('select public.replace_playoff_games(%L::uuid, %L::jsonb, %L::jsonb, false)::text',
           fx ->> 'po_open', fx -> 'replace_settings', fx -> 'replace_games'));
  if v_res not like 'OK {%' or (substr(v_res, 4)::jsonb ->> 'public_games')::int is distinct from 1 then
    v_fails := array_append(v_fails, 'R1: replace preview public_games (now) — ' || left(v_res, 300));
  end if;
  if v_res not like 'OK {%' or (substr(v_res, 4)::jsonb ->> 'public_games_after')::int is distinct from 1 then
    v_fails := array_append(v_fails, 'R2: replace preview public_games_after — ' || left(v_res, 300));
  end if;

  v_res := pg_temp.h112_try('authenticated', v_owner,
    format('select public.clear_playoff_result(%L::uuid, false)::text', fx ->> 'pg_result'));
  if v_res not like 'OK {%' or (substr(v_res, 4)::jsonb ->> 'on_public_schedule') is distinct from 'true' then
    v_fails := array_append(v_fails, 'C1: clear preview on_public_schedule — ' || left(v_res, 300));
  end if;

  -- P1 / S1: privileges and security mode.
  for v_fn in select * from (values
      ('public.season_last_day(uuid)', ''),
      ('public.get_team_calendar_by_token(text)', 'anon,authenticated'),
      ('public.get_league_schedule_by_token(text)', 'anon,authenticated'),
      ('public.delete_playoff_bracket(uuid, boolean)', 'authenticated'),
      ('public.replace_playoff_games(uuid, jsonb, jsonb, boolean)', 'authenticated'),
      ('public.clear_playoff_result(uuid, boolean)', 'authenticated')) as t(fn, allowed)
  loop
    foreach v_role in array array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(v_role, v_fn.fn, 'EXECUTE') <> (v_role = any (string_to_array(v_fn.allowed, ','))) then
        v_fails := array_append(v_fails, format('P1: %s EXECUTE on %s is wrong', v_role, v_fn.fn));
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_proc where proname = 'season_last_day' and prosecdef) then
    v_fails := array_append(v_fails, 'S1: season_last_day is SECURITY DEFINER');
  end if;

  return jsonb_build_object('fails', to_jsonb(v_fails), 'cases', v_cases);
end;
$fn$;

do $h112$
declare
  v_owner  uuid;
  v_tz     text;
  t        date;
  v_n      int;
  fx       jsonb := '{}'::jsonb;
  c        record;
  v_lg     uuid;
  v_div    uuid;
  v_t1     uuid;
  v_t2     uuid;
  v_po     uuid;
  v_gn     int;
  v_nn     uuid;
  v_d      text;
  v_tok    text;
  v_h0     text := '';
  v_base   jsonb;
  v_m      jsonb;
  v_out    text := '';
  m        record;
  v_def    text;
  v_mut    text;
  v_pos    int;
  v_idx    int;
  v_first  text;
  v_tag    text;
begin
  select count(*), min(id::text)::uuid into v_n, v_owner from public.profiles where org_name = 'test';
  if v_n <> 1 or v_owner::text not like 'bbf9afe1%' then
    raise exception 'H112 SETUP: expected exactly one "test" org owned by bbf9afe1…, found % (%)', v_n, v_owner;
  end if;
  select timezone into v_tz from public.profiles where id = v_owner;
  t := (now() at time zone v_tz)::date;
  fx := fx || jsonb_build_object('owner', v_owner);

  -- The case table: one league per row (end date, games, playoff games).
  create temp table h112_case_league (case_id text, league_id uuid);
  create temp table h112_not_needed (id uuid);
  for c in select * from h112_cases order by case_id loop
    insert into public.leagues (name, sport, season, status, owner_id, start_date, end_date)
    values ('ZZ112 Case ' || c.case_id, 'baseball', 'Fall', 'active', v_owner, '2026-08-01', c.end_date::date)
    returning id into v_lg;
    insert into public.divisions (league_id, name, settings) values (v_lg, 'ZZ112 D', '{"game_duration": 90}'::jsonb)
    returning id into v_div;
    insert into public.teams (league_id, division_id, name) values (v_lg, v_div, 'ZZ112 T1') returning id into v_t1;
    insert into public.teams (league_id, division_id, name) values (v_lg, v_div, 'ZZ112 T2') returning id into v_t2;
    -- 03:30 UTC: the stored wall-clock date must count, not a zone-converted one.
    foreach v_d in array c.game_dates::text[] loop
      insert into public.games (league_id, home_team_id, away_team_id, scheduled_at, status)
      values (v_lg, v_t1, v_t2, (v_d || ' 03:30:00+00')::timestamptz, 'scheduled');
    end loop;
    insert into public.playoffs (league_id, division_id, format, seeding, status)
    values (v_lg, v_div, 'round_robin', '[]'::jsonb, 'active') returning id into v_po;
    v_gn := 0;
    foreach v_d in array c.playoff_dates::text[] loop
      v_gn := v_gn + 1;
      insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, home_team_id, away_team_id, scheduled_date)
      values (v_po, v_lg, v_div, 'RR1', v_gn, v_t1, v_t2, v_d::date);
    end loop;
    -- 0114: not-needed playoff games. Written 'scheduled' here (the setup runs
    -- before the migration, whose status check allows 'not_needed') and set
    -- not_needed right after the migration runs.
    foreach v_d in array c.not_needed_dates::text[] loop
      v_gn := v_gn + 1;
      insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, home_team_id, away_team_id, scheduled_date)
      values (v_po, v_lg, v_div, 'RR1', v_gn, v_t1, v_t2, v_d::date)
      returning id into v_nn;
      insert into h112_not_needed values (v_nn);
    end loop;
    insert into h112_case_league values (c.case_id, v_lg);
  end loop;

  -- End-to-end seasons, relative to today T in the org's timezone. Each gets a
  -- division, two teams, its games, then the LOCK (which creates the teams'
  -- calendar links and publishes the division).
  for c in select * from (values
      ('ext',   -10, array[-1]),
      ('gone',  -20, array[-9]),
      ('edge7', -20, array[-7]),
      ('edge8', -20, array[-8]),
      ('po',    -20, array[-15]),
      ('null',  null::int, array[-30])) as s(k, end_off, game_offs)
  loop
    insert into public.leagues (name, sport, season, status, owner_id, start_date, end_date)
    values ('ZZ112 ' || c.k, 'baseball', 'Fall', 'active', v_owner, t - 90,
            case when c.end_off is null then null else t + c.end_off end)
    returning id into v_lg;
    insert into public.divisions (league_id, name, settings) values (v_lg, 'ZZ112 Div', '{"game_duration": 90}'::jsonb)
    returning id into v_div;
    insert into public.teams (league_id, division_id, name) values (v_lg, v_div, 'ZZ112 A') returning id into v_t1;
    insert into public.teams (league_id, division_id, name) values (v_lg, v_div, 'ZZ112 B') returning id into v_t2;
    for v_n in select unnest(c.game_offs) loop
      insert into public.games (league_id, home_team_id, away_team_id, scheduled_at, status)
      values (v_lg, v_t1, v_t2, ((t + v_n)::text || ' 18:00:00+00')::timestamptz, 'scheduled');
    end loop;
    if c.k = 'po' then
      -- Bracket 1 (this division): one game, dated T-2, WITH a result — for
      -- delete and clear. Bracket 2 (a second locked division): one game,
      -- dated T-2, no result — for replace.
      insert into public.playoffs (league_id, division_id, format, seeding, status)
      values (v_lg, v_div, 'round_robin', '[]'::jsonb, 'active') returning id into v_po;
      fx := fx || jsonb_build_object('po_result', v_po);
      insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, home_team_id, away_team_id,
                                        scheduled_date, start_time, status, winner_id, home_score, away_score)
      values (v_po, v_lg, v_div, 'RR1', 1, v_t1, v_t2, t - 2, time '10:00', 'completed', v_t1, 5, 3)
      returning id into v_po;
      fx := fx || jsonb_build_object('pg_result', v_po);
      declare v_div2 uuid; v_c1 uuid; v_c2 uuid; v_po2 uuid;
      begin
        insert into public.divisions (league_id, name, settings) values (v_lg, 'ZZ112 Div2', '{"game_duration": 90}'::jsonb)
        returning id into v_div2;
        insert into public.teams (league_id, division_id, name) values (v_lg, v_div2, 'ZZ112 C') returning id into v_c1;
        insert into public.teams (league_id, division_id, name) values (v_lg, v_div2, 'ZZ112 D') returning id into v_c2;
        insert into public.playoffs (league_id, division_id, format, seeding, status)
        values (v_lg, v_div2, 'round_robin', '[]'::jsonb, 'active') returning id into v_po2;
        insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, home_team_id, away_team_id,
                                          scheduled_date, start_time)
        values (v_po2, v_lg, v_div2, 'RR1', 1, v_c1, v_c2, t - 2, time '10:00');
        update public.divisions set locked = true where id = v_div2;
        fx := fx || jsonb_build_object(
          'po_open', v_po2,
          'replace_settings', jsonb_build_object('format', 'round_robin', 'seeding', '[]'::jsonb,
             'playing_days', '[]'::jsonb, 'day_windows', '{}'::jsonb, 'venue_assignments', '[]'::jsonb,
             'cross_division_enabled', false),
          'replace_games', jsonb_build_array(jsonb_build_object('round', 'RR1', 'game_number', 1,
             'home_team_id', v_c1, 'away_team_id', v_c2, 'scheduled_date', (t - 2)::text, 'start_time', '10:00')));
      end;
    end if;
    update public.divisions set locked = true where id = v_div;
    fx := fx || jsonb_build_object('lg_' || c.k, v_lg, 'team_' || c.k, v_t1);
  end loop;

  insert into public.public_schedule_links (org_id, enabled) values (v_owner, true)
  on conflict (org_id) do update set enabled = true
  returning token into v_tok;
  if v_tok is null then
    raise exception 'H112 SETUP: the public schedule link has no token';
  end if;
  fx := fx || jsonb_build_object('public_token', v_tok);

  -- H0: before 0112.
  v_h0 := format('team feed for a game after the end date: %s; public schedule shows it: %s',
                 pg_temp.h112_feed((fx ->> 'team_ext')::uuid),
                 pg_temp.h112_public_has(v_tok, (fx ->> 'lg_ext')::uuid));

  execute $mig112$
-- @@MIGRATION_0112@@
  $mig112$;
  update public.playoff_games set status = 'not_needed' where id in (select id from h112_not_needed);

  v_base := pg_temp.h112_assert(fx);
  v_out := format(E'H112 RESULTS\nH0 (before 0112): %s  [expected expired / false]\nBASELINE failures: %s\nBASELINE cases: %s\n',
                  v_h0, v_base -> 'fails', v_base -> 'cases');

  for m in
    select * from (values
      ('FM1',  'helper ignores regular-season games', 'LD-C', 'public.season_last_day(uuid)',
         E'(select max((g.scheduled_at at time zone ''UTC'')::date)\n                from public.games g\n               where g.league_id = l.id),', 'null::date,', 1),
      ('FM2',  'helper ignores playoff games', 'LD-D', 'public.season_last_day(uuid)',
         E'(select max(pg.scheduled_date)\n                from public.playoff_games pg\n               where pg.league_id = l.id\n                 and pg.status <> ''not_needed''))', 'null::date)', 1),
      ('FM3',  'helper drops the no-end-date guard', 'LD-G', 'public.season_last_day(uuid)',
         'when l.end_date is null then null', 'when false then null', 1),
      ('FM4',  'team feed back to end_date + 7', 'TC1', 'public.get_team_calendar_by_token(text)',
         'public.season_last_day(v_league_id) + 7', 'v_end_date + 7', 1),
      ('FM5',  'team feed grace 6 days', 'TC3', 'public.get_team_calendar_by_token(text)',
         'public.season_last_day(v_league_id) + 7', 'public.season_last_day(v_league_id) + 6', 1),
      ('FM6',  'public reader back to end_date + 7', 'PS1', 'public.get_league_schedule_by_token(text)',
         'public.season_last_day(l.id) + 7', 'l.end_date + 7', 1),
      ('FM7',  'delete_playoff_bracket back', 'D1', 'public.delete_playoff_bracket(uuid, boolean)',
         'public.season_last_day(v_league.id) + 7', 'v_league.end_date + 7', 1),
      ('FM8',  'replace_playoff_games "now" back', 'R1', 'public.replace_playoff_games(uuid, jsonb, jsonb, boolean)',
         'public.season_last_day(v_league.id) + 7', 'v_league.end_date + 7', 1),
      ('FM9',  'replace_playoff_games "after" back', 'R2', 'public.replace_playoff_games(uuid, jsonb, jsonb, boolean)',
         'public.season_last_day(v_league.id) + 7', 'v_league.end_date + 7', 2),
      ('FM10', 'clear_playoff_result back', 'C1', 'public.clear_playoff_result(uuid, boolean)',
         'public.season_last_day(v_league.id) + 7', 'v_league.end_date + 7', 1),
      ('FM11', 'season_last_day granted to anon', 'P1', null, null, null, 0),
      ('FM12', 'helper counts not-needed playoff games', 'LD-K', 'public.season_last_day(uuid)',
         E'\n                 and pg.status <> ''not_needed''))', '))', 1)
    ) as t(id, what, target, fn, old_text, new_text, nth)
  loop
    begin
      if m.fn is null then
        grant execute on function public.season_last_day(uuid) to anon;
      else
        v_def := pg_get_functiondef(m.fn::regprocedure);
        -- Replace the nth occurrence only.
        v_pos := 0;
        for v_n in 1..m.nth loop
          v_idx := strpos(substr(v_def, v_pos + 1), m.old_text);
          if v_idx = 0 then
            raise exception 'MUTANT_NOOP';
          end if;
          v_pos := v_pos + v_idx;
        end loop;
        v_mut := overlay(v_def placing m.new_text from v_pos for length(m.old_text));
        execute v_mut;
      end if;
      v_m := pg_temp.h112_assert(fx);
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s)\n   first: %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED' when v_tag = m.target then 'KILLED' else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'), left(coalesce(v_first, '-'), 220));
      raise exception 'H112_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H112_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  v_m := pg_temp.h112_assert(fx);
  v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');
  v_out := v_out || (select string_agg(proname || '=' || md5(prosrc), ' ' order by proname)
                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public'
                        and proname in ('season_last_day', 'get_team_calendar_by_token', 'get_league_schedule_by_token',
                                        'delete_playoff_bracket', 'replace_playoff_games', 'clear_playoff_result'));
  raise exception '%', v_out;
end;
$h112$;
-- 2026-10-20 — 0114 (playoff series): the case table gains not_needed_dates
-- (cases K and L) and FM12; re-run with 0114 in place of 0112
-- (`playoff-series-build.ts 0112`): BASELINE failures none, 12 cases; 12/12
-- KILLED at their own tag; md5s printed: season_last_day 48e6d550…,
-- get_league_schedule_by_token 58de6c61…, delete_playoff_bracket 0c788c4b…,
-- replace_playoff_games 2e621878…, clear_playoff_result f60c3532… (0114's),
-- get_team_calendar_by_token 45f822d6… (unchanged). H0 read ok / true — 0112
-- is live now, so "before 0112" no longer exists to observe. Leak check clean.

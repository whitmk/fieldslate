-- A 3-team single-elimination bracket with a best-of-3 Final, played through
-- the LIVE 0114 functions (replace_playoff_games, enter_playoff_result,
-- clear_playoff_result) as the "test" proof org's owner (bbf9afe1…, Elite) —
-- never Santa Rosa American's data. One batch, always rolled back by the final
-- RAISE, which carries the results out. Run via the Supabase MCP; follow with
-- the leak check at the bottom. Not npm-runnable (SQL-level, see CLAUDE.md).
-- The games are the planner's output for 3 teams, {F: 3}, one game per team
-- per day (sim:playoff-series FN13 pins the same plan in TypeScript).
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '30s', true);
do $$
declare
  v_org uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_l uuid := gen_random_uuid(); v_d uuid := gen_random_uuid(); v_p uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid();
  v_out text := '';
  v_r jsonb;
  v_r1 uuid; f1 uuid; f2 uuid; f3 uuid;
  rec record;
  v_name text;
begin
  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
    values (v_l, 'ZZ3T Season', 'Baseball', 'Fall 2026', v_org, '2026-09-01', '2026-12-31');
  insert into public.divisions (id, league_id, name, settings) values (v_d, v_l, 'ZZ3T Majors', '{"game_duration": 120, "buffer_minutes": 15}');
  insert into public.teams (id, league_id, division_id, name) values
    (t1, v_l, v_d, 'ZZ3T Expos'), (t2, v_l, v_d, 'ZZ3T Bears'), (t3, v_l, v_d, 'ZZ3T Pirates');
  insert into public.playoffs (id, league_id, division_id, format, seeding, status)
    values (v_p, v_l, v_d, 'single_elimination', '[]', 'draft');

  -- As the test org's owner (authenticated), exactly as the app calls it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_r := public.replace_playoff_games(v_p,
    jsonb_build_object('format', 'single_elimination',
      'seeding', jsonb_build_array(jsonb_build_object('team_id', t1, 'team_name', 'Expos'),
                                   jsonb_build_object('team_id', t2, 'team_name', 'Bears'),
                                   jsonb_build_object('team_id', t3, 'team_name', 'Pirates')),
      'start_date', '2026-11-14', 'end_date', '2026-12-06', 'playing_days', jsonb_build_array('Sa', 'Su'),
      'day_windows', '{}'::jsonb, 'venue_assignments', '[]'::jsonb, 'cross_division_enabled', false,
      'games_per_team_per_day', 1, 'series_by_round', '{"F": 3}'::jsonb),
    jsonb_build_array(
      jsonb_build_object('round', 'R1', 'game_number', 2, 'home_team_id', t2, 'away_team_id', t3, 'scheduled_date', '2026-11-14', 'start_time', '09:00'),
      jsonb_build_object('round', 'F', 'game_number', 3, 'series_game', 1, 'home_team_id', t1, 'scheduled_date', '2026-11-15', 'start_time', '09:00'),
      jsonb_build_object('round', 'F', 'game_number', 3, 'series_game', 2, 'home_team_id', t1, 'scheduled_date', '2026-11-21', 'start_time', '09:00'),
      jsonb_build_object('round', 'F', 'game_number', 3, 'series_game', 3, 'home_team_id', t1, 'scheduled_date', '2026-11-22', 'start_time', '09:00')),
    true);
  v_out := v_out || format(E'GENERATE committed=%s games=%s dated=%s\n', v_r ->> 'committed', v_r ->> 'new_games', v_r ->> 'new_dated_games');

  select id into v_r1 from public.playoff_games where playoff_id = v_p and round = 'R1';
  select id into f1 from public.playoff_games where playoff_id = v_p and round = 'F' and series_game = 1;
  select id into f2 from public.playoff_games where playoff_id = v_p and round = 'F' and series_game = 2;
  select id into f3 from public.playoff_games where playoff_id = v_p and round = 'F' and series_game = 3;

  -- Round 1: Pirates (3) upset Bears (2).
  v_r := public.enter_playoff_result(v_r1, 2, 5);
  v_out := v_out || format(E'R1 2-5 committed=%s advanced=%s\n', v_r ->> 'committed', v_r -> 'advanced');
  for rec in select g.series_game, ht.name h, at.name a, g.scheduled_date, g.status
               from public.playoff_games g left join public.teams ht on ht.id = g.home_team_id left join public.teams at on at.id = g.away_team_id
              where g.playoff_id = v_p and g.round = 'F' order by g.series_game loop
    v_out := v_out || format(E'  Final g%s %s vs %s %s %s\n', rec.series_game, rec.h, rec.a, rec.scheduled_date, rec.status);
  end loop;

  -- Final: Expos win games 1 and 2 → game 3 not needed.
  v_r := public.enter_playoff_result(f1, 4, 1);                     -- Expos home
  v_r := public.enter_playoff_result(f2, 2, 6);                     -- Pirates home, Expos win
  v_out := v_out || format(E'F g2 → series %s\n', v_r -> 'series');
  select status into v_name from public.playoff_games where id = f3;
  v_out := v_out || format(E'  Final g3 status=%s\n', v_name);
  v_r := public.enter_playoff_result(f3, 3, 2);
  v_out := v_out || format(E'  enter g3 while not needed → %s\n', coalesce(v_r ->> 'reason', v_r::text));
  v_r := public.clear_playoff_result(f2, true);
  select status into v_name from public.playoff_games where id = f3;
  v_out := v_out || format(E'CLEAR g2 committed=%s → g3 status=%s\n', v_r ->> 'committed', v_name);
  -- Replay: Pirates take game 2, Expos game 3.
  v_r := public.enter_playoff_result(f2, 6, 2);
  v_r := public.enter_playoff_result(f3, 3, 2);
  v_out := v_out || format(E'F g3 → series %s\n', v_r -> 'series');
  select string_agg(message, E'\n  ' order by created_at, id) into v_name from public.activity_log
   where league_id = v_l and event_type like 'playoff_%';
  v_out := v_out || E'LOG\n  ' || coalesce(v_name, '(none)');

  execute 'reset role';
  raise exception E'ROLLED BACK — 3-team check\n%', v_out;
end $$;

-- Leak check (run separately afterwards; every count must be 0):
-- select (select count(*) from public.leagues where name like 'ZZ3T%'),
--        (select count(*) from public.teams where name like 'ZZ3T%'),
--        (select count(*) from public.divisions where name like 'ZZ3T%'),
--        (select count(*) from public.activity_log where message like 'ZZ3T%');

-- ── RUN LOG ──────────────────────────────────────────────────────────────────
-- 2026-10-20 — against production (0114 applied), "test" org, rolled back:
--   GENERATE committed, 4 games, 4 dated.
--   Round 1 Bears 2, Pirates 5 → Pirates moved into all three Final games:
--     g1 Expos vs Pirates 11/15, g2 Pirates vs Expos 11/21, g3 Expos vs
--     Pirates 11/22 (seed 1 home in games 1 and 3).
--   Expos win g1 4–1 and g2 6–2 (away) → g3 not_needed; entering g3 refused
--   (game_not_needed). Clearing g2 → g3 scheduled again. Replay: Pirates g2
--   6–2, Expos g3 3–2 → Expos win the Final 2–1.
--   Log: "Round 1 — … Pirates moved into the Final", "Final, game 2 of 3 — …".
--   Leak check: 0 / 0 / 0 / 0; totals still 5 brackets, 19 games.

-- Proof for 0116 (public bracket page: playoffs.public_scores,
-- set_playoff_public_scores, get_league_bracket_by_token). Assembled by
-- public-bracket-build.ts, which puts the LITERAL migration text where the
-- placeholder is — so this proves the file that will be applied. It runs
-- BEFORE 0116 is applied: the whole batch is one transaction that the final
-- RAISE always rolls back. Fixtures live in the "test" proof org (bbf9afe1…,
-- Elite) and, as the OTHER league, "Test 2" (27c15406…) — never Santa Rosa
-- American's data. The "test" org has no public schedule link; the case
-- creates one (rolled back).
--
-- LOCKS: applying 0116 takes ACCESS EXCLUSIVE on `playoffs` (ADD COLUMN) for
-- the WHOLE batch — the Playoffs page, the public schedule's playoff rows and
-- every bracket function wait until the batch ends (a few seconds).
-- lock_timeout 3s.
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   T1  a malformed and an unknown token → unknown
--   T2  the link turned off → off
--   T3  plan free → plan; plan pro → ok (Elite→Pro keeps the bracket)
--   U1  ANOTHER league's division through this token → unavailable
--   U2  a division in an ARCHIVED season → unavailable
--   U3  a random uuid, and a null division → unavailable
--   U4  a season past its window (ended long ago, no games) → unavailable
--   U5  every unavailable answer is byte-identical {"status": "unavailable"}
--   L1  an unlocked division → unpublished, its name and nothing else
--   N1  a locked division with no bracket → no_bracket
--   N2  a locked division with only a DRAFT bracket → no_bracket
--   D1  a double-elimination bracket → not_shareable, no games
--   A1  anon may call the reader (EXECUTE), and gets ok
--   OK1 single elimination: exact top-level, bracket and game keys (KY)
--   OK2 scores and winner present; the not-needed game left out; series
--       length counted
--   OK3 nothing private in the answer: no contact email, notes, seeding,
--       stage1_changes, address, lights, or the fixture's private strings
--   TS1 two-stage: both stages, Stage 1 first, advance_count carried
--   W1  a non-member may not set the switch (not_authorized)
--   W2  anon may not call the setter (EXECUTE)
--   W3  setting it OFF via the Stage 2 id sets BOTH stages; one log row
--   S1  with it off, the reader sends no score in that bracket; winners stay;
--       the OTHER bracket's scores are unaffected
--   W4  setting the same value again changes nothing and logs nothing
--   W5  a Free org may not set it (plan_required)
-- Mutants (each must die at its own tag):
--   MU1  the org ownership join removed                → U1
--   MU2  scores sent whatever the setting              → S1
--   MU3  the locked check removed                      → L1
--   MU4  the double-elimination refusal removed        → D1
--   MU5  the no-bracket check counts drafts            → N2
--   MU6  not-needed games included                     → OK2
--   MU7  archived seasons allowed                      → U2
--   MU8  the bracket's seeding emitted                 → OK1
--   MU9  the setter writes one stage only              → W3
--   MU10 the setter's org check removed                → W1
--   MU11 the setter granted to anon                    → MIG (the migration's
--        own privilege check refuses to apply — the right red line)
--   MU12 the season window removed                     → U4
-- Plus: md5(prosrc) of both functions printed (match them to the file).
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

-- Calls a function as `role` (with `sub` as the JWT subject); returns the
-- jsonb as text, or 'ERR:<sqlstate>:<message>'.
create or replace function pg_temp.h116_as(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare
  v text;
begin
  if p_sub is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  end if;
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$f$;

create or replace function pg_temp.h116_keys(j jsonb) returns text
language sql immutable as $f$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(j) k
$f$;

create or replace function pg_temp.h116_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_org2  uuid := '27c15406-fdda-43ce-bc31-1a071fe254e4';
  v_tok   text;
  v_s     uuid := gen_random_uuid();  -- current season
  v_sa    uuid := gen_random_uuid();  -- archived season
  v_so    uuid := gen_random_uuid();  -- season long over
  v_s2    uuid := gen_random_uuid();  -- the OTHER league's season
  d_se uuid := gen_random_uuid(); d_ts uuid := gen_random_uuid(); d_de uuid := gen_random_uuid();
  d_dr uuid := gen_random_uuid(); d_no uuid := gen_random_uuid(); d_un uuid := gen_random_uuid();
  d_ar uuid := gen_random_uuid(); d_ov uuid := gen_random_uuid(); d_o2 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  p_se uuid := gen_random_uuid(); p_ts1 uuid := gen_random_uuid(); p_ts2 uuid := gen_random_uuid();
  p_de uuid := gen_random_uuid(); p_dr uuid := gen_random_uuid(); p_un uuid := gen_random_uuid();
  p_ar uuid := gen_random_uuid(); p_o2 uuid := gen_random_uuid();
  v_loc uuid := gen_random_uuid(); v_ven uuid := gen_random_uuid();
  r jsonb; t text; g jsonb; b jsonb;
  v_unavail text := '{"status": "unavailable"}';
  v_logs int;
begin
  -- ── fixtures ──────────────────────────────────────────────────────────────
  delete from public.public_schedule_links where org_id = v_org;
  insert into public.public_schedule_links (org_id, enabled) values (v_org, true) returning token into v_tok;

  insert into public.locations (id, owner_id, name, address) values (v_loc, v_org, 'ZZ116 Park', 'ZZ116SECRETADDR 1 Main St');
  insert into public.venues (id, owner_id, name, location_id, address, has_lights)
    values (v_ven, v_org, 'ZZ116 Field', v_loc, 'ZZ116SECRETADDR 2 Main St', true);

  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date, archived_at) values
    (v_s,  'ZZ116 Season',   'Baseball', 'Fall 2026', v_org,  '2026-09-01'::date, '2026-12-31'::date, null),
    (v_sa, 'ZZ116 Archived', 'Baseball', 'Fall 2026', v_org,  '2026-09-01'::date, '2026-12-31'::date, now()),
    (v_so, 'ZZ116 Over',     'Baseball', 'Spring 2020', v_org, '2020-03-01'::date, '2020-06-01'::date, null),
    (v_s2, 'ZZ116 Other',    'Baseball', 'Fall 2026', v_org2, '2026-09-01'::date, '2026-12-31'::date, null);
  insert into public.divisions (id, league_id, name, settings) values
    (d_se, v_s, 'ZZ116 Majors', '{}'), (d_ts, v_s, 'ZZ116 AAA', '{}'), (d_de, v_s, 'ZZ116 Juniors', '{}'),
    (d_dr, v_s, 'ZZ116 Minors', '{}'), (d_no, v_s, 'ZZ116 Rookies', '{}'), (d_un, v_s, 'ZZ116 AA', '{}'),
    (d_ar, v_sa, 'ZZ116 Arch', '{}'), (d_ov, v_so, 'ZZ116 Old', '{}'), (d_o2, v_s2, 'ZZ116 Theirs', '{}');
  update public.divisions set locked = true where id in (d_se, d_ts, d_de, d_dr, d_no, d_ar, d_ov, d_o2);

  insert into public.teams (id, league_id, division_id, name, contact_email) values
    (t1, v_s, d_se, 'ZZ116 Braves', 'zz116secret@example.com'), (t2, v_s, d_se, 'ZZ116 Cubs', 'zz116secret@example.com'),
    (t3, v_s, d_se, 'ZZ116 Mets', null), (t4, v_s, d_se, 'ZZ116 Giants', null),
    (u1, v_s, d_ts, 'ZZ116 Bears', null), (u2, v_s, d_ts, 'ZZ116 Lions', null), (u3, v_s, d_ts, 'ZZ116 Owls', null);

  insert into public.playoffs (id, league_id, division_id, format, seeding, status, stage, parent_playoff_id, advance_count) values
    (p_se,  v_s,  d_se, 'single_elimination', '["ZZ116SEEDING"]'::jsonb, 'active', 1, null, null),
    (p_ts1, v_s,  d_ts, 'round_robin',        '[]'::jsonb, 'active', 1, null, null),
    (p_de,  v_s,  d_de, 'double_elimination', '[]'::jsonb, 'active', 1, null, null),
    (p_dr,  v_s,  d_dr, 'single_elimination', '[]'::jsonb, 'draft',  1, null, null),
    (p_un,  v_s,  d_un, 'single_elimination', '[]'::jsonb, 'active', 1, null, null),
    (p_ar,  v_sa, d_ar, 'single_elimination', '[]'::jsonb, 'active', 1, null, null),
    (p_o2,  v_s2, d_o2, 'single_elimination', '[]'::jsonb, 'active', 1, null, null);
  insert into public.playoffs (id, league_id, division_id, format, seeding, status, stage, parent_playoff_id, advance_count, stage1_changes)
    values (p_ts2, v_s, d_ts, 'single_elimination', '[]'::jsonb, 'active', 2, p_ts1, 2, '[{"zz":"ZZ116STAGE1CHANGES"}]'::jsonb);
  insert into public.playoffs (id, league_id, division_id, format, seeding, status)
    values (gen_random_uuid(), v_so, d_ov, 'single_elimination', '[]'::jsonb, 'active');

  -- Majors: a played game (scores + winner), a best-of-3 Final with game 3 not needed.
  insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, series_game,
                                    home_team_id, away_team_id, winner_id, home_score, away_score, status,
                                    scheduled_date, start_time, venue_id) values
    (p_se, v_s, d_se, 'R1', 2, 1, t1, t2, t1, 7, 4, 'completed', '2026-10-24'::date, '09:00'::time, v_ven),
    (p_se, v_s, d_se, 'R1', 3, 1, t3, t4, t4, 3, 5, 'completed', '2026-10-24'::date, '11:30'::time, v_ven),
    (p_se, v_s, d_se, 'F',  4, 1, t1, t4, t1, 2, 1, 'completed', '2026-10-31'::date, '10:00'::time, v_ven),
    (p_se, v_s, d_se, 'F',  4, 2, t4, t1, t1, 6, 8, 'completed', '2026-10-31'::date, '13:00'::time, v_ven),
    (p_se, v_s, d_se, 'F',  4, 3, t1, t4, null, null, null, 'not_needed', null, null, null);
  -- AAA: a round-robin result, and a Stage 2 slot waiting for seeding.
  insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, series_game,
                                    home_team_id, away_team_id, winner_id, home_score, away_score, status,
                                    scheduled_date, start_time, venue_id, seed_home, seed_away) values
    (p_ts1, v_s, d_ts, 'RR1', 1, 1, u1, u2, u1, 5, 1, 'completed', '2026-10-17'::date, '09:00'::time, v_ven, null, null),
    (p_ts2, v_s, d_ts, 'F',   1, 1, null, null, null, null, null, 'scheduled', null, null, null, 1, 2);
  insert into public.playoff_games (playoff_id, league_id, division_id, round, game_number, series_game,
                                    home_team_id, away_team_id, status) values
    (p_de, v_s, d_de, 'WB-R1', 1, 1, null, null, 'scheduled'),
    (p_un, v_s, d_un, 'F', 1, 1, null, null, 'scheduled'),
    (p_o2, v_s2, d_o2, 'F', 1, 1, null, null, 'scheduled');

  -- ── reader ────────────────────────────────────────────────────────────────
  if public.get_league_bracket_by_token('nope', d_se) ->> 'status' <> 'unknown'
     or public.get_league_bracket_by_token(repeat('0', 64), d_se) ->> 'status' <> 'unknown' then
    return 'T1 bad token not unknown';
  end if;

  update public.public_schedule_links set enabled = false where org_id = v_org;
  if public.get_league_bracket_by_token(v_tok, d_se)::text <> '{"status": "off"}' then return 'T2 not off'; end if;
  update public.public_schedule_links set enabled = true where org_id = v_org;

  update public.profiles set plan = 'free' where id = v_org;
  if public.get_league_bracket_by_token(v_tok, d_se)::text <> '{"status": "plan"}' then
    update public.profiles set plan = 'elite' where id = v_org;
    return 'T3 free not plan';
  end if;
  update public.profiles set plan = 'pro' where id = v_org;
  t := public.get_league_bracket_by_token(v_tok, d_se) ->> 'status';
  update public.profiles set plan = 'elite' where id = v_org;
  if t <> 'ok' then return 'T3 pro not ok: ' || t; end if;

  if public.get_league_bracket_by_token(v_tok, d_o2)::text <> v_unavail then
    return 'U1 another league''s division: ' || left(public.get_league_bracket_by_token(v_tok, d_o2)::text, 120);
  end if;
  if public.get_league_bracket_by_token(v_tok, d_ar)::text <> v_unavail then
    return 'U2 archived season: ' || left(public.get_league_bracket_by_token(v_tok, d_ar)::text, 120);
  end if;
  if public.get_league_bracket_by_token(v_tok, gen_random_uuid())::text <> v_unavail
     or public.get_league_bracket_by_token(v_tok, null)::text <> v_unavail then
    return 'U3 random/null division';
  end if;
  if public.get_league_bracket_by_token(v_tok, d_ov)::text <> v_unavail then
    return 'U4 season over: ' || left(public.get_league_bracket_by_token(v_tok, d_ov)::text, 120);
  end if;

  r := public.get_league_bracket_by_token(v_tok, d_un);
  if r::text <> '{"status": "unpublished", "division": {"name": "ZZ116 AA"}}' then return 'L1 unlocked: ' || left(r::text, 120); end if;

  r := public.get_league_bracket_by_token(v_tok, d_no);
  if r ->> 'status' <> 'no_bracket' or pg_temp.h116_keys(r) <> 'division,status' then return 'N1 no bracket: ' || left(r::text, 120); end if;
  r := public.get_league_bracket_by_token(v_tok, d_dr);
  if r::text <> '{"status": "no_bracket", "division": {"name": "ZZ116 Minors"}}' then return 'N2 draft only: ' || left(r::text, 120); end if;

  r := public.get_league_bracket_by_token(v_tok, d_de);
  if r::text <> '{"status": "not_shareable", "division": {"name": "ZZ116 Juniors"}}' then return 'D1 double elim: ' || left(r::text, 120); end if;

  t := pg_temp.h116_as('anon', null, format('select public.get_league_bracket_by_token(%L, %L::uuid)::text', v_tok, d_se));
  if t like 'ERR:%' or (t::jsonb ->> 'status') <> 'ok' then return 'A1 anon: ' || left(t, 120); end if;

  r := t::jsonb;
  if pg_temp.h116_keys(r) <> 'brackets,division,org,season,status,today' then return 'OK1 top keys: ' || pg_temp.h116_keys(r); end if;
  if jsonb_array_length(r -> 'brackets') <> 1 then return 'OK1 bracket count'; end if;
  b := r -> 'brackets' -> 0;
  if pg_temp.h116_keys(b) <> 'advance_count,format,games,id,show_scores,stage' then return 'OK1 bracket keys: ' || pg_temp.h116_keys(b); end if;
  for g in select * from jsonb_array_elements(b -> 'games') loop
    if pg_temp.h116_keys(g) <> 'away_score,away_team,game_number,home_score,home_team,id,round,scheduled_date,seed_away,seed_home,series_game,series_length,start_time,status,venue,winner_id' then
      return 'OK1 game keys: ' || pg_temp.h116_keys(g);
    end if;
    if g -> 'venue' <> 'null'::jsonb and pg_temp.h116_keys(g -> 'venue') <> 'location,name' then
      return 'OK1 venue keys: ' || pg_temp.h116_keys(g -> 'venue');
    end if;
  end loop;

  if jsonb_array_length(b -> 'games') <> 4 then return 'OK2 game count (not-needed included?): ' || jsonb_array_length(b -> 'games'); end if;
  if not exists (select 1 from jsonb_array_elements(b -> 'games') x
                  where x ->> 'home_score' = '7' and x ->> 'away_score' = '4' and x ->> 'winner_id' = t1::text) then
    return 'OK2 scores/winner missing';
  end if;
  if exists (select 1 from jsonb_array_elements(b -> 'games') x where x ->> 'round' = 'F' and x ->> 'series_length' <> '3') then
    return 'OK2 series length';
  end if;
  if b ->> 'show_scores' <> 'true' then return 'OK2 show_scores default'; end if;

  t := r::text;
  if t ~* '(zz116secret|ZZ116SECRETADDR|ZZ116SEEDING|ZZ116STAGE1CHANGES|contact|notes|seeding|stage1_changes|address|has_lights|lights)' then
    return 'OK3 private text leaked: ' || substring(t from '(?i)(zz116secret|ZZ116SECRETADDR|ZZ116SEEDING|ZZ116STAGE1CHANGES|contact|notes|seeding|stage1_changes|address|has_lights|lights)');
  end if;

  r := public.get_league_bracket_by_token(v_tok, d_ts);
  if r ->> 'status' <> 'ok' or jsonb_array_length(r -> 'brackets') <> 2
     or (r -> 'brackets' -> 0 ->> 'stage') <> '1' or (r -> 'brackets' -> 1 ->> 'stage') <> '2'
     or (r -> 'brackets' -> 1 ->> 'advance_count') <> '2'
     or (r -> 'brackets' -> 1 -> 'games' -> 0 ->> 'seed_home') <> '1' then
    return 'TS1 two-stage: ' || left(r::text, 200);
  end if;
  if r::text ~* '(ZZ116STAGE1CHANGES|stage1_changes)' then return 'OK3 stage1_changes leaked'; end if;

  -- ── setter ────────────────────────────────────────────────────────────────
  t := pg_temp.h116_as('authenticated', gen_random_uuid(), format('select public.set_playoff_public_scores(%L::uuid, false)::text', p_ts2));
  if t not like 'ERR:42501:not_authorized%' then return 'W1 non-member: ' || left(t, 120); end if;

  t := pg_temp.h116_as('anon', null, format('select public.set_playoff_public_scores(%L::uuid, false)::text', p_ts2));
  if t not like 'ERR:42501:permission denied%' then return 'W2 anon: ' || left(t, 120); end if;

  t := pg_temp.h116_as('authenticated', v_org, format('select public.set_playoff_public_scores(%L::uuid, false)::text', p_ts2));
  if t like 'ERR:%' or (t::jsonb ->> 'changed') <> 'true' then return 'W3 set off: ' || left(t, 160); end if;
  if (select count(*) from public.playoffs where id in (p_ts1, p_ts2) and not public_scores) <> 2 then
    return 'W3 both stages not off';
  end if;
  select count(*) into v_logs from public.activity_log where division_id = d_ts and event_type = 'playoff_public_scores_changed';
  if v_logs <> 1 then return 'W3 log rows: ' || v_logs; end if;

  r := public.get_league_bracket_by_token(v_tok, d_ts);
  if exists (select 1 from jsonb_array_elements(r -> 'brackets') bb, jsonb_array_elements(bb -> 'games') x
              where x -> 'home_score' <> 'null'::jsonb or x -> 'away_score' <> 'null'::jsonb) then
    return 'S1 a score left with scores off';
  end if;
  if (r -> 'brackets' -> 0 -> 'games' -> 0 ->> 'winner_id') is distinct from u1::text then return 'S1 winner dropped'; end if;
  if (r -> 'brackets' -> 0 ->> 'show_scores') <> 'false' then return 'S1 show_scores not false'; end if;
  r := public.get_league_bracket_by_token(v_tok, d_se);
  if not exists (select 1 from jsonb_array_elements(r -> 'brackets' -> 0 -> 'games') x where x ->> 'home_score' = '7') then
    return 'S1 another bracket lost its scores';
  end if;

  t := pg_temp.h116_as('authenticated', v_org, format('select public.set_playoff_public_scores(%L::uuid, false)::text', p_ts1));
  if t like 'ERR:%' or (t::jsonb ->> 'changed') <> 'false' then return 'W4 repeat: ' || left(t, 160); end if;
  if (select count(*) from public.activity_log where division_id = d_ts and event_type = 'playoff_public_scores_changed') <> 1 then
    return 'W4 repeat logged';
  end if;

  update public.profiles set plan = 'free' where id = v_org;
  t := pg_temp.h116_as('authenticated', v_org, format('select public.set_playoff_public_scores(%L::uuid, true)::text', p_ts1));
  update public.profiles set plan = 'elite' where id = v_org;
  if t not like 'ERR:P0001:plan_required%' then return 'W5 free: ' || left(t, 120); end if;

  return 'pass';
end;
$f$;

do $h$
declare
  v_mig text := $mig116$
-- @@MIGRATION_0116@@
$mig116$;
  v_fns text;
  v_out text := '';
  v_res text;
  v_mut text;
  v_cut int;
  m record;
begin
  execute v_mig;

  v_out := v_out || 'md5 set_playoff_public_scores ' || (select md5(prosrc) from pg_proc where proname = 'set_playoff_public_scores') || E'\n';
  v_out := v_out || 'md5 get_league_bracket_by_token ' || (select md5(prosrc) from pg_proc where proname = 'get_league_bracket_by_token') || E'\n';
  v_out := v_out || 'P1 ' || (select string_agg(f || ':' || r || '=' || has_function_privilege(r, f, 'EXECUTE'), ' ' order by f, r)
    from unnest(array['public.get_league_bracket_by_token(text, uuid)', 'public.set_playoff_public_scores(uuid, boolean)']) f,
         unnest(array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']) r) || E'\n';

  begin
    v_res := pg_temp.h116_case();
    raise exception 'H116CASE:%', v_res;
  exception when others then
    v_out := v_out || 'BASELINE ' || replace(sqlerrm, 'H116CASE:', '') || E'\n';
  end;

  -- Mutants re-run the FUNCTION part of the migration only (the ALTER has
  -- already run).
  v_cut := strpos(v_mig, '-- 2. set_playoff_public_scores');
  v_fns := substr(v_mig, v_cut);

  for m in select * from (values
    ('MU1', 'U1', $r1$     and l.owner_id = v_org_id
$r1$, $r1b$
$r1b$),
    ('MU2', 'S1', $r2$'home_score',     case when po.public_scores then pg.home_score else null end,$r2$, $r2b$'home_score',     pg.home_score,$r2b$),
    ('MU3', 'L1', $r3$  if not v_div.locked then$r3$, $r3b$  if false then$r3b$),
    ('MU4', 'D1', $r4$                and po.status <> 'draft' and po.format = 'double_elimination') then$r4$, $r4b$                and false) then$r4b$),
    ('MU5', 'N2', $r5$                    and po.status <> 'draft') then
    return jsonb_build_object('status', 'no_bracket'$r5$, $r5b$                    ) then
    return jsonb_build_object('status', 'no_bracket'$r5b$),
    ('MU6', 'OK2', $r6$                and pg.status <> 'not_needed'$r6$, $r6b$$r6b$),
    ('MU7', 'U2', $r7$     and l.archived_at is null
     and (l.end_date is null or v_today <= public.season_last_day(l.id) + 7);$r7$, $r7b$     and (l.end_date is null or v_today <= public.season_last_day(l.id) + 7);$r7b$),
    ('MU8', 'OK1', $r8$           'show_scores',   po.public_scores,$r8$, $r8b$           'show_scores',   po.public_scores,
           'seeding',       po.seeding,$r8b$),
    ('MU9', 'W3', $r9$   where (id = v_root or parent_playoff_id = v_root)
     and public_scores is distinct from p_show;$r9$, $r9b$   where id = p_playoff_id
     and public_scores is distinct from p_show;$r9b$),
    ('MU10', 'W1', $r10$  if not public.is_org_member(v_league.owner_id) then$r10$, $r10b$  if false then$r10b$),
    ('MU11', 'MIG', $r11$grant execute on function public.set_playoff_public_scores(uuid, boolean)
  to authenticated;$r11$, $r11b$grant execute on function public.set_playoff_public_scores(uuid, boolean)
  to authenticated, anon;$r11b$),
    ('MU12', 'U4', $r12$     and (l.end_date is null or v_today <= public.season_last_day(l.id) + 7);$r12$, $r12b$     ;$r12b$)
  ) as x(id, expect, find, repl)
  loop
    if (length(v_fns) - length(replace(v_fns, m.find, ''))) / length(m.find) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      begin
        execute replace(v_fns, m.find, m.repl);
      exception when others then
        raise exception 'H116CASE:MIG %', sqlerrm;
      end;
      v_res := pg_temp.h116_case();
      raise exception 'H116CASE:%', v_res;
    exception when others then
      v_mut := replace(sqlerrm, 'H116CASE:', '');
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED' when v_mut = 'pass' then 'SURVIVED' else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 160), m.expect);
    end;
  end loop;

  raise exception E'ROLLED BACK — 0116 proof\n%', v_out;
end $h$;

-- Leak check (run separately afterwards; every count must be 0 and both
-- function lookups null until 0116 is applied):
-- select (select count(*) from public.leagues where name like 'ZZ116%'),
--        (select count(*) from public.divisions where name like 'ZZ116%'),
--        (select count(*) from public.locations where name like 'ZZ116%'),
--        (select count(*) from public.public_schedule_links where org_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6'),
--        (select count(*) from information_schema.columns where table_name = 'playoffs' and column_name = 'public_scores'),
--        to_regprocedure('public.get_league_bracket_by_token(text, uuid)'),
--        to_regprocedure('public.set_playoff_public_scores(uuid, boolean)'),
--        (select plan from public.profiles where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6');

-- ── RUN LOG ──────────────────────────────────────────────────────────────────
-- 2026-10-20 — against production, "test" proof org (+ "Test 2" as the other
--   league), rolled back. FIRST RUN GREEN. md5(prosrc) printed:
--   set_playoff_public_scores 9ccc674a87e094870bf9b42ad47b8930,
--   get_league_bracket_by_token 368f441841a3baffe120e94a815d523c — both equal
--   to the repo file's bodies. P1: reader anon=true authenticated=true,
--   setter authenticated=true; every other role (public, service_role,
--   dashboard_readonly, and anon on the setter) false. BASELINE pass.
--   MU1 U1, MU2 S1, MU3 L1, MU4 D1, MU5 N2, MU6 OK2, MU7 U2, MU8 OK1, MU9 W3,
--   MU10 W1, MU11 MIG (the migration's own privilege check refused), MU12 U4 —
--   12/12 KILLED at their own tag. The batch carried the migration's
--   statements and function bodies verbatim with its long header comment
--   shortened (header comments are never stored; the md5s prove the bodies).
--   Leak check: 0 leagues/divisions/locations/teams named ZZ116, no link row
--   for "test", no public_scores column, both functions absent, "test" plan
--   still elite, 0 log rows, 0 temp functions. 0116 NOT applied.
-- 2026-10-21 05:05 UTC — 0116 APPLIED verbatim (catalog 20261021050508) on
--   Whit's go. md5(prosrc) 9ccc674a… / 368f4418… verified live, one overload
--   each; privileges per role as stated; 6 brackets + 23 games fingerprinted
--   before and after — identical apart from public_scores (true on all 6);
--   leak check clean (0 log rows, 0 temp functions, no ZZ116 rows, no "test"
--   link row).

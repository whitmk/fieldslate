-- Proof for 0124 (officials self-sign-up). Assembled by official-signup-build.ts,
-- which puts the LITERAL migration text where the placeholder is. It runs
-- BEFORE 0124 is applied: one transaction that the final RAISE always rolls
-- back; the migration is applied inside a rolled-back sub-run for the
-- baseline and again for every mutant. Fixtures in the "test" proof org
-- (bbf9afe1…, Elite) — never Santa Rosa American's data.
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/official-signup-build.ts
-- > proof.sql`, send it as ONE batch through the Supabase MCP, read the raised
-- message, then the leak check at the bottom. `--md5` prints the md5(prosrc)
-- each function must have after apply.
--
-- LOCKS for the run (seconds; lock_timeout 3s), the migration's own, held to
-- the end of each sub-run: SHARE ROW EXCLUSIVE on umpires, divisions, leagues,
-- profiles, game_umpires and games (new foreign keys — blocks WRITES to them,
-- not reads); ACCESS EXCLUSIVE on org_features (the CHECK swap) and on the five
-- new tables. The fixture writes take ROW EXCLUSIVE on leagues, divisions,
-- teams, games, umpires, official_* and game_umpires. L1 prints what is held.
--
-- Fixture (now = the org's wall clock):
--   season S, divisions D1 (locked, 2 per game), D2 (UNLOCKED, 1), D3 (locked, 1)
--   roles Plate (0), Base (1), Third (2) — D1's slots are Plate and Base only
--   games g1 D1 +5 days 10:00 · g2 D1 +5 days 10:30 (overlaps g1) · gU D2 +5 days
--         · g3 D3 +6 days · g47 D1 now+47h · g49 D1 now+49h · gP D1 yesterday
--   officials uA (email, adult) · uB (no email) · uC (youth, parent's email,
--             may work D3 only) · uX (blackout on g1's date)
--   uB holds g2 Base (made by the coordinator, not through a link)
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   OB1 the shared OFFICIAL-BLOCK-TABLE through official_block_reason
--   OK1 the page's keys: no other official's name or contact anywhere
--   OG1 a link that doesn't work says only "unknown": bad, revoked, switch
--       off, setting off, a Pro league, an archived season
--   OS1 open spots: LOCKED divisions, scheduled games not started, slots
--       nobody holds, the official's divisions only; a problem is their own
--   OC1 claim: written as an ordinary game_umpires row + a self-claim mark +
--       a confirmation; the same slot again is refused; unpublished, started,
--       a non-slot role and a blackout are refused with nothing written
--   OD1 drop: a self-claim more than 48 hours out goes (both emails queued);
--       inside 48 hours, or an assignment the coordinator made, is refused
--       with the contact email and nothing deleted
--   OL1 "Copy new link": the old link stops working, the new one works
--   OH1 help request: no email and emailed-in-24h skipped by name, a fresh
--       link per email, signup off refused
--   OA1 insert_official_assignments: writes rows that fit, returns the rest as
--       skipped (slot taken meanwhile, a blackout), a non-member refused
--   OV1 set_official_divisions: a division of another season refused; [] = all
--   OX1 take: the help email carries the link and only open spots; no token
--       in the payload; the coordinator gets the drop notice; finish strips
--       the token
--   OW1 archiving wipes links, self-claim marks and the outbox; assignments stay
--   OP1 privileges per role; RLS on the five tables
-- Mutants (each must die at its own tag):
--   MO1  the division rule dropped                         → OB1
--   MO2  a window may end a minute late                   → OB1
--   MO3  the weekly cap counts every week                 → OB1
--   MO4  a claim in an UNLOCKED division                  → OS1
--   MO5  a claim on a started game                        → OC1
--   MO6  drops allowed up to 24 hours before              → OD1
--   MO7  a coordinator's assignment can be dropped        → OD1
--   MO8  a help email to an official with no email        → OH1
--   MO9  the 24-hour help limit gone                      → OH1
--   MO10 a revoked link still works                       → OL1
--   MO11 insert_official_assignments re-checks nothing    → OA1
--   MO12 the take hands out the token in the payload      → OX1
--   MO13 the wipe keeps the self-claim marks              → OW1
--   MO14 the page names the other officials on a game     → OK1
--   MO15 the claim callable by anon                       → OP1
--   MO16 open spots ignore the official's divisions       → OS1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '180s', true);

create or replace function pg_temp.h124_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;

create or replace function pg_temp.h124_call(p_sub uuid, p_role text, p_sql text) returns jsonb language plpgsql as $f$
declare v text;
begin
  v := pg_temp.h124_as(p_sub, p_role, p_sql);
  if v is null then return 'null'::jsonb; end if;
  if v like 'ERR%' then return jsonb_build_object('error', v); end if;
  return v::jsonb;
end;
$f$;

-- 'a|b' → '{a,b}'; '' → '{}'
create or replace function pg_temp.h124_list(p text) returns text[] language sql as $f$
  select coalesce(string_to_array(nullif(p, ''), '|'), '{}'::text[]);
$f$;

create or replace function pg_temp.h124_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_other uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';  -- a real profile, not a member of "test"
  v_now   timestamp;
  v_s  uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); dX uuid := gen_random_uuid();
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid(); tC uuid := gen_random_uuid(); tD uuid := gen_random_uuid();
  tE uuid := gen_random_uuid(); tF uuid := gen_random_uuid(); tX uuid := gen_random_uuid();
  g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); gU uuid := gen_random_uuid(); g3 uuid := gen_random_uuid();
  g47 uuid := gen_random_uuid(); g49 uuid := gen_random_uuid(); gP uuid := gen_random_uuid();
  rPl uuid := gen_random_uuid(); rBa uuid := gen_random_uuid(); rTh uuid := gen_random_uuid();
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); uC uuid := gen_random_uuid(); uX uuid := gen_random_uuid();
  guB uuid := gen_random_uuid();
  tokA text; tokC text; tokOld text; tokNew text;
  j jsonb; k jsonb; r record; v_r text; v_n integer; v_gu uuid; v_id bigint; f text; p text;
  v_g1day date;
begin
  -- ── OB1 — the shared table (no fixture needed) ──────────────────────────
  for r in
    select * from (values
-- OFFICIAL-BLOCK-TABLE-BEGIN
  ('B01', false, true,  '',           false, false, '2026-10-10T09:00', 90, '',                          '',                              null, null),
  ('B02', true,  true,  '2026-10-10', false, false, '2026-10-10T09:00', 90, '',                          '',                              null, 'already_on_game'),
  ('B03', false, false, '',           false, false, '2026-10-10T09:00', 90, '',                          '',                              null, 'division_not_allowed'),
  ('B04', false, true,  '2026-10-10', false, false, '2026-10-10T09:00', 90, '',                          '',                              null, 'blackout'),
  ('B05', false, true,  '2026-10-11', false, false, '2026-10-10T09:00', 90, '',                          '',                              null, null),
  ('B06', false, true,  '',           true,  false, '2026-10-10T09:00', 90, '',                          '',                              null, 'coach_conflict'),
  ('B07', false, true,  '',           false, true,  '2026-10-10T09:00', 90, '',                          '',                              null, 'conflict_of_interest'),
  ('B08', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-10T08:00/90',       '',                              null, 'time_conflict'),
  ('B09', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-10T07:30/90',       '',                              null, null),
  ('B10', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-10T10:30/60',       '',                              null, null),
  ('B11', false, true,  '',           false, false, '2026-10-10T09:00', 90, '',                          'Sa/09:00/10:30',                null, null),
  ('B12', false, true,  '',           false, false, '2026-10-10T09:00', 90, '',                          'Sa/09:00/10:29',                null, 'outside_availability'),
  ('B13', false, true,  '',           false, false, '2026-10-10T09:00', 90, '',                          'Sa/09:01/12:00',                null, 'outside_availability'),
  ('B14', false, true,  '',           false, false, '2026-10-10T09:00', 90, '',                          'Su/08:00/12:00',                null, 'outside_availability'),
  ('B15', false, true,  '',           false, false, '2026-10-10T09:00', 90, '',                          'Fr/08:00/12:00|Sa/08:00/12:00', null, null),
  ('B16', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-05T18:00/90',       '',                              1,    'over_weekly_limit'),
  ('B17', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-04T18:00/90',       '',                              1,    null),
  ('B18', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-05T18:00/90',       '',                              2,    null),
  ('B19', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-05T18:00/90',       '',                              0,    null),
  ('B20', false, true,  '',           false, false, '2026-10-11T23:30', 90, '',                          'Su/23:00/23:59',                null, 'outside_availability'),
  ('B21', false, true,  '',           false, false, '2026-10-12T00:30', 90, '2026-10-11T22:00/90',       '',                              1,    null),
  ('B22', false, true,  '',           false, false, '2026-10-11T23:30', 90, '2026-10-05T10:00/90',       '',                              1,    'over_weekly_limit'),
  ('B23', false, true,  '2026-10-10', true,  false, '2026-10-10T09:00', 90, '',                          '',                              null, 'blackout'),
  ('B24', false, true,  '',           true,  false, '2026-10-10T09:00', 90, '2026-10-10T08:00/90',       '',                              null, 'coach_conflict'),
  ('B25', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-05T18:00/90',       'Su/08:00/12:00',                1,    'outside_availability'),
  ('B26', false, false, '2026-10-10', false, false, '2026-10-10T09:00', 90, '',                          '',                              null, 'division_not_allowed'),
  ('B27', false, true,  '',           false, true,  '2026-10-10T09:00', 90, '2026-10-10T08:00/90',       '',                              null, 'conflict_of_interest')
-- OFFICIAL-BLOCK-TABLE-END
    ) as x(id, on_game, allowed, blackouts, coaches, coi, start_at, minutes, bookings, windows, cap, expected)
  loop
    v_r := public.official_block_reason(
      r.on_game, r.allowed, pg_temp.h124_list(r.blackouts)::date[], r.coaches, r.coi,
      r.start_at::timestamp, r.minutes,
      (select coalesce(jsonb_agg(jsonb_build_object('start', split_part(b, '/', 1), 'minutes', split_part(b, '/', 2)::integer)), '[]'::jsonb)
         from unnest(pg_temp.h124_list(r.bookings)) b),
      (select coalesce(jsonb_agg(jsonb_build_object('day', split_part(w, '/', 1), 'start', split_part(w, '/', 2), 'end', split_part(w, '/', 3))), '[]'::jsonb)
         from unnest(pg_temp.h124_list(r.windows)) w),
      r.cap);
    if v_r is distinct from r.expected then
      return format('OB1 %s: want %s, got %s', r.id, coalesce(r.expected, 'null'), coalesce(v_r, 'null'));
    end if;
  end loop;

  -- ── Fixture ─────────────────────────────────────────────────────────────
  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'official_signup', true)
    on conflict (owner_id, feature) do update set enabled = true;
  insert into public.official_signup_settings (owner_id, enabled, contact_email)
    values (v_org, true, 'umpires@zz124.test')
    on conflict (owner_id) do update set enabled = true, contact_email = excluded.contact_email;
  v_now := public.official_org_now(v_org);

  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (v_s,  'ZZ124 Season', 'Baseball', 'Fall', v_org, v_now::date - 20, v_now::date + 30),
    (v_s2, 'ZZ124 Other',  'Baseball', 'Fall', v_org, v_now::date - 20, v_now::date + 30);
  insert into public.divisions (id, league_id, name, settings, umpires_per_game) values
    (d1, v_s, 'ZZ Majors', '{"game_duration": 90}', 2),
    (d2, v_s, 'ZZ Minors', '{"game_duration": 90}', 1),
    (d3, v_s, 'ZZ AAA',    '{"game_duration": 90}', 1),
    (dX, v_s2, 'ZZ Other', '{}', 1);
  insert into public.teams (id, league_id, division_id, name) values
    (tA, v_s, d1, 'ZZ Expos'), (tB, v_s, d1, 'ZZ Pirates'), (tC, v_s, d2, 'ZZ Owls'), (tD, v_s, d2, 'ZZ Hawks'),
    (tE, v_s, d3, 'ZZ Bears'), (tF, v_s, d3, 'ZZ Lions'), (tX, v_s2, dX, 'ZZ Other Team');
  v_g1day := v_now::date + 5;
  insert into public.games (id, league_id, home_team_id, away_team_id, scheduled_at, status) values
    (g1,  v_s, tA, tB, (v_g1day + time '10:00') at time zone 'UTC', 'scheduled'),
    (g2,  v_s, tB, tA, (v_g1day + time '10:30') at time zone 'UTC', 'scheduled'),
    (gU,  v_s, tC, tD, (v_g1day + time '14:00') at time zone 'UTC', 'scheduled'),
    (g3,  v_s, tE, tF, ((v_now::date + 6) + time '10:00') at time zone 'UTC', 'scheduled'),
    (g47, v_s, tA, tB, date_trunc('minute', v_now + interval '47 hours') at time zone 'UTC', 'scheduled'),
    (g49, v_s, tA, tB, date_trunc('minute', v_now + interval '49 hours') at time zone 'UTC', 'scheduled'),
    (gP,  v_s, tA, tB, ((v_now::date - 1) + time '10:00') at time zone 'UTC', 'scheduled');
  update public.divisions set locked = true where id in (d1, d3, dX);
  insert into public.official_roles (id, season_id, name, sort_order) values
    (rPl, v_s, 'ZZ Plate', 0), (rBa, v_s, 'ZZ Base', 1), (rTh, v_s, 'ZZ Third', 2);
  insert into public.umpires (id, season_id, name, designation, email) values
    (uA, v_s, 'ZZ Ann Ump', 'adult', 'ann@zz124.test'),
    (uB, v_s, 'ZZ Ben Ump', 'adult', null),
    (uC, v_s, 'ZZ Cal Kid', 'youth', 'parent@zz124.test'),
    (uX, v_s, 'ZZ Xia Ump', 'adult', 'xia@zz124.test');
  insert into public.official_blackouts (umpire_id, date) values (uX, v_g1day);
  insert into public.official_divisions (umpire_id, division_id) values (uC, d3);
  insert into public.game_umpires (id, game_id, umpire_id, role) values (guB, g2, uB, 'ZZ Base');
  -- Links, minted the way the app does (as the admin) — read back below.
  j := pg_temp.h124_call(v_org, 'authenticated', format('select public.official_issue_link(%L)::text', uA));
  tokA := j ->> 'token';
  if tokA is null then return 'OL1 issue_link for uA: ' || j::text; end if;
  tokC := (pg_temp.h124_call(v_org, 'authenticated', format('select public.official_issue_link(%L)::text', uC))) ->> 'token';

  -- ── OK1 — the page's keys ───────────────────────────────────────────────
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokA));
  if j ->> 'status' is distinct from 'ok' then return 'OK1 page status: ' || left(j::text, 200); end if;
  if (select array_agg(x order by x) from jsonb_object_keys(j) x)
     <> array['contact_email', 'league_name', 'mine', 'now', 'official', 'open', 'season_name', 'status'] then
    return 'OK1 page keys: ' || (select string_agg(x, ',' order by x) from jsonb_object_keys(j) x);
  end if;
  for k in select e from jsonb_array_elements(j -> 'open') e loop
    if (select array_agg(x order by x) from jsonb_object_keys(k) x)
       <> array['away', 'division', 'field', 'game_id', 'home', 'minutes', 'problem', 'role', 'role_id', 'start'] then
      return 'OK1 open spot keys: ' || (select string_agg(x, ',' order by x) from jsonb_object_keys(k) x);
    end if;
  end loop;
  if j::text like '%ZZ Ben Ump%' or j::text like '%ZZ Xia Ump%' or j::text like '%ann@zz124%' then
    return 'OK1 the page names another official or an email: ' || left(j::text, 300);
  end if;

  -- ── OG1 — a link that doesn't work ──────────────────────────────────────
  if (pg_temp.h124_call(null, 'service_role', $q$select public.official_signup_page('nope')::text$q$)) ->> 'status' <> 'unknown' then
    return 'OG1 a malformed token';
  end if;
  update public.official_signup_settings set enabled = false where owner_id = v_org;
  if (pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokA))) ->> 'status' <> 'unknown' then
    return 'OG1 setting off still works';
  end if;
  update public.official_signup_settings set enabled = true where owner_id = v_org;
  update public.org_features set enabled = false where owner_id = v_org and feature = 'official_signup';
  if (pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokA))) ->> 'status' <> 'unknown' then
    return 'OG1 switch off still works';
  end if;
  update public.org_features set enabled = true where owner_id = v_org and feature = 'official_signup';
  update public.profiles set plan = 'pro' where id = v_org;
  v_r := (pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokA))) ->> 'status';
  update public.profiles set plan = 'elite' where id = v_org;
  if v_r <> 'unknown' then return 'OG1 a Pro league still works'; end if;

  -- ── OS1 — open spots ────────────────────────────────────────────────────
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokA));
  -- g1: Plate and Base, both open; g2: Plate open (Base held by uB); gU never
  -- (unlocked); gP never (past); g3: Plate; g47, g49: Plate and Base. Third
  -- never (D1 has two slots).
  if exists (select 1 from jsonb_array_elements(j -> 'open') e where (e ->> 'game_id')::uuid in (gU, gP)) then
    return 'OS1 an unlocked or past game is offered';
  end if;
  if exists (select 1 from jsonb_array_elements(j -> 'open') e where e ->> 'role' = 'ZZ Third') then
    return 'OS1 a role beyond the division''s slots is offered';
  end if;
  if exists (select 1 from jsonb_array_elements(j -> 'open') e where (e ->> 'game_id')::uuid = g2 and e ->> 'role' = 'ZZ Base') then
    return 'OS1 a slot someone holds is offered';
  end if;
  if (select count(*) from jsonb_array_elements(j -> 'open') e where (e ->> 'game_id')::uuid in (g1, g2, g3, g47, g49)) <> 8 then
    return 'OS1 uA should see 8 open slots: ' || (select count(*) from jsonb_array_elements(j -> 'open') e)::text;
  end if;
  -- uC may work D3 only.
  k := pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokC));
  if exists (select 1 from jsonb_array_elements(k -> 'open') e where (e ->> 'game_id')::uuid <> g3) then
    return 'OS1 uC is offered a division outside their list';
  end if;
  if (k -> 'official' ->> 'youth')::boolean is distinct from true then return 'OS1 youth flag'; end if;

  -- ── OC1 — claim ─────────────────────────────────────────────────────────
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_claim(%L, %L, %L)::text', tokA, g1, rPl));
  if j ->> 'status' <> 'claimed' then return 'OC1 claim g1 Plate: ' || j::text; end if;
  v_gu := (j ->> 'game_umpire_id')::uuid;
  if not exists (select 1 from public.game_umpires where id = v_gu and game_id = g1 and umpire_id = uA and role = 'ZZ Plate' and role_id = rPl)
     or not exists (select 1 from public.official_self_claims where game_umpire_id = v_gu and umpire_id = uA and season_id = v_s)
     or not exists (select 1 from public.official_outbox where umpire_id = uA and kind = 'claim_confirmed' and payload ->> 'game_id' = g1::text) then
    return 'OC1 the claim did not write row + mark + confirmation';
  end if;
  -- uA is now on g1 → g2 (overlapping) is a time conflict for them.
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_claim(%L, %L, %L)::text', tokA, g2, rPl));
  if j ->> 'status' <> 'time_conflict' then return 'OC1 overlapping claim: ' || j::text; end if;
  v_n := (select count(*) from public.game_umpires where game_id = g1);
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_claim(%L, %L, %L)::text', tokC, g1, rPl));
  if j ->> 'status' not in ('slot_taken', 'division_not_allowed') then return 'OC1 a held slot: ' || j::text; end if;
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_claim(%L, %L, %L)::text', tokA, gU, rPl));
  if j ->> 'status' <> 'unpublished' then return 'OC1 unlocked division: ' || j::text; end if;
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_claim(%L, %L, %L)::text', tokA, gP, rPl));
  if j ->> 'status' <> 'started' then return 'OC1 a past game: ' || j::text; end if;
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_claim(%L, %L, %L)::text', tokA, g3, rTh));
  if j ->> 'status' <> 'no_slot' then return 'OC1 a role that isn''t a slot: ' || j::text; end if;
  if (select count(*) from public.game_umpires where game_id in (gU, gP, g3, g2) and umpire_id = uA) <> 0
     or (select count(*) from public.game_umpires where game_id = g1) <> v_n then
    return 'OC1 a refused claim wrote something';
  end if;

  -- ── OD1 — drop ──────────────────────────────────────────────────────────
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_claim(%L, %L, %L)::text', tokA, g47, rPl));
  if j ->> 'status' <> 'claimed' then return 'OD1 setup claim g47: ' || j::text; end if;
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_drop(%L, %L)::text', tokA, (j ->> 'game_umpire_id')));
  if j ->> 'status' <> 'change_closed' or j ->> 'contact_email' <> 'umpires@zz124.test' then
    return 'OD1 inside 48 hours: ' || j::text;
  end if;
  if not exists (select 1 from public.game_umpires where game_id = g47 and umpire_id = uA) then
    return 'OD1 a refused drop deleted the assignment';
  end if;
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_claim(%L, %L, %L)::text', tokA, g49, rPl));
  if j ->> 'status' <> 'claimed' then return 'OD1 setup claim g49: ' || j::text; end if;
  v_gu := (j ->> 'game_umpire_id')::uuid;
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_drop(%L, %L)::text', tokA, v_gu));
  if j ->> 'status' <> 'dropped' or exists (select 1 from public.game_umpires where id = v_gu)
     or (select count(*) from public.official_outbox where umpire_id = uA and kind in ('drop_confirmed', 'drop_notice')
           and payload ->> 'game_id' = g49::text) <> 2 then
    return 'OD1 a drop 49 hours out: ' || j::text;
  end if;
  -- uB's coordinator-made assignment can't be dropped through uB's link.
  tokOld := (pg_temp.h124_call(v_org, 'authenticated', format('select public.official_issue_link(%L)::text', uB))) ->> 'token';
  j := pg_temp.h124_call(null, 'service_role', format('select public.official_drop(%L, %L)::text', tokOld, guB));
  if j ->> 'status' <> 'not_self_claimed' or not exists (select 1 from public.game_umpires where id = guB) then
    return 'OD1 a coordinator''s assignment: ' || j::text;
  end if;

  -- ── OL1 — Copy new link ─────────────────────────────────────────────────
  tokNew := (pg_temp.h124_call(v_org, 'authenticated', format('select public.official_issue_link(%L)::text', uB))) ->> 'token';
  if (pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokOld))) ->> 'status' <> 'unknown' then
    return 'OL1 the old link still works';
  end if;
  if (pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokNew))) ->> 'status' <> 'ok' then
    return 'OL1 the new link doesn''t work';
  end if;
  if (select count(*) from public.official_signup_links where umpire_id = uB and revoked_at is null) <> 1 then
    return 'OL1 more than one current link';
  end if;

  -- ── OH1 — help request ──────────────────────────────────────────────────
  j := pg_temp.h124_call(v_org, 'authenticated', format('select public.send_official_help_request(%L, array[%L, %L, %L]::uuid[])::text', v_s, uA, uB, uX));
  if (j ->> 'queued')::int is distinct from 2
     or not exists (select 1 from jsonb_array_elements(j -> 'skipped') e where (e ->> 'umpire_id')::uuid = uB and e ->> 'reason' = 'no_email') then
    return 'OH1 first request: ' || j::text;
  end if;
  if (select count(*) from public.official_outbox where kind = 'help_request' and umpire_id in (uA, uX) and payload ? 'token') <> 2 then
    return 'OH1 the help emails carry no token';
  end if;
  -- uA's link from before the help email no longer works (a fresh one went out).
  if (pg_temp.h124_call(null, 'service_role', format('select public.official_signup_page(%L)::text', tokA))) ->> 'status' <> 'unknown' then
    return 'OH1 the old link survived the help email';
  end if;
  j := pg_temp.h124_call(v_org, 'authenticated', format('select public.send_official_help_request(%L, array[%L]::uuid[])::text', v_s, uA));
  if (j ->> 'queued')::int <> 0 or not exists (select 1 from jsonb_array_elements(j -> 'skipped') e where e ->> 'reason' = 'recent') then
    return 'OH1 a second request inside 24 hours: ' || j::text;
  end if;
  update public.official_signup_settings set enabled = false where owner_id = v_org;
  j := pg_temp.h124_call(v_org, 'authenticated', format('select public.send_official_help_request(%L, array[%L]::uuid[])::text', v_s, uX));
  update public.official_signup_settings set enabled = true where owner_id = v_org;
  if coalesce(j ->> 'error', '') not like '%signup_off%' then return 'OH1 sign-up off: ' || j::text; end if;
  j := pg_temp.h124_call(v_other, 'authenticated', format('select public.send_official_help_request(%L, array[%L]::uuid[])::text', v_s, uX));
  if coalesce(j ->> 'error', '') not like '%not_authorized%' then return 'OH1 a non-member: ' || j::text; end if;

  -- ── OA1 — insert_official_assignments ───────────────────────────────────
  j := pg_temp.h124_call(v_org, 'authenticated', format(
    'select public.insert_official_assignments(%L, %L::jsonb)::text', v_s,
    jsonb_build_array(
      jsonb_build_object('game_id', g3, 'umpire_id', uB, 'role', 'ZZ Plate', 'role_id', rPl),   -- fits
      jsonb_build_object('game_id', g1, 'umpire_id', uB, 'role', 'ZZ Plate', 'role_id', rPl),   -- uA holds g1 Plate
      jsonb_build_object('game_id', g1, 'umpire_id', uX, 'role', 'ZZ Base',  'role_id', rBa)    -- uX blacked out
    )));
  if (j ->> 'inserted')::int is distinct from 1
     or (select string_agg(e ->> 'reason', ',' order by e ->> 'reason') from jsonb_array_elements(j -> 'skipped') e) <> 'blackout,slot_taken'
     or not exists (select 1 from public.game_umpires where game_id = g3 and umpire_id = uB)
     or exists (select 1 from public.game_umpires where game_id = g1 and umpire_id in (uB, uX)) then
    return 'OA1 ' || j::text;
  end if;
  j := pg_temp.h124_call(v_other, 'authenticated', format(
    'select public.insert_official_assignments(%L, %L::jsonb)::text', v_s,
    jsonb_build_array(jsonb_build_object('game_id', g49, 'umpire_id', uX, 'role', 'ZZ Base', 'role_id', rBa))));
  if coalesce(j ->> 'error', '') not like '%not_authorized%' then return 'OA1 a non-member: ' || j::text; end if;

  -- ── OV1 — set_official_divisions ────────────────────────────────────────
  j := pg_temp.h124_call(v_org, 'authenticated', format('select public.set_official_divisions(%L, array[%L]::uuid[])::text', uX, dX));
  if coalesce(j ->> 'error', '') not like '%division_not_in_season%' then return 'OV1 another season''s division: ' || j::text; end if;
  j := pg_temp.h124_call(v_org, 'authenticated', format('select public.set_official_divisions(%L, %L::uuid[])::text', uC, '{}'));
  if exists (select 1 from public.official_divisions where umpire_id = uC) then return 'OV1 [] left a list'; end if;

  -- ── OX1 — the drain's take ──────────────────────────────────────────────
  update public.official_outbox set next_attempt_at = now() - interval '1 minute' where season_id = v_s;
  j := pg_temp.h124_call(null, 'service_role', 'select public.official_outbox_take(100)::text');
  if exists (select 1 from jsonb_array_elements(j) e where e -> 'payload' ? 'token') then
    return 'OX1 a token in the taken payload';
  end if;
  k := (select e from jsonb_array_elements(j) e where e ->> 'kind' = 'help_request' and e ->> 'to' = 'xia@zz124.test');
  if k is null or coalesce(k ->> 'link_token', '') !~ '^[0-9a-f]{64}$'
     or exists (select 1 from jsonb_array_elements(k -> 'spots') s where s -> 'problem' <> 'null'::jsonb) then
    return 'OX1 the help email: ' || left(coalesce(k::text, 'missing'), 300);
  end if;
  if not exists (select 1 from jsonb_array_elements(j) e where e ->> 'kind' = 'drop_notice' and e ->> 'to' = 'umpires@zz124.test'
                   and e ->> 'official_name' = 'ZZ Ann Ump') then
    return 'OX1 the drop notice did not go to the officials contact';
  end if;
  v_id := (k ->> 'id')::bigint;
  perform pg_temp.h124_call(null, 'service_role', format('select public.official_outbox_finish(%s, true, %L, null, false)::text', v_id, 'resend-1'));
  if exists (select 1 from public.official_outbox where id = v_id and (status <> 'sent' or payload ? 'token')) then
    return 'OX1 finish kept the token';
  end if;

  -- ── OW1 — archive ───────────────────────────────────────────────────────
  v_n := (select count(*) from public.game_umpires gu join public.games g on g.id = gu.game_id where g.league_id = v_s);
  update public.leagues set archived_at = now() where id = v_s;
  if exists (select 1 from public.official_signup_links where season_id = v_s)
     or exists (select 1 from public.official_self_claims where season_id = v_s)
     or exists (select 1 from public.official_outbox where season_id = v_s) then
    return 'OW1 archiving left sign-up records';
  end if;
  if (select count(*) from public.game_umpires gu join public.games g on g.id = gu.game_id where g.league_id = v_s) <> v_n then
    return 'OW1 archiving touched assignments';
  end if;

  -- ── OP1 — privileges ────────────────────────────────────────────────────
  foreach f in array array['public.official_signup_page(text)', 'public.official_claim(text, uuid, uuid)', 'public.official_drop(text, uuid)'] loop
    foreach p in array array['anon', 'authenticated', 'dashboard_readonly'] loop
      if has_function_privilege(p, f, 'EXECUTE') then return format('OP1 %s can execute %s', p, f); end if;
    end loop;
  end loop;
  foreach f in array array['public.insert_official_assignments(uuid, jsonb)', 'public.send_official_help_request(uuid, uuid[])',
                           'public.official_issue_link(uuid)'] loop
    foreach p in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(p, f, 'EXECUTE') then return format('OP1 %s can execute %s', p, f); end if;
    end loop;
  end loop;
  foreach f in array array['official_divisions', 'official_signup_settings', 'official_signup_links', 'official_self_claims', 'official_outbox'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || f)::regclass) then return 'OP1 RLS off on ' || f; end if;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('authenticated', 'public.' || f, p) then return format('OP1 authenticated holds %s on %s', p, f); end if;
    end loop;
  end loop;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig124$
-- @@MIGRATION_0124@@
$mig124$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\n';
  m       record;
begin
  -- Mutants run without the migration's verify block (a grant mutant would
  -- otherwise die in the verify, not at its own assertion — 0120's rule).
  if strpos(v_body, '-- 9. Verify') = 0 then raise exception 'harness: verify marker not found in 0124'; end if;
  v_nover := split_part(v_body, '-- 9. Verify', 1);

  begin
    execute v_body;
    v_res := pg_temp.h124_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || 'md5(prosrc) ' || (
      select string_agg(p.proname || '=' || md5(p.prosrc), ', ' order by p.proname)
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and (p.proname like 'official\_%' or p.proname in ('set_official_signup_contact', 'set_official_signup_enabled',
              'set_official_divisions', 'send_official_help_request', 'insert_official_assignments',
              'wipe_official_signup_on_archive'))) || E'\n';
    v_out := v_out || 'L1 locks held: ' || (
      select coalesce(string_agg(distinct c.relname || '=' || l.mode, ', '), 'none')
        from pg_locks l join pg_class c on c.oid = l.relation
       where l.pid = pg_backend_pid() and l.granted and c.relkind = 'r'
         and c.relnamespace = 'public'::regnamespace) || E'\n';
    raise exception 'H124ROLLBACK';
  exception when others then
    if sqlerrm <> 'H124ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('MO1', 'OB1', $r$    when not coalesce(p_division_allowed, true) then 'division_not_allowed'
$r$, $r$$r$),
    ('MO2', 'OB1', $r$         and extract(hour from p_start) * 60 + extract(minute from p_start) + p_minutes
             <= extract(hour from (w ->> 'end')::time) * 60 + extract(minute from (w ->> 'end')::time)$r$,
                   $r$         and extract(hour from p_start) * 60 + extract(minute from p_start) + p_minutes
             <= extract(hour from (w ->> 'end')::time) * 60 + extract(minute from (w ->> 'end')::time) + 1$r$),
    ('MO3', 'OB1', $r$       where date_trunc('week', (b ->> 'start')::timestamp) = date_trunc('week', p_start)$r$,
                   $r$       where true$r$),
    ('MO4', 'OS1', $r$      join public.divisions d on d.id = t.division_id and d.locked and d.umpires_per_game > 0$r$,
                   $r$      join public.divisions d on d.id = t.division_id and d.umpires_per_game > 0$r$),
    ('MO5', 'OC1', $r$    if v_start <= public.official_org_now(v_owner) then return 'started'; end if;$r$, $r$$r$),
    ('MO6', 'OD1', $r$  if not (v_start - public.official_org_now(v_owner) > interval '48 hours') then$r$,
                   $r$  if not (v_start - public.official_org_now(v_owner) > interval '24 hours') then$r$),
    ('MO7', 'OD1', $r$  if not v_self then
    return jsonb_build_object('status', 'not_self_claimed', 'contact_email', v_contact);
  end if;$r$, $r$$r$),
    ('MO8', 'OH1', $r$    if not public.official_email_ok(u.email) then$r$, $r$    if false then$r$),
    ('MO9', 'OH1', $r$                     and o.status <> 'failed' and o.created_at > now() - interval '24 hours') then$r$,
                   $r$                     and false) then$r$),
    ('MO10', 'OL1', $r$     and k.revoked_at is null
     and public.org_feature_on(l.owner_id, 'official_signup');$r$,
                    $r$     and public.org_feature_on(l.owner_id, 'official_signup');$r$),
    ('MO11', 'OA1', $r$    v_problem := public.official_slot_problem(r.umpire_id, r.game_id, r.role, false);$r$,
                    $r$    v_problem := null;$r$),
    ('MO12', 'OX1', $r$           'payload', t.payload - 'token',$r$, $r$           'payload', t.payload,$r$),
    ('MO13', 'OW1', $r$  delete from public.official_self_claims  where season_id = new.id;
$r$, $r$$r$),
    ('MO14', 'OK1', $r$           'role', p_role)$r$,
                    $r$           'role', p_role,
           'officials', (select jsonb_agg(u.name) from public.game_umpires gu join public.umpires u on u.id = gu.umpire_id where gu.game_id = g.id))$r$),
    ('MO15', 'OP1', $r$grant execute on function public.official_claim(text, uuid, uuid)          to service_role;$r$,
                    $r$grant execute on function public.official_claim(text, uuid, uuid)          to service_role, anon;$r$),
    ('MO16', 'OS1', $r$       and (not exists (select 1 from public.official_divisions od where od.umpire_id = u.id)
            or exists (select 1 from public.official_divisions od where od.umpire_id = u.id and od.division_id = d.id))$r$,
                    $r$       and true$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h124_case();
      raise exception 'H124CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H124CASE:%' then replace(sqlerrm, 'H124CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0124 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_class where relname in ('official_divisions', 'official_signup_settings',
--      'official_signup_links', 'official_self_claims', 'official_outbox')) as new_tables_must_be_0,
--   (select count(*) from pg_proc where proname like 'official\_%' or proname in ('set_official_divisions',
--      'send_official_help_request', 'insert_official_assignments', 'wipe_official_signup_on_archive')) as new_functions_must_be_0,
--   (select pg_get_constraintdef(oid) from pg_constraint where conname = 'org_features_feature_check') as check_must_be_volunteers_only,
--   (select count(*) from leagues where name like 'ZZ124%') as fixture_leagues_must_be_0,
--   (select count(*) from umpires where name like 'ZZ %Ump%' or name = 'ZZ Cal Kid') as fixture_officials_must_be_0,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- 2026-11-09, against production, rolled back, on Whit's go (sent as a
-- comment-stripped copy — harness only; the migration byte-exact).
--   Run 1 — GREEN: baseline pass; 16/16 KILLED at their own tag; md5(prosrc)
--     of all 25 functions = `official-signup-build.ts --md5`. Locks held (L1),
--     the migration's own: SHARE ROW EXCLUSIVE on divisions, game_umpires,
--     leagues, profiles, umpires (new foreign keys / the trigger); ACCESS
--     EXCLUSIVE on org_features (the CHECK swap) and the five new tables;
--     the rest were the fixture's row locks. NOTE: the migration header also
--     names `games` — no 0124 key references games; it was row-locked only.
--   Leak check after the run: identical to the pre-run snapshot (no new
--     tables or functions, CHECK = volunteers only, no ZZ124 fixtures,
--     game_umpires md5 6d579ac5… unchanged, org_features unchanged, test org
--     still Elite, no idle transaction).
--   Applied right after (verbatim, apply_migration): catalog 20261109225744;
--     its verify block passed; md5s, EXECUTE per role, RLS, table grants and
--     the trigger checked live.
--   GAP FOUND LIVE (2026-11-09, after the apply): turning sign-up on from
--     Settings always failed (CHECK official_signup_settings_contact_when_on).
--     This proof's fixture wrote the settings row directly and never called
--     set_official_signup_enabled, so the upsert's proposed row (no contact)
--     was never exercised. Fixed by 0125; its proof
--     (official-signup-enable-sim.sql) calls contact and enable separately.

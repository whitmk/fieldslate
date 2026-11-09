-- Proof for 0122 (volunteer sign-ups: snack shack shifts). Assembled by
-- volunteer-snack-build.ts, which puts the LITERAL migration text where the
-- placeholder is. It runs BEFORE 0122 is applied: one transaction that the
-- final RAISE always rolls back, and the migration itself is applied inside a
-- rolled-back sub-run for the baseline and again for every mutant. Fixtures
-- in the "test" proof org (bbf9afe1…, Elite) — never Santa Rosa American's
-- data. The 0119 proof (R-, N-, H-series) re-runs against 0122 separately:
-- `volunteer-snack-build.ts regress0119`.
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/volunteer-snack-build.ts
-- > proof.sql`, send it as ONE batch through the Supabase MCP, read the raised
-- message, then the leak check at the bottom.
--
-- LOCKS for the run (seconds; lock_timeout 3s), the migration's own, held to
-- the end of each sub-run: ACCESS EXCLUSIVE on volunteer_roles,
-- volunteer_claims, volunteer_trigger_failures; SHARE ROW EXCLUSIVE on
-- snack_shack_blocks and snack_shack_settings (the triggers). The fixture
-- writes take ROW EXCLUSIVE on leagues, divisions, teams, games,
-- snack_shack_* and the volunteer tables. L1 prints what the baseline holds.
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   S1  the snack shack role: stored with spots 1, lead 0 and no division
--       whatever is sent; a second one → snack_role_exists
--   SH1 the page: future shifts while the role is open (not the past one),
--       each with its team ("For <team> families"), its headcount as spots, a
--       taken COUNT and nothing else; role closed → no shifts
--   SC5 refusals: both targets / neither → no_slot; a game role on a shift →
--       no_slot; a past shift → past; role closed → signups_closed
--   SC1 a shift claim: position 1, the block stored, no game, no for-team
--   SC2 the next position; the shift's headcount (2) full → just_taken
--   SC3 the same email on the same shift → already_signed_up
--   SC6 the family's team must be in a LOCKED division → wrong_team
--   GR1 game spots unchanged: next position, full → just_taken,
--       already_signed_up
--   SC4 overlap across kinds: a game spot then an overlapping shift, and a
--       shift then an overlapping game spot → overlap_confirm_needed;
--       touching ends don't overlap; confirmed → claimed
--   S2  renaming the snack shack role cancels none of its sign-ups
--   SM1 manage page shows the shift (kind, start, end, its team, can change);
--       inside 24 hours → change_closed; outside → canceled + email
--   SA1 admin assign fills a shift while the role is closed; past → past;
--       full → just_taken
--   SL1 the admin list carries the shift's block id
--   SN1 no-show on a past shift; a future one → not_past
--   SR1 reminders cover future shift spots, skip past ones
--   SE1 email details of a shift: kind, start, end, its team, open
--   SCC1 shift sign-up counts for members; a non-member → not_authorized
--   SHC1 a shift's own headcount lowered (3 → 2) cancels the spot above it
--        and emails (reason headcount); a PAST shift's cancels nothing
--   SHC2 the season number lowered (2 → 1) cancels spots above it on future
--        shifts WITHOUT their own number only
--   SD1 a deleted shift's sign-ups detach (the delete succeeds) with
--       spot_lost held 10 minutes
--   SI1 a new shift with the same date and start takes them back (email
--       withdrawn) when its headcount has room; a spot above it, or a
--       different start, stays detached
--   SG1 regenerate: a shift whose end moves carries its sign-up; a removed
--       shift's sign-up is lost; claims_carried / claims_lost say so; 0119's
--       keys still there
--   SW1 archiving wipes the season's shift sign-ups and the snack shack role
--   G1  privileges: helpers and triggers callable by no role; claim / page /
--       manage / cancel service_role only; admin functions authenticated
--       only; one overload each of claim and assign; claims readable by none
-- Mutants (each must die at its own tag; a mutant whose find text doesn't
-- match exactly once is STALE):
--   MS1  a game role's strand check cancels shift sign-ups     → S2
--   MS2  the snack shack role keeps the sent spots/divisions   → S1
--   MS3  a second snack shack role not refused by name         → S1
--   MS4  the page lists past shifts                            → SH1
--   MS5  the page lists shifts while the role is closed        → SH1
--   MS6  a shift claim ignores the headcount                   → SC2
--   MS7  the overlap check ignores shifts                      → SC4
--   MS8  a shift claim accepts a game role                     → SC5
--   MS9  a deleted shift's spot_lost not held                  → SD1
--   MS10 the reattach ignores the start                        → SI1
--   MS11 the reattach ignores the headcount                    → SI1
--   MS12 a past shift's headcount drop cancels sign-ups        → SHC1
--   MS13 the season number cancels on shifts with their own    → SHC2
--   MS14 regenerate doesn't count the sign-ups                 → SG1
--   MS15 cancel can't place a shift's start                    → SM1
--   MS16 shift sign-up counts callable by anon                 → G1
--   MS17 a shift's email has no start                          → SE1
--   MS18 reminders skip shifts                                 → SR1
--   MS19 no-show can't place a shift                           → SN1
--   MS20 the admin list loses the block id                     → SL1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '180s', true);

create or replace function pg_temp.h122_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

create or replace function pg_temp.h122_hex() returns text language sql as $f$
  select md5(random()::text) || md5(random()::text);
$f$;

-- A public claim, as the route makes it (service_role).
create or replace function pg_temp.h122_claim(p_token text, p_game uuid, p_block uuid, p_role uuid, p_div uuid, p_team uuid,
                                              p_email text, p_confirm boolean) returns jsonb language plpgsql as $f$
declare v text;
begin
  v := pg_temp.h122_as(null, 'service_role', format(
    'select public.volunteer_claim(%L, %L::uuid, %L::uuid, null, %L::uuid, %L::uuid, %L, %L, %L, true, %L, %L, %L, %L::uuid)::text',
    p_token, p_game, p_role, p_div, p_team, 'Q', 'Proof', p_email, pg_temp.h122_hex(), pg_temp.h122_hex(), p_confirm, p_block));
  if v like 'ERR%' then return jsonb_build_object('status', v); end if;
  return v::jsonb;
end;
$f$;

-- An admin call (authenticated, as the org owner unless told otherwise).
create or replace function pg_temp.h122_admin(p_sub uuid, p_sql text) returns jsonb language plpgsql as $f$
declare v text;
begin
  v := pg_temp.h122_as(p_sub, 'authenticated', p_sql);
  if v is null then return 'null'::jsonb; end if;
  if v like 'ERR%' then return jsonb_build_object('error', v); end if;
  return v::jsonb;
end;
$f$;


-- One pass: fixtures, then every assertion in order. Returns the FIRST
-- failing tag (with detail) or 'pass'. Runs only after 0122 is applied inside
-- the current sub-run, so everything it writes rolls back with it.
create or replace function pg_temp.h122_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_other uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';  -- a real profile, not a member of "test"
  v_tok   text := pg_temp.h122_hex();
  v_now   timestamp;
  d3      date;
  d3s     text;
  v_ts    timestamp;
  v_s  uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid();
  v_d  uuid := gen_random_uuid(); v_du uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid();
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_tu uuid := gen_random_uuid(); v_tx uuid := gen_random_uuid();
  v_g1 uuid := gen_random_uuid();
  v_snack uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); bo uuid := gen_random_uuid();
  bp uuid := gen_random_uuid(); bs uuid := gen_random_uuid(); b11 uuid := gen_random_uuid(); b10 uuid := gen_random_uuid();
  v_fp uuid; v_sb uuid; v_sr uuid;
  j jsonb; k jsonb; e jsonb; v_r text;
  cA uuid; cB uuid; cX1 uuid; cX2 uuid; cX3 uuid; cY uuid; cD uuid; cAdm uuid; cE uuid; cF uuid; cP1 uuid; cP2 uuid;
  v_vp uuid; v_mt text; v_n integer; f text; r text;
begin
  -- ── Fixture ─────────────────────────────────────────────────────────────
  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'volunteers', true)
    on conflict (owner_id, feature) do update set enabled = true;
  insert into public.volunteer_settings (owner_id, link_token, link_enabled, contact_email)
    values (v_org, v_tok, true, 'contact@example.test')
    on conflict (owner_id) do update set link_token = excluded.link_token, link_enabled = true,
                                         contact_email = excluded.contact_email;
  v_now := public.volunteer_org_now(v_org);
  d3 := (v_now + interval '3 days')::date;
  d3s := to_char(d3, 'YYYY-MM-DD');

  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (v_s,  'ZZ122 Season', 'Baseball', 'Fall', v_org, v_now::date - 10, v_now::date + 30),
    (v_s2, 'ZZ122 Other',  'Baseball', 'Fall', v_org, v_now::date - 10, v_now::date + 30);
  insert into public.divisions (id, league_id, name, settings) values
    (v_d,  v_s,  'ZZ Minors',   '{"game_duration": 90, "buffer_minutes": 15}'),
    (v_du, v_s,  'ZZ Unlocked', '{}'),
    (v_d2, v_s2, 'ZZ Other',    '{}');
  insert into public.teams (id, league_id, division_id, name) values
    (v_t1, v_s, v_d, 'ZZ Team 1'), (v_t2, v_s, v_d, 'ZZ Team 2'),
    (v_tu, v_s, v_du, 'ZZ Unlocked Team'), (v_tx, v_s2, v_d2, 'ZZ Other Team');
  insert into public.games (id, league_id, home_team_id, away_team_id, scheduled_at, status)
    values (v_g1, v_s, v_t1, v_t2, (d3 + time '10:00') at time zone 'UTC', 'scheduled');
  update public.divisions set locked = true where id in (v_d, v_d2);

  insert into public.snack_shack_settings (id, season_id, start_date, end_date, people_per_shift)
    values (v_snack, v_s, v_now::date - 10, v_now::date + 30, 2);
  v_ts := date_trunc('minute', v_now + interval '20 hours');
  insert into public.snack_shack_blocks (id, snack_shack_id, date, start_time, end_time, assigned_team_id, people_needed) values
    (b1, v_snack, d3, '09:30', '11:30', v_t1, null),
    (b2, v_snack, d3, '11:30', '13:30', null, 3),
    (bo, v_snack, d3, '10:30', '11:00', null, null),
    (bp, v_snack, v_now::date - 2, '09:00', '11:00', null, null),
    (bs, v_snack, v_ts::date, v_ts::time,
         case when v_ts::time < '23:00' then (v_ts + interval '30 minutes')::time else '23:59'::time end, null, null);

  -- Two game roles, as the owner.
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(null, %L::uuid, %L, %L, 4, 0, true, true, %L::uuid[], true)::text',
    v_s, 'Field prep', 'per_game', '{' || v_d || '}'));
  v_fp := (j ->> 'role_id')::uuid;
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(null, %L::uuid, %L, %L, 2, 0, true, true, %L::uuid[], true)::text',
    v_s, 'Scoreboard', 'per_game', '{' || v_d || '}'));
  v_sb := (j ->> 'role_id')::uuid;
  if v_fp is null or v_sb is null then
    return 'FIX game roles not created: ' || coalesce(j::text, 'null');
  end if;

  -- ── S1 the snack shack role ────────────────────────────────────────────
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(null, %L::uuid, %L, %L, 5, 30, true, true, %L::uuid[], true)::text',
    v_s, 'Snack shack', 'snack_shack', '{' || v_d || '}'));
  v_sr := (j ->> 'role_id')::uuid;
  if v_sr is null then
    return 'S1 snack shack role not saved: ' || coalesce(j::text, 'null');
  end if;
  if (select spots from public.volunteer_roles where id = v_sr) <> 1
     or (select lead_minutes from public.volunteer_roles where id = v_sr) <> 0
     or exists (select 1 from public.volunteer_role_divisions where role_id = v_sr) then
    return 'S1 the snack shack role kept the spots, lead or divisions it was sent';
  end if;
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(null, %L::uuid, %L, %L, 1, 0, true, true, %L::uuid[], true)::text',
    v_s, 'Snack shack 2', 'snack_shack', '{}'));
  if coalesce(j ->> 'error', '') not like '%snack_role_exists%' then
    return 'S1 a second snack shack role was not refused as snack_role_exists: ' || j::text;
  end if;

  -- ── SH1 the page ───────────────────────────────────────────────────────
  j := pg_temp.h122_as(null, 'service_role', format('select public.volunteer_signup_page(%L, %L::uuid)::text', v_tok, v_s))::jsonb;
  if jsonb_array_length(coalesce(j -> 'shifts', '[]')) <> 4
     or exists (select 1 from jsonb_array_elements(j -> 'shifts') x where (x ->> 'block_id')::uuid = bp) then
    return 'SH1 the page should list the 4 future shifts, not the past one: ' || coalesce((j -> 'shifts')::text, 'null');
  end if;
  e := (select x from jsonb_array_elements(j -> 'shifts') x where (x ->> 'block_id')::uuid = b1);
  if e ->> 'assigned_team_name' is distinct from 'ZZ Team 1' or (e ->> 'spots')::int <> 2 or (e ->> 'taken')::int <> 0
     or e ->> 'start' <> d3s || 'T09:30' or e ->> 'end' <> d3s || 'T11:30' or (e ->> 'role_id')::uuid <> v_sr then
    return 'SH1 shift b1 wrong: ' || coalesce(e::text, 'null');
  end if;
  if (select (x ->> 'spots')::int from jsonb_array_elements(j -> 'shifts') x where (x ->> 'block_id')::uuid = b2) <> 3
     or (select x ->> 'assigned_team_name' from jsonb_array_elements(j -> 'shifts') x where (x ->> 'block_id')::uuid = b2) is not null then
    return 'SH1 shift b2 should carry its own headcount (3) and no team';
  end if;
  if exists (select 1 from jsonb_array_elements(j -> 'shifts') x
              where (select array_agg(kk order by kk) from jsonb_object_keys(x) kk)
                    <> array['assigned_team_name', 'block_id', 'end', 'role_id', 'spots', 'start', 'taken']) then
    return 'SH1 a shift carries keys beyond its times, team, spots and taken count';
  end if;
  -- Role closed → no shifts.
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(%L::uuid, %L::uuid, %L, %L, 1, 0, false, true, %L::uuid[], true)::text',
    v_sr, v_s, 'Snack shack', 'snack_shack', '{}'));
  j := pg_temp.h122_as(null, 'service_role', format('select public.volunteer_signup_page(%L, %L::uuid)::text', v_tok, v_s))::jsonb;
  if jsonb_array_length(coalesce(j -> 'shifts', '[]')) <> 0 then
    return 'SH1 shifts listed while the snack shack role is closed';
  end if;

  -- ── SC5 refusals ───────────────────────────────────────────────────────
  if pg_temp.h122_claim(v_tok, null, b1, v_sr, v_d, v_t1, 'r1@example.test', false) ->> 'status' <> 'signups_closed' then
    return 'SC5 a closed role should answer signups_closed';
  end if;
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(%L::uuid, %L::uuid, %L, %L, 1, 0, true, true, %L::uuid[], true)::text',
    v_sr, v_s, 'Snack shack', 'snack_shack', '{}'));
  if pg_temp.h122_claim(v_tok, null, null, v_sr, v_d, v_t1, 'r2@example.test', false) ->> 'status' <> 'no_slot'
     or pg_temp.h122_claim(v_tok, v_g1, b1, v_sr, v_d, v_t1, 'r2@example.test', false) ->> 'status' <> 'no_slot' then
    return 'SC5 neither or both targets should answer no_slot';
  end if;
  if pg_temp.h122_claim(v_tok, null, b1, v_fp, v_d, v_t1, 'r3@example.test', false) ->> 'status' <> 'no_slot' then
    return 'SC5 a game role on a shift should answer no_slot';
  end if;
  if pg_temp.h122_claim(v_tok, null, bp, v_sr, v_d, v_t1, 'r4@example.test', false) ->> 'status' <> 'past' then
    return 'SC5 a past shift should answer past';
  end if;

  -- ── SC1 a shift claim ──────────────────────────────────────────────────
  j := pg_temp.h122_claim(v_tok, null, b1, v_sr, v_d, v_t1, 'a@example.test', false);
  cA := (j ->> 'claim_id')::uuid;
  if j ->> 'status' <> 'claimed' or (j ->> 'position')::int <> 1 then
    return 'SC1 the first claim on b1: ' || j::text;
  end if;
  if not exists (select 1 from public.volunteer_claims c
                  where c.id = cA and c.snack_shack_block_id = b1 and c.game_id is null and c.for_team_id is null
                    and c.role_id = v_sr and c.status = 'active' and c.family_team_id = v_t1) then
    return 'SC1 the claim row should name the shift, no game, no for-team';
  end if;

  -- ── SC2 the next position; the headcount full ───────────────────────────
  j := pg_temp.h122_claim(v_tok, null, b1, v_sr, v_d, v_t2, 'b@example.test', false);
  cB := (j ->> 'claim_id')::uuid;
  if j ->> 'status' <> 'claimed' or (j ->> 'position')::int <> 2 then
    return 'SC2 the second claim on b1 should take position 2: ' || j::text;
  end if;
  if pg_temp.h122_claim(v_tok, null, b1, v_sr, v_d, v_t1, 'c@example.test', false) ->> 'status' <> 'just_taken' then
    return 'SC2 b1 (headcount 2) is full — the third claim should be just_taken';
  end if;

  -- ── SC3 already signed up ──────────────────────────────────────────────
  if pg_temp.h122_claim(v_tok, null, b1, v_sr, v_d, v_t1, 'a@example.test', false) ->> 'status' <> 'already_signed_up' then
    return 'SC3 the same email on the same shift should answer already_signed_up';
  end if;

  -- ── SC6 the family's team ──────────────────────────────────────────────
  if pg_temp.h122_claim(v_tok, null, b2, v_sr, v_du, v_tu, 'w@example.test', false) ->> 'status' <> 'wrong_team'
     or pg_temp.h122_claim(v_tok, null, b2, v_sr, v_d2, v_tx, 'w@example.test', false) ->> 'status' <> 'wrong_team' then
    return 'SC6 a team in an unlocked division or another season should answer wrong_team';
  end if;

  -- ── GR1 game spots unchanged ───────────────────────────────────────────
  if (pg_temp.h122_claim(v_tok, v_g1, null, v_sb, v_d, v_t1, 'z1@example.test', false) ->> 'position')::int is distinct from 1
     or (pg_temp.h122_claim(v_tok, v_g1, null, v_sb, v_d, v_t1, 'z2@example.test', false) ->> 'position')::int is distinct from 2
     or pg_temp.h122_claim(v_tok, v_g1, null, v_sb, v_d, v_t1, 'z3@example.test', false) ->> 'status' <> 'just_taken'
     or pg_temp.h122_claim(v_tok, v_g1, null, v_sb, v_d, v_t1, 'z1@example.test', false) ->> 'status' <> 'already_signed_up' then
    return 'GR1 a game spot no longer behaves as in 0121';
  end if;

  -- ── SC4 overlap across kinds ───────────────────────────────────────────
  j := pg_temp.h122_claim(v_tok, v_g1, null, v_fp, v_d, v_t1, 'x@example.test', false);  -- game 10:00–11:30
  cX1 := (j ->> 'claim_id')::uuid;
  j := pg_temp.h122_claim(v_tok, null, b2, v_sr, v_d, v_t1, 'x@example.test', false);    -- 11:30, touching
  cX2 := (j ->> 'claim_id')::uuid;
  if cX1 is null or cX2 is null then
    return 'SC4 a game spot, then a shift that only touches it, should both be claimed: ' || j::text;
  end if;
  if pg_temp.h122_claim(v_tok, null, bo, v_sr, v_d, v_t1, 'x@example.test', false) ->> 'status' <> 'overlap_confirm_needed' then
    return 'SC4 a shift overlapping the volunteer''s game spot should need confirming';
  end if;
  j := pg_temp.h122_claim(v_tok, null, bo, v_sr, v_d, v_t1, 'x@example.test', true);
  cX3 := (j ->> 'claim_id')::uuid;
  j := pg_temp.h122_claim(v_tok, null, bo, v_sr, v_d, v_t2, 'y@example.test', false);
  cY := (j ->> 'claim_id')::uuid;
  if cX3 is null or cY is null then
    return 'SC4 confirmed overlap and a fresh volunteer on bo should be claimed';
  end if;
  j := pg_temp.h122_claim(v_tok, v_g1, null, v_fp, v_d, v_t2, 'y@example.test', false);
  if j ->> 'status' <> 'overlap_confirm_needed' then
    return 'SC4 a game spot overlapping the volunteer''s shift should need confirming: ' || j::text;
  end if;

  -- ── S2 renaming the snack shack role keeps its sign-ups ─────────────────
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(%L::uuid, %L::uuid, %L, %L, 1, 0, true, true, %L::uuid[], true)::text',
    v_sr, v_s, 'Snack shack volunteers', 'snack_shack', '{}'));
  if (j ->> 'claims_canceled')::int is distinct from 0
     or (select count(*) from public.volunteer_claims where role_id = v_sr and status = 'active') <> 5 then
    return 'S2 saving the snack shack role canceled sign-ups: ' || j::text;
  end if;

  -- ── SM1 the manage page and cancel ─────────────────────────────────────
  v_mt := (select o.payload ->> 'manage_token' from public.volunteer_outbox o
            where o.kind = 'signup_confirmed' and o.payload ->> 'claim_id' = cA::text);
  j := pg_temp.h122_as(null, 'service_role', format('select public.volunteer_manage_page(%L)::text', v_mt))::jsonb;
  e := (select x from jsonb_array_elements(j -> 'claims') x where (x ->> 'claim_id')::uuid = cA);
  if e ->> 'kind' is distinct from 'shift' or e ->> 'start' <> d3s || 'T09:30' or e ->> 'end' <> d3s || 'T11:30'
     or e ->> 'assigned_team_name' is distinct from 'ZZ Team 1' or (e ->> 'can_change')::boolean is distinct from true then
    return 'SM1 the manage page should show the shift: ' || coalesce(e::text, 'null');
  end if;
  j := pg_temp.h122_claim(v_tok, null, bs, v_sr, v_d, v_t1, 'd@example.test', false);
  cD := (j ->> 'claim_id')::uuid;
  v_r := (select o.payload ->> 'manage_token' from public.volunteer_outbox o
           where o.kind = 'signup_confirmed' and o.payload ->> 'claim_id' = cD::text);
  j := pg_temp.h122_as(null, 'service_role', format('select public.volunteer_cancel(%L, %L::uuid)::text', v_r, cD))::jsonb;
  if j ->> 'status' <> 'change_closed' or j ->> 'contact_email' <> 'contact@example.test' then
    return 'SM1 a shift inside 24 hours should answer change_closed with the contact: ' || j::text;
  end if;
  j := pg_temp.h122_as(null, 'service_role', format('select public.volunteer_cancel(%L, %L::uuid)::text', v_mt, cA))::jsonb;
  if j ->> 'status' <> 'canceled'
     or not exists (select 1 from public.volunteer_outbox o where o.kind = 'canceled_by_volunteer' and o.payload ->> 'claim_id' = cA::text) then
    return 'SM1 a shift outside 24 hours should cancel and queue its email: ' || j::text;
  end if;

  -- ── SA1 admin assign ───────────────────────────────────────────────────
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(%L::uuid, %L::uuid, %L, %L, 1, 0, false, true, %L::uuid[], true)::text',
    v_sr, v_s, 'Snack shack volunteers', 'snack_shack', '{}'));
  j := pg_temp.h122_admin(v_org, format(
    'select public.volunteer_admin_assign(%L::uuid, null, %L::uuid, null, %L::uuid, %L, %L, %L, true, false, %L::uuid)::text',
    v_s, v_sr, v_t1, 'M', 'Admin', 'adm@example.test', b1));
  cAdm := (j ->> 'claim_id')::uuid;
  if j ->> 'status' <> 'assigned' or (j ->> 'position')::int <> 1
     or (select created_by from public.volunteer_claims where id = cAdm) <> 'admin' then
    return 'SA1 an admin should fill b1 position 1 while the role is closed: ' || j::text;
  end if;
  if pg_temp.h122_admin(v_org, format(
       'select public.volunteer_admin_assign(%L::uuid, null, %L::uuid, null, %L::uuid, %L, %L, %L, true, false, %L::uuid)::text',
       v_s, v_sr, v_t1, 'M', 'Admin', 'adm2@example.test', bp)) ->> 'status' <> 'past'
     or pg_temp.h122_admin(v_org, format(
       'select public.volunteer_admin_assign(%L::uuid, null, %L::uuid, null, %L::uuid, %L, %L, %L, true, false, %L::uuid)::text',
       v_s, v_sr, v_t1, 'M', 'Admin', 'adm3@example.test', b1)) ->> 'status' <> 'just_taken' then
    return 'SA1 a past shift → past, a full one → just_taken';
  end if;
  j := pg_temp.h122_admin(v_org, format(
    'select public.save_volunteer_role(%L::uuid, %L::uuid, %L, %L, 1, 0, true, true, %L::uuid[], true)::text',
    v_sr, v_s, 'Snack shack volunteers', 'snack_shack', '{}'));

  -- ── SL1 the admin list ─────────────────────────────────────────────────
  j := pg_temp.h122_admin(v_org, format('select public.volunteer_admin_signups(%L::uuid)::text', v_s));
  if (select (x ->> 'snack_shack_block_id')::uuid from jsonb_array_elements(j -> 'claims') x
       where (x ->> 'claim_id')::uuid = cAdm) is distinct from b1 then
    return 'SL1 the admin list should carry the shift''s block id';
  end if;

  -- ── SN1 no-show ────────────────────────────────────────────────────────
  insert into public.volunteers (owner_id, email_lc, first_initial, last_name, adult_confirmed_at)
    values (v_org, 'past@example.test', 'P', 'Past', now()) returning id into v_vp;
  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, family_team_id, snack_shack_block_id, role_id, position, created_by)
    values (v_org, v_s, v_vp, v_t1, bp, v_sr, 1, 'admin') returning id into cP1;
  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, family_team_id, snack_shack_block_id, role_id, position, created_by)
    values (v_org, v_s, v_vp, v_t1, bp, v_sr, 2, 'admin') returning id into cP2;
  if pg_temp.h122_admin(v_org, format('select public.volunteer_set_no_show(%L::uuid, true)::text', cP1)) ->> 'status' <> 'saved'
     or pg_temp.h122_admin(v_org, format('select public.volunteer_set_no_show(%L::uuid, true)::text', cX2)) ->> 'status' <> 'not_past' then
    return 'SN1 no-show: a past shift → saved, a future one → not_past';
  end if;

  -- ── SR1 reminders ──────────────────────────────────────────────────────
  j := pg_temp.h122_admin(v_org, format('select public.volunteer_admin_remind(%L::uuid, %L::uuid[])::text',
                                        v_s, '{' || cX2 || ',' || cP1 || '}'));
  if (j ->> 'reminded')::int is distinct from 1 or (j ->> 'skipped')::int is distinct from 1 then
    return 'SR1 reminders should cover the future shift and skip the past one: ' || j::text;
  end if;

  -- ── SE1 email details ──────────────────────────────────────────────────
  e := public.volunteer_email_spots(array[cB]) -> 0;
  if e ->> 'kind' is distinct from 'shift' or e ->> 'start' is distinct from d3s || 'T09:30'
     or e ->> 'end' is distinct from d3s || 'T11:30' or e ->> 'assigned_team_name' is distinct from 'ZZ Team 1'
     or e ->> 'state' is distinct from 'open' or e ->> 'role_name' is distinct from 'Snack shack volunteers' then
    return 'SE1 a shift''s email details: ' || coalesce(e::text, 'null');
  end if;

  -- ── SCC1 counts ────────────────────────────────────────────────────────
  j := pg_temp.h122_admin(v_org, format('select public.volunteer_shift_claim_counts(%L::uuid)::text', v_s));
  if (j ->> b1::text)::int is distinct from 2 or (j ->> bo::text)::int is distinct from 2 then
    return 'SCC1 shift counts for a member: ' || j::text;
  end if;
  if coalesce(pg_temp.h122_admin(v_other, format('select public.volunteer_shift_claim_counts(%L::uuid)::text', v_s)) ->> 'error', '')
       not like '%not_authorized%' then
    return 'SCC1 a non-member should be refused';
  end if;

  -- ── SHC1 a shift's own headcount ───────────────────────────────────────
  cE := (pg_temp.h122_claim(v_tok, null, b2, v_sr, v_d, v_t1, 'e@example.test', false) ->> 'claim_id')::uuid;
  cF := (pg_temp.h122_claim(v_tok, null, b2, v_sr, v_d, v_t1, 'f@example.test', false) ->> 'claim_id')::uuid;
  v_r := pg_temp.h122_as(v_org, 'authenticated', format(
    'with u as (update public.snack_shack_blocks set people_needed = 2 where id = %L returning 1) select count(*)::text from u', b2));
  if v_r <> '1'
     or (select status from public.volunteer_claims where id = cF) <> 'canceled'
     or (select status from public.volunteer_claims where id = cE) <> 'active'
     or (select status from public.volunteer_claims where id = cX2) <> 'active'
     or not exists (select 1 from public.volunteer_outbox o where o.kind = 'shift_canceled'
                     and o.payload ->> 'claim_id' = cF::text and o.payload ->> 'reason' = 'headcount') then
    return 'SHC1 lowering b2 to 2 should cancel position 3 only, with a headcount email: ' || coalesce(v_r, 'null');
  end if;
  v_r := pg_temp.h122_as(v_org, 'authenticated', format(
    'with u as (update public.snack_shack_blocks set people_needed = 1 where id = %L returning 1) select count(*)::text from u', bp));
  if (select status from public.volunteer_claims where id = cP2) <> 'active' then
    return 'SHC1 a past shift''s headcount drop canceled a sign-up';
  end if;

  -- ── SHC2 the season number ─────────────────────────────────────────────
  v_r := pg_temp.h122_as(v_org, 'authenticated', format(
    'with u as (update public.snack_shack_settings set people_per_shift = 1 where id = %L returning 1) select count(*)::text from u', v_snack));
  if v_r <> '1'
     or (select status from public.volunteer_claims where id = cB) <> 'canceled'
     or (select status from public.volunteer_claims where id = cY) <> 'canceled'
     or (select status from public.volunteer_claims where id = cAdm) <> 'active'
     or (select status from public.volunteer_claims where id = cX3) <> 'active' then
    return 'SHC2 the season number 1 should cancel position 2 on b1 and bo: ' || coalesce(v_r, 'null');
  end if;
  if (select status from public.volunteer_claims where id = cE) <> 'active'
     or (select status from public.volunteer_claims where id = cP2) <> 'active' then
    return 'SHC2 a shift with its own number (b2) or a past one lost a sign-up';
  end if;

  -- ── SD1 a deleted shift ────────────────────────────────────────────────
  v_r := pg_temp.h122_as(v_org, 'authenticated', format(
    'with u as (delete from public.snack_shack_blocks where id = %L returning 1) select count(*)::text from u', b2));
  if v_r is distinct from '1' then
    return 'SD1 deleting a shift with sign-ups failed: ' || coalesce(v_r, 'null');
  end if;
  if (select count(*) from public.volunteer_claims c
       where c.id in (cX2, cE) and c.status = 'detached' and c.snack_shack_block_id is null
         and c.detached_from ->> 'kind' = 'shift' and c.detached_from ->> 'start' = d3s || 'T11:30') <> 2 then
    return 'SD1 the shift''s two sign-ups should be detached, remembering the shift';
  end if;
  if (select count(*) from public.volunteer_outbox o
       where o.kind = 'spot_lost' and o.status = 'pending' and o.payload ->> 'claim_id' in (cX2::text, cE::text)
         and o.next_attempt_at > now() + interval '9 minutes') <> 2 then
    return 'SD1 each should get a spot_lost email held 10 minutes';
  end if;

  -- ── SI1 a same-start shift takes them back ─────────────────────────────
  v_r := pg_temp.h122_as(v_org, 'authenticated', format(
    'with u as (insert into public.snack_shack_blocks (id, snack_shack_id, date, start_time, end_time, people_needed)
                values (%L, %L, %L, %L, %L, 1) returning 1) select count(*)::text from u', b11, v_snack, d3, '11:30', '14:00'));
  if (select snack_shack_block_id from public.volunteer_claims where id = cX2 and status = 'active') is distinct from b11
     or (select status from public.volunteer_outbox where kind = 'spot_lost' and payload ->> 'claim_id' = cX2::text) <> 'superseded' then
    return 'SI1 the same-start shift should take back position 1 and withdraw its email: ' || coalesce(v_r, 'null');
  end if;
  if (select status from public.volunteer_claims where id = cE) <> 'detached'
     or (select status from public.volunteer_outbox where kind = 'spot_lost' and payload ->> 'claim_id' = cE::text) <> 'pending' then
    return 'SI1 position 2 has no spot on a headcount-1 shift: it should stay detached, its email pending';
  end if;
  v_r := pg_temp.h122_as(v_org, 'authenticated', format(
    'with u as (delete from public.snack_shack_blocks where id = %L returning 1) select count(*)::text from u', bo));
  v_r := pg_temp.h122_as(v_org, 'authenticated', format(
    'with u as (insert into public.snack_shack_blocks (id, snack_shack_id, date, start_time, end_time)
                values (%L, %L, %L, %L, %L) returning 1) select count(*)::text from u', b10, v_snack, d3, '10:00', '11:00'));
  if (select status from public.volunteer_claims where id = cX3) <> 'detached' then
    return 'SI1 a shift at a different start should not take a sign-up back';
  end if;

  -- ── SG1 regenerate ─────────────────────────────────────────────────────
  j := pg_temp.h122_admin(v_org, format('select public.regenerate_snack_shack_shifts(%L::uuid, %L::jsonb)::text', v_snack,
    jsonb_build_array(
      jsonb_build_object('date', d3s, 'start', '09:30', 'end', '12:00', 'assigned_team_id', v_t1),
      jsonb_build_object('date', to_char(v_now::date - 2, 'YYYY-MM-DD'), 'start', '09:00', 'end', '11:00', 'assigned_team_id', ''),
      jsonb_build_object('date', d3s, 'start', '11:30', 'end', '14:00', 'assigned_team_id', ''),
      jsonb_build_object('date', d3s, 'start', '10:00', 'end', '11:00', 'assigned_team_id', ''))::text));
  if (j ->> 'claims_carried')::int is distinct from 1 or (j ->> 'claims_lost')::int is distinct from 1
     or not (j ? 'kept') or not (j ? 'lost') then
    return 'SG1 regenerate should carry 1 sign-up and lose 1: ' || j::text;
  end if;
  if (select b.end_time from public.volunteer_claims c join public.snack_shack_blocks b on b.id = c.snack_shack_block_id
       where c.id = cAdm and c.status = 'active') is distinct from '12:00'::time
     or (select status from public.volunteer_claims where id = cD) <> 'detached' then
    return 'SG1 the carried sign-up should sit on the 09:30–12:00 shift; the removed shift''s should be detached';
  end if;

  -- ── SW1 archive ────────────────────────────────────────────────────────
  v_r := pg_temp.h122_as(v_org, 'authenticated', format(
    'with u as (update public.leagues set archived_at = now() where id = %L returning 1) select count(*)::text from u', v_s));
  if v_r is distinct from '1'
     or exists (select 1 from public.volunteer_claims where season_id = v_s)
     or exists (select 1 from public.volunteer_roles where season_id = v_s) then
    return 'SW1 archiving should wipe the season''s shift sign-ups and its snack shack role: ' || coalesce(v_r, 'null');
  end if;

  -- ── G1 privileges ──────────────────────────────────────────────────────
  foreach f in array array[
    'public.volunteer_shift_people(integer, integer)', 'public.volunteer_season_shifts(uuid)',
    'public.volunteer_overlaps(uuid, timestamp, timestamp)', 'public.volunteer_record_shift_failure(uuid, uuid, text)',
    'public.volunteer_cancel_shift_spots(uuid, integer)', 'public.volunteer_email_spots(uuid[])',
    'public.volunteer_on_shift_delete()', 'public.volunteer_on_shift_insert()',
    'public.volunteer_on_shift_headcount()', 'public.volunteer_on_shack_headcount()'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        return format('G1 %s can execute %s', r, f);
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.volunteer_signup_page(text, uuid)', 'public.volunteer_manage_page(text)', 'public.volunteer_cancel(text, uuid)',
    'public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean, uuid)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      return format('G1 service_role cannot execute %s', f);
    end if;
    foreach r in array array['anon', 'authenticated', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        return format('G1 %s can execute %s', r, f);
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean)',
    'public.volunteer_admin_signups(uuid)', 'public.volunteer_set_no_show(uuid, boolean)',
    'public.volunteer_admin_remind(uuid, uuid[])', 'public.volunteer_shift_claim_counts(uuid)',
    'public.regenerate_snack_shack_shifts(uuid, jsonb)',
    'public.volunteer_admin_assign(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, boolean, uuid)'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      return format('G1 authenticated cannot execute %s', f);
    end if;
    foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        return format('G1 %s can execute %s', r, f);
      end if;
    end loop;
  end loop;
  if (select count(*) from pg_proc where proname = 'volunteer_claim' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_proc where proname = 'volunteer_admin_assign' and pronamespace = 'public'::regnamespace) <> 1 then
    return 'G1 claim / assign must each have one overload';
  end if;
  foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
    if has_table_privilege(r, 'public.volunteer_claims', 'SELECT') then
      return format('G1 %s can read volunteer_claims', r);
    end if;
  end loop;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig122$
-- @@MIGRATION_0122@@
$mig122$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\n';
  m       record;
begin
  -- Mutants run without the migration's verify block (a grant mutant would
  -- otherwise die in the verify, not at its own assertion — 0120's rule).
  v_nover := split_part(v_body, '-- 7. Verify', 1);

  -- BASELINE: the file as it will be applied.
  begin
    execute v_body;
    v_res := pg_temp.h122_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || 'md5(prosrc) ' || (
      select string_agg(p.proname || '=' || md5(p.prosrc), ', ' order by p.proname)
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('volunteer_shift_people', 'volunteer_season_shifts', 'volunteer_overlaps',
                           'volunteer_record_shift_failure', 'volunteer_cancel_shift_spots', 'save_volunteer_role',
                           'volunteer_signup_page', 'volunteer_claim', 'volunteer_manage_page', 'volunteer_cancel',
                           'volunteer_admin_signups', 'volunteer_admin_assign', 'volunteer_set_no_show',
                           'volunteer_admin_remind', 'volunteer_email_spots', 'volunteer_on_shift_delete',
                           'volunteer_on_shift_insert', 'volunteer_on_shift_headcount', 'volunteer_on_shack_headcount',
                           'volunteer_shift_claim_counts', 'regenerate_snack_shack_shifts')) || E'\n';
    v_out := v_out || 'L1 locks held: ' || (
      select coalesce(string_agg(distinct c.relname || '=' || l.mode, ', '), 'none')
        from pg_locks l join pg_class c on c.oid = l.relation
       where l.pid = pg_backend_pid() and l.granted and c.relkind = 'r'
         and c.relnamespace = 'public'::regnamespace) || E'\n';
    raise exception 'H122ROLLBACK';
  exception when others then
    if sqlerrm <> 'H122ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('MS1', 'S2', $r$     where c.role_id = v_role.id and c.status = 'active' and c.game_id is not null  -- 0122: game spots only$r$,
                  $r$     where c.role_id = v_role.id and c.status = 'active'$r$),
    ('MS2', 'S1', $r$  if p_kind = 'snack_shack' then
    p_spots := 1;
    p_lead_minutes := 0;
    v_divs := '{}';
  end if;
$r$, $r$$r$),
    ('MS3', 'S1', $r$  if p_kind = 'snack_shack' and exists ($r$, $r$  if false and exists ($r$),
    ('MS4', 'SH1', $r$       where sh.signups_open and sh.start_wall > v_now), '[]')$r$, $r$       where sh.signups_open), '[]')$r$),
    ('MS5', 'SH1', $r$       where sh.signups_open and sh.start_wall > v_now), '[]')$r$, $r$       where sh.start_wall > v_now), '[]')$r$),
    ('MS6', 'SC2', $r$                                            true, v_shift.signups_open);
    v_start := v_shift.start_wall;
    v_end := v_shift.end_wall;
    v_spots := v_shift.spots;$r$, $r$                                            true, v_shift.signups_open);
    v_start := v_shift.start_wall;
    v_end := v_shift.end_wall;
    v_spots := 10;$r$),
    ('MS7', 'SC4', $r$      or exists (
           select 1
             from public.volunteer_claims c
             join public.snack_shack_blocks b on b.id = c.snack_shack_block_id$r$, $r$      or false and exists (
           select 1
             from public.volunteer_claims c
             join public.snack_shack_blocks b on b.id = c.snack_shack_block_id$r$),
    ('MS8', 'SC5', $r$                                            v_shift.block_id is not null and v_shift.role_id = p_role_id,
                                            true, v_shift.signups_open);$r$, $r$                                            v_shift.block_id is not null,
                                            true, v_shift.signups_open);$r$),
    ('MS9', 'SD1', $r$         'lost:' || d.id, now() + interval '10 minutes'$r$, $r$         'lost:' || d.id, now()$r$),
    ('MS10', 'SI1', $r$       and c.detached_from ->> 'start' = v_wall
$r$, $r$$r$),
    ('MS11', 'SI1', $r$    if r.position <= v_people
       and not exists$r$, $r$    if not exists$r$),
    ('MS12', 'SHC1', $r$  if new.date + new.start_time <= public.volunteer_org_now(v_owner) then$r$, $r$  if false then$r$),
    ('MS13', 'SHC2', $r$ and x.people_needed is null and$r$, $r$ and$r$),
    ('MS14', 'SG1', $r$   where b.snack_shack_id = p_snack_shack_id
     and b.is_recurring
     and c.status = 'active'$r$, $r$   where false$r$),
    ('MS15', 'SM1', $r$  -- 0122: a shift's spot starts when the shift does.
  if v_claim.snack_shack_block_id is not null then$r$, $r$  if false then$r$),
    ('MS16', 'G1', $r$grant execute on function public.volunteer_shift_claim_counts(uuid) to authenticated;$r$,
                   $r$grant execute on function public.volunteer_shift_claim_counts(uuid) to authenticated, anon;$r$),
    ('MS17', 'SE1', $r$                          when b.id is not null then to_char(b.date + b.start_time, 'YYYY-MM-DD"T"HH24:MI')
$r$, $r$$r$),
    ('MS18', 'SR1', $r$                    b.date + b.start_time) > v_now$r$, $r$                    null) > v_now$r$),
    ('MS19', 'SN1', $r$                  b.date + b.start_time) into v_start$r$, $r$                  null) into v_start$r$),
    ('MS20', 'SL1', $r$               'snack_shack_block_id', c.snack_shack_block_id, 'role_id', c.role_id,$r$,
                    $r$               'role_id', c.role_id,$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h122_case();
      raise exception 'H122CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H122CASE:%' then replace(sqlerrm, 'H122CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;

  raise exception E'ROLLED BACK — 0122 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname in ('volunteer_season_shifts', 'volunteer_overlaps',
--      'volunteer_on_shift_delete', 'volunteer_shift_claim_counts')) as new_functions_must_be_0,
--   (select count(*) from pg_proc where proname = 'volunteer_claim') as claim_overloads_must_be_1,
--   (select md5(prosrc) from pg_proc where proname = 'regenerate_snack_shack_shifts') as regen_must_be_0119_fd94fb29,
--   (select count(*) from pg_trigger where tgname like 'volunteer_on_sh%') as shift_triggers_must_be_0,
--   (select count(*) from pg_constraint where conname = 'volunteer_claims_v1_games_only') as v1_check_must_be_1,
--   (select count(*) from leagues where name like 'ZZ122%') as fixture_leagues_must_be_0,
--   (select count(*) from volunteer_settings) as settings_must_be_pre_run,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;

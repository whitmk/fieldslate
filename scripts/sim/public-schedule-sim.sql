-- SQL-level proof for migration 0105 (public league schedule — home park flag,
-- the org link table, the anonymous reader, the two admin functions).
--
-- WHY SQL: the behavior is a SECURITY DEFINER reader's row selection, RLS on a
-- new table, grants, and is_org_member gating — exercised as `anon` and
-- `authenticated`. NOT `npm run`-able, NOT in CI (CLAUDE.md, "Harness standard
-- — SQL-level exceptions").
--
-- THIS HARNESS APPLIES 0105 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK, so it runs BEFORE the migration is applied. The text proven is the
-- repo file: the build script substitutes it for the placeholder below.
--
-- HOW TO RUN: `npx tsx scripts/sim/public-schedule-build.ts > <file>`, send the
-- output as ONE batch through the Supabase MCP (one batch = one transaction),
-- read the raised message, then run the leak check at the bottom.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: one to two seconds)
--   ACCESS EXCLUSIVE on public.locations (ADD COLUMN) — blocks every READ and
--     write of parks: every venue picker and the Venues page, the Schedule
--     page's games query (its venue embed joins locations), the team calendar
--     feed reader and the three partner token functions (all join locations).
--   SHARE ROW EXCLUSIVE on public.profiles (the new table's FK) — blocks
--     WRITES to profiles (org-name saves, setup dismiss, a Stripe webhook's
--     plan update, a signup's insert); reads unaffected.
--   Row locks on the FIXTURE rows only (all new, all rolled back).
--   lock_timeout = 3s: the run gives up rather than queueing behind a live
--   writer; statement_timeout = 60s bounds the whole thing.
--
-- ROWS TOUCHED (all rolled back; the test org "SRALL" only, owner
-- aa21d01c-66dc-4c37-b15c-7b743c557eea): two parks, three fields, one
-- interleague contact, five seasons, eight divisions, four teams, eight games,
-- three brackets, four playoff games, the org's plan (flipped to free and back
-- inside L6). NOTHING belonging to Santa Rosa American Little League is
-- written — the SRALL owner is also an admin there, which is why every
-- fixture names the SRALL org id explicitly.
-- Non-member for refusals: the "test" org owner bbf9afe1-… (not a member of
-- SRALL, verified 2026-10-08).
--
-- ASSERTIONS
--   P1   privileges: reader anon+authenticated; admin functions authenticated
--        only; link table SELECT for authenticated only; anon reads none of the
--        tables the reader joins
--   L1   a malformed or unknown token → 'unknown'
--   L2   a member turns the page on → a 64-hex token; the reader answers 'ok'
--   L3   OFF → 'off'; ON again → the SAME token
--   L4   RESET → a new token; the old one → 'unknown'; the new one → 'ok'
--   L5   a non-member cannot turn on / reset (42501); anon cannot call either
--   L6   plan: a free org → 'plan'; turning on refused (plan_required); turning
--        off still allowed
--   U1   an UNLOCKED division contributes its name to `unpublished` and nothing
--        else — no division entry, no team, no game, no playoff game
--   PI1  a pending interleague game is not returned
--   ST1  rained out (cancelled) and reschedule_pending ARE returned, with status
--   H1   a game on a home-park field: home_park true, the park's address
--   H2   a game in someone else's park, a field in no park: home_park false;
--        an interleague away game: no venue, the partner's field, flagged
--   N1   nothing private leaves: no game note, no score, no contact email, no
--        interleague contact, no `notes` key at all
--   PO1  playoff games: a draft bracket's are not returned; an active
--        bracket's are, dated and undated
--   W1   seasons: ended 7 days ago in, 8 days ago out, archived out, no locked
--        division out; `today` is the org's date
--
-- MUTANTS (each rewrites the REAL function inside its own rolled-back block;
-- KILLED only if the FIRST failure is its own tag)
--   SM1  the games' locked-division filter removed            → U1
--   SM2  pending interleague games returned                    → PI1
--   SM3  the game's note emitted                               → N1
--   SM4  any park counts as a home park                        → H2
--   SM5  turning the page back on mints a new token            → L3
--
-- RUN LOG: see the bottom of this file after the run.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

create temp table h105_fx on commit drop as
select
  'aa21d01c-66dc-4c37-b15c-7b743c557eea'::uuid as org,
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as nonmember,
  (now() at time zone 'America/Los_Angeles')::date as today,
  gen_random_uuid() as loc_home, gen_random_uuid() as loc_other,
  gen_random_uuid() as v_home, gen_random_uuid() as v_other, gen_random_uuid() as v_nopark,
  gen_random_uuid() as io,
  gen_random_uuid() as s_now, gen_random_uuid() as s_e7, gen_random_uuid() as s_e8,
  gen_random_uuid() as s_arch, gen_random_uuid() as s_nolock,
  gen_random_uuid() as div_a, gen_random_uuid() as div_b, gen_random_uuid() as div_c,
  gen_random_uuid() as div_e7, gen_random_uuid() as div_e8, gen_random_uuid() as div_arch,
  gen_random_uuid() as div_nolock,
  gen_random_uuid() as a1, gen_random_uuid() as a2, gen_random_uuid() as b1, gen_random_uuid() as b2,
  gen_random_uuid() as g_home, gen_random_uuid() as g_other, gen_random_uuid() as g_nopark,
  gen_random_uuid() as g_cx, gen_random_uuid() as g_rp, gen_random_uuid() as g_pending,
  gen_random_uuid() as g_il_away, gen_random_uuid() as g_b,
  gen_random_uuid() as p_active, gen_random_uuid() as p_draft, gen_random_uuid() as p_b,
  gen_random_uuid() as pg1, gen_random_uuid() as pg2, gen_random_uuid() as pg3, gen_random_uuid() as pg4;

-- Fixtures. Divisions are created UNLOCKED (the 0082 trigger refuses inserts
-- into a locked division) and locked after the games exist.
insert into public.locations (id, owner_id, name, address)
select loc_home, org, 'ZZ105 Home Park', '1200 Monroe St' from h105_fx union all
select loc_other, org, 'ZZ105 Other League Park', null::text from h105_fx;

insert into public.venues (id, owner_id, name, location_id)
select v_home, org, 'ZZ105 Andrews', loc_home from h105_fx union all
select v_other, org, 'ZZ105 Perry', loc_other from h105_fx union all
select v_nopark, org, 'ZZ105 Loose Field', null::uuid from h105_fx;

insert into public.interleague_orgs (id, owner_id, name, admin_email, contact_name, contact_phone, notes)
select io, org, 'ZZ105 Northgate LL', 'zz105-secret@example.com', 'ZZ_SECRET_CONTACT', '555-0100', 'ZZ_SECRET_IONOTE' from h105_fx;

insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date, archived_at)
select s_now,    'ZZ105 Now',     'Baseball', 'Fall 2026', org, today - 30, today + 30, null::timestamptz from h105_fx union all
select s_e7,     'ZZ105 Ended 7', 'Baseball', 'Fall 2026', org, today - 60, today - 7,  null::timestamptz from h105_fx union all
select s_e8,     'ZZ105 Ended 8', 'Baseball', 'Fall 2026', org, today - 60, today - 8,  null::timestamptz from h105_fx union all
select s_arch,   'ZZ105 Archived','Baseball', 'Fall 2026', org, today - 30, today + 30, now() from h105_fx union all
select s_nolock, 'ZZ105 No lock', 'Baseball', 'Fall 2026', org, today - 30, today + 30, null::timestamptz from h105_fx;

insert into public.divisions (id, league_id, name, settings)
select div_a, s_now, 'ZZ105 Majors', '{"game_duration": 120, "teams": [{"name": "x", "coach_email": "ZZ_SECRET_COACH"}]}'::jsonb from h105_fx union all
select div_b, s_now, 'ZZ105 Rookies', '{"game_duration": 90}'::jsonb from h105_fx union all
-- One bracket per division (playoffs_league_id_division_id_key), so the draft
-- bracket gets its own locked division.
select div_c, s_now, 'ZZ105 Minors', '{"game_duration": 105}'::jsonb from h105_fx union all
select div_e7, s_e7, 'ZZ105 E7', '{}'::jsonb from h105_fx union all
select div_e8, s_e8, 'ZZ105 E8', '{}'::jsonb from h105_fx union all
select div_arch, s_arch, 'ZZ105 Arch', '{}'::jsonb from h105_fx union all
select div_nolock, s_nolock, 'ZZ105 Unlocked only', '{}'::jsonb from h105_fx;

insert into public.teams (id, league_id, division_id, name, contact_email)
select a1, s_now, div_a, 'ZZ105 Expos', 'zz105-team-secret@example.com' from h105_fx union all
select a2, s_now, div_a, 'ZZ105 Bears', null::text from h105_fx union all
select b1, s_now, div_b, 'ZZ105 Cubs', null::text from h105_fx union all
select b2, s_now, div_b, 'ZZ105 Twins', null::text from h105_fx;

insert into public.games (id, league_id, home_team_id, away_team_id, venue_id, scheduled_at, status, notes, home_score, away_score,
                          interleague_org_id, is_away, external_team_name, proposed_venue_name)
select g_home,    s_now, a1, a2,          v_home,   (today + 3)::timestamp + time '09:00', 'scheduled', 'ZZ_SECRET_NOTE', 7, 3, null::uuid, false, null::text, null::text from h105_fx union all
select g_other,   s_now, a1, a2,          v_other,  (today + 3)::timestamp + time '11:00', 'scheduled', null::text, null::int, null::int, null::uuid, false, null::text, null::text from h105_fx union all
select g_nopark,  s_now, a2, a1,          v_nopark, (today + 3)::timestamp + time '13:00', 'scheduled', null::text, null::int, null::int, null::uuid, false, null::text, null::text from h105_fx union all
select g_cx,      s_now, a2, a1,          v_home,   (today + 4)::timestamp + time '09:00', 'cancelled', null::text, null::int, null::int, null::uuid, false, null::text, null::text from h105_fx union all
select g_rp,      s_now, a1, a2,          v_home,   (today + 5)::timestamp + time '09:00', 'reschedule_pending', null::text, null::int, null::int, null::uuid, false, null::text, null::text from h105_fx union all
select g_pending, s_now, a1, null::uuid,  v_home,   (today + 6)::timestamp + time '09:00', 'pending_interleague', null::text, null::int, null::int, io, false, 'ZZ105 Pending Partner', 'ZZ105 Countered Field' from h105_fx union all
select g_il_away, s_now, a1, null::uuid,  null::uuid, (today + 7)::timestamp + time '09:00', 'scheduled', null::text, null::int, null::int, io, true, 'ZZ105 Northgate Rays', 'ZZ105 Northgate Field 2' from h105_fx union all
select g_b,       s_now, b1, b2,          v_home,   (today + 3)::timestamp + time '15:00', 'scheduled', null::text, null::int, null::int, null::uuid, false, null::text, null::text from h105_fx;

insert into public.playoffs (id, league_id, division_id, format, status)
select p_active, s_now, div_a, 'single_elimination', 'active' from h105_fx union all
select p_draft,  s_now, div_c, 'single_elimination', 'draft' from h105_fx union all
select p_b,      s_now, div_b, 'single_elimination', 'active' from h105_fx;

insert into public.playoff_games (id, playoff_id, league_id, division_id, round, game_number, home_team_id, away_team_id, venue_id, scheduled_date, start_time, status, winner_id, home_score)
select pg1, p_active, s_now, div_a, 'SF', 1, a1, a2, v_home, today + 20, time '10:00', 'scheduled', null::uuid, null::int from h105_fx union all
select pg2, p_active, s_now, div_a, 'F',  3, null::uuid, null::uuid, null::uuid, null::date, null::time, 'scheduled', null::uuid, null::int from h105_fx union all
select pg3, p_draft,  s_now, div_c, 'F',  1, a1, a2, v_home, today + 21, time '10:00', 'scheduled', null::uuid, null::int from h105_fx union all
select pg4, p_b,      s_now, div_b, 'F',  1, b1, b2, v_home, today + 21, time '12:00', 'scheduled', null::uuid, null::int from h105_fx;

update public.divisions set locked = true
 where id in (select unnest(array[div_a, div_c, div_e7, div_e8, div_arch]) from h105_fx);

-- Runs a statement as a role (and, for authenticated, as a user). Returns
-- 'OK rows=N' or 'ERR <sqlstate> <message>'.
create function pg_temp.h105_try(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_n   integer;
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    v_out := 'OK rows=' || v_n;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

-- Calls a jsonb-returning expression as a role; errors come back as {error}.
create function pg_temp.h105_json(p_role text, p_uid uuid, p_sql text)
returns jsonb
language plpgsql
as $fn$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate || ' ' || sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$fn$;

create function pg_temp.h105_read(p_token text)
returns jsonb
language plpgsql
as $fn$
begin
  return pg_temp.h105_json('anon', null, format('select public.get_league_schedule_by_token(%L)', p_token));
end;
$fn$;

create function pg_temp.h105_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx       h105_fx%rowtype;
  v_fails  text[] := array[]::text[];
  v_r      jsonb;
  v_j      jsonb;
  v_s      jsonb;
  v_g      jsonb;
  v_txt    text;
  v_tok    text;
  v_tok2   text;
  v_plan   text;
  v_ids    text[];
  v_pids   text[];
  v_sids   text[];
begin
  select * into fx from h105_fx;
  -- Start every pass from no link and the org's real plan. The home park is
  -- flagged here because the column only exists once the migration has run.
  delete from public.public_schedule_links where org_id = fx.org;
  update public.locations set is_home_park = (id = fx.loc_home) where id in (fx.loc_home, fx.loc_other);

  -- ── L1 ────────────────────────────────────────────────────────────────────
  if pg_temp.h105_read('not-a-token') ->> 'status' is distinct from 'unknown'
     or pg_temp.h105_read(repeat('a', 64)) ->> 'status' is distinct from 'unknown' then
    v_fails := array_append(v_fails, 'L1: a malformed or unknown token was not answered unknown');
  end if;

  -- ── L2 ────────────────────────────────────────────────────────────────────
  v_r := pg_temp.h105_json('authenticated', fx.org, format('select public.set_public_schedule_enabled(%L, true)', fx.org));
  v_tok := v_r ->> 'token';
  if v_r ? 'error' or v_tok is null or v_tok !~ '^[0-9a-f]{64}$' or (v_r ->> 'enabled') <> 'true' then
    v_fails := array_append(v_fails, 'L2: turning the page on failed: ' || coalesce(v_r::text, 'null'));
    return jsonb_build_object('fails', to_jsonb(v_fails));
  end if;
  v_j := pg_temp.h105_read(v_tok);
  if v_j ->> 'status' is distinct from 'ok' then
    v_fails := array_append(v_fails, 'L2: the reader did not answer ok: ' || left(v_j::text, 200));
    return jsonb_build_object('fails', to_jsonb(v_fails));
  end if;

  -- ── L3 ────────────────────────────────────────────────────────────────────
  v_r := pg_temp.h105_json('authenticated', fx.org, format('select public.set_public_schedule_enabled(%L, false)', fx.org));
  if pg_temp.h105_read(v_tok) ->> 'status' is distinct from 'off' then
    v_fails := array_append(v_fails, 'L3: turned off but the reader did not answer off');
  end if;
  v_r := pg_temp.h105_json('authenticated', fx.org, format('select public.set_public_schedule_enabled(%L, true)', fx.org));
  if v_r ->> 'token' is distinct from v_tok or pg_temp.h105_read(v_tok) ->> 'status' is distinct from 'ok' then
    v_fails := array_append(v_fails, 'L3: turning back on did not restore the same link: ' || coalesce(v_r::text, 'null'));
    v_tok := coalesce(v_r ->> 'token', v_tok);
  end if;

  -- ── L4 ────────────────────────────────────────────────────────────────────
  v_r := pg_temp.h105_json('authenticated', fx.org, format('select public.reset_public_schedule_link(%L)', fx.org));
  v_tok2 := v_r ->> 'token';
  if v_tok2 is null or v_tok2 = v_tok or v_tok2 !~ '^[0-9a-f]{64}$'
     or pg_temp.h105_read(v_tok) ->> 'status' is distinct from 'unknown'
     or pg_temp.h105_read(v_tok2) ->> 'status' is distinct from 'ok' then
    v_fails := array_append(v_fails, 'L4: reset did not replace the link: ' || coalesce(v_r::text, 'null'));
  end if;
  v_tok := coalesce(v_tok2, v_tok);

  -- ── L5 ────────────────────────────────────────────────────────────────────
  v_txt := pg_temp.h105_try('authenticated', fx.nonmember, format('select public.set_public_schedule_enabled(%L, true)', fx.org));
  if v_txt not like 'ERR 42501%' then v_fails := array_append(v_fails, 'L5: a non-member turned the page on: ' || v_txt); end if;
  v_txt := pg_temp.h105_try('authenticated', fx.nonmember, format('select public.reset_public_schedule_link(%L)', fx.org));
  if v_txt not like 'ERR 42501%' then v_fails := array_append(v_fails, 'L5: a non-member reset the link: ' || v_txt); end if;
  v_txt := pg_temp.h105_try('anon', null, format('select public.set_public_schedule_enabled(%L, false)', fx.org));
  if v_txt not like 'ERR 42501%' then v_fails := array_append(v_fails, 'L5: anon called set_public_schedule_enabled: ' || v_txt); end if;
  v_txt := pg_temp.h105_try('anon', null, format('select public.reset_public_schedule_link(%L)', fx.org));
  if v_txt not like 'ERR 42501%' then v_fails := array_append(v_fails, 'L5: anon called reset_public_schedule_link: ' || v_txt); end if;
  v_txt := pg_temp.h105_try('authenticated', fx.nonmember, format('select 1 from public.public_schedule_links where org_id = %L', fx.org));
  if v_txt <> 'OK rows=0' then v_fails := array_append(v_fails, 'L5: a non-member read the link row: ' || v_txt); end if;
  v_txt := pg_temp.h105_try('anon', null, 'select 1 from public.public_schedule_links');
  if v_txt not like 'ERR 42501%' then v_fails := array_append(v_fails, 'L5: anon read the link table: ' || v_txt); end if;

  -- ── L6 (plan) ─────────────────────────────────────────────────────────────
  select plan into v_plan from public.profiles where id = fx.org;
  update public.profiles set plan = 'free' where id = fx.org;
  if pg_temp.h105_read(v_tok) ->> 'status' is distinct from 'plan' then
    v_fails := array_append(v_fails, 'L6: a free org''s link did not answer plan');
  end if;
  v_txt := pg_temp.h105_try('authenticated', fx.org, format('select public.set_public_schedule_enabled(%L, true)', fx.org));
  if v_txt not like 'ERR P0001%plan_required%' then v_fails := array_append(v_fails, 'L6: a free org turned the page on: ' || v_txt); end if;
  v_txt := pg_temp.h105_try('authenticated', fx.org, format('select public.reset_public_schedule_link(%L)', fx.org));
  if v_txt not like 'ERR P0001%plan_required%' then v_fails := array_append(v_fails, 'L6: a free org reset the link: ' || v_txt); end if;
  v_txt := pg_temp.h105_try('authenticated', fx.org, format('select public.set_public_schedule_enabled(%L, false)', fx.org));
  if v_txt <> 'OK rows=1' then v_fails := array_append(v_fails, 'L6: a free org could not turn the page off: ' || v_txt); end if;
  update public.profiles set plan = v_plan where id = fx.org;
  v_r := pg_temp.h105_json('authenticated', fx.org, format('select public.set_public_schedule_enabled(%L, true)', fx.org));

  -- ── Content ───────────────────────────────────────────────────────────────
  v_j := pg_temp.h105_read(v_tok);
  select s into v_s from jsonb_array_elements(v_j -> 'seasons') s where s ->> 'id' = fx.s_now::text;
  if v_s is null then
    v_fails := array_append(v_fails, 'W1: the current fixture season is missing');
    return jsonb_build_object('fails', to_jsonb(v_fails));
  end if;
  select coalesce(array_agg(g ->> 'id'), '{}') into v_ids from jsonb_array_elements(v_s -> 'games') g;
  select coalesce(array_agg(g ->> 'id'), '{}') into v_pids from jsonb_array_elements(v_s -> 'playoff_games') g;

  -- U1 — the unlocked division
  if exists (select 1 from jsonb_array_elements(v_s -> 'divisions') d where d ->> 'id' = fx.div_b::text)
     or not (v_s -> 'unpublished') ? 'ZZ105 Rookies'
     or (v_s -> 'unpublished') ? 'ZZ105 Majors'
     or fx.g_b::text = any(v_ids)
     or exists (select 1 from jsonb_array_elements(v_s -> 'games') g where g ->> 'division_id' = fx.div_b::text)
     or exists (select 1 from jsonb_array_elements(v_s -> 'teams') t where t ->> 'id' in (fx.b1::text, fx.b2::text))
     or fx.pg4::text = any(v_pids) then
    v_fails := array_append(v_fails, 'U1: the unlocked division leaked (or was not listed as unpublished)');
  end if;

  -- PI1
  if fx.g_pending::text = any(v_ids) then
    v_fails := array_append(v_fails, 'PI1: a pending interleague game was returned');
  end if;

  -- ST1
  if not (fx.g_home::text = any(v_ids))
     or not exists (select 1 from jsonb_array_elements(v_s -> 'games') g where g ->> 'id' = fx.g_cx::text and g ->> 'status' = 'cancelled')
     or not exists (select 1 from jsonb_array_elements(v_s -> 'games') g where g ->> 'id' = fx.g_rp::text and g ->> 'status' = 'reschedule_pending') then
    v_fails := array_append(v_fails, 'ST1: a scheduled, rained-out or reschedule-pending game is missing or lost its status');
  end if;

  -- H1
  select g into v_g from jsonb_array_elements(v_s -> 'games') g where g ->> 'id' = fx.g_home::text;
  if (v_g -> 'venue' ->> 'home_park') is distinct from 'true' or (v_g -> 'venue' ->> 'address') is distinct from '1200 Monroe St'
     or (v_g -> 'venue' -> 'location' ->> 'name') is distinct from 'ZZ105 Home Park' then
    v_fails := array_append(v_fails, 'H1: the home-park game is not marked home (or lost its park/address): ' || coalesce((v_g -> 'venue')::text, 'null'));
  end if;

  -- H2
  select g into v_g from jsonb_array_elements(v_s -> 'games') g where g ->> 'id' = fx.g_other::text;
  if (v_g -> 'venue' ->> 'home_park') is distinct from 'false' then
    v_fails := array_append(v_fails, 'H2: a game in another league''s park is marked home');
  end if;
  select g into v_g from jsonb_array_elements(v_s -> 'games') g where g ->> 'id' = fx.g_nopark::text;
  if (v_g -> 'venue' ->> 'home_park') is distinct from 'false' then
    v_fails := array_append(v_fails, 'H2: a field in no park is marked home');
  end if;
  select g into v_g from jsonb_array_elements(v_s -> 'games') g where g ->> 'id' = fx.g_il_away::text;
  if v_g is null or (v_g -> 'venue') <> 'null'::jsonb or (v_g ->> 'proposed_venue_name') is distinct from 'ZZ105 Northgate Field 2'
     or (v_g ->> 'interleague') <> 'true' or (v_g ->> 'is_away') <> 'true' or (v_g ->> 'external_team_name') is distinct from 'ZZ105 Northgate Rays' then
    v_fails := array_append(v_fails, 'H2: the interleague away game is wrong: ' || coalesce(v_g::text, 'missing'));
  end if;

  -- N1 — nothing private. The planted VALUES are searched in the whole
  -- answer; KEY names in the fixture season only (the test org's real season
  -- rides along in the same answer, and a real team name could contain a word
  -- like "contact" without anything leaking).
  v_txt := v_j::text;
  if v_txt ~ 'ZZ_SECRET' or v_txt ~ 'zz105-secret' or v_txt ~ 'zz105-team-secret'
     or v_txt ~ 'ZZ105 Countered Field' or v_txt ~ 'ZZ105 Pending Partner'
     or v_s::text ~ '"notes"' or v_s::text ~ 'score' or v_s::text ~ 'winner' or v_s::text ~ 'contact'
     or v_s::text ~ 'admin_email' or v_s::text ~ 'interleague_org_id' or v_s::text ~ 'coach' then
    v_fails := array_append(v_fails, 'N1: something private left the database');
  end if;

  -- PO1
  if not (fx.pg1::text = any(v_pids)) or not (fx.pg2::text = any(v_pids)) or fx.pg3::text = any(v_pids) then
    v_fails := array_append(v_fails, 'PO1: playoff games wrong (draft returned, or an active bracket game missing): ' || coalesce(v_pids::text, 'null'));
  end if;

  -- W1
  select coalesce(array_agg(s ->> 'id'), '{}') into v_sids from jsonb_array_elements(v_j -> 'seasons') s;
  if not (fx.s_e7::text = any(v_sids)) or fx.s_e8::text = any(v_sids) or fx.s_arch::text = any(v_sids)
     or fx.s_nolock::text = any(v_sids) or (v_j ->> 'today') is distinct from fx.today::text then
    v_fails := array_append(v_fails, 'W1: season window wrong: ' || v_sids::text || ' today=' || coalesce(v_j ->> 'today', 'null'));
  end if;

  return jsonb_build_object('fails', to_jsonb(v_fails));
end;
$fn$;

do $h105$
declare
  v_fails  text[] := array[]::text[];
  v_out    text := E'\n';
  v_m      jsonb;
  v_first  text;
  v_tag    text;
  v_def    text;
  v_mut    text;
  m        record;
  r        record;
  v_reader constant text := 'public.get_league_schedule_by_token(text)';
  v_set    constant text := 'public.set_public_schedule_enabled(uuid, boolean)';
  v_reset  constant text := 'public.reset_public_schedule_link(uuid)';
begin
  execute $mig105$
-- @@MIGRATION_0105@@
$mig105$;

  -- P1 — privileges.
  if not has_function_privilege('anon', v_reader, 'execute') or not has_function_privilege('authenticated', v_reader, 'execute')
     or has_function_privilege('service_role', v_reader, 'execute') or has_function_privilege('dashboard_readonly', v_reader, 'execute') then
    v_fails := array_append(v_fails, 'P1: reader privileges wrong');
  end if;
  for r in select unnest(array[v_set, v_reset]) as fn loop
    if has_function_privilege('anon', r.fn, 'execute') or not has_function_privilege('authenticated', r.fn, 'execute')
       or has_function_privilege('service_role', r.fn, 'execute') or has_function_privilege('dashboard_readonly', r.fn, 'execute') then
      v_fails := array_append(v_fails, 'P1: privileges wrong on ' || r.fn);
    end if;
  end loop;
  for r in select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as priv loop
    if has_table_privilege('authenticated', 'public.public_schedule_links', r.priv) <> (r.priv = 'SELECT')
       or has_table_privilege('anon', 'public.public_schedule_links', r.priv)
       or has_table_privilege('service_role', 'public.public_schedule_links', r.priv)
       or has_table_privilege('dashboard_readonly', 'public.public_schedule_links', r.priv) then
      v_fails := array_append(v_fails, 'P1: link table privilege wrong for ' || r.priv);
    end if;
  end loop;
  if exists (select 1 from pg_proc where oid = v_reader::regprocedure and (not prosecdef or provolatile <> 's')) then
    v_fails := array_append(v_fails, 'P1: the reader is not SECURITY DEFINER STABLE');
  end if;

  v_m := pg_temp.h105_assert();
  v_fails := v_fails || array(select jsonb_array_elements_text(v_m -> 'fails'));
  v_out := v_out || format(E'BASELINE failures (%s): %s\n', coalesce(array_length(v_fails, 1), 0), to_jsonb(v_fails));

  for m in
    select * from (values
      ('SM1', 'the games'' locked-division filter removed', 'U1', v_reader,
        $a$and hd.locked$a$, $a$and (hd.locked or true)$a$),
      ('SM2', 'pending interleague games returned', 'PI1', v_reader,
        $a$and g.status <> 'pending_interleague'$a$, $a$and true$a$),
      ('SM3', 'the game note emitted', 'N1', v_reader,
        $a$'status',              g.status,$a$, $a$'status',              g.status, 'notes', g.notes,$a$),
      ('SM4', 'any park counts as a home park', 'H2', v_reader,
        $a$coalesce(loc.is_home_park, false)$a$, $a$(loc.id is not null)$a$),
      ('SM5', 'turning back on mints a new token', 'L3', v_set,
        $a$set enabled = true, updated_at = now()$a$,
        $a$set enabled = true, updated_at = now(), token = encode(extensions.gen_random_bytes(32), 'hex')$a$)
    ) as t(id, what, target, fn, find, repl)
  loop
    begin
      v_def := pg_get_functiondef(m.fn::regprocedure);
      v_mut := replace(v_def, m.find, m.repl);
      if v_mut = v_def then
        raise exception 'MUTANT_NOOP';
      end if;
      execute v_mut;
      v_m := pg_temp.h105_assert();
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED'
             when v_tag = m.target then 'KILLED'
             else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
      raise exception 'H105_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H105_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  v_m := pg_temp.h105_assert();
  v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');
  v_out := v_out || format(E'prosrc md5 reader: %s | set_enabled: %s | reset: %s\n',
    (select md5(p.prosrc) from pg_proc p where p.oid = v_reader::regprocedure),
    (select md5(p.prosrc) from pg_proc p where p.oid = v_set::regprocedure),
    (select md5(p.prosrc) from pg_proc p where p.oid = v_reset::regprocedure));

  raise exception '%', v_out;
end;
$h105$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from information_schema.columns where table_name = 'locations' and column_name = 'is_home_park') as col_must_be_0,
--   (select count(*) from pg_class where relname = 'public_schedule_links') as tbl_must_be_0,
--   (select count(*) from pg_proc where proname in ('get_league_schedule_by_token','set_public_schedule_enabled','reset_public_schedule_link')) as fns_must_be_0,
--   (select count(*) from leagues where name like 'ZZ105%') + (select count(*) from locations where name like 'ZZ105%')
--     + (select count(*) from venues where name like 'ZZ105%') + (select count(*) from interleague_orgs where name like 'ZZ105%') as fixtures_must_be_0,
--   (select plan from profiles where id = 'aa21d01c-66dc-4c37-b15c-7b743c557eea') as srall_plan_must_be_elite;

-- ── RUN LOG ─────────────────────────────────────────────────────────────────
-- 2026-10-08 ~16:55 UTC — against production, test org "SRALL" fixtures only,
-- rolled back. No other active backend before or after.
-- Run 1: died at FIXTURE SETUP, before the migration ran — 23505 on
--   playoffs_league_id_division_id_key (one bracket per division per season).
--   The draft bracket was given its own locked division (div_c). Harness
--   fault, not a migration fault; the whole batch rolled back.
-- Run 2: GREEN.
--   BASELINE failures (0): []
--   SM1 games' locked-division filter removed → KILLED, first failure [U1]
--   SM2 pending interleague returned          → KILLED, first failure [PI1] (then N1:
--       the countered partner name/field rode along — expected)
--   SM3 the game note emitted                 → KILLED, first failure [N1]
--   SM4 any park counts as a home park        → KILLED, first failure [H2]
--   SM5 turning back on mints a new token     → KILLED, first failure [L3] (then W1:
--       the reader was then handed the dead token — expected)
--   AFTER MUTANTS failures: []
--   prosrc md5 inside the batch: reader 42b8926dd2c0efb2555128b1693752d1,
--   set_enabled a26e52df4e42e41c010d30685eb07cb9, reset
--   847e50d16e5c53002cc551b99405c47b — each equal to the body computed from
--   the repo file, so the text proven is the text that will be applied.
-- Leak check after: is_home_park column 0, link table 0, functions 0,
-- ZZ105 fixtures 0, SRALL plan elite.
-- 0105 NOT APPLIED — waiting on the founder for timing.

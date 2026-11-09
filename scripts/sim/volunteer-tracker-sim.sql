-- Proof for 0123 (volunteer sign-ups: the tracker). Assembled by
-- volunteer-tracker-build.ts, which puts the LITERAL migration text where the
-- placeholder is. It runs BEFORE 0123 is applied: one transaction that the
-- final RAISE always rolls back; the migration is applied inside a
-- rolled-back sub-run for the baseline and again for every mutant. Fixtures
-- in the "test" proof org (bbf9afe1…, Elite) — never Santa Rosa American's
-- data. The 0121 and 0122 proofs re-run against 0123 separately
-- (`volunteer-tracker-build.ts regress0121` / `regress0122`) because 0123
-- re-creates the archive wipe.
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/volunteer-tracker-build.ts
-- > proof.sql`, send it as ONE batch through the Supabase MCP, read the raised
-- message, then the leak check at the bottom.
--
-- LOCKS for the run (seconds; lock_timeout 3s), the migration's own, held to
-- the end of each sub-run: SHARE ROW EXCLUSIVE on profiles, leagues, teams,
-- umpires, game_umpires and volunteers (the new foreign keys — blocks WRITES
-- to them, not reads); ACCESS EXCLUSIVE on volunteers (the dropped column).
-- The fixture writes take ROW EXCLUSIVE on leagues, divisions, teams, games,
-- umpires, game_umpires, snack_shack_* and the volunteer tables. L1 prints
-- what the baseline holds.
--
-- Fixture (today = the org's today; P = 3 days ago, F = in 3 days):
--   Brooks  vB: P GameChanger (worked), a past shift (worked); + official u2
--               joined by EMAIL (P → worked)                       → 3/0/0/0
--   Adams   vA: P GameChanger (worked), P Field prep (role doesn't count),
--               F GameChanger (upcoming), a FUTURE rained-out game (held —
--               future, so counting it as upcoming would show; run 3)  → 1/1/0/1
--   M Patel vM: TODAY's GameChanger (upcoming, not worked)          → 0/1/0/0
--   R Patel vR: F GameChanger, family team Owls                     → 0/1/0/0
--   Xu      vX: P GameChanger, no-show                              → 0/0/1/0
--   Cole    vC: F GameChanger, CANCELED (listed — decided)          → 0/0/0/0
--   Dee     vD: a detached sign-up (listed)                         → 0/0/0/0
--   Jo      u1: counts for Expos, no email: P (worked), rained out (held),
--               F + today (upcoming), a game of ANOTHER season (never)
--                                                                   → 1/2/0/1
--   Lou     u4: counts for Pirates: P with a no-show, F            → 0/1/1/0
--   Kim     u3: NOT counted, same email as Adams (matched, not a member)
--   Zed     u5: not counted, same email as a volunteer of ANOTHER season only
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   TK1 volunteers.family_id is gone; RLS on the five tables
--   TG1 gates: a non-member, the switch off, a Pro league → refused
--   TR3 today's spot is upcoming, not worked
--   TR5 a canceled family and a detached one are listed with 0 / 0
--   TRN a no-show never counts as worked; it counts as a no-show
--   TR4 a rained-out spot is held: neither worked nor upcoming
--   TR6 a role that doesn't count isn't counted
--   TO1 officials: only "counts for" officials, their season's games only,
--       a rained-out game held, a no-show; an email match puts a counted
--       official in the volunteer's family; an uncounted one is only
--       "matched" in the panel, and only by a volunteer of THIS season
--   TR1 every family's numbers, members and teams exactly
--   TR2 the goal: out of range / a foreign role refused; which roles count
--       and whether officials count change the numbers; a null list leaves
--       the roles alone
--   TT1 family counts: range, team in the season, saved, cleared
--   TF1 merge (preview writes nothing; one family after; same family; gone)
--       and separate (a volunteer, a manually merged official, an official
--       joined by email when the family's key is the volunteer)
--   TO2 counts-for and no-show functions: wrong season, wrong team, not past,
--       not played, not counted, saved; game_umpires never written
--   TN1 the nudge: link off, no goal, one per volunteer (officials and
--       duplicates skipped), payload numbers only, the 3-day limit, a
--       canceled family can be nudged
--   TL1 no activity_log row
--   TP1 privileges: the admin functions authenticated only; the families
--       helper and the wipe no role; no role on the five tables
--   TW1 archiving deletes the season's tracker rows (and leaves another
--       season's); the tracker of an archived season is refused
-- Mutants (each must die at its own tag; a mutant whose find text doesn't
-- match exactly once is STALE):
--   MT1  a no-show counts as worked                        → TRN
--   MT2  today counts as worked                            → TR3
--   MT3  a held spot counts as upcoming                    → TR4
--   MT4  a canceled spot counts as upcoming                → TR5
--   MT5  every role counts                                 → TR6
--   MT6  an official's other-season games count            → TO1
--   MT7  an official's rained-out game counts as worked    → TO1
--   MT8  officials count even when switched off            → TR2
--   MT9  the panel matches a volunteer of another season   → TO1
--   MT10 a merge preview writes                            → TF1
--   MT11 separating an official doesn't beat the email     → TF1
--   MT12 separating a volunteer takes its email officials  → TF1
--   MT13 a family count out of range not refused           → TT1
--   MT14 a family count for another season's team          → TT1
--   MT15 a no-show on a future game                        → TO2
--   MT16 a no-show for an official who doesn't count       → TO2
--   MT17 counts-for a team of another season               → TO2
--   MT18 the 3-day nudge limit gone                        → TN1
--   MT19 a nudge with the sign-up link off                 → TN1
--   MT20 a nudge payload with a name                       → TN1
--   MT21 the tracker without its gate                      → TG1
--   MT22 the wipe keeps the goal                           → TW1
--   MT23 the wipe keeps the merges                         → TW1
--   MT24 the tracker callable by anon                      → TP1
--   MT25 the families helper callable by authenticated     → TP1
--   MT26 a family's worked is its biggest member's         → TR1
--   MT27 family_id kept                                    → TK1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '180s', true);

create or replace function pg_temp.h123_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

-- An admin call (authenticated).
create or replace function pg_temp.h123_admin(p_sub uuid, p_sql text) returns jsonb language plpgsql as $f$
declare v text;
begin
  v := pg_temp.h123_as(p_sub, 'authenticated', p_sql);
  if v is null then return 'null'::jsonb; end if;
  if v like 'ERR%' then return jsonb_build_object('error', v); end if;
  return v::jsonb;
end;
$f$;

-- The family holding a member, from a tracker reply.
create or replace function pg_temp.h123_fam(p_j jsonb, p_member uuid) returns jsonb language sql as $f$
  select f from jsonb_array_elements(coalesce(p_j -> 'families', '[]'::jsonb)) f
   where exists (select 1 from jsonb_array_elements(f -> 'members') m where (m ->> 'id')::uuid = p_member)
   limit 1;
$f$;

-- "worked/upcoming/no_shows/held" of the family holding a member.
create or replace function pg_temp.h123_n(p_j jsonb, p_member uuid) returns text language sql as $f$
  select coalesce((select format('%s/%s/%s/%s', f ->> 'worked', f ->> 'upcoming', f ->> 'no_shows', f ->> 'held')
                     from (select pg_temp.h123_fam(p_j, p_member) as f) x where x.f is not null), 'absent');
$f$;

create or replace function pg_temp.h123_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_other uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';  -- a real profile, not a member of "test"
  v_now   timestamp;
  dP date; dT date; dF date;
  v_s  uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid();
  v_d  uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid();
  tE uuid := gen_random_uuid(); tP uuid := gen_random_uuid(); tOw uuid := gen_random_uuid(); tX uuid := gen_random_uuid(); tX2 uuid := gen_random_uuid();
  gP uuid := gen_random_uuid(); gT uuid := gen_random_uuid(); gF uuid := gen_random_uuid(); gC uuid := gen_random_uuid();
  gO uuid := gen_random_uuid(); gC2 uuid := gen_random_uuid();
  v_snack uuid := gen_random_uuid(); bP uuid := gen_random_uuid();
  rGC uuid := gen_random_uuid(); rFP uuid := gen_random_uuid(); rSS uuid := gen_random_uuid(); rO uuid := gen_random_uuid();
  vA uuid := gen_random_uuid(); vB uuid := gen_random_uuid(); vM uuid := gen_random_uuid(); vR uuid := gen_random_uuid();
  vX uuid := gen_random_uuid(); vC uuid := gen_random_uuid(); vD uuid := gen_random_uuid(); vZ uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); u4 uuid := gen_random_uuid();
  u5 uuid := gen_random_uuid(); u6 uuid := gen_random_uuid();
  gu1P uuid := gen_random_uuid(); gu1C uuid := gen_random_uuid(); gu1F uuid := gen_random_uuid(); gu1T uuid := gen_random_uuid();
  gu1O uuid := gen_random_uuid(); gu2P uuid := gen_random_uuid(); gu3P uuid := gen_random_uuid(); gu4P uuid := gen_random_uuid();
  gu4F uuid := gen_random_uuid();
  j jsonb; k jsonb; v_gu text; v_n integer; v_r text; r text; f text;
begin
  -- ── Fixture ─────────────────────────────────────────────────────────────
  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'volunteers', true)
    on conflict (owner_id, feature) do update set enabled = true;
  insert into public.volunteer_settings (owner_id, link_enabled, contact_email)
    values (v_org, true, 'contact@example.test')
    on conflict (owner_id) do update set link_enabled = true, contact_email = excluded.contact_email;
  v_now := public.volunteer_org_now(v_org);
  dP := v_now::date - 3; dT := v_now::date; dF := v_now::date + 3;

  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (v_s,  'ZZ123 Season', 'Baseball', 'Fall', v_org, v_now::date - 20, v_now::date + 30),
    (v_s2, 'ZZ123 Other',  'Baseball', 'Fall', v_org, v_now::date - 20, v_now::date + 30);
  insert into public.divisions (id, league_id, name, settings) values
    (v_d, v_s, 'ZZ Minors', '{"game_duration": 90, "buffer_minutes": 15}'),
    (v_d2, v_s2, 'ZZ Other', '{}');
  insert into public.teams (id, league_id, division_id, name) values
    (tE, v_s, v_d, 'ZZ Expos'), (tP, v_s, v_d, 'ZZ Pirates'), (tOw, v_s, v_d, 'ZZ Owls'), (tX, v_s2, v_d2, 'ZZ Other Team'), (tX2, v_s2, v_d2, 'ZZ Other Team 2');
  insert into public.games (id, league_id, home_team_id, away_team_id, scheduled_at, status) values
    (gP, v_s, tE, tP, (dP + time '10:00') at time zone 'UTC', 'scheduled'),
    (gT, v_s, tE, tOw, (dT + time '10:00') at time zone 'UTC', 'scheduled'),
    (gF, v_s, tE, tP, (dF + time '10:00') at time zone 'UTC', 'scheduled'),
    (gC, v_s, tE, tOw, ((v_now::date - 2) + time '10:00') at time zone 'UTC', 'cancelled'),
    (gC2, v_s, tP, tOw, ((v_now::date + 2) + time '10:00') at time zone 'UTC', 'cancelled'),
    (gO, v_s2, tX, tX2, (dP + time '12:00') at time zone 'UTC', 'scheduled');
  update public.divisions set locked = true where id in (v_d, v_d2);

  insert into public.snack_shack_settings (id, season_id, start_date, end_date, people_per_shift)
    values (v_snack, v_s, v_now::date - 20, v_now::date + 30, 1);
  insert into public.snack_shack_blocks (id, snack_shack_id, date, start_time, end_time) values (bP, v_snack, dP, '08:00', '09:00');

  insert into public.volunteer_roles (id, owner_id, season_id, name, kind, spots, counts_toward_goal) values
    (rGC, v_org, v_s, 'GameChanger', 'per_team', 2, true),
    (rFP, v_org, v_s, 'Field prep', 'per_game', 2, false),
    (rSS, v_org, v_s, 'Snack shack', 'snack_shack', 1, true),
    (rO,  v_org, v_s2, 'Other role', 'per_game', 1, true);

  insert into public.volunteers (id, owner_id, email_lc, first_initial, last_name, adult_confirmed_at) values
    (vA, v_org, 'adams@zz123.test', 'J', 'Adams', now()),
    (vB, v_org, 'brooks@zz123.test', 'T', 'Brooks', now()),
    (vM, v_org, 'mpatel@zz123.test', 'M', 'Patel', now()),
    (vR, v_org, 'rpatel@zz123.test', 'R', 'Patel', now()),
    (vX, v_org, 'xu@zz123.test', 'L', 'Xu', now()),
    (vC, v_org, 'cole@zz123.test', 'A', 'Cole', now()),
    (vD, v_org, 'dee@zz123.test', 'D', 'Dee', now()),
    (vZ, v_org, 'zed@zz123.test', 'Z', 'Zed', now());

  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, family_team_id, game_id, snack_shack_block_id,
                                       role_id, for_team_id, position, status, no_show, created_by, created_at, canceled_at,
                                       detached_from, detached_at) values
    (v_org, v_s, vB, tE, gP, null, rGC, tE, 1, 'active', false, 'volunteer', now() - interval '9 days', null, null, null),
    (v_org, v_s, vB, tE, null, bP, rSS, null, 1, 'active', false, 'volunteer', now() - interval '9 days', null, null, null),
    (v_org, v_s, vA, tE, gP, null, rGC, tP, 1, 'active', false, 'volunteer', now() - interval '8 days', null, null, null),
    (v_org, v_s, vA, tE, gP, null, rFP, null, 1, 'active', false, 'volunteer', now() - interval '8 days', null, null, null),
    (v_org, v_s, vA, tE, gF, null, rGC, tE, 1, 'active', false, 'volunteer', now() - interval '8 days', null, null, null),
    (v_org, v_s, vA, tE, gC2, null, rGC, tP, 1, 'active', false, 'volunteer', now() - interval '8 days', null, null, null),
    (v_org, v_s, vM, tP, gT, null, rGC, tE, 1, 'active', false, 'volunteer', now() - interval '7 days', null, null, null),
    (v_org, v_s, vR, tOw, gF, null, rGC, tP, 1, 'active', false, 'volunteer', now() - interval '6 days', null, null, null),
    (v_org, v_s, vX, tE, gP, null, rGC, tE, 2, 'active', true,  'volunteer', now() - interval '5 days', null, null, null),
    (v_org, v_s, vC, tE, gF, null, rGC, tE, 2, 'canceled', false, 'volunteer', now() - interval '4 days', now(), null, null),
    (v_org, v_s, vD, tE, null, null, rGC, tE, 1, 'detached', false, 'volunteer', now() - interval '3 days', null,
       '{"start": "2030-01-01T09:00"}'::jsonb, now()),
    (v_org, v_s2, vZ, tX, gO, null, rO, null, 1, 'active', false, 'volunteer', now() - interval '3 days', null, null, null);

  insert into public.umpires (id, season_id, name, designation, email) values
    (u1, v_s, 'Jo Smith', 'adult', null),
    (u2, v_s, 'Pat Brooks', 'adult', ' Brooks@ZZ123.test '),
    (u3, v_s, 'Kim Adams', 'adult', 'adams@zz123.test'),
    (u4, v_s, 'Lou Lane', 'adult', null),
    (u5, v_s, 'Zed Z', 'youth', 'zed@zz123.test'),
    (u6, v_s2, 'Other Ump', 'adult', null);
  insert into public.game_umpires (id, game_id, umpire_id, role) values
    (gu1P, gP, u1, 'Plate'), (gu2P, gP, u2, 'Base 1'), (gu3P, gP, u3, 'Base 2'), (gu4P, gP, u4, 'Base 3'),
    (gu1C, gC, u1, 'Plate'), (gu1F, gF, u1, 'Plate'), (gu4F, gF, u4, 'Base 1'), (gu1T, gT, u1, 'Plate'),
    (gu1O, gO, u1, 'Plate');
  insert into public.volunteer_official_links (umpire_id, season_id, owner_id, counts_for_team_id) values
    (u1, v_s, v_org, tE), (u2, v_s, v_org, tE), (u4, v_s, v_org, tP);
  insert into public.volunteer_official_no_shows (game_umpire_id, season_id, owner_id) values (gu4P, v_s, v_org);
  insert into public.volunteer_goals (season_id, owner_id, shifts_per_family) values (v_s2, v_org, 3);
  v_gu := (select md5(string_agg(to_jsonb(g)::text, '|' order by g.id)) from public.game_umpires g
            where g.id in (gu1P, gu1C, gu1F, gu1T, gu1O, gu2P, gu3P, gu4P, gu4F));

  -- ── TK1 ─────────────────────────────────────────────────────────────────
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'volunteers' and column_name = 'family_id') then
    return 'TK1 volunteers.family_id still exists';
  end if;
  foreach f in array array['volunteer_goals', 'volunteer_team_family_counts', 'volunteer_family_members',
                           'volunteer_official_links', 'volunteer_official_no_shows'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || f)::regclass) then
      return 'TK1 RLS off on ' || f;
    end if;
  end loop;

  -- ── TG1 gates ───────────────────────────────────────────────────────────
  j := pg_temp.h123_admin(v_other, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if coalesce(j ->> 'error', '') not like '%not_authorized%' then
    return 'TG1 a non-member read the tracker: ' || left(j::text, 200);
  end if;
  update public.org_features set enabled = false where owner_id = v_org and feature = 'volunteers';
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  update public.org_features set enabled = true where owner_id = v_org and feature = 'volunteers';
  if coalesce(j ->> 'error', '') not like '%feature_off%' then
    return 'TG1 the tracker with the switch off: ' || left(j::text, 200);
  end if;
  update public.profiles set plan = 'pro' where id = v_org;
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  update public.profiles set plan = 'elite' where id = v_org;
  if coalesce(j ->> 'error', '') not like '%plan_required%' then
    return 'TG1 the tracker on Pro: ' || left(j::text, 200);
  end if;

  -- The baseline read.
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if j ? 'error' or jsonb_typeof(j -> 'families') <> 'array' then
    return 'FIX the tracker read failed: ' || left(j::text, 300);
  end if;

  -- ── TR3 today is upcoming ───────────────────────────────────────────────
  if pg_temp.h123_n(j, vM) <> '0/1/0/0' then
    return 'TR3 today''s spot: M Patel ' || pg_temp.h123_n(j, vM) || ' (want 0/1/0/0)';
  end if;
  -- ── TR5 canceled / detached listed at zero ──────────────────────────────
  if pg_temp.h123_n(j, vC) <> '0/0/0/0' or pg_temp.h123_n(j, vD) <> '0/0/0/0' then
    return 'TR5 Cole ' || pg_temp.h123_n(j, vC) || ', Dee ' || pg_temp.h123_n(j, vD) || ' (want 0/0/0/0 both, listed)';
  end if;
  -- ── TRN a no-show ───────────────────────────────────────────────────────
  if pg_temp.h123_n(j, vX) <> '0/0/1/0' then
    return 'TRN Xu ' || pg_temp.h123_n(j, vX) || ' (want 0/0/1/0)';
  end if;
  -- ── TR4 held ────────────────────────────────────────────────────────────
  k := pg_temp.h123_fam(j, vA);
  if (k ->> 'held')::int <> 1 or (k ->> 'upcoming')::int <> 1 then
    return 'TR4 Adams held/upcoming ' || (k ->> 'held') || '/' || (k ->> 'upcoming') || ' (want 1/1)';
  end if;
  -- ── TR6 a role that doesn't count ───────────────────────────────────────
  if (k ->> 'worked')::int <> 1 then
    return 'TR6 Adams worked ' || (k ->> 'worked') || ' (want 1: Field prep doesn''t count)';
  end if;
  -- ── TO1 officials ───────────────────────────────────────────────────────
  if pg_temp.h123_n(j, u1) <> '1/2/0/1' then
    return 'TO1 Jo ' || pg_temp.h123_n(j, u1) || ' (want 1/2/0/1: P worked, today + F upcoming, rained out held, other season never)';
  end if;
  if pg_temp.h123_n(j, u4) <> '0/1/1/0' then
    return 'TO1 Lou ' || pg_temp.h123_n(j, u4) || ' (want 0/1/1/0)';
  end if;
  if pg_temp.h123_fam(j, u3) is not null or pg_temp.h123_fam(j, u5) is not null then
    return 'TO1 an official who doesn''t count is in a family';
  end if;
  k := pg_temp.h123_fam(j, vB);
  if k is null or not exists (select 1 from jsonb_array_elements(k -> 'members') m
                               where (m ->> 'id')::uuid = u2 and (m ->> 'by_email')::boolean and m ->> 'kind' = 'official') then
    return 'TO1 the counted official with Brooks''s email is not in the Brooks family by email';
  end if;
  k := (select o from jsonb_array_elements(j -> 'officials') o where (o ->> 'umpire_id')::uuid = u3);
  if (k ->> 'matched_volunteer_id')::uuid is distinct from vA or jsonb_array_length(k -> 'games') <> 0 then
    return 'TO1 the uncounted official: matched ' || coalesce(k ->> 'matched_volunteer_id', 'null') || ', games ' || (k -> 'games')::text;
  end if;
  k := (select o from jsonb_array_elements(j -> 'officials') o where (o ->> 'umpire_id')::uuid = u5);
  if k ->> 'matched_volunteer_id' is not null then
    return 'TO1 matched to a volunteer of ANOTHER season';
  end if;
  k := (select o from jsonb_array_elements(j -> 'officials') o where (o ->> 'umpire_id')::uuid = u1);
  if jsonb_array_length(k -> 'games') <> 4 then
    return 'TO1 Jo''s panel games ' || jsonb_array_length(k -> 'games') || ' (want 4: not the other season''s)';
  end if;
  if (select count(*) from jsonb_array_elements(j -> 'officials')) <> 5 then
    return 'TO1 the panel lists the season''s officials only';
  end if;
  -- ── TR1 every family exactly ────────────────────────────────────────────
  if jsonb_array_length(j -> 'families') <> 9 then
    return 'TR1 families ' || jsonb_array_length(j -> 'families') || ' (want 9)';
  end if;
  if pg_temp.h123_n(j, vB) <> '3/0/0/0' then
    return 'TR1 Brooks ' || pg_temp.h123_n(j, vB) || ' (want 3/0/0/0: a game, a shift, the official)';
  end if;
  if pg_temp.h123_n(j, vA) <> '1/1/0/1' or pg_temp.h123_n(j, vR) <> '0/1/0/0' then
    return 'TR1 Adams ' || pg_temp.h123_n(j, vA) || ', R Patel ' || pg_temp.h123_n(j, vR);
  end if;
  if (pg_temp.h123_fam(j, vR) -> 'team_ids') <> jsonb_build_array(tOw)
     or (pg_temp.h123_fam(j, vB) -> 'team_ids') <> jsonb_build_array(tE) then
    return 'TR1 team ids: R Patel ' || (pg_temp.h123_fam(j, vR) -> 'team_ids')::text || ', Brooks ' || (pg_temp.h123_fam(j, vB) -> 'team_ids')::text;
  end if;
  if jsonb_array_length(pg_temp.h123_fam(j, vB) -> 'members') <> 2
     or (pg_temp.h123_fam(j, vB) -> 'members' -> 0 ->> 'id')::uuid <> vB then
    return 'TR1 Brooks''s members: the volunteer first, then the official';
  end if;
  if (pg_temp.h123_fam(j, vB) -> 'members' -> 0) ?| array['detached_from', 'phone', 'notes'] then
    return 'TR1 a member carries more than its name and email';
  end if;
  if j -> 'goal' <> '{"shifts_per_family": null, "officials_count": true}'::jsonb then
    return 'TR1 the default goal ' || (j -> 'goal')::text;
  end if;

  -- ── TR2 the goal ────────────────────────────────────────────────────────
  k := pg_temp.h123_admin(v_org, format('select public.set_volunteer_goal(%L::uuid, 21, true, null)::text', v_s));
  if k ->> 'status' is distinct from 'invalid_goal' then return 'TR2 a goal of 21: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_volunteer_goal(%L::uuid, 2, true, %L::uuid[])::text', v_s, '{' || rO || '}'));
  if k ->> 'status' is distinct from 'invalid_role' then return 'TR2 another season''s role: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_volunteer_goal(%L::uuid, 2, true, %L::uuid[])::text', v_s, '{' || rSS || '}'));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if k ->> 'status' is distinct from 'saved' or pg_temp.h123_n(j, vA) <> '0/0/0/0' or pg_temp.h123_n(j, vB) <> '2/0/0/0' then
    return 'TR2 only snack shack counting: Adams ' || pg_temp.h123_n(j, vA) || ', Brooks ' || pg_temp.h123_n(j, vB) || ' ' || k::text;
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_volunteer_goal(%L::uuid, 2, false, %L::uuid[])::text', v_s, '{' || rGC || ',' || rSS || '}'));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if pg_temp.h123_fam(j, u1) is not null or pg_temp.h123_n(j, vB) <> '2/0/0/0' or jsonb_array_length(j -> 'families') <> 7 then
    return 'TR2 officials switched off: Jo ' || pg_temp.h123_n(j, u1) || ', Brooks ' || pg_temp.h123_n(j, vB) || ', families ' || jsonb_array_length(j -> 'families');
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_volunteer_goal(%L::uuid, 2, true, null)::text', v_s));
  if (select counts_toward_goal from public.volunteer_roles where id = rGC) is not true
     or (select counts_toward_goal from public.volunteer_roles where id = rFP) is not false then
    return 'TR2 a null role list changed the roles';
  end if;
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if j -> 'goal' <> '{"shifts_per_family": 2, "officials_count": true}'::jsonb or pg_temp.h123_n(j, vB) <> '3/0/0/0' then
    return 'TR2 restored: ' || (j -> 'goal')::text || ' Brooks ' || pg_temp.h123_n(j, vB);
  end if;

  -- ── TT1 family counts ───────────────────────────────────────────────────
  k := pg_temp.h123_admin(v_org, format('select public.set_team_family_count(%L::uuid, %L::uuid, 0)::text', v_s, tE));
  if k ->> 'status' is distinct from 'invalid_count' then return 'TT1 a count of 0: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_team_family_count(%L::uuid, %L::uuid, 61)::text', v_s, tE));
  if k ->> 'status' is distinct from 'invalid_count' then return 'TT1 a count of 61: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_team_family_count(%L::uuid, %L::uuid, 5)::text', v_s, tX));
  if k ->> 'status' is distinct from 'not_found' then return 'TT1 another season''s team: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_team_family_count(%L::uuid, %L::uuid, 10)::text', v_s, tE));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if k ->> 'status' is distinct from 'saved' or j -> 'team_counts' <> jsonb_build_array(jsonb_build_object('team_id', tE, 'families', 10)) then
    return 'TT1 saved: ' || k::text || ' ' || (j -> 'team_counts')::text;
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_team_family_count(%L::uuid, %L::uuid, null)::text', v_s, tE));
  if exists (select 1 from public.volunteer_team_family_counts where team_id = tE) then return 'TT1 a blank count not cleared'; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_team_family_count(%L::uuid, %L::uuid, 10)::text', v_s, tE));

  -- ── TF1 merge and separate ──────────────────────────────────────────────
  k := pg_temp.h123_admin(v_org, format('select public.merge_volunteer_families(%L::uuid, %L::uuid, %L::uuid, false)::text', v_s, vM, vR));
  if k ->> 'status' is distinct from 'ready' or (k ->> 'members')::int <> 2
     or exists (select 1 from public.volunteer_family_members where season_id = v_s) then
    return 'TF1 a merge preview: ' || k::text || ' rows ' || (select count(*) from public.volunteer_family_members where season_id = v_s);
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.merge_volunteer_families(%L::uuid, %L::uuid, %L::uuid, true)::text', v_s, vM, vR));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if k ->> 'status' is distinct from 'merged' or pg_temp.h123_n(j, vM) <> '0/2/0/0'
     or jsonb_array_length(pg_temp.h123_fam(j, vR) -> 'members') <> 2
     or jsonb_array_length(pg_temp.h123_fam(j, vR) -> 'team_ids') <> 2 then
    return 'TF1 merged Patels: ' || k::text || ' ' || pg_temp.h123_n(j, vM);
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.merge_volunteer_families(%L::uuid, %L::uuid, %L::uuid, true)::text', v_s, vR, vM));
  if k ->> 'status' is distinct from 'same_family' then return 'TF1 merging one family with itself: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.merge_volunteer_families(%L::uuid, %L::uuid, %L::uuid, true)::text', v_s, vM, gen_random_uuid()));
  if k ->> 'status' is distinct from 'not_found' then return 'TF1 a merge with nobody: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.separate_volunteer_family_member(%L::uuid, %L::uuid)::text', v_s, vR));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if k ->> 'status' is distinct from 'separated' or pg_temp.h123_n(j, vM) <> '0/1/0/0' or pg_temp.h123_n(j, vR) <> '0/1/0/0' then
    return 'TF1 separate a volunteer: ' || k::text || ' M ' || pg_temp.h123_n(j, vM) || ' R ' || pg_temp.h123_n(j, vR);
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.separate_volunteer_family_member(%L::uuid, %L::uuid)::text', v_s, vR));
  if k ->> 'status' is distinct from 'not_merged' then return 'TF1 separating someone already alone: ' || k::text; end if;
  -- An official joined by email, merged into another family, then separated.
  k := pg_temp.h123_admin(v_org, format('select public.merge_volunteer_families(%L::uuid, %L::uuid, %L::uuid, true)::text', v_s, vC, u2));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if pg_temp.h123_n(j, vC) <> '3/0/0/0' or jsonb_array_length(pg_temp.h123_fam(j, vC) -> 'members') <> 3 then
    return 'TF1 merging the Brooks family (with its email official) into Cole: Cole ' || pg_temp.h123_n(j, vC);
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.separate_volunteer_family_member(%L::uuid, %L::uuid)::text', v_s, u2));
  k := pg_temp.h123_admin(v_org, format('select public.separate_volunteer_family_member(%L::uuid, %L::uuid)::text', v_s, vB));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if pg_temp.h123_n(j, u2) <> '1/0/0/0' or pg_temp.h123_n(j, vB) <> '2/0/0/0' or pg_temp.h123_n(j, vC) <> '0/0/0/0'
     or jsonb_array_length(pg_temp.h123_fam(j, u2) -> 'members') <> 1 then
    return 'TF1 a separated official stays alone (the email no longer joins it): u2 ' || pg_temp.h123_n(j, u2)
           || ' Brooks ' || pg_temp.h123_n(j, vB) || ' Cole ' || pg_temp.h123_n(j, vC);
  end if;
  -- Kim counts now and joins Adams by email; separating Adams leaves Kim alone.
  k := pg_temp.h123_admin(v_org, format('select public.set_official_counts_for(%L::uuid, %L::uuid, %L::uuid)::text', v_s, u3, tE));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if pg_temp.h123_n(j, vA) <> '2/1/0/1' then return 'TF1 Kim counted joins Adams by email: Adams ' || pg_temp.h123_n(j, vA); end if;
  k := pg_temp.h123_admin(v_org, format('select public.separate_volunteer_family_member(%L::uuid, %L::uuid)::text', v_s, vA));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if k ->> 'status' is distinct from 'separated' or pg_temp.h123_n(j, vA) <> '1/1/0/1' or pg_temp.h123_n(j, u3) <> '1/0/0/0' then
    return 'TF1 separating a volunteer leaves its email official alone: Adams ' || pg_temp.h123_n(j, vA) || ' Kim ' || pg_temp.h123_n(j, u3);
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_official_counts_for(%L::uuid, %L::uuid, null)::text', v_s, u3));

  -- ── TO2 counts-for and no-show ──────────────────────────────────────────
  k := pg_temp.h123_admin(v_org, format('select public.set_official_counts_for(%L::uuid, %L::uuid, %L::uuid)::text', v_s, u6, tE));
  if k ->> 'status' is distinct from 'not_found' then return 'TO2 another season''s official: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_official_counts_for(%L::uuid, %L::uuid, %L::uuid)::text', v_s, u1, tX));
  if k ->> 'status' is distinct from 'team_not_in_season' then return 'TO2 another season''s team: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_official_no_show(%L::uuid, true)::text', gu1F));
  if k ->> 'status' is distinct from 'not_past' then return 'TO2 a no-show on a future game: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_official_no_show(%L::uuid, true)::text', gu1C));
  if k ->> 'status' is distinct from 'not_played' then return 'TO2 a no-show on a rained-out game: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_official_no_show(%L::uuid, true)::text', gu3P));
  if k ->> 'status' is distinct from 'not_counted' then return 'TO2 a no-show for an official who doesn''t count: ' || k::text; end if;
  k := pg_temp.h123_admin(v_other, format('select public.set_official_no_show(%L::uuid, true)::text', gu1P));
  if coalesce(k ->> 'error', '') not like '%not_authorized%' then return 'TO2 a non-member marked a no-show: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_official_no_show(%L::uuid, true)::text', gu1P));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if k ->> 'status' is distinct from 'saved' or pg_temp.h123_n(j, u1) <> '0/2/1/1' then
    return 'TO2 Jo''s no-show: ' || k::text || ' ' || pg_temp.h123_n(j, u1);
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.set_official_no_show(%L::uuid, false)::text', gu1P));
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if pg_temp.h123_n(j, u1) <> '1/2/0/1' then return 'TO2 the no-show cleared: ' || pg_temp.h123_n(j, u1); end if;
  if v_gu is distinct from (select md5(string_agg(to_jsonb(g)::text, '|' order by g.id)) from public.game_umpires g
                              where g.id in (gu1P, gu1C, gu1F, gu1T, gu1O, gu2P, gu3P, gu4P, gu4F)) then
    return 'TO2 game_umpires was written (pay must never change)';
  end if;

  -- ── TN1 the nudge ───────────────────────────────────────────────────────
  update public.volunteer_settings set link_enabled = false where owner_id = v_org;
  k := pg_temp.h123_admin(v_org, format('select public.volunteer_admin_nudge(%L::uuid, %L::uuid[])::text', v_s, '{' || vA || '}'));
  update public.volunteer_settings set link_enabled = true where owner_id = v_org;
  if k ->> 'status' is distinct from 'link_off' then return 'TN1 a nudge with the link off: ' || k::text; end if;
  perform pg_temp.h123_admin(v_org, format('select public.set_volunteer_goal(%L::uuid, null, true, null)::text', v_s));
  k := pg_temp.h123_admin(v_org, format('select public.volunteer_admin_nudge(%L::uuid, %L::uuid[])::text', v_s, '{' || vA || '}'));
  perform pg_temp.h123_admin(v_org, format('select public.set_volunteer_goal(%L::uuid, 2, true, null)::text', v_s));
  if k ->> 'status' is distinct from 'no_goal' then return 'TN1 a nudge with no goal: ' || k::text; end if;
  k := pg_temp.h123_admin(v_org, format('select public.volunteer_admin_nudge(%L::uuid, %L::uuid[])::text', v_s,
         '{' || vA || ',' || vM || ',' || u1 || ',' || vA || '}'));
  if k ->> 'status' is distinct from 'queued' or (k ->> 'queued')::int <> 2 or (k ->> 'not_found')::int <> 1
     or jsonb_array_length(k -> 'recent') <> 0 then
    return 'TN1 one per volunteer, the official skipped: ' || k::text;
  end if;
  k := (select o.payload from public.volunteer_outbox o where o.season_id = v_s and o.volunteer_id = vA and o.kind = 'nudge');
  if k <> '{"goal": 2, "worked": 1, "upcoming": 1}'::jsonb then
    return 'TN1 the payload is the family''s numbers only: ' || coalesce(k::text, 'null');
  end if;
  if (select o.coalesce_key from public.volunteer_outbox o where o.season_id = v_s and o.volunteer_id = vA and o.kind = 'nudge')
     is distinct from 'nudge:' || v_s || ':' || vA then
    return 'TN1 coalesce key';
  end if;
  k := pg_temp.h123_admin(v_org, format('select public.volunteer_admin_nudge(%L::uuid, %L::uuid[])::text', v_s, '{' || vA || ',' || vM || '}'));
  if (k ->> 'queued')::int <> 0 or jsonb_array_length(k -> 'recent') <> 2 then
    return 'TN1 a second nudge within 3 days: ' || k::text;
  end if;
  update public.volunteer_outbox set created_at = now() - interval '73 hours'
   where season_id = v_s and volunteer_id = vA and kind = 'nudge';
  k := pg_temp.h123_admin(v_org, format('select public.volunteer_admin_nudge(%L::uuid, %L::uuid[])::text', v_s, '{' || vA || ',' || vC || '}'));
  if (k ->> 'queued')::int <> 2 then
    return 'TN1 after 3 days, and a family whose spots were all canceled: ' || k::text;
  end if;
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if (select count(*) from jsonb_array_elements(j -> 'nudged') x) <> 3 then
    return 'TN1 the tracker lists who was nudged: ' || (j -> 'nudged')::text;
  end if;

  -- ── TL1 no activity log ─────────────────────────────────────────────────
  if exists (select 1 from public.activity_log where league_id in (v_s, v_s2)) then
    return 'TL1 a tracker write logged activity';
  end if;

  -- ── TP1 privileges ──────────────────────────────────────────────────────
  foreach f in array array[
    'public.volunteer_tracker(uuid)', 'public.set_volunteer_goal(uuid, integer, boolean, uuid[])',
    'public.set_team_family_count(uuid, uuid, integer)', 'public.set_official_counts_for(uuid, uuid, uuid)',
    'public.set_official_no_show(uuid, boolean)', 'public.merge_volunteer_families(uuid, uuid, uuid, boolean)',
    'public.separate_volunteer_family_member(uuid, uuid)', 'public.volunteer_admin_nudge(uuid, uuid[])'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') then return 'TP1 authenticated can''t run ' || f; end if;
    foreach r in array array['public', 'anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then return 'TP1 ' || r || ' can run ' || f; end if;
    end loop;
  end loop;
  foreach f in array array['public.volunteer_tracker_families(uuid, uuid)', 'public.wipe_volunteer_data_on_archive()'] loop
    foreach r in array array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then return 'TP1 ' || r || ' can run ' || f; end if;
    end loop;
  end loop;
  foreach f in array array['volunteer_goals', 'volunteer_team_family_counts', 'volunteer_family_members',
                           'volunteer_official_links', 'volunteer_official_no_shows'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_table_privilege(r, 'public.' || f, 'SELECT') or has_table_privilege(r, 'public.' || f, 'INSERT')
         or has_table_privilege(r, 'public.' || f, 'UPDATE') or has_table_privilege(r, 'public.' || f, 'DELETE') then
        return 'TP1 ' || r || ' holds a privilege on ' || f;
      end if;
    end loop;
  end loop;

  -- ── TW1 archiving ───────────────────────────────────────────────────────
  perform pg_temp.h123_admin(v_org, format('select public.merge_volunteer_families(%L::uuid, %L::uuid, %L::uuid, true)::text', v_s, vM, vR));
  if not exists (select 1 from public.volunteer_family_members where season_id = v_s)
     or not exists (select 1 from public.volunteer_goals where season_id = v_s)
     or not exists (select 1 from public.volunteer_official_no_shows where season_id = v_s) then
    return 'FIX TW1 has nothing to wipe';
  end if;
  v_r := pg_temp.h123_as(v_org, 'authenticated', format(
    'with u as (update public.leagues set archived_at = now() where id = %L returning 1) select count(*)::text from u', v_s));
  if v_r is distinct from '1' then return 'TW1 archive as a member refused: ' || coalesce(v_r, 'null'); end if;
  if exists (select 1 from public.volunteer_goals where season_id = v_s) then return 'TW1 the goal survived the archive'; end if;
  if exists (select 1 from public.volunteer_family_members where season_id = v_s) then return 'TW1 the merges survived the archive'; end if;
  if exists (select 1 from public.volunteer_team_family_counts where season_id = v_s) then return 'TW1 the family counts survived the archive'; end if;
  if exists (select 1 from public.volunteer_official_links where season_id = v_s) then return 'TW1 the official links survived the archive'; end if;
  if exists (select 1 from public.volunteer_official_no_shows where season_id = v_s) then return 'TW1 the no-shows survived the archive'; end if;
  if not exists (select 1 from public.volunteer_goals where season_id = v_s2) then return 'TW1 another season''s goal was wiped'; end if;
  j := pg_temp.h123_admin(v_org, format('select public.volunteer_tracker(%L::uuid)::text', v_s));
  if coalesce(j ->> 'error', '') not like '%season_archived%' then
    return 'TW1 the tracker of an archived season: ' || left(j::text, 200);
  end if;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig123$
-- @@MIGRATION_0123@@
$mig123$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\n';
  m       record;
begin
  -- Mutants run without the migration's verify block (a grant mutant would
  -- otherwise die in the verify, not at its own assertion — 0120's rule).
  v_nover := split_part(v_body, '-- 5. Verify', 1);
  if strpos(v_body, '-- 5. Verify') = 0 then
    raise exception 'harness: verify marker not found in 0123';
  end if;

  -- BASELINE: the file as it will be applied.
  begin
    execute v_body;
    v_res := pg_temp.h123_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || 'md5(prosrc) ' || (
      select string_agg(p.proname || '=' || md5(p.prosrc), ', ' order by p.proname)
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('volunteer_tracker_families', 'volunteer_tracker', 'set_volunteer_goal', 'set_team_family_count',
                           'set_official_counts_for', 'set_official_no_show', 'merge_volunteer_families',
                           'separate_volunteer_family_member', 'volunteer_admin_nudge', 'wipe_volunteer_data_on_archive')) || E'\n';
    v_out := v_out || 'L1 locks held: ' || (
      select coalesce(string_agg(distinct c.relname || '=' || l.mode, ', '), 'none')
        from pg_locks l join pg_class c on c.oid = l.relation
       where l.pid = pg_backend_pid() and l.granted and c.relkind = 'r'
         and c.relnamespace = 'public'::regnamespace) || E'\n';
    raise exception 'H123ROLLBACK';
  exception when others then
    if sqlerrm <> 'H123ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('MT1', 'TRN', $r$ and not c.no_show
$r$, $r$
$r$),
    ('MT2', 'TR3', $r$                              and c.spot_date < (select d from today)) as worked,$r$,
                   $r$                              and c.spot_date <= (select d from today)) as worked,$r$),
    ('MT3', 'TR4', $r$           count(*) filter (where c.status = 'active' and c.counts and not c.held
                              and c.spot_date >= (select d from today)) as upcoming,$r$,
                   $r$           count(*) filter (where c.status = 'active' and c.counts
                              and c.spot_date >= (select d from today)) as upcoming,$r$),
    ('MT4', 'TR5', $r$           count(*) filter (where c.status = 'active' and c.counts and not c.held
                              and c.spot_date >= (select d from today)) as upcoming,$r$,
                   $r$           count(*) filter (where c.status <> 'detached' and c.counts and not c.held
                              and c.spot_date >= (select d from today)) as upcoming,$r$),
    ('MT5', 'TR6', $r$           coalesce(r.counts_toward_goal, false) as counts,$r$, $r$           true as counts,$r$),
    ('MT6', 'TO1', $r$     where gu.umpire_id in (select id from offs)
       and g.league_id = p_season_id$r$, $r$     where gu.umpire_id in (select id from offs)$r$),
    ('MT7', 'TO1', $r$           count(og.gu_id) filter (where og.status <> 'cancelled' and not og.ns and og.d < (select d from today)) as worked,$r$,
                   $r$           count(og.gu_id) filter (where not og.ns and og.d < (select d from today)) as worked,$r$),
    ('MT8', 'TR2', $r$
       and (select on_ from officials_on)
$r$, $r$
$r$),
    ('MT9', 'TO1', $r$                    and exists (select 1 from public.volunteer_claims c
                                 where c.volunteer_id = v.id and c.season_id = p_season_id)),$r$,
                   $r$                    and exists (select 1 from public.volunteer_claims c
                                 where c.volunteer_id = v.id)),$r$),
    ('MT10', 'TF1', $r$  if not coalesce(p_commit, false) then
    return jsonb_build_object('status', 'ready',$r$, $r$  if false then
    return jsonb_build_object('status', 'ready',$r$),
    ('MT11', 'TF1', $r$    insert into public.volunteer_family_members (season_id, owner_id, umpire_id, family_key)
    values (p_season_id, v_owner, p_member, p_member);$r$, $r$$r$),
    ('MT12', 'TF1', $r$              case when (v_f ->> 'key')::uuid = p_member then (x ->> 'id')::uuid else (v_f ->> 'key')::uuid end);$r$,
                    $r$              (v_f ->> 'key')::uuid);$r$),
    ('MT13', 'TT1', $r$  if p_families < 1 or p_families > 60 then$r$, $r$  if false then$r$),
    ('MT14', 'TT1', $r$  if not exists (select 1 from public.teams t where t.id = p_team_id and t.league_id = p_season_id) then
    return jsonb_build_object('status', 'not_found');$r$, $r$  if false then
    return jsonb_build_object('status', 'not_found');$r$),
    ('MT15', 'TO2', $r$  if v_date >= public.volunteer_org_now(v_owner)::date then$r$, $r$  if false then$r$),
    ('MT16', 'TO2', $r$  if not exists (select 1 from public.volunteer_official_links l where l.umpire_id = v_umpire) then$r$,
                    $r$  if false then$r$),
    ('MT17', 'TO2', $r$  if not exists (select 1 from public.teams t where t.id = p_team_id and t.league_id = p_season_id) then
    return jsonb_build_object('status', 'team_not_in_season');$r$, $r$  if false then
    return jsonb_build_object('status', 'team_not_in_season');$r$),
    ('MT18', 'TN1', $r$                  and o.created_at > now() - interval '72 hours') then$r$, $r$                  and false) then$r$),
    ('MT19', 'TN1', $r$  if not coalesce((select s.link_enabled from public.volunteer_settings s where s.owner_id = v_owner), false) then
    return jsonb_build_object('status', 'link_off');$r$, $r$  if false then
    return jsonb_build_object('status', 'link_off');$r$),
    ('MT20', 'TN1', $r$                               'upcoming', (v_f ->> 'upcoming')::int),$r$,
                    $r$                               'upcoming', (v_f ->> 'upcoming')::int, 'family', v_f -> 'members' -> 0 ->> 'last_name'),$r$),
    ('MT21', 'TG1', $r$  v_owner uuid := public.volunteer_admin_gate(p_season_id, false);
  v_tz    text$r$, $r$  v_owner uuid := (select l.owner_id from public.leagues l where l.id = p_season_id);
  v_tz    text$r$),
    ('MT22', 'TW1', $r$  delete from public.volunteer_goals where season_id = new.id;
$r$, $r$$r$),
    ('MT23', 'TW1', $r$  delete from public.volunteer_family_members where season_id = new.id;
$r$, $r$$r$),
    ('MT24', 'TP1', $r$grant execute on function public.volunteer_tracker(uuid) to authenticated;$r$,
                    $r$grant execute on function public.volunteer_tracker(uuid) to authenticated, anon;$r$),
    ('MT25', 'TP1', $r$revoke execute on function public.volunteer_tracker_families(uuid, uuid) from public, anon, authenticated, service_role, dashboard_readonly;$r$,
                    $r$revoke execute on function public.volunteer_tracker_families(uuid, uuid) from public, anon, service_role, dashboard_readonly;
grant execute on function public.volunteer_tracker_families(uuid, uuid) to authenticated;$r$),
    ('MT26', 'TR1', $r$               'worked', sum(m.worked)::int,$r$, $r$               'worked', max(m.worked)::int,$r$),
    ('MT27', 'TK1', $r$alter table public.volunteers drop column if exists family_id;$r$, $r$$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h123_case();
      raise exception 'H123CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H123CASE:%' then replace(sqlerrm, 'H123CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0123 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_class where relname in ('volunteer_goals', 'volunteer_team_family_counts',
--      'volunteer_family_members', 'volunteer_official_links', 'volunteer_official_no_shows')) as new_tables_must_be_0,
--   (select count(*) from pg_proc where proname in ('volunteer_tracker', 'volunteer_tracker_families', 'set_volunteer_goal',
--      'set_team_family_count', 'set_official_counts_for', 'set_official_no_show', 'merge_volunteer_families',
--      'separate_volunteer_family_member', 'volunteer_admin_nudge')) as new_functions_must_be_0,
--   (select md5(prosrc) from pg_proc where proname = 'wipe_volunteer_data_on_archive') as wipe_must_be_0121_04dd2bd2,
--   (select count(*) from information_schema.columns where table_name = 'volunteers' and column_name = 'family_id') as family_id_must_be_1,
--   (select count(*) from leagues where name like 'ZZ123%') as fixture_leagues_must_be_0,
--   (select count(*) from volunteers where email_lc like '%@zz123.test') as fixture_volunteers_must_be_0,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- 2026-11-09, against production, every run rolled back, on Whit's go
-- (sent as a comment-stripped copy — harness only; the migration byte-exact,
-- md5-checked on the server before each run).
--   Run 1 — HARNESS FAULT: a variable named `tO` is the PL/pgSQL keyword
--     `to`; the case function didn't compile, nothing ran. Renamed `tOw`.
--   Run 2 — HARNESS FAULT: the other season's game had no opponent
--     (games_opponent_required — 0122's run 1 hit the same). Added team tX2.
--   Run 3 — baseline PASS; 26/27 killed at their own tag; MT3 SURVIVED: the
--     rained-out spot was in the PAST, so counting held spots as upcoming
--     changed nothing (a fixture gap). Adams's held spot moved to a FUTURE
--     rained-out game gC2 (Jo's past one stays — MT7 needs it).
--   Run 4 — GREEN: baseline pass, 27/27 KILLED at their own tag, md5(prosrc)
--     of all ten functions = `volunteer-tracker-build.ts --md5`. Locks held
--     (L1): SHARE ROW EXCLUSIVE on profiles, leagues, teams, umpires,
--     game_umpires, volunteers; ACCESS EXCLUSIVE on volunteers and the five
--     new tables; row locks on the fixture tables.
--   regress0122 — GREEN first run: baseline pass; MSW (wipe keeps roles)
--     KILLED at SW1.
--   regress0121 — run 1: baseline crashed at G2, which names 0121's
--     13-argument volunteer_claim (0122 replaced it; everything before G2,
--     W1 included, passed); MU15 KILLED at W1. The builder now updates the
--     two signatures 0122 changed (claim, admin_assign) and removes the
--     "test" org's switch row first (the proof predates the switch being on
--     there). Run 2 — GREEN: baseline pass through all five parts; MU15
--     KILLED at W1.
--   Leak check after all runs: identical to the pre-run snapshot (wipe
--     04dd2bd2…, family_id present, no new tables or functions, no ZZ
--     fixtures, volunteer counts unchanged, game_umpires md5 unchanged, no
--     idle transaction).
--   Applied right after: catalog 20261109201948, md5s and grants verified.

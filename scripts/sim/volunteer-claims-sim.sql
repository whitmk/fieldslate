-- Proof for 0121 (volunteer game roles + claims), PART 1: roles, role
-- divisions, claims, the pure slot-rule twins, role save/delete, the archive
-- wipe extended. Assembled by volunteer-claims-build.ts, which puts the
-- LITERAL migration text where the placeholder is. It runs BEFORE 0121 is
-- applied: one transaction that the final RAISE always rolls back. Fixtures in
-- the "test" proof org (bbf9afe1…, Elite), with the volunteers switch turned
-- on INSIDE the batch (rolled back with it) — never Santa Rosa American's data.
--
-- NOT RUN YET. Running it against production needs Whit's go and timing.
--
-- LOCKS for the run (seconds; lock_timeout 3s): the migration's new FKs take
-- SHARE ROW EXCLUSIVE on leagues, divisions, teams, games, playoff_games,
-- snack_shack_blocks and profiles (writes to them wait, reads don't), held to
-- the end of the batch. Each mutant drops and re-creates the 0121 tables in
-- its own rolled-back sub-run; dropping their foreign keys can lock the
-- tables they point at (games, teams, divisions, leagues, profiles) more
-- strongly — up to ACCESS EXCLUSIVE, so reads wait too — for a fraction of a
-- second per mutant, 16 times. L1 prints the locks the baseline holds.
--
-- THE TWO CASE TABLES below are the ONE copy of the slot rules shared with
-- src/lib/volunteers/slots.ts (npm run sim:volunteer-slots parses the same
-- blocks). Each marker alone on its line, one row per line, never a second
-- copy.
--
-- Assertions (each case returns the FIRST failing tag, or 'pass'):
--   VT1 every VSLOT row through volunteer_slot_targets + _claim_refusal
--   VC1 every VCHANGE row through volunteer_change_allowed
--   G1  privileges: helpers callable by no role; save/delete authenticated
--       only; claims readable by no role; roles + role divisions SELECT for
--       members only (a non-member reads 0 rows); RLS on
--   R1  a non-member → not_authorized
--   F1  switch off → feature_off
--   E1  Pro → plan_required
--   A1  archived season → season_archived
--   N1  validation: blank name, 61 characters, bad kind, 0 and 11 spots;
--       a name differing only by case/space → name_taken
--   RS1 create: preview writes nothing; commit stores the trimmed name and
--       the divisions
--   RS2 a division of another season → division_not_in_season
--   U1  the spot index: a second active claim on one per-game spot is
--       refused; a canceled one doesn't count; per-team spots for two teams
--       don't collide
--   RS3 lowering spots 3 → 2: preview counts 1, writes nothing; commit
--       cancels position 3 only and queues one shift_canceled email
--   RS4 removing the division cancels the claims in it
--   RS5 changing kind with active claims → kind_locked
--   RD1 delete: preview counts; commit cancels + queues emails, role gone
--   W1  archiving the season deletes its claims, roles and outbox rows and
--       the volunteers nothing else references; another season's claim and
--       its volunteer stay
-- Mutants (each must die at its own tag):
--   MU1  per-game spots on games the partner hosts            → VT1
--   MU2  the time check before the rained-out check           → VT1
--   MU3  exactly 24 hours still allows a change               → VC1
--   MU4  claims SELECT granted to authenticated               → G1
--   MU5  membership gate removed                              → R1
--   MU6  switch gate removed                                  → F1
--   MU7  Elite gate removed                                   → E1
--   MU8  archived gate removed                                → A1
--   MU9  name uniqueness check case-sensitive                 → N1
--   MU10 lowering spots cancels nothing                       → RS3
--   MU11 a canceled claim queues no email                     → RS3
--   MU12 removing a division cancels nothing                  → RS4
--   MU13 kind change allowed with claims                      → RS5
--   MU14 spot index without the for_team coalesce             → U1
--   MU15 the wipe keeps the season's claims                   → W1
--   MU16 delete skips the cancel                              → RD1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '120s', true);

create or replace function pg_temp.h121_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

-- Drops what 0121 part 1 creates (the wipe function is re-created by every
-- apply, so it is left). Only ever called inside a rolled-back sub-run.
create or replace function pg_temp.h121_drop() returns void language plpgsql as $f$
begin
  drop function if exists public.save_volunteer_role(uuid, uuid, text, text, integer, boolean, boolean, uuid[], boolean);
  drop function if exists public.delete_volunteer_role(uuid, boolean);
  drop function if exists public.volunteer_cancel_claims(uuid[], text);
  drop function if exists public.volunteer_admin_gate(uuid, boolean);
  drop function if exists public.volunteer_change_allowed(timestamp, timestamp);
  drop function if exists public.volunteer_claim_refusal(text, timestamp, timestamp, boolean, boolean, boolean);
  drop function if exists public.volunteer_slot_targets(text, boolean, boolean, uuid, uuid, uuid, uuid, uuid[], integer);
  drop function if exists public.volunteer_slot_state(text);
  drop table if exists public.volunteer_claims;
  drop table if exists public.volunteer_role_divisions;
  drop table if exists public.volunteer_roles;
end;
$f$;

create or replace function pg_temp.h121_case() returns text language plpgsql as $f$
declare
  v_org  uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_now  timestamp := '2026-11-10 12:00';
  c_th uuid := '00000000-0000-0000-0000-0000000000a1'; c_ta uuid := '00000000-0000-0000-0000-0000000000a2';
  c_dh uuid := '00000000-0000-0000-0000-0000000000d1'; c_da uuid := '00000000-0000-0000-0000-0000000000d2';
  v_s  uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid();
  v_d1 uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid(); v_dx uuid := gen_random_uuid();
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_t3 uuid := gen_random_uuid(); v_tx uuid := gen_random_uuid(); v_ty uuid := gen_random_uuid();
  v_g1 uuid := gen_random_uuid(); v_g2 uuid := gen_random_uuid(); v_gx uuid := gen_random_uuid();
  v_va uuid := gen_random_uuid(); v_vb uuid := gen_random_uuid(); v_vc uuid := gen_random_uuid();
  v_role uuid; v_role2 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; cx uuid;
  v_r text; j jsonb;
  r record; t record;
  v_n integer; v_first record; v_lockset uuid[]; v_ref text; v_when timestamp;
  e text;
begin
  -- VT1 — the shared VSLOT table through the SQL twins.
  for r in select * from (values
-- VSLOT-TABLE-BEGIN
  ('V01', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, null),
  ('V02', 'scheduled',           false, false, true,  'per_team', true,  true,  'both', 'future',  true,  2, null),
  ('V03', 'scheduled',           false, false, true,  'per_team', true,  false, 'both', 'future',  true,  1, null),
  ('V04', 'scheduled',           false, false, true,  'per_team', false, true,  'away', 'future',  true,  1, null),
  ('V05', 'scheduled',           true,  false, false, 'per_game', true,  false, 'home', 'future',  true,  1, null),
  ('V06', 'scheduled',           true,  true,  false, 'per_game', true,  false, 'home', 'future',  true,  0, 'no_slot'),
  ('V07', 'scheduled',           true,  true,  false, 'per_team', true,  false, 'home', 'future',  true,  1, null),
  ('V08', 'scheduled',           true,  false, false, 'per_team', true,  false, 'home', 'future',  true,  1, null),
  ('V09', 'pending_interleague', true,  false, false, 'per_team', true,  false, 'both', 'future',  true,  0, 'no_slot'),
  ('V10', 'reschedule_pending',  false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, null),
  ('V11', 'cancelled',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, 'rained_out'),
  ('V12', 'completed',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, 'closed'),
  ('V13', 'in_progress',         false, false, true,  'per_team', true,  true,  'both', 'future',  true,  2, 'closed'),
  ('V14', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'past',    true,  1, 'past'),
  ('V15', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'started', true,  1, 'past'),
  ('V16', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'now',     true,  1, 'past'),
  ('V17', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'soon',    true,  1, null),
  ('V18', 'scheduled',           false, false, true,  'per_game', false, true,  'both', 'future',  true,  0, 'no_slot'),
  ('V19', 'scheduled',           false, false, true,  'per_game', true,  true,  'none', 'future',  true,  1, 'unpublished'),
  ('V20', 'scheduled',           false, false, true,  'per_game', true,  true,  'away', 'future',  true,  1, 'unpublished'),
  ('V21', 'scheduled',           false, false, true,  'per_team', true,  true,  'away', 'future',  true,  2, 'unpublished'),
  ('V22', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'future',  false, 1, 'signups_closed'),
  ('V23', 'cancelled',           false, false, true,  'per_game', true,  true,  'both', 'past',    true,  1, 'rained_out'),
  ('V24', 'scheduled',           false, false, false, 'per_team', true,  true,  'both', 'future',  true,  1, null),
  ('V25', 'scheduled',           true,  true,  false, 'per_team', true,  false, 'none', 'future',  true,  1, 'unpublished'),
  ('V26', 'reschedule_pending',  true,  true,  false, 'per_game', true,  false, 'home', 'future',  true,  0, 'no_slot'),
  ('V27', 'cancelled',           false, false, true,  'per_game', true,  true,  'none', 'future',  false, 1, 'rained_out'),
  ('V28', 'scheduled',           false, false, true,  'per_team', false, false, 'both', 'future',  true,  0, 'no_slot')
-- VSLOT-TABLE-END
  ) as x(id, status, il, is_away, has_away, kind, h_in, a_in, locked, at_when, so, targets, refusal)
  loop
    v_when := case r.at_when when 'past' then '2026-11-09 12:00' when 'started' then '2026-11-10 11:59'
                             when 'now' then '2026-11-10 12:00' when 'soon' then '2026-11-10 12:30'
                             else '2026-11-20 10:00' end;
    v_lockset := case r.locked when 'both' then array[c_dh, c_da] when 'home' then array[c_dh]
                               when 'away' then array[c_da] else array[]::uuid[] end;
    select count(*) into v_n
      from public.volunteer_slot_targets(r.kind, r.il, r.is_away, c_th, case when r.has_away then c_ta end,
             c_dh, c_da, (case when r.h_in then array[c_dh] else '{}'::uuid[] end) || (case when r.a_in then array[c_da] else '{}'::uuid[] end), 2);
    if v_n <> r.targets then return format('VT1 %s: %s spot sets, got %s', r.id, r.targets, v_n); end if;
    select * into v_first
      from public.volunteer_slot_targets(r.kind, r.il, r.is_away, c_th, case when r.has_away then c_ta end,
             c_dh, c_da, (case when r.h_in then array[c_dh] else '{}'::uuid[] end) || (case when r.a_in then array[c_da] else '{}'::uuid[] end), 2) s
     order by s.ord limit 1;
    v_ref := public.volunteer_claim_refusal(r.status, v_when, v_now, v_first.division_id is not null,
                                            v_first.division_id = any (v_lockset), r.so);
    if v_ref is distinct from r.refusal then return format('VT1 %s: refusal %s, got %s', r.id, coalesce(r.refusal, 'null'), coalesce(v_ref, 'null')); end if;
  end loop;

  -- VC1 — the shared VCHANGE table.
  for r in select * from (values
-- VCHANGE-TABLE-BEGIN
  ('C01', '2026-11-11T12:01', '2026-11-10T12:00', true),
  ('C02', '2026-11-11T12:00', '2026-11-10T12:00', false),
  ('C03', '2026-11-11T11:59', '2026-11-10T12:00', false),
  ('C04', '2026-12-01T09:00', '2026-11-29T09:00', true),
  ('C05', '2026-12-01T09:00', '2026-11-30T09:01', false),
  ('C06', '2027-01-01T10:00', '2026-12-31T09:59', true),
  ('C07', '2026-11-10T10:00', '2026-11-10T12:00', false),
  ('C08', '2026-11-08T10:00', '2026-11-01T10:00', true)
-- VCHANGE-TABLE-END
  ) as x(id, start_at, now_at, allowed)
  loop
    if public.volunteer_change_allowed(r.start_at::timestamp, r.now_at::timestamp) is distinct from r.allowed then
      return format('VC1 %s: expected %s', r.id, r.allowed);
    end if;
  end loop;

  -- ── fixtures (as postgres) ─────────────────────────────────────────────
  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (v_s,  'ZZ121 S',  'Baseball', 'Fall 2026', v_org, '2026-09-01', '2026-12-31'),
    (v_s2, 'ZZ121 S2', 'Baseball', 'Fall 2026', v_org, '2026-09-01', '2026-12-31');
  insert into public.divisions (id, league_id, name, team_count, settings, status) values
    (v_d1, v_s,  'ZZ Majors', 3, '{}'::jsonb, 'active'),
    (v_d2, v_s,  'ZZ Minors', 0, '{}'::jsonb, 'active'),
    (v_dx, v_s2, 'ZZ Other',  1, '{}'::jsonb, 'active');
  insert into public.teams (id, league_id, name, division_id) values
    (v_t1, v_s, 'ZZ Expos', v_d1), (v_t2, v_s, 'ZZ Mets', v_d1), (v_t3, v_s, 'ZZ Cubs', v_d1),
    (v_tx, v_s2, 'ZZ Other', v_dx), (v_ty, v_s2, 'ZZ Other 2', v_dx);
  insert into public.games (id, league_id, home_team_id, away_team_id, scheduled_at, status) values
    (v_g1, v_s,  v_t1, v_t2, '2026-11-20 10:00+00', 'scheduled'),
    (v_g2, v_s,  v_t3, v_t1, '2026-11-21 10:00+00', 'scheduled'),
    (v_gx, v_s2, v_tx, v_ty, '2026-11-21 10:00+00', 'scheduled');
  insert into public.volunteers (id, owner_id, email_lc, first_initial, last_name, adult_confirmed_at) values
    (v_va, v_org, 'zz121-a@example.org', 'A', 'Alpha', now()),
    (v_vb, v_org, 'zz121-b@example.org', 'B', 'Bravo', now()),
    (v_vc, v_org, 'zz121-c@example.org', 'C', 'Charlie', now());
  update public.profiles set plan = 'elite' where id = v_org;

  -- G1 — privileges and RLS.
  if exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) ro,
                  unnest(array['public.volunteer_slot_state(text)',
                               'public.volunteer_slot_targets(text, boolean, boolean, uuid, uuid, uuid, uuid, uuid[], integer)',
                               'public.volunteer_claim_refusal(text, timestamp, timestamp, boolean, boolean, boolean)',
                               'public.volunteer_change_allowed(timestamp, timestamp)',
                               'public.volunteer_admin_gate(uuid, boolean)', 'public.volunteer_cancel_claims(uuid[], text)']) f
     where has_function_privilege(ro, f, 'EXECUTE')) then
    return 'G1 a helper is callable';
  end if;
  if not has_function_privilege('authenticated', 'public.save_volunteer_role(uuid, uuid, text, text, integer, boolean, boolean, uuid[], boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.save_volunteer_role(uuid, uuid, text, text, integer, boolean, boolean, uuid[], boolean)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.delete_volunteer_role(uuid, boolean)', 'EXECUTE') then
    return 'G1 save/delete grants';
  end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', 'select count(*)::text from public.volunteer_claims');
  if v_r not like 'ERR 42501%' then return 'G1 authenticated read claims: ' || coalesce(v_r, 'null'); end if;
  v_r := pg_temp.h121_as(v_org, 'service_role', 'select count(*)::text from public.volunteer_claims');
  if v_r not like 'ERR 42501%' then return 'G1 service_role read claims: ' || coalesce(v_r, 'null'); end if;
  insert into public.volunteer_roles (id, owner_id, season_id, name, kind, spots) values (gen_random_uuid(), v_org, v_s2, 'ZZ seen', 'per_game', 1);
  v_r := pg_temp.h121_as(gen_random_uuid(), 'authenticated', format('select count(*)::text from public.volunteer_roles where season_id = %L', v_s2));
  if v_r is distinct from '0' then return 'G1 non-member reads roles: ' || coalesce(v_r, 'null'); end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format('select count(*)::text from public.volunteer_roles where season_id = %L', v_s2));
  if v_r is distinct from '1' then return 'G1 member reads roles: ' || coalesce(v_r, 'null'); end if;
  if exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) ro,
                           unnest(array['volunteer_roles', 'volunteer_role_divisions', 'volunteer_claims']) tb,
                           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) pr
              where has_table_privilege(ro, 'public.' || tb, pr)
                and not (tb <> 'volunteer_claims' and ro = 'authenticated' and pr = 'SELECT')) then
    return 'G1 an extra table privilege';
  end if;

  -- R1 / F1 / E1 / A1 — the gate, in order.
  v_r := pg_temp.h121_as(gen_random_uuid(), 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 2, true, true, array[%L]::uuid[], true)::text', v_s, 'GameChanger', 'per_game', v_d1));
  if v_r not like '%not_authorized%' then return 'R1 non-member: ' || v_r; end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 2, true, true, array[%L]::uuid[], true)::text', v_s, 'GameChanger', 'per_game', v_d1));
  if v_r not like '%feature_off%' then return 'F1 switch off: ' || v_r; end if;
  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'volunteers', true);
  update public.profiles set plan = 'pro' where id = v_org;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 2, true, true, array[%L]::uuid[], true)::text', v_s, 'GameChanger', 'per_game', v_d1));
  if v_r not like '%plan_required%' then return 'E1 Pro: ' || v_r; end if;
  update public.profiles set plan = 'elite' where id = v_org;
  update public.leagues set archived_at = now() where id = v_s2;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 2, true, true, array[%L]::uuid[], true)::text', v_s2, 'GameChanger', 'per_game', v_dx));
  if v_r not like '%season_archived%' then return 'A1 archived: ' || v_r; end if;
  update public.leagues set archived_at = null where id = v_s2;

  -- RS1 — create, preview then commit.
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 3, true, true, array[%L]::uuid[], false)::text', v_s, '  GameChanger ', 'per_game', v_d1));
  if v_r like 'ERR%' or (v_r::jsonb ->> 'committed') <> 'false' or exists (select 1 from public.volunteer_roles where season_id = v_s) then
    return 'RS1 preview: ' || v_r;
  end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 3, true, true, array[%L]::uuid[], true)::text', v_s, '  GameChanger ', 'per_game', v_d1));
  if v_r like 'ERR%' then return 'RS1 commit: ' || v_r; end if;
  v_role := (v_r::jsonb ->> 'role_id')::uuid;
  if (select name from public.volunteer_roles where id = v_role) is distinct from 'GameChanger'
     or (select array_agg(division_id) from public.volunteer_role_divisions where role_id = v_role) is distinct from array[v_d1] then
    return 'RS1 stored';
  end if;

  -- N1 — validation and the name rule.
  foreach e in array array[
      format('select public.save_volunteer_role(null, %L, %L, %L, 2, true, true, null, true)::text', v_s, '   ', 'per_game'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 2, true, true, null, true)::text', v_s, repeat('x', 61), 'per_game'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 2, true, true, null, true)::text', v_s, 'X', 'per_season'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 0, true, true, null, true)::text', v_s, 'X', 'per_game'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 11, true, true, null, true)::text', v_s, 'X', 'per_game')] loop
    v_r := pg_temp.h121_as(v_org, 'authenticated', e);
    if v_r not like 'ERR P0001%' then return 'N1 accepted: ' || e || ' → ' || coalesce(v_r, 'null'); end if;
  end loop;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 1, true, true, null, true)::text', v_s, 'gamechanger', 'per_team'));
  if v_r not like '%name_taken%' then return 'N1 case-only duplicate: ' || v_r; end if;

  -- RS2 — a division of another season.
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 3, true, true, array[%L, %L]::uuid[], true)::text', v_role, v_s, 'GameChanger', 'per_game', v_d1, v_dx));
  if v_r not like '%division_not_in_season%' then return 'RS2: ' || v_r; end if;

  -- U1 — one person per spot.
  insert into public.volunteer_claims (id, owner_id, season_id, volunteer_id, game_id, role_id, position, created_by)
    values (gen_random_uuid(), v_org, v_s, v_va, v_g1, v_role, 1, 'volunteer') returning id into c1;
  begin
    insert into public.volunteer_claims (owner_id, season_id, volunteer_id, game_id, role_id, position, created_by)
      values (v_org, v_s, v_vb, v_g1, v_role, 1, 'volunteer');
    return 'U1 a second active claim on one spot was accepted';
  exception when unique_violation then null;
  end;
  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, game_id, role_id, position, created_by, status)
    values (v_org, v_s, v_vb, v_g1, v_role, 1, 'volunteer', 'canceled');
  insert into public.volunteer_role_divisions values (v_role, v_d2) on conflict do nothing;
  delete from public.volunteer_role_divisions where role_id = v_role and division_id = v_d2;
  insert into public.volunteer_roles (id, owner_id, season_id, name, kind, spots) values (gen_random_uuid(), v_org, v_s, 'ZZ Scorebook', 'per_team', 1)
    returning id into v_role2;
  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, game_id, role_id, for_team_id, position, created_by)
    values (v_org, v_s, v_va, v_g1, v_role2, v_t1, 1, 'volunteer'), (v_org, v_s, v_vb, v_g1, v_role2, v_t2, 1, 'volunteer');
  begin
    insert into public.volunteer_claims (owner_id, season_id, volunteer_id, game_id, role_id, position, created_by)
      values (v_org, v_s, v_vc, v_g1, v_role2, 1, 'volunteer');
    insert into public.volunteer_claims (owner_id, season_id, volunteer_id, game_id, role_id, position, created_by)
      values (v_org, v_s, v_vc, v_g1, v_role2, 1, 'volunteer');
    return 'U1 two team-less claims on one spot were accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.volunteer_claims (owner_id, season_id, volunteer_id, position, created_by)
      values (v_org, v_s, v_vc, 1, 'volunteer');
    return 'U1 a claim with no target was accepted';
  exception when check_violation then null;
  end;

  -- RS3 — lowering spots 3 → 2 cancels position 3 only.
  insert into public.volunteer_claims (id, owner_id, season_id, volunteer_id, game_id, role_id, position, created_by)
    values (gen_random_uuid(), v_org, v_s, v_vb, v_g1, v_role, 2, 'volunteer') returning id into c2;
  insert into public.volunteer_claims (id, owner_id, season_id, volunteer_id, game_id, role_id, position, created_by)
    values (gen_random_uuid(), v_org, v_s, v_vc, v_g1, v_role, 3, 'volunteer') returning id into c3;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 2, true, true, array[%L]::uuid[], false)::text', v_role, v_s, 'GameChanger', 'per_game', v_d1));
  if v_r like 'ERR%' or (v_r::jsonb ->> 'claims_to_cancel') <> '1'
     or (select status from public.volunteer_claims where id = c3) <> 'active'
     or (select spots from public.volunteer_roles where id = v_role) <> 3 then
    return 'RS3 preview: ' || v_r;
  end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 2, true, true, array[%L]::uuid[], true)::text', v_role, v_s, 'GameChanger', 'per_game', v_d1));
  if v_r like 'ERR%' or (select status from public.volunteer_claims where id = c3) <> 'canceled'
     or (select status from public.volunteer_claims where id = c1) <> 'active'
     or (select status from public.volunteer_claims where id = c2) <> 'active' then
    return 'RS3 commit: ' || v_r;
  end if;
  if (select count(*) from public.volunteer_outbox where kind = 'shift_canceled' and payload ->> 'claim_id' = c3::text and volunteer_id = v_vc) <> 1 then
    return 'RS3 the canceled spot queued no shift_canceled email';
  end if;

  -- RS4 — removing the division cancels its claims.
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 1, true, true, array[]::uuid[], false)::text', v_role2, v_s, 'ZZ Scorebook', 'per_team'));
  if v_r like 'ERR%' or (v_r::jsonb ->> 'claims_to_cancel') <> '2' then return 'RS4 preview: ' || v_r; end if;

  -- RS5 — kind can't change under claims.
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 2, true, true, array[%L]::uuid[], true)::text', v_role, v_s, 'GameChanger', 'per_team', v_d1));
  if v_r not like '%kind_locked%' then return 'RS5: ' || v_r; end if;

  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 1, true, true, array[]::uuid[], true)::text', v_role2, v_s, 'ZZ Scorebook', 'per_team'));
  if v_r like 'ERR%' or (select count(*) from public.volunteer_claims where role_id = v_role2 and status = 'active') <> 0 then
    return 'RS4 commit: ' || v_r;
  end if;

  -- RD1 — delete.
  v_r := pg_temp.h121_as(v_org, 'authenticated', format('select public.delete_volunteer_role(%L, false)::text', v_role));
  if v_r like 'ERR%' or (v_r::jsonb ->> 'claims_to_cancel') <> '2' or not exists (select 1 from public.volunteer_roles where id = v_role) then
    return 'RD1 preview: ' || v_r;
  end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format('select public.delete_volunteer_role(%L, true)::text', v_role));
  if v_r like 'ERR%' or exists (select 1 from public.volunteer_roles where id = v_role)
     or (select status from public.volunteer_claims where id = c1) <> 'canceled'
     or (select count(*) from public.volunteer_outbox where kind = 'shift_canceled' and payload ->> 'claim_id' in (c1::text, c2::text)) <> 2 then
    return 'RD1 commit: ' || v_r;
  end if;

  -- W1 — the archive wipe.
  insert into public.volunteer_roles (id, owner_id, season_id, name, kind, spots) values (gen_random_uuid(), v_org, v_s2, 'ZZ keep', 'per_game', 1)
    returning id into v_role;
  insert into public.volunteer_claims (id, owner_id, season_id, volunteer_id, game_id, role_id, position, created_by)
    values (gen_random_uuid(), v_org, v_s2, v_vc, v_gx, v_role, 1, 'volunteer') returning id into cx;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'with u as (update public.leagues set archived_at = now() where id = %L returning 1) select count(*)::text from u', v_s));
  if v_r is distinct from '1' then return 'W1 archive as a member refused: ' || coalesce(v_r, 'null'); end if;
  if exists (select 1 from public.volunteer_claims where season_id = v_s)
     or exists (select 1 from public.volunteer_roles where season_id = v_s)
     or exists (select 1 from public.volunteer_outbox where season_id = v_s) then
    return 'W1 season data left';
  end if;
  if exists (select 1 from public.volunteers where id in (v_va, v_vb)) then return 'W1 unreferenced volunteers kept'; end if;
  if not exists (select 1 from public.volunteer_claims where id = cx) or not exists (select 1 from public.volunteers where id = v_vc) then
    return 'W1 wiped another season';
  end if;

  return 'pass';
end;
$f$;

do $h$
declare
  v_mig text := $mig121$
-- @@MIGRATION_0121@@
$mig121$;
  v_out text := '';
  v_body text;
  v_res text;
  v_mut text;
  m record;
begin
  execute v_mig;
  v_body := left(v_mig, strpos(v_mig, '-- Verify, or the whole migration rolls back.') - 1);
  if strpos(v_mig, '-- Verify, or the whole migration rolls back.') = 0 then
    raise exception 'harness: verify marker not found in 0121';
  end if;

  v_out := v_out || 'md5 ' || (
    select string_agg(proname || '=' || md5(prosrc), ' ' order by proname) from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('volunteer_slot_state', 'volunteer_slot_targets', 'volunteer_claim_refusal', 'volunteer_change_allowed',
                       'volunteer_admin_gate', 'volunteer_cancel_claims', 'save_volunteer_role', 'delete_volunteer_role',
                       'wipe_volunteer_data_on_archive')) || E'\n';
  v_out := v_out || 'L1 locks: ' || coalesce((
    select string_agg(c.relname || ' ' || l.mode, ', ' order by c.relname, l.mode)
      from pg_locks l join pg_class c on c.oid = l.relation
     where l.pid = pg_backend_pid() and c.relname in ('leagues', 'divisions', 'teams', 'games', 'playoff_games',
                                                      'snack_shack_blocks', 'profiles')), 'none') || E'\n';

  begin
    v_res := pg_temp.h121_case();
    raise exception 'H121CASE:%', v_res;
  exception when others then
    v_out := v_out || 'BASELINE ' || replace(sqlerrm, 'H121CASE:', '') || E'\n';
  end;

  for m in select * from (values
    ('MU1', 'VT1', $r$         and not (p_interleague and p_is_away)
$r$, $r$$r$),
    ('MU2', 'VT1', $r$           when public.volunteer_slot_state(p_status) = 'rained_out' then 'rained_out'
           when public.volunteer_slot_state(p_status) = 'closed' then 'closed'
           when p_now is null or p_start <= p_now then 'past'
$r$, $r$           when p_now is null or p_start <= p_now then 'past'
           when public.volunteer_slot_state(p_status) = 'rained_out' then 'rained_out'
           when public.volunteer_slot_state(p_status) = 'closed' then 'closed'
$r$),
    ('MU3', 'VC1', $r$  select coalesce(p_start - p_now > interval '24 hours', false);$r$,
                   $r$  select coalesce(p_start - p_now >= interval '24 hours', false);$r$),
    ('MU4', 'G1', $r$revoke all on table public.volunteer_claims from public, anon, authenticated, service_role, dashboard_readonly;$r$,
                  $r$revoke all on table public.volunteer_claims from public, anon, authenticated, service_role, dashboard_readonly;
grant select on table public.volunteer_claims to authenticated;$r$),
    ('MU5', 'R1', $r$  if not public.is_org_member(v_owner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(v_owner, 'volunteers') then$r$, $r$  if not public.org_feature_on(v_owner, 'volunteers') then$r$),
    ('MU6', 'F1', $r$  if not public.org_feature_on(v_owner, 'volunteers') then
    raise exception 'feature_off' using errcode = 'P0001';
  end if;
  select p.plan into v_plan$r$, $r$  select p.plan into v_plan$r$),
    ('MU7', 'E1', $r$  if v_plan is distinct from 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;
  if v_archived is not null then$r$, $r$  if v_archived is not null then$r$),
    ('MU8', 'A1', $r$  if v_archived is not null then
    raise exception 'season_archived' using errcode = 'P0001';
  end if;
$r$, $r$$r$),
    ('MU9', 'N1', $r$                and lower(btrim(r.name)) = lower(v_name)$r$, $r$                and btrim(r.name) = v_name$r$),
    ('MU10', 'RS3', $r$       and (c.position > p_spots or t.division_id is null or not (t.division_id = any (v_divs)));$r$,
                    $r$       and (t.division_id is null or not (t.division_id = any (v_divs)));$r$),
    ('MU11', 'RS3', $r$  ), q as (
    insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
    select c.owner_id, c.season_id, c.volunteer_id, 'shift_canceled',
           jsonb_build_object('claim_id', c.id, 'game_id', c.game_id, 'role_label', p_role_label)
      from c
    returning 1
  )
  select count(*) into v_n from q;$r$, $r$  )
  select count(*) into v_n from c;$r$),
    ('MU12', 'RS4', $r$       and (c.position > p_spots or t.division_id is null or not (t.division_id = any (v_divs)));$r$,
                    $r$       and (c.position > p_spots);$r$),
    ('MU13', 'RS5', $r$    if v_role.kind <> p_kind and exists ($r$, $r$    if false and exists ($r$),
    ('MU14', 'U1', $r$                              coalesce(for_team_id, '00000000-0000-0000-0000-000000000000'::uuid),$r$,
                   $r$                              for_team_id,$r$),
    ('MU15', 'W1', $r$  delete from public.volunteer_claims where season_id = new.id;
$r$, $r$$r$),
    ('MU16', 'RD1', $r$  v_canceled := public.volunteer_cancel_claims(v_cancel, v_role.name);
  delete from public.volunteer_roles where id = p_role_id;$r$, $r$  v_canceled := 0;
  delete from public.volunteer_roles where id = p_role_id;$r$)
  ) as t(id, expect, find, repl)
  loop
    if (length(v_body) - length(replace(v_body, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      perform pg_temp.h121_drop();
      execute replace(v_body, m.find, m.repl);
      v_res := pg_temp.h121_case();
      raise exception 'H121CASE:%', v_res;
    exception when others then
      v_mut := replace(sqlerrm, 'H121CASE:', '');
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 200), m.expect);
    end;
  end loop;

  raise exception E'ROLLED BACK — 0121 proof (part 1)\n%', v_out;
end $h$;

-- Leak check (run separately afterwards; every value must be 0 until 0121 is
-- applied):
-- select (select count(*) from public.leagues where name like 'ZZ121%'),
--        (select count(*) from pg_class where relname in ('volunteer_roles', 'volunteer_role_divisions', 'volunteer_claims')),
--        (select count(*) from pg_proc where proname in ('save_volunteer_role', 'volunteer_slot_targets', 'volunteer_admin_gate')),
--        (select count(*) from public.org_features),
--        (select md5(prosrc) from pg_proc where proname = 'wipe_volunteer_data_on_archive');  -- 888ac9aa… (0120's)

-- ── RUN LOG ──────────────────────────────────────────────────────────────────
-- (not run yet — needs Whit's go and timing)

-- Proof for 0121 (volunteer game roles + claims), PARTS 1–2: roles, role
-- divisions, claims, the pure slot-rule twins, role save/delete, the archive
-- wipe extended. Assembled by volunteer-claims-build.ts, which puts the
-- LITERAL migration text where the placeholder is. It runs BEFORE 0121 is
-- applied: one transaction that the final RAISE always rolls back. Fixtures in
-- the "test" proof org (bbf9afe1…, Elite), with the volunteers switch turned
-- on INSIDE the batch (rolled back with it) — never Santa Rosa American's data.
--
-- Parts 1–2 run 2026-11-08 on Whit's go — green, 31/31 (see RUN LOG).
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
-- Assertions (each case returns the FIRST failing tag, or 'pass'; part 1's
-- case calls part 2's at its end):
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
--   PART 2 (own fixture, times relative to the league's clock N):
--   P0  page: unknown token / link off / switch off → unknown; Pro → plan
--   C0  the claim's own Elite gate
--   P1  page: only locked divisions, roles with sign-ups on, spots whose
--       SHIFTED start is ahead; per-team sets; rained-out shown as such;
--       field prep starts 45 minutes early
--   P2  the season picker
--   C1  claim: position 1, input normalized, the manage link stored as a
--       sha256 only, the plain token only in the outbox payload
--   C2  next free position; a full spot → just_taken
--   C3  the family's team must be in that LOCKED division → wrong_team
--   C4  bad input (adult unticked, initial, name, email, IP hash)
--   C5  the same email on the same spot set → already_signed_up
--   C6  overlap → overlap_confirm_needed, naming nothing; confirmed → claimed
--   C7  rained_out / unpublished / past (shifted) / past / signups_closed
--   C8  the 100th attempt in an hour from one IP → rate_limited; the
--       100th itself (99 before it) still passes
--   P3  no name or email anywhere on the page; taken is a count
--   M1  manage page: own spots only, contact email; unknown and revoked
--       links → unknown
--   X1  cancel: inside 24 hours → change_closed + contact email; another
--       volunteer's spot → not_found; outside → canceled + email queued
--   F1  a sent email loses its manage token
--   G2  public functions service_role only; helpers callable by no role;
--       manage links readable by no role
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
--   MU17 the lead ignored (spot start = game start)           → VT1
--   MU18 a lead over 120 / below 0 accepted                   → N1
--   MU19 the claim's Elite gate removed                       → C0
--   MU20 the page lists spots in unlocked divisions           → P1
--   MU21 the page cuts spots at the game's start, not the spot's → P1
--   MU22 every claim takes position 1                         → C2
--   MU23 the family's division need not be locked             → C3
--   MU24 the overlap check removed                            → C6
--   MU25 the per-IP rate limit removed                        → C8
--   MU26 the page names who took a spot                       → P3
--   MU27 the manage token stored in plain                     → C1
--   MU28 cancel ignores the 24-hour window                    → X1
--   MU29 cancel reaches another volunteer's spot              → X1
--   MU30 a sent email keeps its manage token                  → F1
--   MU31 the manage page callable by anon                     → G2
-- (MU31 alters a grant, which only part 2's G2 checks; the verify block is
-- left out of every mutant's text, as in 0120's proof.)
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
  drop function if exists public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean);
  drop function if exists public.delete_volunteer_role(uuid, boolean);
  drop function if exists public.volunteer_cancel_claims(uuid[], text);
  drop function if exists public.volunteer_admin_gate(uuid, boolean);
  drop function if exists public.volunteer_change_allowed(timestamp, timestamp);
  drop function if exists public.volunteer_claim_refusal(text, timestamp, timestamp, boolean, boolean, boolean);
  drop function if exists public.volunteer_slot_targets(text, text, boolean, boolean, uuid, uuid, uuid, uuid, uuid[], integer);
  drop function if exists public.volunteer_slot_state(text);
  drop function if exists public.volunteer_signup_page(text, uuid);
  drop function if exists public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean);
  drop function if exists public.volunteer_manage_page(text);
  drop function if exists public.volunteer_cancel(text, uuid);
  drop function if exists public.volunteer_season_spots(uuid);
  drop function if exists public.volunteer_org_now(uuid);
  drop function if exists public.volunteer_link_owner(text);
  drop function if exists public.volunteer_game_minutes(jsonb);
  drop function if exists public.volunteer_spot_start(timestamp, integer);
  drop table if exists public.volunteer_manage_links;
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
  ('V01', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, null, 0),
  ('V02', 'scheduled',           false, false, true,  'per_team', true,  true,  'both', 'future',  true,  2, null, 0),
  ('V03', 'scheduled',           false, false, true,  'per_team', true,  false, 'both', 'future',  true,  1, null, 0),
  ('V04', 'scheduled',           false, false, true,  'per_team', false, true,  'away', 'future',  true,  1, null, 0),
  ('V05', 'scheduled',           true,  false, false, 'per_game', true,  false, 'home', 'future',  true,  1, null, 0),
  ('V06', 'scheduled',           true,  true,  false, 'per_game', true,  false, 'home', 'future',  true,  0, 'no_slot', 0),
  ('V07', 'scheduled',           true,  true,  false, 'per_team', true,  false, 'home', 'future',  true,  1, null, 0),
  ('V08', 'scheduled',           true,  false, false, 'per_team', true,  false, 'home', 'future',  true,  1, null, 0),
  ('V09', 'pending_interleague', true,  false, false, 'per_team', true,  false, 'both', 'future',  true,  0, 'no_slot', 0),
  ('V10', 'reschedule_pending',  false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, null, 0),
  ('V11', 'cancelled',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, 'rained_out', 0),
  ('V12', 'completed',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, 'closed', 0),
  ('V13', 'in_progress',         false, false, true,  'per_team', true,  true,  'both', 'future',  true,  2, 'closed', 0),
  ('V14', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'past',    true,  1, 'past', 0),
  ('V15', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'started', true,  1, 'past', 0),
  ('V16', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'now',     true,  1, 'past', 0),
  ('V17', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'soon',    true,  1, null, 0),
  ('V18', 'scheduled',           false, false, true,  'per_game', false, true,  'both', 'future',  true,  0, 'no_slot', 0),
  ('V19', 'scheduled',           false, false, true,  'per_game', true,  true,  'none', 'future',  true,  1, 'unpublished', 0),
  ('V20', 'scheduled',           false, false, true,  'per_game', true,  true,  'away', 'future',  true,  1, 'unpublished', 0),
  ('V21', 'scheduled',           false, false, true,  'per_team', true,  true,  'away', 'future',  true,  2, 'unpublished', 0),
  ('V22', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'future',  false, 1, 'signups_closed', 0),
  ('V23', 'cancelled',           false, false, true,  'per_game', true,  true,  'both', 'past',    true,  1, 'rained_out', 0),
  ('V24', 'scheduled',           false, false, false, 'per_team', true,  true,  'both', 'future',  true,  1, null, 0),
  ('V25', 'scheduled',           true,  true,  false, 'per_team', true,  false, 'none', 'future',  true,  1, 'unpublished', 0),
  ('V26', 'reschedule_pending',  true,  true,  false, 'per_game', true,  false, 'home', 'future',  true,  0, 'no_slot', 0),
  ('V27', 'cancelled',           false, false, true,  'per_game', true,  true,  'none', 'future',  false, 1, 'rained_out', 0),
  ('V28', 'scheduled',           false, false, true,  'per_team', false, false, 'both', 'future',  true,  0, 'no_slot', 0),
  ('V29', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'soon',    true,  1, 'past',        45),
  ('V30', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'soon',    true,  1, null,          15),
  ('V31', 'scheduled',           false, false, true,  'per_team', true,  true,  'both', 'soon',    true,  2, 'past',        30),
  ('V32', 'cancelled',           false, false, true,  'per_game', true,  true,  'both', 'soon',    true,  1, 'rained_out',  45)
-- VSLOT-TABLE-END
  ) as x(id, status, il, is_away, has_away, kind, h_in, a_in, locked, at_when, so, targets, refusal, lead)
  loop
    v_when := case r.at_when when 'past' then '2026-11-09 12:00' when 'started' then '2026-11-10 11:59'
                             when 'now' then '2026-11-10 12:00' when 'soon' then '2026-11-10 12:30'
                             else '2026-11-20 10:00' end;
    v_lockset := case r.locked when 'both' then array[c_dh, c_da] when 'home' then array[c_dh]
                               when 'away' then array[c_da] else array[]::uuid[] end;
    select count(*) into v_n
      from public.volunteer_slot_targets(r.status, r.kind, r.il, r.is_away, c_th, case when r.has_away then c_ta end,
             c_dh, c_da, (case when r.h_in then array[c_dh] else '{}'::uuid[] end) || (case when r.a_in then array[c_da] else '{}'::uuid[] end), 2);
    if v_n <> r.targets then return format('VT1 %s: %s spot sets, got %s', r.id, r.targets, v_n); end if;
    select * into v_first
      from public.volunteer_slot_targets(r.status, r.kind, r.il, r.is_away, c_th, case when r.has_away then c_ta end,
             c_dh, c_da, (case when r.h_in then array[c_dh] else '{}'::uuid[] end) || (case when r.a_in then array[c_da] else '{}'::uuid[] end), 2) s
     order by s.ord limit 1;
    v_ref := public.volunteer_claim_refusal(r.status, public.volunteer_spot_start(v_when, r.lead), v_now, v_first.division_id is not null,
                                            v_first.division_id = any (v_lockset), r.so);
    if v_ref is distinct from r.refusal then return format('VT1 %s: refusal %s, got %s', r.id, coalesce(r.refusal, 'null'), coalesce(v_ref, 'null')); end if;
  end loop;

  -- VC1 — the shared VCHANGE table.
  for r in select * from (values
-- VCHANGE-TABLE-BEGIN
  ('C01', '2026-11-11T12:01', '2026-11-10T12:00', true, 0),
  ('C02', '2026-11-11T12:00', '2026-11-10T12:00', false, 0),
  ('C03', '2026-11-11T11:59', '2026-11-10T12:00', false, 0),
  ('C04', '2026-12-01T09:00', '2026-11-29T09:00', true, 0),
  ('C05', '2026-12-01T09:00', '2026-11-30T09:01', false, 0),
  ('C06', '2027-01-01T10:00', '2026-12-31T09:59', true, 0),
  ('C07', '2026-11-10T10:00', '2026-11-10T12:00', false, 0),
  ('C08', '2026-11-08T10:00', '2026-11-01T10:00', true, 0),
  ('C09', '2026-11-11T12:30', '2026-11-10T12:00', false, 45),
  ('C10', '2026-11-11T12:31', '2026-11-10T12:00', true,  30),
  ('C11', '2026-11-12T00:30', '2026-11-10T23:29', true,  60),
  ('C12', '2026-11-12T00:30', '2026-11-10T23:30', false, 60)
-- VCHANGE-TABLE-END
  ) as x(id, start_at, now_at, allowed, lead)
  loop
    if public.volunteer_change_allowed(public.volunteer_spot_start(r.start_at::timestamp, r.lead), r.now_at::timestamp) is distinct from r.allowed then
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
  update public.profiles set plan = 'elite' where id = v_org;

  -- G1 — privileges and RLS.
  if exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) ro,
                  unnest(array['public.volunteer_slot_state(text)',
                               'public.volunteer_slot_targets(text, text, boolean, boolean, uuid, uuid, uuid, uuid, uuid[], integer)',
                               'public.volunteer_claim_refusal(text, timestamp, timestamp, boolean, boolean, boolean)',
                               'public.volunteer_change_allowed(timestamp, timestamp)',
                               'public.volunteer_admin_gate(uuid, boolean)', 'public.volunteer_cancel_claims(uuid[], text)']) f
     where has_function_privilege(ro, f, 'EXECUTE')) then
    return 'G1 a helper is callable';
  end if;
  if not has_function_privilege('authenticated', 'public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean)', 'EXECUTE')
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
    'select public.save_volunteer_role(null, %L, %L, %L, 2, 0, true, true, array[%L]::uuid[], true)::text', v_s, 'GameChanger', 'per_game', v_d1));
  if v_r not like '%not_authorized%' then return 'R1 non-member: ' || v_r; end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 2, 0, true, true, array[%L]::uuid[], true)::text', v_s, 'GameChanger', 'per_game', v_d1));
  if v_r not like '%feature_off%' then return 'F1 switch off: ' || v_r; end if;
  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'volunteers', true);
  update public.profiles set plan = 'pro' where id = v_org;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 2, 0, true, true, array[%L]::uuid[], true)::text', v_s, 'GameChanger', 'per_game', v_d1));
  if v_r not like '%plan_required%' then return 'E1 Pro: ' || v_r; end if;
  update public.profiles set plan = 'elite' where id = v_org;
  update public.leagues set archived_at = now() where id = v_s2;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 2, 0, true, true, array[%L]::uuid[], true)::text', v_s2, 'GameChanger', 'per_game', v_dx));
  if v_r not like '%season_archived%' then return 'A1 archived: ' || v_r; end if;
  update public.leagues set archived_at = null where id = v_s2;
  -- The volunteers are made only now: archiving S2 just above runs the wipe,
  -- which (correctly) deletes every volunteer nothing references yet.
  insert into public.volunteers (id, owner_id, email_lc, first_initial, last_name, adult_confirmed_at) values
    (v_va, v_org, 'zz121-a@example.org', 'A', 'Alpha', now()),
    (v_vb, v_org, 'zz121-b@example.org', 'B', 'Bravo', now()),
    (v_vc, v_org, 'zz121-c@example.org', 'C', 'Charlie', now());

  -- RS1 — create, preview then commit.
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 3, 0, true, true, array[%L]::uuid[], false)::text', v_s, '  GameChanger ', 'per_game', v_d1));
  if v_r like 'ERR%' or (v_r::jsonb ->> 'committed') <> 'false' or exists (select 1 from public.volunteer_roles where season_id = v_s) then
    return 'RS1 preview: ' || v_r;
  end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 3, 0, true, true, array[%L]::uuid[], true)::text', v_s, '  GameChanger ', 'per_game', v_d1));
  if v_r like 'ERR%' then return 'RS1 commit: ' || v_r; end if;
  v_role := (v_r::jsonb ->> 'role_id')::uuid;
  if (select name from public.volunteer_roles where id = v_role) is distinct from 'GameChanger'
     or (select array_agg(division_id) from public.volunteer_role_divisions where role_id = v_role) is distinct from array[v_d1] then
    return 'RS1 stored';
  end if;

  -- N1 — validation and the name rule.
  foreach e in array array[
      format('select public.save_volunteer_role(null, %L, %L, %L, 2, 0, true, true, null, true)::text', v_s, '   ', 'per_game'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 2, 0, true, true, null, true)::text', v_s, repeat('x', 61), 'per_game'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 2, 0, true, true, null, true)::text', v_s, 'X', 'per_season'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 0, 0, true, true, null, true)::text', v_s, 'X', 'per_game'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 11, 0, true, true, null, true)::text', v_s, 'X', 'per_game'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 1, 121, true, true, null, true)::text', v_s, 'X', 'per_game'),
      format('select public.save_volunteer_role(null, %L, %L, %L, 1, -1, true, true, null, true)::text', v_s, 'X', 'per_game')] loop
    v_r := pg_temp.h121_as(v_org, 'authenticated', e);
    if v_r not like 'ERR P0001%' then return 'N1 accepted: ' || e || ' → ' || coalesce(v_r, 'null'); end if;
  end loop;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(null, %L, %L, %L, 1, 0, true, true, null, true)::text', v_s, 'gamechanger', 'per_team'));
  if v_r not like '%name_taken%' then return 'N1 case-only duplicate: ' || v_r; end if;

  -- RS2 — a division of another season.
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 3, 0, true, true, array[%L, %L]::uuid[], true)::text', v_role, v_s, 'GameChanger', 'per_game', v_d1, v_dx));
  if v_r not like '%division_not_in_season%' then return 'RS2 other season: ' || v_r; end if;

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
    'select public.save_volunteer_role(%L, %L, %L, %L, 2, 0, true, true, array[%L]::uuid[], false)::text', v_role, v_s, 'GameChanger', 'per_game', v_d1));
  if v_r like 'ERR%' or (v_r::jsonb ->> 'claims_to_cancel') <> '1'
     or (select status from public.volunteer_claims where id = c3) <> 'active'
     or (select spots from public.volunteer_roles where id = v_role) <> 3 then
    return 'RS3 preview: ' || v_r;
  end if;
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 2, 0, true, true, array[%L]::uuid[], true)::text', v_role, v_s, 'GameChanger', 'per_game', v_d1));
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
    'select public.save_volunteer_role(%L, %L, %L, %L, 1, 0, true, true, array[]::uuid[], false)::text', v_role2, v_s, 'ZZ Scorebook', 'per_team'));
  if v_r like 'ERR%' or (v_r::jsonb ->> 'claims_to_cancel') <> '2' then return 'RS4 preview: ' || v_r; end if;

  -- RS5 — kind can't change under claims.
  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 2, 0, true, true, array[%L]::uuid[], true)::text', v_role, v_s, 'GameChanger', 'per_team', v_d1));
  if v_r not like '%kind_locked%' then return 'RS5 kind change: ' || v_r; end if;

  v_r := pg_temp.h121_as(v_org, 'authenticated', format(
    'select public.save_volunteer_role(%L, %L, %L, %L, 1, 0, true, true, array[]::uuid[], true)::text', v_role2, v_s, 'ZZ Scorebook', 'per_team'));
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

  return pg_temp.h121_case2();
end;
$f$;

-- PART 2 — the public sign-up path, on its own fixture (times relative to the
-- league's clock now, N). Returns the first failing tag, or 'pass'.
create or replace function pg_temp.h121_case2() returns text language plpgsql as $f$
declare
  v_org uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_now timestamp;
  v_s uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid();
  v_d1 uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid(); v_d3 uuid := gen_random_uuid();
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_t3 uuid := gen_random_uuid();
  v_t4 uuid := gen_random_uuid(); v_t5 uuid := gen_random_uuid(); v_t6 uuid := gen_random_uuid();
  g_a uuid := gen_random_uuid(); g_b uuid := gen_random_uuid(); g_c uuid := gen_random_uuid();
  g_r uuid := gen_random_uuid(); g_p uuid := gen_random_uuid(); g_s uuid := gen_random_uuid();
  g_t uuid := gen_random_uuid(); g_x uuid := gen_random_uuid();
  r_gc uuid := gen_random_uuid(); r_fp uuid := gen_random_uuid(); r_off uuid := gen_random_uuid();
  v_tok text; v_page jsonb; v_r jsonb; v_a_tok text; v_b_tok text; v_claim_a uuid; v_claim_t uuid; v_claim_b uuid;
  h_ip text := repeat('1', 64); h_mail text := repeat('2', 64);
  v_txt text;
begin
  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'volunteers', true)
    on conflict (owner_id, feature) do update set enabled = true;
  insert into public.volunteer_settings (owner_id, link_enabled, contact_email) values (v_org, true, 'board@example.org')
    on conflict (owner_id) do update set link_enabled = true, contact_email = 'board@example.org';
  select link_token into v_tok from public.volunteer_settings where owner_id = v_org;
  update public.profiles set plan = 'elite' where id = v_org;
  v_now := public.volunteer_org_now(v_org);

  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (v_s,  'ZZ121 P2',  'Baseball', 'Fall 2026', v_org, v_now::date - 30, v_now::date + 60),
    (v_s2, 'ZZ121 P2b', 'Baseball', 'Fall 2026', v_org, v_now::date - 10, v_now::date + 60);
  -- Divisions are made UNLOCKED and locked after the games go in: the 0082
  -- lock trigger (correctly) refuses a game insert into a locked division.
  insert into public.divisions (id, league_id, name, team_count, settings, status, locked) values
    (v_d1, v_s,  'ZZ Majors', 2, '{"game_duration": 90}'::jsonb, 'active', false),
    (v_d2, v_s,  'ZZ Minors', 2, '{"game_duration": 90}'::jsonb, 'active', false),
    (v_d3, v_s2, 'ZZ AAA',    2, '{}'::jsonb, 'active', false);
  insert into public.teams (id, league_id, name, division_id) values
    (v_t1, v_s, 'ZZ Expos', v_d1), (v_t2, v_s, 'ZZ Mets', v_d1),
    (v_t3, v_s, 'ZZ Cubs', v_d2), (v_t4, v_s, 'ZZ Rays', v_d2),
    (v_t5, v_s2, 'ZZ Owls', v_d3), (v_t6, v_s2, 'ZZ Bees', v_d3);
  insert into public.games (id, league_id, home_team_id, away_team_id, scheduled_at, status) values
    (g_a, v_s, v_t1, v_t2, (v_now + interval '3 days') at time zone 'UTC', 'scheduled'),
    (g_b, v_s, v_t1, v_t2, (v_now + interval '3 days 30 minutes') at time zone 'UTC', 'scheduled'),
    (g_c, v_s, v_t3, v_t4, (v_now + interval '3 days') at time zone 'UTC', 'scheduled'),
    (g_r, v_s, v_t1, v_t2, (v_now + interval '4 days') at time zone 'UTC', 'cancelled'),
    (g_p, v_s, v_t1, v_t2, (v_now - interval '1 day') at time zone 'UTC', 'scheduled'),
    (g_s, v_s, v_t1, v_t2, (v_now + interval '30 minutes') at time zone 'UTC', 'scheduled'),
    (g_t, v_s, v_t1, v_t2, (v_now + interval '20 hours') at time zone 'UTC', 'scheduled'),
    (g_x, v_s2, v_t5, v_t6, (v_now + interval '5 days') at time zone 'UTC', 'scheduled');
  update public.divisions set locked = true where id in (v_d1, v_d3);
  insert into public.volunteer_roles (id, owner_id, season_id, name, kind, spots, lead_minutes, signups_open) values
    (r_gc,  v_org, v_s, 'ZZ GameChanger', 'per_team', 1, 0,  true),
    (r_fp,  v_org, v_s, 'ZZ Field prep',  'per_game', 2, 45, true),
    (r_off, v_org, v_s, 'ZZ Announcer',   'per_game', 1, 0,  false);
  insert into public.volunteer_role_divisions values (r_gc, v_d1), (r_gc, v_d2), (r_fp, v_d1), (r_off, v_d1);

  -- P0 — statuses.
  if (public.volunteer_signup_page(repeat('a', 64), null) ->> 'status') <> 'unknown' then return 'P0 unknown token'; end if;
  update public.volunteer_settings set link_enabled = false where owner_id = v_org;
  if (public.volunteer_signup_page(v_tok, null) ->> 'status') <> 'unknown' then return 'P0 link off'; end if;
  update public.volunteer_settings set link_enabled = true where owner_id = v_org;
  update public.org_features set enabled = false where owner_id = v_org;
  if (public.volunteer_signup_page(v_tok, null) ->> 'status') <> 'unknown' then return 'P0 feature off'; end if;
  update public.org_features set enabled = true where owner_id = v_org;
  update public.profiles set plan = 'pro' where id = v_org;
  if (public.volunteer_signup_page(v_tok, null) ->> 'status') <> 'plan' then return 'P0 plan'; end if;
  -- C0 — the claim's own plan gate.
  if (public.volunteer_claim(v_tok, g_a, r_fp, null, v_d1, v_t1, 'A', 'Alpha', 'zz121-a@example.org', true, h_ip, h_mail, false) ->> 'status') <> 'plan' then
    return 'C0 claim on Pro';
  end if;
  update public.profiles set plan = 'elite' where id = v_org;

  -- P1 — what the page shows.
  v_page := public.volunteer_signup_page(v_tok, v_s);
  if v_page ->> 'status' <> 'ok' or jsonb_array_length(v_page -> 'seasons') < 2 or (v_page ->> 'season_id')::uuid <> v_s then
    return 'P1 status/seasons: ' || left(v_page::text, 200);
  end if;
  if exists (select 1 from jsonb_array_elements(v_page -> 'divisions') d where (d ->> 'id')::uuid <> v_d1) then
    return 'P1 an unlocked division is listed';
  end if;
  if exists (select 1 from jsonb_array_elements(v_page -> 'roles') r where (r ->> 'id')::uuid = r_off) then
    return 'P1 a role with sign-ups off is listed';
  end if;
  if exists (select 1 from jsonb_array_elements(v_page -> 'spots') x where (x ->> 'game_id')::uuid in (g_c, g_p) or (x ->> 'role_id')::uuid = r_off) then
    return 'P1 an unlocked, past or closed-role spot is listed';
  end if;
  if exists (select 1 from jsonb_array_elements(v_page -> 'spots') x where (x ->> 'game_id')::uuid = g_s and (x ->> 'role_id')::uuid = r_fp) then
    return 'P1 a spot whose shifted start has passed is listed';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_page -> 'spots') x where (x ->> 'game_id')::uuid = g_s and (x ->> 'role_id')::uuid = r_gc)
     or (select count(*) from jsonb_array_elements(v_page -> 'spots') x where (x ->> 'game_id')::uuid = g_a and (x ->> 'role_id')::uuid = r_gc) <> 2
     or not exists (select 1 from jsonb_array_elements(v_page -> 'spots') x where (x ->> 'game_id')::uuid = g_r and x ->> 'state' = 'rained_out') then
    return 'P1 expected spots missing';
  end if;
  if (select x ->> 'start' from jsonb_array_elements(v_page -> 'spots') x where (x ->> 'game_id')::uuid = g_a and (x ->> 'role_id')::uuid = r_fp)
     <> to_char(v_now + interval '3 days' - interval '45 minutes', 'YYYY-MM-DD"T"HH24:MI') then
    return 'P1 field prep does not start 45 minutes early';
  end if;
  -- P2 — the picker.
  v_page := public.volunteer_signup_page(v_tok, v_s2);
  if (v_page ->> 'season_id')::uuid <> v_s2 or (v_page -> 'divisions' -> 0 ->> 'id')::uuid <> v_d3 then
    return 'P2 picker: ' || left(v_page::text, 200);
  end if;

  -- C1 / C2 — take spots.
  v_r := public.volunteer_claim(v_tok, g_a, r_fp, null, v_d1, v_t1, 'a', ' Alpha ', ' ZZ121-A@Example.org ', true, h_ip, h_mail, false);
  if v_r ->> 'status' <> 'claimed' or (v_r ->> 'position') <> '1' then return 'C1 claim: ' || v_r::text; end if;
  v_claim_a := (v_r ->> 'claim_id')::uuid;
  select payload ->> 'manage_token' into v_a_tok from public.volunteer_outbox
   where kind = 'signup_confirmed' and payload ->> 'claim_id' = v_claim_a::text;
  if v_a_tok !~ '^[0-9a-f]{64}$'
     or not exists (select 1 from public.volunteer_manage_links where token_hash = encode(extensions.digest(v_a_tok, 'sha256'), 'hex'))
     or exists (select 1 from public.volunteer_manage_links where token_hash = v_a_tok)
     or (select email_lc || '/' || first_initial || '/' || last_name from public.volunteers
          where id = (select volunteer_id from public.volunteer_claims where id = v_claim_a)) <> 'zz121-a@example.org/A/Alpha' then
    return 'C1 token/link/volunteer';
  end if;
  v_r := public.volunteer_claim(v_tok, g_a, r_fp, null, v_d1, v_t2, 'B', 'Bravo', 'zz121-b@example.org', true, h_ip, repeat('3', 64), false);
  if v_r ->> 'status' <> 'claimed' or (v_r ->> 'position') <> '2' then return 'C2 second spot: ' || v_r::text; end if;
  v_claim_b := (v_r ->> 'claim_id')::uuid;
  select payload ->> 'manage_token' into v_b_tok from public.volunteer_outbox
   where kind = 'signup_confirmed' and payload ->> 'claim_id' = v_claim_b::text;
  v_r := public.volunteer_claim(v_tok, g_a, r_fp, null, v_d1, v_t2, 'C', 'Charlie', 'zz121-c@example.org', true, h_ip, repeat('4', 64), false);
  if v_r ->> 'status' <> 'just_taken' then return 'C2 full spot: ' || v_r::text; end if;

  -- C3 — the family's team must be in that LOCKED division.
  if (public.volunteer_claim(v_tok, g_a, r_gc, v_t1, v_d2, v_t3, 'C', 'Charlie', 'zz121-c@example.org', true, h_ip, repeat('4', 64), false) ->> 'status') <> 'wrong_team'
     or (public.volunteer_claim(v_tok, g_a, r_gc, v_t1, v_d2, v_t1, 'C', 'Charlie', 'zz121-c@example.org', true, h_ip, repeat('4', 64), false) ->> 'status') <> 'wrong_team' then
    return 'C3 wrong team accepted';
  end if;

  -- C4 — input.
  if (public.volunteer_claim(v_tok, g_a, r_gc, v_t1, v_d1, v_t1, 'C', 'Charlie', 'zz121-c@example.org', false, h_ip, repeat('4', 64), false) ->> 'status') <> 'invalid_input'
     or (public.volunteer_claim(v_tok, g_a, r_gc, v_t1, v_d1, v_t1, 'CD', 'Charlie', 'zz121-c@example.org', true, h_ip, repeat('4', 64), false) ->> 'status') <> 'invalid_input'
     or (public.volunteer_claim(v_tok, g_a, r_gc, v_t1, v_d1, v_t1, 'C', '<b>', 'zz121-c@example.org', true, h_ip, repeat('4', 64), false) ->> 'status') <> 'invalid_input'
     or (public.volunteer_claim(v_tok, g_a, r_gc, v_t1, v_d1, v_t1, 'C', 'Charlie', 'x@y', true, h_ip, repeat('4', 64), false) ->> 'status') <> 'invalid_input'
     or (public.volunteer_claim(v_tok, g_a, r_gc, v_t1, v_d1, v_t1, 'C', 'Charlie', 'zz121-c@example.org', true, 'zz', repeat('4', 64), false) ->> 'status') <> 'invalid_input' then
    return 'C4 bad input accepted';
  end if;

  -- C5 — the same spot set twice.
  if (public.volunteer_claim(v_tok, g_a, r_fp, null, v_d1, v_t1, 'A', 'Alpha', 'zz121-a@example.org', true, h_ip, h_mail, false) ->> 'status') <> 'already_signed_up' then
    return 'C5 the same email took the same spot set twice';
  end if;

  -- C6 — overlap: A's field prep on game A runs N+3d−45m to N+3d+90m; game B
  -- starts at N+3d+30m.
  v_r := public.volunteer_claim(v_tok, g_b, r_gc, v_t1, v_d1, v_t1, 'A', 'Alpha', 'zz121-a@example.org', true, h_ip, h_mail, false);
  if v_r ->> 'status' <> 'overlap_confirm_needed' or v_r::text ~ 'Field|ZZ|Expos|start' then return 'C6 overlap: ' || v_r::text; end if;
  v_r := public.volunteer_claim(v_tok, g_b, r_gc, v_t1, v_d1, v_t1, 'A', 'Alpha', 'zz121-a@example.org', true, h_ip, h_mail, true);
  if v_r ->> 'status' <> 'claimed' then return 'C6 confirmed overlap: ' || v_r::text; end if;

  -- C7 — the rules' refusals reach the volunteer.
  if (public.volunteer_claim(v_tok, g_r, r_gc, v_t1, v_d1, v_t1, 'D', 'Delta', 'zz121-d@example.org', true, h_ip, repeat('5', 64), false) ->> 'status') <> 'rained_out'
     or (public.volunteer_claim(v_tok, g_c, r_gc, v_t3, v_d1, v_t1, 'D', 'Delta', 'zz121-d@example.org', true, h_ip, repeat('5', 64), false) ->> 'status') <> 'unpublished'
     or (public.volunteer_claim(v_tok, g_s, r_fp, null, v_d1, v_t1, 'D', 'Delta', 'zz121-d@example.org', true, h_ip, repeat('5', 64), false) ->> 'status') <> 'past'
     or (public.volunteer_claim(v_tok, g_p, r_gc, v_t1, v_d1, v_t1, 'D', 'Delta', 'zz121-d@example.org', true, h_ip, repeat('5', 64), false) ->> 'status') <> 'past'
     or (public.volunteer_claim(v_tok, g_a, r_off, null, v_d1, v_t1, 'D', 'Delta', 'zz121-d@example.org', true, h_ip, repeat('5', 64), false) ->> 'status') <> 'signups_closed' then
    return 'C7 a refusal did not reach the volunteer';
  end if;

  -- C8 — rate limit per IP (100 an hour): 99 earlier attempts still pass,
  -- the 100th recorded one blocks.
  insert into public.volunteer_rate_events (kind, key_hash) select 'claim_ip', repeat('9', 64) from generate_series(1, 99);
  if (public.volunteer_claim(v_tok, g_a, r_gc, v_t2, v_d1, v_t2, 'E', 'Echo', 'zz121-e@example.org', true, repeat('9', 64), repeat('6', 64), false) ->> 'status') = 'rate_limited' then
    return 'C8 refused below the limit';
  end if;
  if (public.volunteer_claim(v_tok, g_a, r_gc, v_t2, v_d1, v_t2, 'E', 'Echo', 'zz121-e@example.org', true, repeat('9', 64), repeat('6', 64), false) ->> 'status') <> 'rate_limited' then
    return 'C8 rate limit';
  end if;

  -- P3 — the page never carries a name or an email.
  v_txt := public.volunteer_signup_page(v_tok, v_s)::text;
  if v_txt ~* 'zz121-|alpha|bravo|example\.org' then return 'P3 a name or email on the page'; end if;
  if (select (x ->> 'taken')::int from jsonb_array_elements(public.volunteer_signup_page(v_tok, v_s) -> 'spots') x
       where (x ->> 'game_id')::uuid = g_a and (x ->> 'role_id')::uuid = r_fp) <> 2 then
    return 'P3 taken count';
  end if;

  -- M1 — the manage page.
  v_r := public.volunteer_manage_page(v_a_tok);
  if v_r ->> 'status' <> 'ok' or jsonb_array_length(v_r -> 'claims') <> 2 or v_r ->> 'contact_email' <> 'board@example.org'
     or v_r::text ~* 'bravo|zz121-b' then
    return 'M1 manage page: ' || left(coalesce(v_r::text, 'null'), 200);
  end if;
  if (public.volunteer_manage_page(repeat('c', 64)) ->> 'status') <> 'unknown' then return 'M1 unknown token'; end if;

  -- X1 — cancel.
  v_r := public.volunteer_claim(v_tok, g_t, r_gc, v_t1, v_d1, v_t1, 'A', 'Alpha', 'zz121-a@example.org', true, h_ip, h_mail, false);
  v_claim_t := (v_r ->> 'claim_id')::uuid;
  if v_claim_t is null then return 'X1 setup: ' || v_r::text; end if;
  v_r := public.volunteer_cancel(v_a_tok, v_claim_t);
  if v_r ->> 'status' <> 'change_closed' or v_r ->> 'contact_email' <> 'board@example.org'
     or (select status from public.volunteer_claims where id = v_claim_t) <> 'active' then
    return 'X1 inside 24 hours: ' || v_r::text;
  end if;
  if (public.volunteer_cancel(v_a_tok, v_claim_b) ->> 'status') <> 'not_found'
     or (select status from public.volunteer_claims where id = v_claim_b) <> 'active' then
    return 'X1 another volunteer''s spot';
  end if;
  v_r := public.volunteer_cancel(v_a_tok, v_claim_a);
  if v_r ->> 'status' <> 'canceled' or (select status from public.volunteer_claims where id = v_claim_a) <> 'canceled'
     or not exists (select 1 from public.volunteer_outbox where kind = 'canceled_by_volunteer' and payload ->> 'claim_id' = v_claim_a::text) then
    return 'X1 cancel: ' || v_r::text;
  end if;
  update public.volunteer_manage_links set revoked_at = now() where token_hash = encode(extensions.digest(v_b_tok, 'sha256'), 'hex');
  if (public.volunteer_manage_page(v_b_tok) ->> 'status') <> 'unknown' then return 'M1 a revoked link still opens'; end if;

  -- F1 — a sent email drops its token.
  perform public.volunteer_outbox_take(100);
  perform public.volunteer_outbox_finish(o.id, true, 're_x', null, false)
     from public.volunteer_outbox o where o.status = 'sending' and o.kind = 'signup_confirmed' and o.owner_id = v_org;
  if exists (select 1 from public.volunteer_outbox where owner_id = v_org and kind = 'signup_confirmed' and status = 'sent' and payload ? 'manage_token')
     or not exists (select 1 from public.volunteer_outbox where owner_id = v_org and kind = 'signup_confirmed' and status = 'sent') then
    return 'F1 a sent email kept its manage token';
  end if;

  -- G2 — privileges.
  if exists (select 1 from unnest(array['anon', 'authenticated', 'dashboard_readonly']) ro,
                           unnest(array['public.volunteer_signup_page(text, uuid)',
                                        'public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean)',
                                        'public.volunteer_manage_page(text)', 'public.volunteer_cancel(text, uuid)']) f
              where has_function_privilege(ro, f, 'EXECUTE'))
     or not has_function_privilege('service_role', 'public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean)', 'EXECUTE')
     or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) ro,
                              unnest(array['public.volunteer_season_spots(uuid)', 'public.volunteer_link_owner(text)',
                                           'public.volunteer_org_now(uuid)', 'public.volunteer_spot_start(timestamp, integer)',
                                           'public.volunteer_game_minutes(jsonb)']) f
                 where has_function_privilege(ro, f, 'EXECUTE'))
     or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) ro,
                              unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
                 where has_table_privilege(ro, 'public.volunteer_manage_links', pr)) then
    return 'G2 public-function or manage-link privileges';
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
  delete from public.volunteer_roles where id = p_role_id;$r$),
    ('MU17', 'VT1', $r$  select p_game_start - make_interval(mins => least(greatest(coalesce(p_lead_minutes, 0), 0), 120));$r$,
                    $r$  select p_game_start;$r$),
    ('MU18', 'N1', $r$  if p_lead_minutes is null or p_lead_minutes < 0 or p_lead_minutes > 120 then$r$,
                   $r$  if p_lead_minutes is null then$r$),
    ('MU19', 'C0', $r$  v_why     text;
  v_vol     uuid;
  v_pos     integer;
  v_claim   uuid;
  v_token   text;
begin
  if v_owner is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then$r$, $r$  v_why     text;
  v_vol     uuid;
  v_pos     integer;
  v_claim   uuid;
  v_token   text;
begin
  if v_owner is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if false then$r$),
    ('MU20', 'P1', $r$       where sp.division_locked and sp.signups_open and sp.spot_start > v_now), '[]')$r$,
                   $r$       where sp.signups_open and sp.spot_start > v_now), '[]')$r$),
    ('MU21', 'P1', $r$       where sp.division_locked and sp.signups_open and sp.spot_start > v_now), '[]')$r$,
                   $r$       where sp.division_locked and sp.signups_open and sp.game_start > v_now), '[]')$r$),
    ('MU22', 'C2', $r$  select min(n) into v_pos$r$, $r$  select 1 into v_pos$r$),
    ('MU23', 'C3', $r$                    and d.league_id = v_season and d.locked) then$r$, $r$                    and d.league_id = v_season) then$r$),
    ('MU24', 'C6', $r$    if not coalesce(p_confirm_overlap, false) and exists ($r$, $r$    if false and exists ($r$),
    ('MU25', 'C8', $r$       where e.kind = 'claim_ip' and e.key_hash = p_ip_hash and e.at > now() - interval '1 hour') >= 100$r$,
                   $r$       where e.kind = 'claim_ip' and e.key_hash = p_ip_hash and e.at > now() - interval '1 hour') >= 1000000$r$),
    ('MU26', 'P3', $r$               'spots', sp.spots, 'taken', least(sp.taken, sp.spots))$r$,
                   $r$               'spots', sp.spots, 'taken', least(sp.taken, sp.spots),
               'who', (select string_agg(v2.last_name, ',') from public.volunteer_claims c2 join public.volunteers v2 on v2.id = c2.volunteer_id
                        where c2.game_id = sp.game_id and c2.role_id = sp.role_id and c2.status = 'active'))$r$),
    ('MU27', 'C1', $r$  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_vol, v_season);$r$,
                   $r$  values (v_token, v_vol, v_season);$r$),
    ('MU28', 'X1', $r$  if not public.volunteer_change_allowed(v_start, public.volunteer_org_now(v_owner)) then$r$,
                   $r$  if false then$r$),
    ('MU29', 'X1', $r$   where c.id = p_claim_id and c.volunteer_id = v_link.volunteer_id and c.season_id = v_link.season_id$r$,
                   $r$   where c.id = p_claim_id and c.season_id = v_link.season_id$r$),
    ('MU30', 'F1', $r$           resend_id = left(p_resend_id, 100), error = null,
           payload = payload - 'manage_token'$r$, $r$           resend_id = left(p_resend_id, 100), error = null$r$),
    ('MU31', 'G2', $r$grant execute on function public.volunteer_manage_page(text) to service_role;$r$,
                   $r$grant execute on function public.volunteer_manage_page(text) to service_role, anon;$r$)
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

  raise exception E'ROLLED BACK — 0121 proof (parts 1–2)\n%', v_out;
end $h$;

-- Leak check (run separately afterwards; every value must be 0 until 0121 is
-- applied):
-- select (select count(*) from public.leagues where name like 'ZZ121%'),
--        (select count(*) from pg_class where relname in ('volunteer_roles', 'volunteer_role_divisions', 'volunteer_claims')),
--        (select count(*) from pg_proc where proname in ('save_volunteer_role', 'volunteer_slot_targets', 'volunteer_admin_gate')),
--        (select count(*) from public.org_features),
--        (select md5(prosrc) from pg_proc where proname = 'wipe_volunteer_data_on_archive');  -- 888ac9aa… (0120's)

-- ── RUN LOG ──────────────────────────────────────────────────────────────────
-- PART 1 — 2026-11-08 ~18:05–18:20 Pacific, against production on Whit's go,
-- rolled back, "test" org with the switch on inside the batch only.
--   L1 locks (all three runs): ACCESS SHARE + SHARE ROW EXCLUSIVE on leagues,
--     divisions, teams, games, playoff_games, snack_shack_blocks, profiles.
--   Run 1 — a REAL drift, caught by the shared table: VT1 V09 — a
--     pending_interleague game had 1 spot set in SQL and 0 in TypeScript
--     (volunteer_slot_targets never looked at the status). Fixed: the SQL
--     twin takes p_status and returns nothing when the state is 'none'. Every
--     mutant died at that baseline line, so none counted. (Run 1 also sent a
--     comment-trimmed copy of the migration; runs 2–3 sent the full file.)
--   Run 2 — HARNESS fault: baseline stopped at the first claim insert (FK on
--     volunteer_id). A1 archives S2, the wipe correctly deleted every
--     unreferenced volunteer — the three fixture volunteers. Moved their
--     insert after A1. MU1–MU9 already killed at their own tag.
--   Run 3 — BASELINE pass; 16/16 killed at their own assertion (MU13 printed
--     "wrong tag" only because its message began 'RS5:' — the colon broke the
--     tag parse; it died at RS5. RS5/RS2 messages relabelled). md5s printed
--     match the repo file. Leak check after: 0 ZZ121 seasons, 0 new tables /
--     functions, 0 feature rows / volunteers / outbox rows, wipe md5 back to
--     0120's 888ac9aa…, test org elite, no disabled trigger, no idle tx.
-- PARTS 1–2 — 2026-11-08 ~19:45–20:40 Pacific, against production on Whit's
-- go (with the per-IP limit raised to 100), rolled back, "test" org.
--   The batch (~107 KB) was too big for one call, so it was STAGED: the
--   migration and the harness were inserted in ~19 KB pieces into a scratch
--   schema `zz_proof` (no API exposure; every role's access revoked), each
--   piece's md5 checked against the local file, the wholes checked (migration
--   56c45636… = "\n" + the repo file; harness 9e76036e…), and the run
--   refused unless both matched. Dropped after (leak check).
--   L1 locks: ACCESS SHARE + SHARE ROW EXCLUSIVE on leagues, divisions,
--     teams, games, playoff_games, snack_shack_blocks, profiles.
--   Run 1 — part 1 green (MU1–MU18 killed at their own tag, incl. the new
--     lead ones). Part 2's baseline stopped on a HARNESS fault: its fixture
--     made the divisions locked BEFORE inserting games, and the 0082 lock
--     trigger (correctly) refused the insert; MU19–MU31 died there. Fixed:
--     games go in while unlocked, then the divisions are locked (the staged
--     harness piece patched in place; whole md5 dd5d9e8d…, re-checked).
--   Run 2 — BASELINE pass; 31/31 killed at their own assertion. md5s printed
--     match the repo file. Leak check after: 0 ZZ121 seasons, 0 new tables /
--     functions, stage schema gone, 0 feature / settings / volunteer /
--     outbox / rate-event rows, no calendar links on fixture teams, the wipe
--     and finish back to 0120's live bodies (888ac9aa…, 8fe09939…), test org
--     elite, no disabled trigger, no idle transaction.

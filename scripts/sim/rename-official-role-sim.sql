-- Proof for 0118 (renaming an official role carries its assignments, pay rates
-- and division role lists; the database is the only way to rename).
-- Assembled by rename-official-role-build.ts, which puts the LITERAL migration
-- text where the placeholder is — so this proves the file that will be
-- applied. It runs BEFORE 0118 is applied: the whole batch is one transaction
-- that the final RAISE always rolls back. Fixtures live in the "test" proof org
-- (bbf9afe1…) only — never Santa Rosa American's data.
--
-- LOCKS for the run (a few seconds; lock_timeout 3s): the migration's
-- REVOKE/GRANT on `official_roles`, CREATE FUNCTION, and CREATE UNIQUE INDEX
-- (SHARE on `official_roles` — role writes wait, reads don't — held to the
-- end of the batch); each mutant DROPs and rebuilds the index inside its own
-- rolled-back sub-transaction, which takes ACCESS EXCLUSIVE on
-- `official_roles` (role READS wait too) for that sub-run only — released
-- when it rolls back; row locks on the fixture rows only. The batch prints the locks it holds on official_roles
-- (L1) so the apply's lock is known, not guessed.
--
-- Fixture: season S (test org) with roles Plate (p) and Base (b); season O
-- (same org) with its own Plate (po) and a LEGACY g3 Plate row (role_id NULL),
-- so a rename that forgets the season would reach it. Division D1 (locked AND posted, list
-- ["Plate","Base"]), D2 (list ["Plate "] — untrimmed), DO in season O (list
-- ["Plate"]). Games g1, g2 in S, g3 in O. Assignments: g1 Plate (role_id p),
-- g2 Plate (role_id NULL — legacy text), g1 Base (b), g3 Plate (role_id NULL). Rates: S
-- Plate (role_id NULL), S Base (b), O Plate (po).
--
-- Assertions (each case returns the FIRST failing tag, or 'pass'):
--   A1  reply: committed, changed  (counts are A11, checked LAST)
--   A2  the role is renamed
--   A3  both S Plate assignments carry the new text
--   A9  ... and role_id p (the legacy g2 row is synced)
--   A4  season O untouched: its assignment, rate and division list; S Base too
--   A5  the S Plate rate carries the new text and role_id p
--   A6  D1's list is ["Plate umpire","Base"] (order kept)
--   A10 D2's untrimmed "Plate " is matched and becomes "Plate umpire"
--   A7  D1 still locked, posted and posted_at unchanged
--   A8  one activity_log row 'official_role_renamed'
--   A11 reply counts: assignments 2, rates 1, divisions 2
--   R1  "base " (another role, trimmed + case-insensitive) → name_taken, nothing written
--   R2  a non-member caller → not_authorized
--   R3  a blank name → name_required
--   R4  the same name → changed false, nothing written
--   R5  a game already holding a leftover "Plate umpire" row → assignment_role_conflict
--   R6  a case-only rename of the role itself ("plate") is allowed
--   G1  as authenticated: UPDATE of name refused (42501); sort_order allowed
--   G2  EXECUTE: authenticated only (public, anon, service_role, dashboard_readonly false)
--   G3  as authenticated: insert … on conflict (season_id, name) do nothing still works
--   G4  as authenticated: inserting " base " beside "Base" → 23505 (the
--       case-insensitive index)
-- Mutants (each must die at its own tag; each run first restores the pre-0118
-- grant and drops the index, so a GRANT or INDEX mutant is measured from the
-- real starting point):
--   MU1  assignments not renamed                         → A3
--   MU2  assignment rename not limited to the season     → A4
--   MU3  role_id not synced on assignments               → A9
--   MU4  pay rates not renamed                           → A5
--   MU5  division lists not renamed                      → A6
--   MU6  division match not trimmed                      → A10
--   MU7  duplicate check case-sensitive                  → R1
--   MU8  membership gate removed                         → R2
--   MU9  assignment conflict check removed               → R5
--   MU10 the UPDATE revoke left out                      → G1
--   MU11 EXECUTE granted to anon                         → G2
--   MU12 the case-insensitive unique index left out      → G4
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

create or replace function pg_temp.h118_as(p_sub uuid, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
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

create or replace function pg_temp.h118_case() returns text language plpgsql as $f$
declare
  v_org uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_s uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
  v_d1 uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid(); v_do uuid := gen_random_uuid();
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_to uuid := gen_random_uuid();
  v_g1 uuid := gen_random_uuid(); v_g2 uuid := gen_random_uuid(); v_g3 uuid := gen_random_uuid();
  v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_uo uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_po uuid := gen_random_uuid();
  v_posted_at timestamptz := '2026-10-01 12:00:00+00';
  v_r text; j jsonb;
begin
  -- ── fixtures ─────────────────────────────────────────────────────────────
  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (v_s, 'ZZ118 Season', 'Baseball', 'Fall 2026', v_org, '2026-09-01', '2026-12-31'),
    (v_o, 'ZZ118 Other', 'Baseball', 'Fall 2026', v_org, '2026-09-01', '2026-12-31');
  insert into public.divisions (id, league_id, name, settings, umpire_roles) values
    (v_d1, v_s, 'ZZ118 D1', '{}', '["Plate","Base"]'),
    (v_d2, v_s, 'ZZ118 D2', '{}', '["Plate "]'),
    (v_do, v_o, 'ZZ118 DO', '{}', '["Plate"]');
  insert into public.teams (id, league_id, division_id, name) values
    (v_t1, v_s, v_d1, 'ZZ118 A'), (v_t2, v_s, v_d1, 'ZZ118 B'), (v_to, v_o, v_do, 'ZZ118 O');
  insert into public.games (id, league_id, home_team_id, away_team_id, scheduled_at, status) values
    (v_g1, v_s, v_t1, v_t2, '2026-10-10 17:00:00+00', 'scheduled'),
    (v_g2, v_s, v_t2, v_t1, '2026-10-17 17:00:00+00', 'scheduled'),
    (v_g3, v_o, v_to, null, '2026-10-10 17:00:00+00', 'scheduled');
  -- Lock and post D1 AFTER its games exist (a locked division refuses inserts).
  update public.divisions set locked = true, posted = true, posted_at = v_posted_at where id = v_d1;
  insert into public.umpires (id, season_id, name, designation) values
    (v_u1, v_s, 'ZZ118 Ump 1', 'adult'), (v_u2, v_s, 'ZZ118 Ump 2', 'adult'), (v_uo, v_o, 'ZZ118 Ump O', 'adult');
  insert into public.official_roles (id, season_id, name, sort_order) values
    (v_p, v_s, 'Plate', 0), (v_b, v_s, 'Base', 1), (v_po, v_o, 'Plate', 0);
  insert into public.game_umpires (game_id, umpire_id, role, role_id) values
    (v_g1, v_u1, 'Plate', v_p), (v_g2, v_u1, 'Plate', null), (v_g1, v_u2, 'Base', v_b), (v_g3, v_uo, 'Plate', null);
  insert into public.umpire_role_rates (season_id, role, rate, role_id) values
    (v_s, 'Plate', 25, null), (v_s, 'Base', 20, v_b), (v_o, 'Plate', 30, v_po);

  -- ── refusals first, each in its own rolled-back sub-transaction ─────────
  begin
    v_r := pg_temp.h118_as(v_org, format('select public.rename_official_role(%L, %L)::text', v_p, 'base '));
    if v_r not like '%name_taken%' then raise exception 'SUB:R1 expected name_taken, got %', v_r; end if;
    raise exception 'SUB:ok';
  exception when others then
    if sqlerrm <> 'SUB:ok' then return replace(sqlerrm, 'SUB:', ''); end if;
  end;
  begin
    v_r := pg_temp.h118_as(gen_random_uuid(), format('select public.rename_official_role(%L, %L)::text', v_p, 'Plate umpire'));
    if v_r not like '%not_authorized%' then raise exception 'SUB:R2 expected not_authorized, got %', v_r; end if;
    raise exception 'SUB:ok';
  exception when others then
    if sqlerrm <> 'SUB:ok' then return replace(sqlerrm, 'SUB:', ''); end if;
  end;
  begin
    v_r := pg_temp.h118_as(v_org, format('select public.rename_official_role(%L, %L)::text', v_p, '   '));
    if v_r not like '%name_required%' then raise exception 'SUB:R3 expected name_required, got %', v_r; end if;
    raise exception 'SUB:ok';
  exception when others then
    if sqlerrm <> 'SUB:ok' then return replace(sqlerrm, 'SUB:', ''); end if;
  end;
  begin
    v_r := pg_temp.h118_as(v_org, format('select public.rename_official_role(%L, %L)::text', v_p, 'Plate'));
    j := v_r::jsonb;
    if (j ->> 'changed') is distinct from 'false' then raise exception 'SUB:R4 same name changed: %', v_r; end if;
    raise exception 'SUB:ok';
  exception when others then
    if sqlerrm <> 'SUB:ok' then return replace(sqlerrm, 'SUB:', ''); end if;
  end;
  begin
    insert into public.game_umpires (game_id, umpire_id, role, role_id) values (v_g2, v_u2, 'Plate umpire', null);
    v_r := pg_temp.h118_as(v_org, format('select public.rename_official_role(%L, %L)::text', v_p, 'Plate umpire'));
    if v_r not like '%assignment_role_conflict%' then raise exception 'SUB:R5 expected assignment_role_conflict, got %', v_r; end if;
    raise exception 'SUB:ok';
  exception when others then
    if sqlerrm <> 'SUB:ok' then return replace(sqlerrm, 'SUB:', ''); end if;
  end;
  begin
    v_r := pg_temp.h118_as(v_org, format('select public.rename_official_role(%L, %L)::text', v_p, 'plate'));
    if v_r like 'ERR%' or (v_r::jsonb ->> 'changed') is distinct from 'true' then
      raise exception 'SUB:R6 case-only rename refused: %', v_r;
    end if;
    raise exception 'SUB:ok';
  exception when others then
    if sqlerrm <> 'SUB:ok' then return replace(sqlerrm, 'SUB:', ''); end if;
  end;

  -- ── grants ───────────────────────────────────────────────────────────────
  v_r := pg_temp.h118_as(v_org, format(
    'with u as (update public.official_roles set name = %L where id = %L returning 1) select count(*)::text from u', 'Hacked', v_b));
  if v_r not like 'ERR 42501%' then return 'G1 direct name update not refused: ' || v_r; end if;
  v_r := pg_temp.h118_as(v_org, format(
    'with u as (update public.official_roles set sort_order = 5 where id = %L returning 1) select count(*)::text from u', v_b));
  if v_r is distinct from '1' then return 'G1 sort_order update refused: ' || coalesce(v_r, 'null'); end if;
  update public.official_roles set sort_order = 1 where id = v_b;

  if not has_function_privilege('authenticated', 'public.rename_official_role(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.rename_official_role(uuid, text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.rename_official_role(uuid, text)', 'EXECUTE')
     or has_function_privilege('dashboard_readonly', 'public.rename_official_role(uuid, text)', 'EXECUTE') then
    return 'G2 execute privileges wrong';
  end if;

  v_r := pg_temp.h118_as(v_org, format(
    'with i as (insert into public.official_roles (season_id, name, sort_order) values (%L, %L, 9) on conflict (season_id, name) do nothing returning 1) select count(*)::text from i',
    v_s, 'Base'));
  if v_r is distinct from '0' then return 'G3 ensureSeasonRoleIds upsert broke: ' || coalesce(v_r, 'null'); end if;

  -- G4: a case/space variant of an existing role is refused by the index.
  v_r := pg_temp.h118_as(v_org, format(
    'with i as (insert into public.official_roles (season_id, name, sort_order) values (%L, %L, 9) returning 1) select count(*)::text from i',
    v_s, ' base '));
  if v_r not like 'ERR 23505%' then return 'G4 case variant not refused: ' || coalesce(v_r, 'null'); end if;

  -- ── the rename ──────────────────────────────────────────────────────────
  v_r := pg_temp.h118_as(v_org, format('select public.rename_official_role(%L, %L)::text', v_p, '  Plate umpire '));
  if v_r like 'ERR%' then return 'A1 refused: ' || v_r; end if;
  j := v_r::jsonb;
  if (j ->> 'committed') is distinct from 'true' or (j ->> 'changed') is distinct from 'true' then
    return 'A1 reply: ' || v_r;
  end if;
  if (select name from public.official_roles where id = v_p) is distinct from 'Plate umpire' then
    return 'A2 role name: ' || coalesce((select name from public.official_roles where id = v_p), 'null');
  end if;
  if (select count(*) from public.game_umpires where game_id in (v_g1, v_g2) and role = 'Plate umpire') <> 2 then
    return 'A3 assignments: ' || (select string_agg(role, ',') from public.game_umpires where game_id in (v_g1, v_g2));
  end if;
  if (select count(*) from public.game_umpires where game_id in (v_g1, v_g2) and role = 'Plate umpire' and role_id = v_p) <> 2 then
    return 'A9 role_id not synced';
  end if;
  if (select role || ':' || coalesce(role_id::text, 'null') from public.game_umpires where game_id = v_g3) is distinct from 'Plate:null'
     or (select role from public.umpire_role_rates where season_id = v_o) is distinct from 'Plate'
     or (select umpire_roles::text from public.divisions where id = v_do) is distinct from '["Plate"]'
     or (select role from public.game_umpires where game_id = v_g1 and umpire_id = v_u2) is distinct from 'Base'
     or (select name from public.official_roles where id = v_po) is distinct from 'Plate' then
    return 'A4 another season or role changed';
  end if;
  if (select role || ':' || coalesce(role_id::text, 'null') from public.umpire_role_rates where season_id = v_s and rate = 25)
       is distinct from 'Plate umpire:' || v_p::text then
    return 'A5 rate: ' || coalesce((select role || ':' || coalesce(role_id::text, 'null') from public.umpire_role_rates where season_id = v_s and rate = 25), 'null');
  end if;
  if (select umpire_roles from public.divisions where id = v_d1) is distinct from '["Plate umpire","Base"]'::jsonb then
    return 'A6 D1 list: ' || (select umpire_roles::text from public.divisions where id = v_d1);
  end if;
  if (select umpire_roles from public.divisions where id = v_d2) is distinct from '["Plate umpire"]'::jsonb then
    return 'A10 D2 list: ' || (select umpire_roles::text from public.divisions where id = v_d2);
  end if;
  if (select locked and posted and posted_at = v_posted_at from public.divisions where id = v_d1) is distinct from true then
    return 'A7 lock/posted changed';
  end if;
  if (select count(*) from public.activity_log where league_id = v_s and event_type = 'official_role_renamed') <> 1 then
    return 'A8 log';
  end if;
  -- Counts LAST, so a mutant that changes what is written dies at the
  -- assertion that names what it broke, not here.
  if (j ->> 'assignments') is distinct from '2' or (j ->> 'rates') is distinct from '1'
     or (j ->> 'divisions') is distinct from '2' then
    return 'A11 reply counts: ' || v_r;
  end if;
  return 'pass';
end;
$f$;

do $h$
declare
  v_mig text := $mig118$
-- @@MIGRATION_0118@@
$mig118$;
  v_out text := '';
  v_body text;
  v_res text;
  v_mut text;
  m record;
begin
  execute v_mig;
  -- Everything before the migration's own verify block. Mutants run THIS, so
  -- each dies at the harness assertion written for it; V1 below runs the
  -- grant mutants WITH the block to show the migration refuses them too.
  if strpos(v_mig, '-- Verify, or the whole migration rolls back.') = 0 then
    raise exception 'harness: verify marker not found in 0118';
  end if;
  v_body := left(v_mig, strpos(v_mig, '-- Verify, or the whole migration rolls back.') - 1);

  v_out := v_out || 'md5 ' || (select md5(prosrc) from pg_proc where proname = 'rename_official_role') || E'\n';
  v_out := v_out || 'L1 locks on official_roles: ' || coalesce((
    select string_agg(mode, ', ' order by mode) from pg_locks
     where relation = 'public.official_roles'::regclass and pid = pg_backend_pid()), 'none') || E'\n';
  v_out := v_out || 'P1 ' || (
    select string_agg(r || ' exec=' || has_function_privilege(r, 'public.rename_official_role(uuid, text)', 'EXECUTE')
                        || ' name=' || has_column_privilege(r, 'public.official_roles', 'name', 'UPDATE')
                        || ' sort=' || has_column_privilege(r, 'public.official_roles', 'sort_order', 'UPDATE'), '; ' order by r)
      from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) r) || E'\n';

  begin
    v_res := pg_temp.h118_case();
    raise exception 'H118CASE:%', v_res;
  exception when others then
    v_out := v_out || 'BASELINE ' || replace(sqlerrm, 'H118CASE:', '') || E'\n';
  end;

  for m in select * from (values
    ('MU1', 'A3', $r1$  update public.game_umpires a
     set role = v_name,$r1$, $r1b$  update public.game_umpires a
     set role = a.role,$r1b$),
    ('MU2', 'A4', $r2$   where g.id = a.game_id
     and g.league_id = v_role.season_id
     and (a.role_id = p_role_id or (a.role_id is null and a.role = v_role.name));$r2$,
                  $r2b$   where g.id = a.game_id
     and (a.role_id = p_role_id or (a.role_id is null and a.role = v_role.name) or a.role = v_role.name);$r2b$),
    ('MU3', 'A9', $r3$     set role = v_name,
         role_id = p_role_id
    from public.games g$r3$, $r3b$     set role = v_name
    from public.games g$r3b$),
    ('MU4', 'A5', $r4$  update public.umpire_role_rates rr
     set role = v_name,$r4$, $r4b$  update public.umpire_role_rates rr
     set role = rr.role,$r4b$),
    ('MU5', 'A6', $r5$   where d.league_id = v_role.season_id
     and jsonb_typeof(d.umpire_roles) = 'array'$r5$, $r5b$   where false
     and jsonb_typeof(d.umpire_roles) = 'array'$r5b$),
    ('MU6', 'A10', $r6$        where jsonb_typeof(y.e) = 'string' and btrim(y.e #>> '{}') = v_role.name);$r6$,
                   $r6b$        where jsonb_typeof(y.e) = 'string' and (y.e #>> '{}') = v_role.name);$r6b$),
    ('MU7', 'R1', $r7$       and lower(btrim(r.name)) = lower(v_name)$r7$, $r7b$       and r.name = v_name$r7b$),
    ('MU8', 'R2', $r8$  if v_owner is null or not public.is_org_member(v_owner) then$r8$, $r8b$  if v_owner is null then$r8b$),
    ('MU9', 'R5', $r9$    raise exception 'assignment_role_conflict';$r9$, $r9b$    null;$r9b$),
    ('MU10', 'G1', $r10$revoke update on table public.official_roles from anon, authenticated, service_role, dashboard_readonly;
grant update (sort_order) on table public.official_roles to authenticated;$r10$,
                   $r10b$select 1;$r10b$),
    ('MU11', 'G2', $r11$grant execute on function public.rename_official_role(uuid, text) to authenticated;$r11$,
                   $r11b$grant execute on function public.rename_official_role(uuid, text) to authenticated, anon;$r11b$),
    ('MU12', 'G4', $r12$create unique index official_roles_season_name_ci_uniq
  on public.official_roles (season_id, lower(btrim(name)));$r12$, $r12b$select 1;$r12b$)
  ) as t(id, expect, find, repl)
  loop
    if (length(v_body) - length(replace(v_body, m.find, ''))) / length(m.find) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      -- Back to the pre-0118 grant first, so a mutant that leaves a GRANT or
      -- REVOKE out is measured from the real starting point.
      grant update on table public.official_roles to authenticated;
      drop index public.official_roles_season_name_ci_uniq;
      execute replace(v_body, m.find, m.repl);
      v_res := pg_temp.h118_case();
      raise exception 'H118CASE:%', v_res;
    exception when others then
      v_mut := replace(sqlerrm, 'H118CASE:', '');
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 180), m.expect);
    end;
  end loop;

  -- V1: the migration's own verify block refuses the two grant mutants.
  for m in select * from (values
    ('MU10', $v10$revoke update on table public.official_roles from anon, authenticated, service_role, dashboard_readonly;
grant update (sort_order) on table public.official_roles to authenticated;$v10$, $v10b$select 1;$v10b$),
    ('MU11', $v11$grant execute on function public.rename_official_role(uuid, text) to authenticated;$v11$,
             $v11b$grant execute on function public.rename_official_role(uuid, text) to authenticated, anon;$v11b$)
  ) as t(id, find, repl)
  loop
    begin
      grant update on table public.official_roles to authenticated;
      drop index public.official_roles_season_name_ci_uniq;
      execute replace(v_mig, m.find, m.repl);
      raise exception 'V1MISS';
    exception when others then
      v_out := v_out || format(E'V1 %s %s\n', m.id,
        case when sqlerrm like '0118 verify:%' then 'refused by the verify block' else 'NOT refused: ' || left(sqlerrm, 120) end);
    end;
  end loop;

  raise exception E'ROLLED BACK — 0118 proof\n%', v_out;
end $h$;

-- Leak check (run separately afterwards; every count must be 0, the function
-- must not exist, and authenticated must still hold UPDATE on name until 0118
-- is applied):
-- select (select count(*) from public.leagues where name like 'ZZ118%'),
--        (select count(*) from public.official_roles r join public.leagues l on l.id = r.season_id where l.name like 'ZZ118%'),
--        (select count(*) from public.activity_log where event_type = 'official_role_renamed'),
--        (select count(*) from pg_proc where proname = 'rename_official_role'),
--        has_column_privilege('authenticated', 'public.official_roles', 'name', 'UPDATE');

-- ── RUN LOG ──────────────────────────────────────────────────────────────────
-- (not yet run — waiting for Whit's go on the locks)

-- Proof for 0115 (division delete clears another bracket's cross-division
-- opponent instead of being blocked by it). Assembled by
-- division-delete-cross-build.ts, which puts the LITERAL migration text where
-- the placeholder is — so this proves the file that will be applied. It can
-- run BEFORE 0115 is applied: the whole batch is one transaction that the
-- final RAISE always rolls back. Fixtures live in the "test" proof org
-- (bbf9afe1…, Elite) only — never Santa Rosa American's data.
--
-- Assertions (each case returns the FIRST failing tag, or 'pass'):
--   A1 the delete is not refused (no `blocked` reply)
--   A2 the division is deleted (deleted = true, row gone)
--   A3 the other bracket's cross-division setting is cleared (false / null)
--   A4 side_effects.cross_division_settings_cleared = 1
--   A5 a bracket that names no opponent is untouched
-- Mutants (each must die at its own tag):
--   MU1 the clear is removed (the NO ACTION FK fires)            → A2
--   MU2 the cross-division block condition is put back            → A1
--   MU3 the cleared count is not reported                         → A4
-- Plus: md5(prosrc) printed (match it to the file), privileges per role
-- unchanged from before the batch (P1).
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

create or replace function pg_temp.h115_case() returns text language plpgsql as $f$
declare
  v_org uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_l uuid := gen_random_uuid(); v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_c uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid(); v_pc uuid := gen_random_uuid();
  v_pc_before text;
  r jsonb;
  v_err text;
  v_row record;
begin
  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
    values (v_l, 'ZZ115 Season', 'Baseball', 'Fall 2026', v_org, '2026-09-01', '2026-12-31');
  insert into public.divisions (id, league_id, name, settings) values
    (v_a, v_l, 'ZZ115 AAA', '{}'), (v_b, v_l, 'ZZ115 AA', '{}'), (v_c, v_l, 'ZZ115 A', '{}');
  insert into public.teams (id, league_id, division_id, name) values (gen_random_uuid(), v_l, v_b, 'ZZ115 AA Team');
  insert into public.playoffs (id, league_id, division_id, format, seeding, status, cross_division_enabled, cross_division_opponent_id)
    values (v_pa, v_l, v_a, 'single_elimination', '[]', 'draft', true, v_b),
           (v_pc, v_l, v_c, 'single_elimination', '[]', 'draft', false, null);
  select to_jsonb(p)::text into v_pc_before from public.playoffs p where id = v_pc;

  perform set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    r := public.delete_division_permanently(v_b);
  exception when others then
    v_err := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  if r ->> 'blocked' = 'true' then return 'A1 blocked: ' || r::text; end if;
  if r is null or r ->> 'deleted' is distinct from 'true' or exists (select 1 from public.divisions where id = v_b) then
    return 'A2 not deleted: ' || coalesce(r::text, v_err, 'null');
  end if;
  select cross_division_enabled, cross_division_opponent_id into v_row from public.playoffs where id = v_pa;
  if v_row.cross_division_enabled or v_row.cross_division_opponent_id is not null then
    return 'A3 not cleared: ' || v_row::text;
  end if;
  if (r -> 'side_effects' ->> 'cross_division_settings_cleared') is distinct from '1' then
    return 'A4 count: ' || coalesce(r -> 'side_effects' ->> 'cross_division_settings_cleared', 'absent');
  end if;
  if (select to_jsonb(p)::text from public.playoffs p where id = v_pc) is distinct from v_pc_before then
    return 'A5 another bracket changed';
  end if;
  return 'pass';
end;
$f$;

do $h$
declare
  v_mig text := $mig115$
-- @@MIGRATION_0115@@
$mig115$;
  v_out text := '';
  v_privs_before text;
  v_privs_after text;
  v_res text;
  v_mut text;
  m record;
begin
  select string_agg(r || '=' || has_function_privilege(r, 'public.delete_division_permanently(uuid)', 'EXECUTE'), ' ' order by r)
    into v_privs_before
    from unnest(array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']) r;

  execute v_mig;

  v_out := v_out || 'md5 ' || (select md5(prosrc) from pg_proc where proname = 'delete_division_permanently') || E'\n';
  select string_agg(r || '=' || has_function_privilege(r, 'public.delete_division_permanently(uuid)', 'EXECUTE'), ' ' order by r)
    into v_privs_after
    from unnest(array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']) r;
  v_out := v_out || format(E'P1 privileges %s (before %s / after %s)\n',
    case when v_privs_before = v_privs_after then 'unchanged' else 'CHANGED' end, v_privs_before, v_privs_after);

  -- Baseline, in a sub-transaction so its rows go.
  begin
    v_res := pg_temp.h115_case();
    raise exception 'H115CASE:%', v_res;
  exception when others then
    v_out := v_out || 'BASELINE ' || replace(sqlerrm, 'H115CASE:', '') || E'\n';
  end;

  for m in select * from (values
    ('MU1', 'A2', $r1$  update public.playoffs
     set cross_division_enabled = false,
         cross_division_opponent_id = null,
         updated_at = now()
   where cross_division_opponent_id = p_division_id;$r1$, $r1b$  perform 1;$r1b$),
    ('MU2', 'A1', $r2$  if jsonb_array_length(v_reasons) > 0 then
    return jsonb_build_object($r2$, $r2b$  if exists (select 1 from public.playoffs where cross_division_opponent_id = p_division_id) then
    v_reasons := v_reasons || to_jsonb('cross_division_playoff_opponent'::text);
  end if;
  if jsonb_array_length(v_reasons) > 0 then
    return jsonb_build_object($r2b$),
    ('MU3', 'A4', $r3$      'cross_division_settings_cleared', v_cross_division_cleared$r3$, $r3b$      'cross_division_settings_cleared', 0$r3b$)
  ) as t(id, expect, find, repl)
  loop
    if (length(v_mig) - length(replace(v_mig, m.find, ''))) / length(m.find) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_mig, m.find, m.repl);
      v_res := pg_temp.h115_case();
      raise exception 'H115CASE:%', v_res;
    exception when others then
      v_mut := replace(sqlerrm, 'H115CASE:', '');
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED' when v_mut = 'pass' then 'SURVIVED' else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 160), m.expect);
    end;
  end loop;

  raise exception E'ROLLED BACK — 0115 proof\n%', v_out;
end $h$;

-- Leak check (run separately afterwards; every count must be 0, and md5 must
-- still be 0082's cfcaec7bc5ad69f61b8df97ef8c33dfa until 0115 is applied):
-- select (select count(*) from public.leagues where name like 'ZZ115%'),
--        (select count(*) from public.divisions where name like 'ZZ115%'),
--        (select md5(prosrc) from pg_proc where proname = 'delete_division_permanently');

-- ── RUN LOG ──────────────────────────────────────────────────────────────────
-- 2026-10-20 — against production, "test" proof org, rolled back: md5
--   ac83c7547bf926f85e8fd1ad0e590782 (= the file); P1 privileges unchanged
--   (anon=false authenticated=true dashboard_readonly=true public=false
--   service_role=false — dashboard_readonly as before 0115, the known
--   default-privileges backlog item); BASELINE pass; MU1 KILLED at A2 (the
--   NO ACTION FK fires), MU2 KILLED at A1, MU3 KILLED at A4 — first run.
--   Leak check: 0 / 0, live md5 still 0082's cfcaec7b… (0115 NOT applied).
-- 2026-10-21 04:08 UTC — 0115 APPLIED verbatim (catalog 20261021040826);
--   md5(prosrc) ac83c7547bf926f85e8fd1ad0e590782 verified live; privileges
--   unchanged per role; leak check clean.

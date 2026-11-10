-- Proof for 0127 (volunteer sign-ups and officials sign-up on by default).
-- Assembled by feature-default-on-build.ts, which puts the LITERAL migration
-- text where the placeholder is. One transaction the final RAISE always rolls
-- back; the migration is applied in a rolled-back sub-run for the baseline and
-- again for every mutant.
--
-- FIXTURES: the "test" proof org (bbf9afe1…, Elite, both switches on today).
-- Inside each run its two org_features rows are deleted or rewritten, and its
-- plan is set to 'pro' for one case — DIRECT WRITES, because org_features has
-- no function (it is set in the SQL editor by design) and the plan is written
-- only by billing. Santa Rosa American Little League (8fde72f9…) is READ only
-- (FR1), never written.
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/feature-default-on-build.ts
-- > proof.sql`, send it as ONE batch, read the raised message, then the leak
-- check at the bottom. `--md5` prints the md5(prosrc) the apply must match.
--
-- LOCKS: the function's catalog row (CREATE OR REPLACE), SHARE UPDATE
-- EXCLUSIVE on org_features (COMMENT ON — blocks only other DDL on it), row
-- locks on the test org's org_features rows and its profiles row (the 'pro'
-- case; blocks writes to that one row only). Nothing on any other table.
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   RL1 (baseline only) applying 0127 writes no row: org_features,
--       volunteer_settings and official_signup_settings byte-identical
--   FD1 no row → ON for 'volunteers' AND 'official_signup'
--   FD2 a row with enabled = false → OFF, for each
--   FD3 a row with enabled = true → ON, for each
--   FD4 an unknown feature name with no row → OFF (decided 2026-11-09: default
--       on applies to the two features by name only)
--   FD5 a null feature name → OFF (false, never null)
--   FA1 an Elite league with no rows: volunteer_admin_state and
--       official_signup_admin_state say feature true, elite true; officials
--       sign-up still off (enabled false)
--   FA2 a Pro league with no rows: both say feature true, elite false (the
--       entry points show the upgrade prompt)
--   FA3 rows with enabled = false: both say feature false
--   FR1 Santa Rosa American (no rows): both features on, and neither sign-up
--       link is on — nothing went public
--   FP1 org_feature_on callable by no role (PUBLIC, anon, authenticated,
--       service_role, dashboard_readonly)
-- Mutants (each must die at its own tag):
--   MF1 no row = off again (0120's rule)               → FD1
--   MF2 the row is ignored                             → FD2
--   MF3 no row = on for ANY feature name               → FD4
--   MF4 default on for 'volunteers' only               → FD1
--   MF5 the null guard dropped (null name → null)      → FD5
--   MF6 EXECUTE granted to authenticated               → FP1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

create or replace function pg_temp.h127_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

create or replace function pg_temp.h127_fingerprint() returns text language sql as $f$
  select md5(
    coalesce((select string_agg(to_jsonb(f)::text, '|' order by f.owner_id, f.feature) from public.org_features f), '') || '#' ||
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.owner_id) from public.volunteer_settings s), '') || '#' ||
    coalesce((select string_agg(to_jsonb(o)::text, '|' order by o.owner_id) from public.official_signup_settings o), ''));
$f$;

create or replace function pg_temp.h127_case() returns text language plpgsql as $f$
declare
  v_org  uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';  -- "test"
  v_sra  uuid := '8fde72f9-cd5a-43ad-91e3-db14fb6fbcc4';  -- Santa Rosa American: READ ONLY
  v_feat text;
  v_vol  jsonb;
  v_off  jsonb;
  r      text;
begin
  -- FD1 — no row → on, for both names.
  delete from public.org_features where owner_id = v_org;
  foreach v_feat in array array['volunteers', 'official_signup'] loop
    if public.org_feature_on(v_org, v_feat) is distinct from true then
      return format('FD1 no row, %s: %s', v_feat, public.org_feature_on(v_org, v_feat));
    end if;
  end loop;

  -- FD2 — a false row → off.
  insert into public.org_features (owner_id, feature, enabled)
    values (v_org, 'volunteers', false), (v_org, 'official_signup', false);
  foreach v_feat in array array['volunteers', 'official_signup'] loop
    if public.org_feature_on(v_org, v_feat) is distinct from false then
      return format('FD2 row false, %s: %s', v_feat, public.org_feature_on(v_org, v_feat));
    end if;
  end loop;

  -- FD3 — a true row → on.
  update public.org_features set enabled = true where owner_id = v_org;
  foreach v_feat in array array['volunteers', 'official_signup'] loop
    if public.org_feature_on(v_org, v_feat) is distinct from true then
      return format('FD3 row true, %s: %s', v_feat, public.org_feature_on(v_org, v_feat));
    end if;
  end loop;

  -- FD4 — an unknown feature with no row → off. (The table's CHECK allows
  -- only the two names, so an unknown feature can never have a row.)
  delete from public.org_features where owner_id = v_org;
  foreach v_feat in array array['zz_unknown_feature', 'volunteer', 'officials_signup', ''] loop
    if public.org_feature_on(v_org, v_feat) is distinct from false then
      return format('FD4 unknown feature %L, no row: %s', v_feat, public.org_feature_on(v_org, v_feat));
    end if;
  end loop;

  -- FD5 — a null name → false, never null.
  if public.org_feature_on(v_org, null) is distinct from false then
    return format('FD5 null feature: %s', coalesce(public.org_feature_on(v_org, null)::text, 'null'));
  end if;

  -- FA1 — Elite, no rows: the admin screens see the feature.
  v_vol := pg_temp.h127_as(v_org, 'authenticated', format('select public.volunteer_admin_state(%L)::text', v_org))::jsonb;
  v_off := pg_temp.h127_as(v_org, 'authenticated', format('select public.official_signup_admin_state(%L)::text', v_org))::jsonb;
  if v_vol->>'feature' is distinct from 'true' or v_vol->>'elite' is distinct from 'true'
     or v_off->>'feature' is distinct from 'true' or v_off->>'elite' is distinct from 'true' then
    return format('FA1 Elite, no rows: volunteers %s; officials %s', v_vol, v_off);
  end if;
  if v_off->>'enabled' is distinct from 'false'
     and not exists (select 1 from public.official_signup_settings s where s.owner_id = v_org and s.enabled) then
    return format('FA1 officials sign-up reads on with no setting on: %s', v_off);
  end if;

  -- FA2 — Pro, no rows: feature on, not Elite (the upgrade prompt).
  update public.profiles set plan = 'pro' where id = v_org;
  v_vol := pg_temp.h127_as(v_org, 'authenticated', format('select public.volunteer_admin_state(%L)::text', v_org))::jsonb;
  v_off := pg_temp.h127_as(v_org, 'authenticated', format('select public.official_signup_admin_state(%L)::text', v_org))::jsonb;
  if v_vol->>'feature' is distinct from 'true' or v_vol->>'elite' is distinct from 'false'
     or v_off->>'feature' is distinct from 'true' or v_off->>'elite' is distinct from 'false' then
    return format('FA2 Pro, no rows: volunteers %s; officials %s', v_vol, v_off);
  end if;
  update public.profiles set plan = 'elite' where id = v_org;

  -- FA3 — the per-org switch still turns a league off.
  insert into public.org_features (owner_id, feature, enabled)
    values (v_org, 'volunteers', false), (v_org, 'official_signup', false);
  v_vol := pg_temp.h127_as(v_org, 'authenticated', format('select public.volunteer_admin_state(%L)::text', v_org))::jsonb;
  v_off := pg_temp.h127_as(v_org, 'authenticated', format('select public.official_signup_admin_state(%L)::text', v_org))::jsonb;
  if v_vol is distinct from '{"feature": false}'::jsonb or v_off is distinct from '{"feature": false}'::jsonb then
    return format('FA3 switched off: volunteers %s; officials %s', v_vol, v_off);
  end if;

  -- FR1 — the real league: on, and nothing public.
  if exists (select 1 from public.org_features where owner_id = v_sra) then
    return 'FR1 VACUOUS: Santa Rosa American has an org_features row';
  end if;
  if public.org_feature_on(v_sra, 'volunteers') is distinct from true
     or public.org_feature_on(v_sra, 'official_signup') is distinct from true then
    return 'FR1 Santa Rosa American is not on';
  end if;
  if exists (select 1 from public.volunteer_settings where owner_id = v_sra and link_enabled)
     or exists (select 1 from public.official_signup_settings where owner_id = v_sra and enabled) then
    return 'FR1 a Santa Rosa American sign-up link is on';
  end if;

  -- FP1 — privileges.
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.proname = 'org_feature_on' and p.pronamespace = 'public'::regnamespace
                and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    return 'FP1 PUBLIC can execute org_feature_on';
  end if;
  foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
    if has_function_privilege(r, 'public.org_feature_on(uuid, text)', 'EXECUTE') then
      return 'FP1 ' || r || ' can execute org_feature_on';
    end if;
  end loop;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig127$
-- @@MIGRATION_0127@@
$mig127$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_fp    text;
  v_out   text := E'\n';
  m       record;
begin
  if strpos(v_body, '-- 3. Verify') = 0 then raise exception 'harness: verify marker not found in 0127'; end if;
  v_nover := split_part(v_body, '-- 3. Verify', 1);

  begin
    v_fp := pg_temp.h127_fingerprint();
    execute v_body;
    v_out := v_out || case when pg_temp.h127_fingerprint() = v_fp then 'RL1 pass (no row written)'
                           else 'RL1 FAILED: applying 0127 changed a settings row' end || E'\n';
    v_res := pg_temp.h127_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || 'md5(prosrc) org_feature_on=' ||
      (select md5(p.prosrc) from pg_proc p where p.proname = 'org_feature_on'
          and p.pronamespace = 'public'::regnamespace) || E'\n';
    raise exception 'H127ROLLBACK';
  exception when others then
    if sqlerrm <> 'H127ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('MF1', 'FD1', $r$coalesce(p_feature in ('volunteers', 'official_signup'), false)$r$, $r$false$r$),
    ('MF2', 'FD2', $r$    (select f.enabled from public.org_features f
      where f.owner_id = p_owner_id and f.feature = p_feature),$r$, $r$    null::boolean,$r$),
    ('MF3', 'FD4', $r$coalesce(p_feature in ('volunteers', 'official_signup'), false)$r$, $r$true$r$),
    ('MF4', 'FD1', $r$in ('volunteers', 'official_signup')$r$, $r$in ('volunteers')$r$),
    ('MF5', 'FD5', $r$coalesce(p_feature in ('volunteers', 'official_signup'), false)$r$,
                   $r$p_feature in ('volunteers', 'official_signup')$r$),
    ('MF6', 'FP1', $r$revoke execute on function public.org_feature_on(uuid, text) from public, anon, authenticated, service_role, dashboard_readonly;$r$,
                   $r$revoke execute on function public.org_feature_on(uuid, text) from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.org_feature_on(uuid, text) to authenticated;$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h127_case();
      raise exception 'H127CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H127CASE:%' then replace(sqlerrm, 'H127CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0127 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select md5(prosrc) from pg_proc where proname = 'org_feature_on') as must_be_0120s,
--   (select string_agg(left(owner_id::text, 8) || ':' || feature || '=' || enabled, ', ' order by owner_id, feature)
--      from org_features) as rows_as_before_4,
--   (select plan from profiles where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as test_plan_elite,
--   (select count(*) from pg_proc where proname like 'h127%') as temp_fns_0,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- 2026-11-10 (2026-11-09 evening Pacific), against production, rolled back,
-- on Whit's go (sent as one batch, the migration byte-exact).
--   Run 1 — GREEN: RL1 pass (no row written); baseline pass; md5(prosrc)
--     f7cf60e0… = `--md5`; MF1–MF6 KILLED at their own tag (MF3, default-on for
--     any name, died at FD4 on 'zz_unknown_feature').
--   Leak check: identical to the pre-run snapshot (0120 md5 517cc1d6… live,
--     the four test-org rows unchanged, "test" still Elite, table comment
--     unchanged, no h127 functions, no idle transaction).
--   Applied right after (apply_migration, verbatim): catalog 20261110023443;
--     verify block passed; md5 f7cf60e0…, one overload, INVOKER, STABLE,
--     search_path=public, pg_temp; EXECUTE false for PUBLIC, anon,
--     authenticated, service_role, dashboard_readonly. Santa Rosa American
--     (8fde72f9…) reads on for both, has no volunteer_settings or
--     official_signup_settings row (both links off). Read as the Pro account
--     (5ea39d6b…) and a Free one (66ecbcb5…), rolled back: both admin states
--     feature true, elite false.

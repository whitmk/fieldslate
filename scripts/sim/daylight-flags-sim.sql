-- SQL-level proof for migration 0109 (daylight flags: venues.has_lights,
-- profiles.sunset_city + daylight_flags_enabled, set_org_daylight).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): column
-- privileges, the 0098 guard trigger, a CHECK and a SECURITY DEFINER
-- function, exercised as `authenticated` under RLS. The in-memory fake client
-- models none of that. NOT `npm run`-able, NOT in CI.
--
-- THIS HARNESS APPLIES 0109 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK. It is the proof to run BEFORE the migration is applied for real.
--
-- HOW TO RUN
--   1. `npx tsx scripts/sim/daylight-flags-build.ts > <file>` substitutes the
--      LITERAL text of supabase/migrations/0109_daylight_flags.sql for the
--      placeholder line below — what is proven is the file that will be
--      applied, never a copy.
--   2. Send the whole output as ONE batch through the Supabase MCP
--      (execute_sql). A batch is one transaction.
--   3. The last statement ALWAYS raises. The raised message IS the result.
--   4. Run the LEAK CHECK at the bottom as a separate statement.
--   The founder picks the time. Get an explicit go-ahead first.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: one to two seconds)
--   ACCESS EXCLUSIVE on public.venues and public.profiles (the migration's
--   ADD COLUMNs; the MD6 mutant's DROP CONSTRAINT re-takes profiles in its
--   own rolled-back block). This BLOCKS READS AND WRITES of both tables from
--   the live app for the run — profiles is read on nearly every dashboard
--   page load, venues by the Schedule, Venues and picker screens.
--   lock_timeout = 3s: the run gives up rather than queueing behind a long
--   transaction. statement_timeout = 60s bounds the whole thing.
--
-- ROWS TOUCHED (all rolled back): the "test" org's profiles row (owner
-- bbf9afe1-…, whitmellonking@), two fixture fields ZZ109 in the "test" org,
-- one ZZ109 field in the SRALL TEST org (owner aa21d01c-…, used only as the
-- NON-MEMBER — asserted below; never the real league, org 8fde72f9-…).
--
-- IMPERSONATION: `set local role authenticated` plus request.jwt.claims.sub,
-- exactly what PostgREST does for a signed-in browser.
--
-- ASSERTIONS (in this order; a mutant must die FIRST at its own tag)
--   PRE   the non-member really is not a member of the "test" org, and the
--         test org's profiles row exists
--   C1    every existing venue reads has_lights = false; every existing
--         profile reads sunset_city null and daylight_flags_enabled true
--   C2    every existing venue and profile row is byte-identical apart from
--         the new columns (md5 over the whole table, before vs after)
--   P1    set_org_daylight: EXECUTE authenticated only (anon, service_role,
--         dashboard_readonly and PUBLIC false)
--   P2    authenticated holds NO column UPDATE on the two profiles columns;
--         it does hold UPDATE on venues.has_lights
--   T1    set_org_daylight is SECURITY DEFINER with a pinned search_path
--   S1    a member sets the city + toggle; the row reads them back
--   S2    '' clears the city to null
--   S3    the toggle saves false
--   S4    a badly shaped city ('Santa Rosa') → invalid_city, row unchanged
--   S5    a null toggle → invalid_enabled
--   S6    a non-member → not_authorized; the org row unchanged
--   S7    anon cannot call it
--   D1    a signed-in owner's DIRECT update of sunset_city on their own row
--         is refused
--   D2    same for daylight_flags_enabled
--   V1    a member sets has_lights on their own field; it reads back true
--   V2    a non-member's update of that field changes zero rows
--   V3    a field inserted without has_lights reads false
--   K1    LEAK: no public get_*_by_token function body (comments stripped)
--         names has_lights, sunset_city or daylight_flags_enabled — the live
--         twin of sim:daylight-leaks [D1]
--
-- MUTANTS — each in its own rolled-back block (a rewrite that changes no
-- text is MUTANT_NOOP, never a kill). KILLED only if the FIRST failure is the
-- mutant's own tag.
--   MD1  membership gate removed                         → S6
--   MD2  EXECUTE granted to anon                         → P1
--   MD3  UPDATE (sunset_city) granted to authenticated   → P2
--        (D1 still holds: the 0098 trigger refuses it — the second layer)
--   MD4  has_lights defaults TRUE (new fields)           → V3
--   MD5  function made SECURITY INVOKER                  → T1
--   MD6  the sunset_city CHECK dropped                   → S4
--
-- NOT EXERCISED, stated: the `nothing_saved` branch (an org member whose org
-- has no profiles row cannot exist — every org IS its owner's profile).

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

create temp table h109_fx on commit drop as
select
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as org,
  'aa21d01c-66dc-4c37-b15c-7b743c557eea'::uuid as nonmember,
  gen_random_uuid() as v_own, gen_random_uuid() as v_new, gen_random_uuid() as v_other;

-- Snapshots BEFORE the migration (C2).
create temp table h109_before on commit drop as
select
  (select md5(coalesce(string_agg(to_jsonb(v)::text, '|' order by v.id), '')) from public.venues v) as venues_md5,
  (select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) from public.profiles p) as profiles_md5,
  (select count(*) from public.venues) as venues_n,
  (select count(*) from public.profiles) as profiles_n;

-- Runs one statement as a role. 'OK rows=N' or 'ERR <sqlstate> <message>'.
create function pg_temp.h109_try(p_role text, p_uid uuid, p_sql text)
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

-- Calls set_org_daylight as a role. 'OK <json>' or 'ERR <sqlstate> <message>'.
create function pg_temp.h109_set(p_role text, p_uid uuid, p_org uuid, p_city text, p_enabled boolean)
returns text
language plpgsql
as $fn$
declare
  v_j   jsonb;
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute 'select public.set_org_daylight($1, $2, $3)' into v_j using p_org, p_city, p_enabled;
    v_out := 'OK ' || v_j::text;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

-- Every assertion, in order. Returns {fails: [...], notes: [...]}. Each fail
-- starts with its tag and a colon.
create function pg_temp.h109_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx       record;
  b        record;
  v_fails  text[] := '{}';
  v_notes  text[] := '{}';
  v_txt    text;
  v_n      bigint;
  v_md5    text;
  v_city   text;
  v_on     boolean;
  v_lights boolean;
  v_fn     constant text := 'public.set_org_daylight(uuid, text, boolean)';
begin
  select * into fx from h109_fx;
  select * into b from h109_before;
  begin
    -- ── PRE ─────────────────────────────────────────────────────────────────
    select count(*) into v_n from public.organization_members
     where org_id = fx.org and user_id = fx.nonmember;
    if v_n <> 0 or not exists (select 1 from public.profiles where id = fx.org) then
      v_fails := array_append(v_fails, format('PRE: non-member rows %s, org row exists %s',
        v_n, exists (select 1 from public.profiles where id = fx.org)));
    end if;

    -- ── C1 ──────────────────────────────────────────────────────────────────
    select count(*) into v_n from public.venues where has_lights is distinct from false
       and id not in (fx.v_own, fx.v_new, fx.v_other);
    if v_n <> 0 then
      v_fails := array_append(v_fails, format('C1: %s existing venue(s) not unlit', v_n));
    end if;
    select count(*) into v_n from public.profiles where sunset_city is not null or daylight_flags_enabled is distinct from true;
    if v_n <> 0 then
      v_fails := array_append(v_fails, format('C1: %s existing profile(s) not defaulted', v_n));
    end if;

    -- ── C2 ──────────────────────────────────────────────────────────────────
    select md5(coalesce(string_agg((to_jsonb(v) - 'has_lights')::text, '|' order by v.id), ''))
      into v_md5 from public.venues v where id not in (fx.v_own, fx.v_new, fx.v_other);
    if v_md5 is distinct from b.venues_md5 then
      v_fails := array_append(v_fails, 'C2: existing venues changed apart from has_lights');
    end if;
    select md5(coalesce(string_agg((to_jsonb(p) - 'sunset_city' - 'daylight_flags_enabled')::text, '|' order by p.id), ''))
      into v_md5 from public.profiles p;
    if v_md5 is distinct from b.profiles_md5 then
      v_fails := array_append(v_fails, 'C2: existing profiles changed apart from the new columns');
    end if;

    -- ── P1 ──────────────────────────────────────────────────────────────────
    if not has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or has_function_privilege('dashboard_readonly', v_fn, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = v_fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      v_fails := array_append(v_fails, 'P1: set_org_daylight EXECUTE is not authenticated-only');
    end if;

    -- ── P2 ──────────────────────────────────────────────────────────────────
    if has_column_privilege('authenticated', 'public.profiles', 'sunset_city', 'update')
       or has_column_privilege('authenticated', 'public.profiles', 'daylight_flags_enabled', 'update')
       or not has_column_privilege('authenticated', 'public.venues', 'has_lights', 'update') then
      v_fails := array_append(v_fails, 'P2: column privileges wrong');
    end if;

    -- ── T1 ──────────────────────────────────────────────────────────────────
    if not exists (select 1 from pg_proc where oid = v_fn::regprocedure and prosecdef
                     and proconfig::text like '%search_path=public, pg_temp%') then
      v_fails := array_append(v_fails, 'T1: set_org_daylight is not SECURITY DEFINER with a pinned search_path');
    end if;

    -- ── S1 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_set('authenticated', fx.org, fx.org, 'ca-santa-rosa', true);
    select sunset_city, daylight_flags_enabled into v_city, v_on from public.profiles where id = fx.org;
    if v_txt not like 'OK %' or v_city is distinct from 'ca-santa-rosa' or v_on is distinct from true then
      v_fails := array_append(v_fails, format('S1: set city: %s → %s/%s', v_txt, v_city, v_on));
    end if;

    -- ── S2 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_set('authenticated', fx.org, fx.org, '  ', true);
    select sunset_city into v_city from public.profiles where id = fx.org;
    if v_txt not like 'OK %' or v_city is not null then
      v_fails := array_append(v_fails, format('S2: blank clears: %s → %s', v_txt, v_city));
    end if;

    -- ── S3 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_set('authenticated', fx.org, fx.org, 'co-denver', false);
    select sunset_city, daylight_flags_enabled into v_city, v_on from public.profiles where id = fx.org;
    if v_txt not like 'OK %' or v_on is distinct from false or v_city is distinct from 'co-denver' then
      v_fails := array_append(v_fails, format('S3: toggle off: %s → %s/%s', v_txt, v_city, v_on));
    end if;

    -- ── S4 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_set('authenticated', fx.org, fx.org, 'Santa Rosa', true);
    select sunset_city, daylight_flags_enabled into v_city, v_on from public.profiles where id = fx.org;
    if v_txt not like 'ERR 22023 invalid_city%' or v_city is distinct from 'co-denver' or v_on is distinct from false then
      v_fails := array_append(v_fails, format('S4: bad shape: %s → %s/%s', v_txt, v_city, v_on));
    end if;

    -- ── S5 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_set('authenticated', fx.org, fx.org, 'ca-santa-rosa', null);
    if v_txt not like 'ERR 22023 invalid_enabled%' then
      v_fails := array_append(v_fails, 'S5: null toggle: ' || v_txt);
    end if;

    -- ── S6 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_set('authenticated', fx.nonmember, fx.org, 'ny-albany', true);
    select sunset_city, daylight_flags_enabled into v_city, v_on from public.profiles where id = fx.org;
    if v_txt not like 'ERR 42501 not_authorized%' or v_city is distinct from 'co-denver' or v_on is distinct from false then
      v_fails := array_append(v_fails, format('S6: non-member: %s → %s/%s', v_txt, v_city, v_on));
    end if;

    -- ── S7 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_set('anon', null, fx.org, 'ny-albany', true);
    if v_txt not like 'ERR 42501 %' then
      v_fails := array_append(v_fails, 'S7: anon: ' || v_txt);
    end if;

    -- ── D1 / D2 ─────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_try('authenticated', fx.org,
      format('update public.profiles set sunset_city = %L where id = %L', 'ny-albany', fx.org));
    select sunset_city into v_city from public.profiles where id = fx.org;
    if v_txt not like 'ERR 42501 %' or v_city is distinct from 'co-denver' then
      v_fails := array_append(v_fails, format('D1: direct sunset_city write: %s → %s', v_txt, v_city));
    end if;
    v_txt := pg_temp.h109_try('authenticated', fx.org,
      format('update public.profiles set daylight_flags_enabled = true where id = %L', fx.org));
    select daylight_flags_enabled into v_on from public.profiles where id = fx.org;
    if v_txt not like 'ERR 42501 %' or v_on is distinct from false then
      v_fails := array_append(v_fails, format('D2: direct toggle write: %s → %s', v_txt, v_on));
    end if;

    -- ── V1 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_try('authenticated', fx.org,
      format('update public.venues set has_lights = true where id = %L', fx.v_own));
    select has_lights into v_lights from public.venues where id = fx.v_own;
    if v_txt <> 'OK rows=1' or v_lights is distinct from true then
      v_fails := array_append(v_fails, format('V1: member sets lights: %s → %s', v_txt, v_lights));
    end if;

    -- ── V2 ──────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h109_try('authenticated', fx.nonmember,
      format('update public.venues set has_lights = false where id = %L', fx.v_own));
    select has_lights into v_lights from public.venues where id = fx.v_own;
    if v_txt <> 'OK rows=0' or v_lights is distinct from true then
      v_fails := array_append(v_fails, format('V2: non-member: %s → %s', v_txt, v_lights));
    end if;

    -- ── V3 ──────────────────────────────────────────────────────────────────
    insert into public.venues (id, owner_id, name) select fx.v_new, fx.org, 'ZZ109 Andrews 1';
    select has_lights into v_lights from public.venues where id = fx.v_new;
    if v_lights is distinct from false then
      v_fails := array_append(v_fails, format('V3: new field lights = %s', v_lights));
    end if;

    -- ── K1 ──────────────────────────────────────────────────────────────────
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'get\_%\_by\_token'
       and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ '(has_lights|sunset_city|daylight_flags_enabled)';
    if v_n <> 0 then
      v_fails := array_append(v_fails, format('K1: %s token function(s) name a daylight column', v_n));
    end if;
  exception when others then
    v_fails := array_append(v_fails, 'CRASH: ' || sqlstate || ' ' || sqlerrm);
  end;

  return jsonb_build_object('fails', to_jsonb(v_fails), 'notes', to_jsonb(v_notes));
end;
$fn$;

do $h109$
declare
  v_out   text := E'\n';
  v_m     jsonb;
  v_first text;
  v_tag   text;
  v_def   text;
  v_mut   text;
  m       record;
  v_fn    constant text := 'public.set_org_daylight(uuid, text, boolean)';
begin
  execute $mig109$
-- @@MIGRATION_0109@@
$mig109$;

  -- Fixture fields AFTER the migration, inserted WITHOUT has_lights. (V3's
  -- own field is inserted INSIDE the assertions, so a changed default shows.)
  insert into public.venues (id, owner_id, name)
  select v_own,   org,       'ZZ109 Galvin 2' from h109_fx union all
  select v_other, nonmember, 'ZZ109 Elsewhere' from h109_fx;

  -- Baseline, in its own rolled-back block like every mutant.
  begin
    v_m := pg_temp.h109_assert();
    raise exception 'H109_RESULT %', v_m::text;
  exception when others then
    if sqlerrm like 'H109_RESULT %' then
      v_m := substr(sqlerrm, 13)::jsonb;
      v_out := v_out || format(E'BASELINE failures (%s): %s\n', jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
    else
      v_out := v_out || format(E'BASELINE CRASH %s %s\n', sqlstate, sqlerrm);
    end if;
  end;

  for m in
    select * from (values
      ('MD1', 'membership gate removed', 'S6', v_fn,
        $a$if p_org_id is null or not public.is_org_member(p_org_id) then$a$, $a$if p_org_id is null then$a$),
      ('MD2', 'EXECUTE granted to anon', 'P1', null::text,
        null::text, $a$grant execute on function public.set_org_daylight(uuid, text, boolean) to anon$a$),
      ('MD3', 'UPDATE (sunset_city) granted to authenticated', 'P2', null,
        null, $a$grant update (sunset_city) on public.profiles to authenticated$a$),
      ('MD4', 'has_lights defaults true', 'V3', null,
        null, $a$alter table public.venues alter column has_lights set default true$a$),
      ('MD5', 'function made SECURITY INVOKER', 'T1', null,
        null, $a$alter function public.set_org_daylight(uuid, text, boolean) security invoker$a$),
      ('MD6', 'sunset_city CHECK dropped', 'S4', null,
        null, $a$alter table public.profiles drop constraint profiles_sunset_city_check$a$)
    ) as t(id, what, target, fn, find, repl)
  loop
    begin
      if m.fn is null then
        execute m.repl;
      else
        v_def := pg_get_functiondef(m.fn::regprocedure);
        v_mut := replace(v_def, m.find, m.repl);
        if v_mut = v_def then
          raise exception 'MUTANT_NOOP';
        end if;
        execute v_mut;
      end if;
      v_m := pg_temp.h109_assert();
      raise exception 'H109_RESULT %', v_m::text;
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm like 'H109_RESULT %' then
        v_m := substr(sqlerrm, 13)::jsonb;
        v_first := v_m -> 'fails' ->> 0;
        v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
        v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n',
          m.id, m.what,
          case when v_first is null then 'SURVIVED'
               when v_tag = m.target then 'KILLED'
               else 'KILLED AT THE WRONG ASSERTION' end,
          v_tag, m.target, jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
      else
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  v_out := v_out || format(E'prosrc md5 set_org_daylight: %s\n',
    (select md5(prosrc) from pg_proc where oid = v_fn::regprocedure));

  raise exception '%', v_out;
end;
$h109$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname = 'set_org_daylight') as fn_must_be_0,
--   (select count(*) from information_schema.columns where table_schema = 'public'
--      and ((table_name = 'venues' and column_name = 'has_lights')
--        or (table_name = 'profiles' and column_name in ('sunset_city', 'daylight_flags_enabled')))) as cols_must_be_0,
--   (select count(*) from venues where name like 'ZZ109%') as fixtures_must_be_0;

-- ── RUN LOG ─────────────────────────────────────────────────────────────────
-- (not yet run — the founder picks the time)

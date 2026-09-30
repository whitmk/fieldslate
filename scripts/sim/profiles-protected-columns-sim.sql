-- SQL-level proof for migration 0098 (profiles: protected columns).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the behavior
-- is column privileges plus a trigger, exercised as the `authenticated` role
-- under RLS. The in-memory fake client cannot model any of that. NOT
-- `npm run`-able, NOT in CI.
--
-- THIS HARNESS APPLIES 0098 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK. It is the proof to run BEFORE the migration is applied for real. It
-- leaves nothing behind: no grant, no trigger, no function, no row change.
--
-- HOW TO RUN
--   1. `npx tsx scripts/sim/profiles-protected-columns-build.ts > <file>`
--      substitutes the LITERAL text of
--      supabase/migrations/0098_profiles_protected_columns.sql for the
--      placeholder line below, so what is proven is the file that will be
--      applied, not a copy that can drift.
--   2. Send the whole output as ONE batch through the Supabase MCP
--      (execute_sql). A batch runs in a single transaction (probed
--      2026-09-29: a transaction-local setting made by the first statement
--      was visible to the second).
--   3. The last statement ALWAYS raises. The raised message IS the result.
--      Everything — the timeouts, the helpers, the migration, every mutant —
--      rolls back with it.
--   Evenings only. Get an explicit go-ahead first.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: about a second)
--   SHARE ROW EXCLUSIVE on public.profiles, from CREATE TRIGGER. It BLOCKS
--   WRITES to profiles from the live app (organization name saves, setup
--   dismiss, a Stripe webhook's plan update, a signup's profile insert) and
--   does NOT block reads. lock_timeout = 3s means the run gives up rather
--   than queueing behind a long writer; statement_timeout = 60s bounds the
--   whole thing. No ACCESS EXCLUSIVE lock is taken: no mutant drops or
--   disables the trigger or alters the table, deliberately.
--
-- ROWS TOUCHED (all rolled back): the profiles row of the "test" org, the
-- profiles row of the "Test 2" org (expected to be affected ZERO times), and
-- whatever process_checkout_event writes for the "test" org (a stripe_events
-- claim named HARNESS-0098-evt, the plan, possibly a season).
--
-- IMPERSONATION: `set local role authenticated` plus request.jwt.claims.sub,
-- exactly what PostgREST does for a signed-in browser. Assertions are read
-- back as postgres.
--
-- ASSERTIONS
--   H0        BEFORE 0098: a signed-in user CAN set their own plan (the hole
--             is real; if this fails the premise is wrong, not the fix)
--   A-<col>   PRIVILEGE LAYER: updating any non-editable column is refused
--             with "permission denied" — one assertion per column, plan first
--   A-mixed   an editable and a protected column in one statement is refused
--   B-<col>   each of the four editable columns saves, and reads back changed
--   B-both    two editable columns in one statement save
--   D1        another user's row: zero rows affected
--   E-anon    anon is refused
--   C-<col>   TRIGGER LAYER, isolated by re-granting table-level UPDATE inside
--             a rolled-back block: every non-editable column is still refused,
--             by the trigger, and the message names the column
--   C-mixed   editable + protected in one statement is refused by the trigger
--   C-edit    an editable column still saves with the trigger in the path
--   C-noop    `plan = plan` is not a change and is not refused by the trigger
--   L1        comping runbook: postgres sets plan and comped directly
--   L2        a SECURITY DEFINER function owned by postgres, called by a
--             signed-in user, changes plan and pending_promo
--   L3        the REAL process_checkout_event, called as service_role, sets
--             the plan and clears pending_promo
--   L4        service_role cannot update profiles directly (unchanged: it
--             never could — the webhook goes through L3's function)
--   L5        handle_new_user inserts and never updates profiles, and its
--             trigger on auth.users is an INSERT trigger
--   S1        the trigger function is SECURITY INVOKER
--   S2        the trigger is BEFORE UPDATE, per row, enabled, UPDATE only
--   P1        has_column_privilege: authenticated = exactly the four; anon = none
--
-- MUTANTS — each in its own rolled-back block, applied with
-- `alter function` / `grant` / a rewritten function body (the replace is
-- asserted to have changed the text: a no-op is MUTANT_NOOP, never a kill).
-- KILLED only if the FIRST failure is the mutant's own tag.
--   PM1  trigger function made SECURITY DEFINER            → C-plan
--   PM2  'plan' added to the trigger's editable list       → C-plan
--        (and C-comped must NOT fail: the mutant is specific)
--   PM3  UPDATE (plan) granted to authenticated            → A-plan
--   PM4  table-level UPDATE re-granted to authenticated    → A-plan
--   PM5  subtraction replaced by a list of three columns   → C-pending_plan
--   PM6  the caller check removed (nobody is restricted)   → C-plan
--
-- RUN LOG (2026-09-29, 18:3x Pacific, against production, rolled back; leak
-- check clean after each run). 0098 was NOT applied when this was run.
--
--   RUN 1 — baseline RED, and the fault was the HARNESS, not the fix:
--     C-plan, C-mixed and C-unchanged failed with "OK rows=1". The test
--     account is already Elite and comped, and the harness wrote the literals
--     'elite' and `true` — so "change the plan" changed nothing, and the
--     trigger correctly let a non-change through. The same flaw made L1 (the
--     comping runbook) pass without proving anything, and made PM5 look like
--     it died at the wrong assertion.
--     FIX: every test value is now an EXPRESSION that differs from the row's
--     current value (`case when plan = 'elite' then 'pro' else 'elite' end`,
--     `not comped`), and H0 and L1 read the row back to prove it moved.
--     Never test a refusal with a value the row might already hold.
--
--   RUN 2 — baseline GREEN, zero failures, no zero counter:
--     H0   the hole is real: a signed-in user changed their own plan, comp
--          flag and promo code (OK rows=1, read back)
--     refused_by_privilege 9 · refused_by_trigger 9 · editable_saved 4 ·
--     legitimate_writers_ok 4 (L1 postgres, L2 SECURITY DEFINER, L3 the real
--     process_checkout_event as service_role, L5 handle_new_user)
--     PM1 → KILLED at [C-plan]   (12 failures; S1 also names the cause)
--     PM2 → KILLED at [C-plan]   (C-comped did NOT fail: the mutant is specific)
--     PM3 → KILLED at [A-plan]   — and the refusal that replaced "permission
--                                  denied" was the TRIGGER's. With the column
--                                  grant widened, the second layer held.
--     PM4 → KILLED at [A-plan]   — same: all nine columns still refused, by
--                                  the trigger.
--     PM5 → KILLED at [C-pending_plan]
--     PM6 → KILLED at [C-plan]
--     AFTER MUTANTS: zero failures.
--
--   NOT EXERCISED, stated: `anon` against the trigger layer. anon has no
--   session, so RLS (`auth.uid() = id`) matches no row and the trigger never
--   fires for it. anon is refused by privileges (E-anon).

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

-- Runs one statement as a role, reports what happened, and always returns to
-- postgres. The role is set OUTSIDE the inner block so a failure inside it
-- does not undo the impersonation before the statement has run.
create function pg_temp.h98_try(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_n   integer;
  v_out text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null then ''
         else json_build_object('sub', p_uid, 'role', p_role)::text end,
    true
  );
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

-- An EXPRESSION that differs from the row's current value whatever that value
-- is — never a fixed literal. The first run used 'elite' and `true` against a
-- test account that is already Elite and comped, so "change the plan" was no
-- change at all and the trigger correctly let it through.
create function pg_temp.h98_new_value(p_col text, p_type text)
returns text
language sql
as $fn$
  select case
    when p_col = 'plan'
      then 'case when plan = ''elite'' then ''pro'' else ''elite'' end'
    when p_col = 'pending_plan'
      then 'case when pending_plan = ''elite'' then ''pro'' else ''elite'' end'
    when p_col = 'role'
      then 'case when role = ''viewer'' then ''manager'' else ''viewer'' end'
    when p_type = 'boolean'     then format('not %I', p_col)
    when p_type = 'uuid'        then 'gen_random_uuid()'
    when p_type like 'timestamp%' then format('%I + interval ''1 day''', p_col)
    else format('coalesce(%I, '''') || ''-h98''', p_col)
  end;
$fn$;

-- The whole assertion set. Returns { fails: [...in order...], counters: {} }.
create function pg_temp.h98_assert(p_uid uuid, p_other uuid)
returns jsonb
language plpgsql
as $fn$
declare
  v_editable constant text[] := array['full_name', 'avatar_url', 'org_name', 'setup_dismissed'];
  v_fails    text[] := array[]::text[];
  v_priv     integer := 0;
  v_trig     integer := 0;
  v_saved    integer := 0;
  v_legit    integer := 0;
  r          record;
  v_res      text;
  v_row      public.profiles%rowtype;
  v_before   public.profiles%rowtype;
begin
  select * into v_before from public.profiles where id = p_uid;

  -- ── A: privilege layer ───────────────────────────────────────────────────
  for r in
    select c.column_name::text as col, c.data_type::text as typ
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'profiles'
       and not (c.column_name::text = any (v_editable))
     order by array_position(
                array['plan', 'comped', 'pending_promo', 'pending_plan', 'role', 'email'],
                c.column_name::text) nulls last,
              c.column_name
  loop
    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set %I = %s where id = %L',
      r.col, pg_temp.h98_new_value(r.col, r.typ), p_uid));
    if v_res not like 'ERR 42501 permission denied%' then
      v_fails := array_append(v_fails, format('A-%s: %s', r.col, v_res));
    else
      v_priv := v_priv + 1;
    end if;
  end loop;

  v_res := pg_temp.h98_try('authenticated', p_uid, format(
    'update public.profiles set org_name = %L, comped = not comped where id = %L', 'H98 Mixed', p_uid));
  if v_res not like 'ERR 42501 permission denied%' then
    v_fails := array_append(v_fails, 'A-mixed: ' || v_res);
  end if;

  select * into v_row from public.profiles where id = p_uid;
  if to_jsonb(v_row) is distinct from to_jsonb(v_before) then
    v_fails := array_append(v_fails, 'A-unchanged: the row changed during refused writes');
  end if;

  -- ── B: the four editable columns ─────────────────────────────────────────
  begin
    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set full_name = %L where id = %L', 'H98 Name', p_uid));
    select * into v_row from public.profiles where id = p_uid;
    if v_res <> 'OK rows=1' or v_row.full_name is distinct from 'H98 Name' then
      v_fails := array_append(v_fails, 'B-full_name: ' || v_res);
    else v_saved := v_saved + 1; end if;

    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set avatar_url = %L where id = %L', 'https://example.test/h98.png', p_uid));
    select * into v_row from public.profiles where id = p_uid;
    if v_res <> 'OK rows=1' or v_row.avatar_url is distinct from 'https://example.test/h98.png' then
      v_fails := array_append(v_fails, 'B-avatar_url: ' || v_res);
    else v_saved := v_saved + 1; end if;

    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set org_name = %L where id = %L', 'H98 Org', p_uid));
    select * into v_row from public.profiles where id = p_uid;
    if v_res <> 'OK rows=1' or v_row.org_name is distinct from 'H98 Org' then
      v_fails := array_append(v_fails, 'B-org_name: ' || v_res);
    else v_saved := v_saved + 1; end if;

    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set setup_dismissed = not setup_dismissed where id = %L', p_uid));
    select * into v_row from public.profiles where id = p_uid;
    if v_res <> 'OK rows=1' or v_row.setup_dismissed is not distinct from v_before.setup_dismissed then
      v_fails := array_append(v_fails, 'B-setup_dismissed: ' || v_res);
    else v_saved := v_saved + 1; end if;

    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set full_name = %L, org_name = %L where id = %L', 'H98 Both', 'H98 Both Org', p_uid));
    if v_res <> 'OK rows=1' then
      v_fails := array_append(v_fails, 'B-both: ' || v_res);
    end if;

    select * into v_row from public.profiles where id = p_uid;
    if v_row.plan is distinct from v_before.plan or v_row.comped is distinct from v_before.comped
       or v_row.pending_promo is distinct from v_before.pending_promo then
      v_fails := array_append(v_fails, 'B-billing: a billing column moved during an allowed save');
    end if;

    -- D1: someone else's row.
    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set org_name = %L where id = %L', 'H98 Not Yours', p_other));
    if v_res <> 'OK rows=0' then
      v_fails := array_append(v_fails, 'D1: ' || v_res);
    end if;

    -- anon
    v_res := pg_temp.h98_try('anon', null, format(
      'update public.profiles set org_name = %L where id = %L', 'H98 Anon', p_uid));
    if v_res not like 'ERR 42501 permission denied%' then
      v_fails := array_append(v_fails, 'E-anon: ' || v_res);
    end if;

    raise exception 'H98_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H98_ROLLBACK' then
      v_fails := array_append(v_fails, 'CRASH-B: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- ── C: trigger layer, isolated ───────────────────────────────────────────
  begin
    grant update on table public.profiles to authenticated;

    for r in
      select c.column_name::text as col, c.data_type::text as typ
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'profiles'
         and not (c.column_name::text = any (v_editable))
       order by array_position(
                  array['plan', 'comped', 'pending_promo', 'pending_plan', 'role', 'email'],
                  c.column_name::text) nulls last,
                c.column_name
    loop
      v_res := pg_temp.h98_try('authenticated', p_uid, format(
        'update public.profiles set %I = %s where id = %L',
        r.col, pg_temp.h98_new_value(r.col, r.typ), p_uid));
      if v_res like 'ERR 42501 profiles_protected_column:%' and position(r.col in v_res) > 0 then
        v_trig := v_trig + 1;
      else
        v_fails := array_append(v_fails, format('C-%s: %s', r.col, v_res));
      end if;
    end loop;

    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set org_name = %L, comped = not comped where id = %L', 'H98 Mixed', p_uid));
    if v_res not like 'ERR 42501 profiles_protected_column:%' then
      v_fails := array_append(v_fails, 'C-mixed: ' || v_res);
    end if;

    v_res := pg_temp.h98_try('authenticated', p_uid,
      format('update public.profiles set plan = plan where id = %L', p_uid));
    if v_res <> 'OK rows=1' then
      v_fails := array_append(v_fails, 'C-noop: ' || v_res);
    end if;

    select * into v_row from public.profiles where id = p_uid;
    if to_jsonb(v_row) is distinct from to_jsonb(v_before) then
      v_fails := array_append(v_fails, 'C-unchanged: the row changed during refused writes');
    end if;

    v_res := pg_temp.h98_try('authenticated', p_uid, format(
      'update public.profiles set org_name = %L where id = %L', 'H98 Trigger Path', p_uid));
    if v_res <> 'OK rows=1' then
      v_fails := array_append(v_fails, 'C-edit: ' || v_res);
    end if;

    raise exception 'H98_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H98_ROLLBACK' then
      v_fails := array_append(v_fails, 'CRASH-C: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- ── L: every legitimate writer still works ───────────────────────────────
  begin
    -- Differing values, so this is a real change whatever the account holds.
    update public.profiles
       set plan = case when plan = 'elite' then 'pro' else 'elite' end,
           comped = not comped
     where id = p_uid;
    select * into v_row from public.profiles where id = p_uid;
    if v_row.plan is not distinct from v_before.plan
       or v_row.comped is not distinct from v_before.comped then
      v_fails := array_append(v_fails, 'L1: comping runbook update did not take');
    else v_legit := v_legit + 1; end if;
    raise exception 'H98_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H98_ROLLBACK' then
      v_fails := array_append(v_fails, 'L1: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    execute $sd$
      create function public.h98_secdef_probe(p uuid) returns void
      language sql security definer set search_path = public
      as 'update public.profiles set plan = ''pro'', pending_promo = ''H98'' where id = p'
    $sd$;
    grant execute on function public.h98_secdef_probe(uuid) to authenticated;
    update public.profiles set plan = 'free', pending_promo = null where id = p_uid;
    v_res := pg_temp.h98_try('authenticated', p_uid,
      format('select public.h98_secdef_probe(%L)', p_uid));
    select * into v_row from public.profiles where id = p_uid;
    if v_res not like 'OK%' or v_row.plan <> 'pro' or v_row.pending_promo is distinct from 'H98' then
      v_fails := array_append(v_fails, 'L2: ' || v_res);
    else v_legit := v_legit + 1; end if;
    raise exception 'H98_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H98_ROLLBACK' then
      v_fails := array_append(v_fails, 'L2: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    update public.profiles
       set plan = 'free', pending_promo = 'H98PROMO', pending_plan = 'elite'
     where id = p_uid;
    v_res := pg_temp.h98_try('service_role', null, format(
      'select public.process_checkout_event(%L, %L::uuid, %L, 1, false)',
      'HARNESS-0098-evt', p_uid, 'elite'));
    select * into v_row from public.profiles where id = p_uid;
    if v_res not like 'OK%' or v_row.plan <> 'elite' or v_row.pending_promo is not null then
      v_fails := array_append(v_fails, format('L3: %s (plan=%s, pending_promo=%s)',
        v_res, v_row.plan, coalesce(v_row.pending_promo, 'null')));
    else v_legit := v_legit + 1; end if;
    raise exception 'H98_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H98_ROLLBACK' then
      v_fails := array_append(v_fails, 'L3: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  v_res := pg_temp.h98_try('service_role', null, format(
    'update public.profiles set plan = %L where id = %L', 'pro', p_uid));
  if v_res not like 'ERR 42501 permission denied%' then
    v_fails := array_append(v_fails, 'L4: ' || v_res);
  end if;

  if not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'handle_new_user'
          and p.prosecdef
          and p.prosrc ~* 'insert\s+into\s+(public\.)?profiles'
          and p.prosrc !~* 'update\s+(public\.)?profiles'
          and p.prosrc !~* 'on\s+conflict[^;]*do\s+update')
     or not exists (
       select 1 from pg_trigger t
        where t.tgrelid = 'auth.users'::regclass
          and t.tgname = 'on_auth_user_created'
          and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 0)
  then
    v_fails := array_append(v_fails, 'L5: handle_new_user is not the insert-only trigger this fix assumes');
  else v_legit := v_legit + 1; end if;

  -- ── S / P: structure and privileges ──────────────────────────────────────
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'protect_profiles_columns'
                    and not p.prosecdef) then
    v_fails := array_append(v_fails, 'S1: the trigger function is missing or SECURITY DEFINER');
  end if;
  -- tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.profiles'::regclass
                    and t.tgname = 'protect_profiles_columns'
                    and t.tgenabled = 'O' and t.tgtype = 19) then
    v_fails := array_append(v_fails, 'S2: trigger is not an enabled BEFORE UPDATE row trigger');
  end if;
  for r in
    select c.column_name::text as col
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'profiles'
  loop
    if has_column_privilege('authenticated', 'public.profiles', r.col, 'UPDATE')
         <> (r.col = any (v_editable))
       or has_column_privilege('anon', 'public.profiles', r.col, 'UPDATE')
    then
      v_fails := array_append(v_fails, 'P1: ' || r.col);
    end if;
  end loop;

  return jsonb_build_object(
    'fails', to_jsonb(v_fails),
    'counters', jsonb_build_object(
      'refused_by_privilege', v_priv,
      'refused_by_trigger', v_trig,
      'editable_saved', v_saved,
      'legitimate_writers_ok', v_legit));
end;
$fn$;

do $h98$
declare
  v_uid     uuid;
  v_other   uuid;
  v_n       integer;
  v_hole    text;
  v_base    jsonb;
  v_m       jsonb;
  v_out     text := '';
  v_def     text;
  v_mut     text;
  m         record;
  v_first   text;
  v_tag     text;
  v_zero    text := '';
  k         text;
begin
  select count(*), min(id::text)::uuid into v_n, v_uid
    from public.profiles where org_name = 'test';
  if v_n <> 1 then
    raise exception 'H98 SETUP: expected exactly one profiles row with org_name = test, found %', v_n;
  end if;
  select count(*), min(id::text)::uuid into v_n, v_other
    from public.profiles where org_name = 'Test 2';
  if v_n <> 1 then
    raise exception 'H98 SETUP: expected exactly one profiles row with org_name = Test 2, found %', v_n;
  end if;

  -- H0: the hole, before the fix.
  begin
    v_hole := pg_temp.h98_try('authenticated', v_uid, format(
      'update public.profiles set plan = case when plan = ''elite'' then ''pro'' else ''elite'' end, comped = not comped, pending_promo = %L where id = %L',
      'H98', v_uid));
    -- Read back: the write must have actually CHANGED the row.
    if v_hole = 'OK rows=1' and not exists (
         select 1 from public.profiles p
          where p.id = v_uid and p.pending_promo = 'H98') then
      v_hole := 'OK rows=1 BUT the row did not change';
    end if;
    raise exception 'H98_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H98_ROLLBACK' then
      v_hole := 'CRASH ' || sqlstate || ' ' || sqlerrm;
    end if;
  end;

  -- The migration, verbatim.
  execute $mig98$
-- @@MIGRATION_0098@@
  $mig98$;

  v_base := pg_temp.h98_assert(v_uid, v_other);
  for k in select jsonb_object_keys(v_base -> 'counters') loop
    if (v_base -> 'counters' ->> k)::integer = 0 then
      v_zero := v_zero || ' ' || k;
    end if;
  end loop;

  v_out := format(
    E'H98 RESULTS\nH0 (hole before 0098): %s  [expected OK rows=1]\nBASELINE failures: %s\nBASELINE counters: %s\nZERO counters:%s\n',
    v_hole, v_base -> 'fails', v_base -> 'counters', case when v_zero = '' then ' none' else v_zero end);

  for m in
    select * from (values
      ('PM1', 'trigger function made SECURITY DEFINER', 'C-plan', 'alter'),
      ('PM2', 'plan added to the editable list',        'C-plan', 'body'),
      ('PM3', 'UPDATE (plan) granted to authenticated', 'A-plan', 'grantcol'),
      ('PM4', 'table-level UPDATE re-granted',          'A-plan', 'granttbl'),
      ('PM5', 'subtraction replaced by three columns',  'C-pending_plan', 'body'),
      ('PM6', 'caller check removed',                   'C-plan', 'body')
    ) as t(id, what, target, kind)
  loop
    begin
      if m.kind = 'alter' then
        alter function public.protect_profiles_columns() security definer;
      elsif m.kind = 'grantcol' then
        grant update (plan) on table public.profiles to authenticated;
      elsif m.kind = 'granttbl' then
        grant update on table public.profiles to authenticated;
      else
        v_def := pg_get_functiondef('public.protect_profiles_columns()'::regprocedure);
        if m.id = 'PM2' then
          v_mut := replace(v_def, $a$'org_name', 'setup_dismissed'$a$, $a$'org_name', 'setup_dismissed', 'plan'$a$);
        elsif m.id = 'PM5' then
          v_mut := replace(v_def,
            $a$if (to_jsonb(old) - v_editable) is distinct from (to_jsonb(new) - v_editable) then$a$,
            $a$if old.plan is distinct from new.plan or old.comped is distinct from new.comped or old.pending_promo is distinct from new.pending_promo then$a$);
        else
          v_mut := replace(v_def,
            $a$if current_user not in ('authenticated', 'anon') then$a$,
            $a$if true then$a$);
        end if;
        if v_mut = v_def then
          raise exception 'MUTANT_NOOP';
        end if;
        execute v_mut;
      end if;

      v_m := pg_temp.h98_assert(v_uid, v_other);
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED'
             when v_tag = m.target then 'KILLED'
             else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
      if m.id = 'PM2' and (v_m -> 'fails')::text like '%C-comped%' then
        v_out := v_out || E'   PM2 NOT SPECIFIC: C-comped failed too\n';
      end if;
      raise exception 'H98_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H98_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  -- After the mutants: the unmutated fix must still be green.
  v_m := pg_temp.h98_assert(v_uid, v_other);
  v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');

  -- ALWAYS raise: this is what rolls everything back.
  raise exception '%', v_out;
end;
$h98$;

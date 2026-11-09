-- Proof for 0125 (officials sign-up: turning it on works). Assembled by
-- official-signup-enable-build.ts, which puts the LITERAL migration text where
-- the placeholder is. One transaction the final RAISE always rolls back; the
-- migration is applied in a rolled-back sub-run for the baseline and again for
-- every mutant. Fixture: the "test" proof org (bbf9afe1…, Elite, switch on) —
-- its settings row is removed inside the run so every case starts from a
-- known state; never Santa Rosa American's data.
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/official-signup-enable-build.ts
-- > proof.sql`, send it as ONE batch, read the raised message, then the leak
-- check at the bottom. `--md5` prints the md5(prosrc) the apply must match.
--
-- LOCKS: the function's catalog row (CREATE OR REPLACE) and row locks on the
-- test org's official_signup_settings row — nothing on any other table.
--
-- WHY THE 0124 PROOF MISSED IT: its fixture wrote the settings row directly
-- (enabled + contact in one INSERT) and never called set_official_signup_enabled.
-- OE1 below is the sequence the screen makes: save the contact, then turn on.
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   OE1 the contact saved in one call, sign-up turned on in a SEPARATE call →
--       on, contact kept (the live bug)
--   OE2 turning on with no contact → `contact_required`, nothing written
--   OE3 turning off keeps the contact; turning on again works
--   OE4 turning off with no settings row → a row, off, no contact
--   OE5 clearing the contact while on → `contact_required` (0124, unchanged)
--   OE6 a non-member → `not_authorized`
--   OP1 EXECUTE authenticated only
-- Mutants (each must die at its own tag):
--   ME1 the 0124 upsert (no contact in the proposed row)   → OE1
--   ME2 the contact_required check dropped (the CHECK fires
--       instead, with the raw constraint message)          → OE2
--   ME3 callable by anon                                   → OP1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

create or replace function pg_temp.h125_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

create or replace function pg_temp.h125_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_other uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';  -- a real profile, not a member of "test"
  v_r text;
  v_on boolean;
  v_mail text;
  r text;
begin
  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'official_signup', true)
    on conflict (owner_id, feature) do update set enabled = true;
  delete from public.official_signup_settings where owner_id = v_org;

  -- OE1 — the live bug: contact in one call, on in another.
  v_r := pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_contact(%L, %L)::text', v_org, 'umps@zz125.test'));
  if v_r like 'ERR%' then return 'OE1 saving the contact: ' || v_r; end if;
  v_r := pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_enabled(%L, true)::text', v_org));
  select s.enabled, s.contact_email into v_on, v_mail from public.official_signup_settings s where s.owner_id = v_org;
  if v_r is distinct from '{"enabled": true}' or v_on is distinct from true or v_mail is distinct from 'umps@zz125.test' then
    return format('OE1 turning on after saving the contact: %s (row: %s, %s)', v_r, v_on, v_mail);
  end if;

  -- OE2 — on with no contact: refused, nothing written.
  delete from public.official_signup_settings where owner_id = v_org;
  v_r := pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_enabled(%L, true)::text', v_org));
  if v_r not like '%contact_required%' or exists (select 1 from public.official_signup_settings where owner_id = v_org) then
    return 'OE2 on with no contact: ' || v_r;
  end if;

  -- OE3 — off keeps the contact; on again works.
  perform pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_contact(%L, %L)::text', v_org, 'umps@zz125.test'));
  perform pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_enabled(%L, true)::text', v_org));
  v_r := pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_enabled(%L, false)::text', v_org));
  select s.enabled, s.contact_email into v_on, v_mail from public.official_signup_settings s where s.owner_id = v_org;
  if v_r is distinct from '{"enabled": false}' or v_on or v_mail is distinct from 'umps@zz125.test' then
    return format('OE3 off: %s (row: %s, %s)', v_r, v_on, v_mail);
  end if;
  v_r := pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_enabled(%L, true)::text', v_org));
  if v_r is distinct from '{"enabled": true}' then return 'OE3 on again: ' || v_r; end if;

  -- OE4 — off with no row: a row, off, no contact.
  delete from public.official_signup_settings where owner_id = v_org;
  v_r := pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_enabled(%L, false)::text', v_org));
  select s.enabled, s.contact_email into v_on, v_mail from public.official_signup_settings s where s.owner_id = v_org;
  if v_r is distinct from '{"enabled": false}' or v_on is distinct from false or v_mail is not null then
    return format('OE4 off with no row: %s (row: %s, %s)', v_r, v_on, v_mail);
  end if;

  -- OE5 — clearing the contact while on is refused (0124's rule).
  perform pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_contact(%L, %L)::text', v_org, 'umps@zz125.test'));
  perform pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_enabled(%L, true)::text', v_org));
  v_r := pg_temp.h125_as(v_org, 'authenticated', format('select public.set_official_signup_contact(%L, %L)::text', v_org, ''));
  if v_r not like '%contact_required%' then return 'OE5 clearing the contact while on: ' || v_r; end if;

  -- OE6 — a non-member.
  v_r := pg_temp.h125_as(v_other, 'authenticated', format('select public.set_official_signup_enabled(%L, true)::text', v_org));
  if v_r not like '%not_authorized%' then return 'OE6 a non-member: ' || v_r; end if;

  -- OP1 — privileges.
  foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
    if has_function_privilege(r, 'public.set_official_signup_enabled(uuid, boolean)', 'EXECUTE') then
      return 'OP1 ' || r || ' can execute set_official_signup_enabled';
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.set_official_signup_enabled(uuid, boolean)', 'EXECUTE') then
    return 'OP1 authenticated cannot execute set_official_signup_enabled';
  end if;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig125$
-- @@MIGRATION_0125@@
$mig125$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\n';
  m       record;
begin
  if strpos(v_body, '-- 3. Verify') = 0 then raise exception 'harness: verify marker not found in 0125'; end if;
  v_nover := split_part(v_body, '-- 3. Verify', 1);

  begin
    execute v_body;
    v_res := pg_temp.h125_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || 'md5(prosrc) set_official_signup_enabled=' ||
      (select md5(p.prosrc) from pg_proc p where p.proname = 'set_official_signup_enabled'
          and p.pronamespace = 'public'::regnamespace) || E'\n';
    raise exception 'H125ROLLBACK';
  exception when others then
    if sqlerrm <> 'H125ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('ME1', 'OE1', $r$  insert into public.official_signup_settings (owner_id, enabled, contact_email, updated_by)
  values (p_org_id, coalesce(p_enabled, false), v_mail, auth.uid())$r$,
                   $r$  insert into public.official_signup_settings (owner_id, enabled, updated_by)
  values (p_org_id, coalesce(p_enabled, false), auth.uid())$r$),
    ('ME2', 'OE2', $r$    if v_mail is null then raise exception 'contact_required' using errcode = 'P0001'; end if;
$r$, $r$$r$),
    ('ME3', 'OP1', $r$grant execute on function public.set_official_signup_enabled(uuid, boolean) to authenticated;$r$,
                   $r$grant execute on function public.set_official_signup_enabled(uuid, boolean) to authenticated, anon;$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h125_case();
      raise exception 'H125CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H125CASE:%' then replace(sqlerrm, 'H125CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0125 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select md5(prosrc) from pg_proc where proname = 'set_official_signup_enabled') as must_be_0124_65e1a45f,
--   (select count(*) from official_signup_settings where owner_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as test_settings_rows_as_before,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- 2026-11-09, against production, rolled back, on Whit's go (sent as one
-- batch, the migration byte-exact).
--   Run 1 — GREEN: baseline pass; md5(prosrc) 3bd26f05… = `--md5`; ME1, ME2,
--     ME3 KILLED at their own tag (ME1 reproduced the live error: 23514
--     contact_when_on). Locks: the function's catalog row and the test org's
--     settings row only.
--   Leak check: identical to the pre-run snapshot (0124 md5 65e1a45f… live,
--     one settings row — SRALL's, unchanged — none for "test", feature rows
--     unchanged, no h125 functions, no idle transaction).
--   Applied right after (apply_migration, verbatim): catalog 20261109231310;
--     verify block passed; md5, overloads, SECURITY DEFINER, search_path and
--     EXECUTE per role checked live.

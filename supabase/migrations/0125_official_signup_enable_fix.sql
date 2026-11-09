-- 0125 — Officials sign-up: turning it on works (2026-11-09, branch
-- fix/official-signup-enable).
--
-- THE BUG (0124, live): "Officials can sign up" always failed with
-- `violates check constraint official_signup_settings_contact_when_on`, even
-- after the contact email was saved. set_official_signup_enabled upserted
--   insert (owner_id, enabled, updated_by) values (…, true, …)
--   on conflict (owner_id) do update set enabled = excluded.enabled, …
-- and Postgres checks a table's CHECK constraints against the PROPOSED INSERT
-- ROW before it resolves the conflict. That row had no contact_email, so
-- (enabled = true, contact_email = null) failed the CHECK although the row it
-- would have updated held a contact. Confirmed 2026-11-09 on a temp table.
--
-- THE FIX: the function reads the current contact (FOR UPDATE) on every call
-- and carries it into the proposed row, so the proposed row is always valid:
-- enabling requires that contact (refused with `contact_required` otherwise),
-- disabling proposes enabled = false. The conflict path still changes only
-- `enabled` and the stamps — never the contact.
--
-- AUDIT (2026-11-09): every INSERT … ON CONFLICT in 0120–0124. Only this one
-- can trip: official_signup_settings_contact_when_on is the only CHECK that
-- ties a column an upsert leaves out to one it sets. set_volunteer_link (0120)
-- uses plain UPDATEs; set_volunteer_contact_email and
-- set_official_signup_contact propose enabled/link_enabled = false (the
-- default), which always passes; the other upserts' tables have single-column
-- CHECKs on values they supply, or none.
--
-- Body otherwise verbatim from 0124; signature, SECURITY DEFINER, search_path
-- and EXECUTE (authenticated only) unchanged. LOCKS when applied: none beyond
-- the function's own catalog row (CREATE OR REPLACE FUNCTION).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The function
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.set_official_signup_enabled(p_org_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_mail text;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(p_org_id, 'official_signup') then raise exception 'feature_off' using errcode = 'P0001'; end if;
  -- The current contact, on every call: it goes into the proposed row below
  -- (Postgres checks CHECKs on the proposed insert row before ON CONFLICT).
  select s.contact_email into v_mail from public.official_signup_settings s where s.owner_id = p_org_id for update;
  if coalesce(p_enabled, false) then
    select p.plan into v_plan from public.profiles p where p.id = p_org_id;
    if v_plan is distinct from 'elite' then raise exception 'plan_required' using errcode = 'P0001'; end if;
    if v_mail is null then raise exception 'contact_required' using errcode = 'P0001'; end if;
  end if;
  insert into public.official_signup_settings (owner_id, enabled, contact_email, updated_by)
  values (p_org_id, coalesce(p_enabled, false), v_mail, auth.uid())
  on conflict (owner_id) do update
     set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('enabled', coalesce(p_enabled, false));
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Privileges (unchanged; restated so the file stands alone)
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.set_official_signup_enabled(uuid, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.set_official_signup_enabled(uuid, boolean) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Verify (or the whole migration rolls back)
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  r text;
  f text := 'public.set_official_signup_enabled(uuid, boolean)';
begin
  if not has_function_privilege('authenticated', f, 'EXECUTE') then
    raise exception '0125 verify: authenticated cannot execute %', f;
  end if;
  foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
    if has_function_privilege(r, f, 'EXECUTE') then raise exception '0125 verify: % can execute %', r, f; end if;
  end loop;
  if (select count(*) from pg_proc where proname = 'set_official_signup_enabled' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0125 verify: set_official_signup_enabled is overloaded';
  end if;
  if not (select prosecdef from pg_proc where oid = f::regprocedure) then
    raise exception '0125 verify: not SECURITY DEFINER';
  end if;
end
$v$;

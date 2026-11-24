-- 0132: revoke the default PUBLIC EXECUTE grant from trigger / event-trigger functions.
-- Postgres checks EXECUTE on a trigger function at CREATE TRIGGER time only, never
-- when it fires, so no role needs EXECUTE for these to keep working (17 trigger
-- functions in this schema already run with none). Revoke from PUBLIC: a role-level
-- revoke is a no-op while PUBLIC holds the grant (see CLAUDE.md).
-- rls_auto_enable and the dashboard_readonly role are not created by our migrations,
-- so both are existence-guarded: this migration must also run on a rebuilt database.

do $$
declare
  fns text[] := array['handle_new_user()','clear_division_posted()','enforce_division_lock()',
                      'set_games_notes_attribution()','rls_auto_enable()','set_updated_at()'];
  f text;
  has_dash boolean := exists (select 1 from pg_roles where rolname = 'dashboard_readonly');
begin
  foreach f in array fns loop
    if to_regprocedure('public.' || f) is null then
      if f = 'rls_auto_enable()' then continue; end if;  -- not ours; may be absent
      raise exception '0132: public.% is missing', f;
    end if;
    execute format('revoke execute on function public.%s from public', f);
    if has_dash then
      execute format('revoke execute on function public.%s from dashboard_readonly', f);
    end if;
  end loop;
end $$;

alter function public.set_updated_at() set search_path = '';

-- Assertion: no API-facing or service role still holds EXECUTE on any of the six.
do $$
declare
  fns text[] := array['handle_new_user()','clear_division_posted()','enforce_division_lock()',
                      'set_games_notes_attribution()','rls_auto_enable()','set_updated_at()'];
  f text; r text;
begin
  foreach f in array fns loop
    continue when to_regprocedure('public.' || f) is null;
    for r in select rolname from pg_roles
             where rolname in ('anon','authenticated','service_role','dashboard_readonly','supabase_auth_admin') loop
      if has_function_privilege(r, 'public.' || f, 'execute') then
        raise exception '0132: % still holds EXECUTE on public.%', r, f;
      end if;
    end loop;
  end loop;
end $$;

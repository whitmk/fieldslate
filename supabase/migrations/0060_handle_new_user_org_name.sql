-- handle_new_user(): also persist the organization name captured at signup.
--
-- The signup form (src/app/(auth)/signup/page.tsx) stores its "Organization
-- name" field in auth user metadata as `org_name`. Until now the trigger only
-- read `full_name`, so that value went unused. This reads `org_name` and writes
-- it to profiles.org_name (the umbrella org label introduced in migration 0044).
--
-- nullif(trim(...), '') keeps the column NULL when the field is blank or
-- whitespace, so the UI fallback (migration 0044) still applies — and it matches
-- the normalization used elsewhere (e.g. migration 0052). Idempotent
-- create-or-replace; the organization_members owner insert added in migration
-- 0048 is preserved exactly, and the existing trigger binding (migration 0001)
-- continues to point at this function unchanged.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, org_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    nullif(trim(new.raw_user_meta_data->>'org_name'), '')
  );

  insert into public.organization_members (org_id, user_id, role)
  values (new.id, new.id, 'owner');

  return new;
end;
$$;

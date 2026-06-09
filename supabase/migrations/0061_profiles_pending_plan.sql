-- profiles.pending_plan — the paid tier a user chose at signup but hasn't paid
-- for yet. Set at signup time (carried through auth metadata, written by the
-- handle_new_user trigger below), read after email verification to bounce the
-- user into Stripe checkout, and cleared by the Stripe webhook once payment
-- completes. NULL = no pending purchase (the normal Free signup).
--
-- Why the trigger and not a client write: at signup the user has no session
-- yet (email confirmation is on), so the anon client can't satisfy the
-- profiles RLS UPDATE policy (auth.uid() = id). Carrying the value through
-- user metadata and letting the SECURITY DEFINER trigger persist it — exactly
-- how full_name (0001) and org_name (0060) already flow — makes the write
-- atomic with row creation and needs no service-role surface on the signup path.

alter table public.profiles
  add column if not exists pending_plan text
    check (pending_plan in ('pro', 'elite'));

-- handle_new_user(): now also persists the chosen paid plan from signup.
--
-- The signup form stores the ?plan= URL param in auth user metadata as `plan`.
-- We only accept 'pro'/'elite' (a CASE, not a raw read) so a Free signup or any
-- junk value lands as NULL and can never violate the column CHECK and fail the
-- whole signup. Create-or-replace; the org_name logic (0060) and the
-- organization_members owner insert (0048) are preserved exactly, and the
-- trigger binding (0001) continues to point at this function unchanged.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, org_name, pending_plan)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    nullif(trim(new.raw_user_meta_data->>'org_name'), ''),
    case
      when new.raw_user_meta_data->>'plan' in ('pro', 'elite')
        then new.raw_user_meta_data->>'plan'
      else null
    end
  );

  insert into public.organization_members (org_id, user_id, role)
  values (new.id, new.id, 'owner');

  return new;
end;
$$;

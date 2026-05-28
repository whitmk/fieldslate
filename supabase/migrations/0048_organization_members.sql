-- Multi-admin foundation (Chunk A of 2).
-- Introduces organization_members as the membership join table for users -> orgs.
-- An "org" has no dedicated table: the original creator's user id IS the org id.
-- Every existing user is backfilled as the sole owner of their own org so behavior
-- is unchanged after this migration runs (no new access, no lost access).

create table public.organization_members (
  id        uuid        primary key default gen_random_uuid(),
  org_id    uuid        not null,
  user_id   uuid        not null references auth.users(id) on delete cascade,
  role      text        not null check (role in ('owner', 'admin')),
  added_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index idx_org_members_user on public.organization_members(user_id);
create index idx_org_members_org  on public.organization_members(org_id);

alter table public.organization_members enable row level security;

-- A user can read their own memberships (used by the header org switcher
-- and the Settings -> Team section). All mutations are locked down to the
-- service role for now; Chunk B adds policies for invitations / management.
create policy "Members can read their own memberships"
  on public.organization_members for select
  using (user_id = auth.uid());

grant select on public.organization_members to authenticated;

-- Membership predicate used by every owned-table RLS policy (migration 0049).
-- SECURITY DEFINER bypasses RLS on organization_members so the function can
-- check membership across orgs the calling user belongs to (RLS would otherwise
-- only let it see its own rows, which is fine here, but DEFINER also avoids any
-- planner pitfalls with policy recursion if we ever broaden the SELECT policy).
-- STABLE because membership can change between transactions but is stable within one.
create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.organization_members
     where org_id  = check_org_id
       and user_id = auth.uid()
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;

-- Backfill: every existing auth.users row becomes the sole owner of its own
-- org (org_id = user_id). We include ALL auth.users rather than only distinct
-- owner_ids across owned tables -- a user who signed up but never created
-- a league still needs a membership row, otherwise their first INSERT under
-- the new RLS (migration 0049) would fail is_org_member().
insert into public.organization_members (org_id, user_id, role)
select id, id, 'owner'
  from auth.users
on conflict (org_id, user_id) do nothing;

-- Extend the existing handle_new_user() trigger so every future signup also
-- gets an owner membership for its own org. Profiles auto-creation is
-- preserved exactly as before (see migration 0001).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );

  insert into public.organization_members (org_id, user_id, role)
  values (new.id, new.id, 'owner');

  return new;
end;
$$;

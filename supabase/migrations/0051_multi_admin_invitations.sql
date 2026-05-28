-- Chunk B foundations: broaden RLS so admins can see each other, add the
-- plan field that drives tier caps, and add the organization_invitations
-- table that backs the email-invite flow.

-- ────────────────────────────────────────────────────────────────────────────
-- organization_members SELECT — broaden from self-only to org-roster.
-- Settings -> Team needs to list all members of the current org. Safe from
-- recursion: is_org_member() is SECURITY DEFINER (migration 0048) so it
-- bypasses RLS on organization_members internally.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Members can read their own memberships" on public.organization_members;

create policy "Org members can read membership roster"
  on public.organization_members for select
  using (public.is_org_member(org_id));

-- ────────────────────────────────────────────────────────────────────────────
-- profiles SELECT — broaden to allow reading org-mate profiles. Needed by
-- the Team section to display each member's name/email, and by the
-- org switcher to display the owner's name as the org's display name when
-- the caller is an admin of someone else's org.
--
-- Pattern: visible if it's your own profile, OR you share at least one org
-- with the profile owner. is_org_member() prevents the
-- profiles -> organization_members -> profiles recursion risk.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Users can view own profile" on public.profiles;

create policy "Users can view own and org-mate profiles"
  on public.profiles for select
  using (
    auth.uid() = id
    or exists (
      select 1 from public.organization_members them
      where them.user_id = profiles.id
        and public.is_org_member(them.org_id)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- profiles.plan — drives the tier-cap calculations. The OWNER's profile.plan
-- is the gating value for the whole org (since an org's id IS its owner's
-- user id). Stripe will write here later; for this chunk it's set by hand.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'pro', 'elite'));

-- ────────────────────────────────────────────────────────────────────────────
-- organization_invitations — email-invite records for users who don't have a
-- FieldSlate account yet. (Direct-add for existing users skips this table
-- and inserts straight into organization_members.)
-- ────────────────────────────────────────────────────────────────────────────

create table public.organization_invitations (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null,
  email       text        not null,
  -- Random opaque token used in the accept link. Generated client-side in the
  -- RPC (encode(gen_random_bytes(...))).
  token       text        not null unique,
  -- The user who initiated the invite. Stored for audit; not used for RLS
  -- gating (which goes via org_id + is_org_member).
  invited_by  uuid        not null references auth.users(id) on delete cascade,
  status      text        not null default 'pending'
              check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '14 days')
);

-- No two pending invites for the same (org, email) at once. Accepted, revoked,
-- and expired rows don't block new pending ones — useful for "resend" semantics
-- where a revoke can be immediately followed by a fresh invite.
create unique index organization_invitations_pending_unique
  on public.organization_invitations (org_id, lower(email))
  where status = 'pending';

create index organization_invitations_token_idx
  on public.organization_invitations (token);

create index organization_invitations_org_status_idx
  on public.organization_invitations (org_id, status);

alter table public.organization_invitations enable row level security;

-- Org members can read their org's invites (so the Team UI can list pending
-- invitations next to active members).
create policy "Org members can read invitations"
  on public.organization_invitations for select
  using (public.is_org_member(org_id));

-- All mutations happen via SECURITY DEFINER RPCs in migration 0052. No
-- direct INSERT/UPDATE/DELETE policies — service role only.

grant select on public.organization_invitations to authenticated;

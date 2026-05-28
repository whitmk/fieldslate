-- SECURITY DEFINER RPCs for org-admin management.
-- Every mutation on organization_members or organization_invitations
-- routes through one of these so the policies on those tables stay
-- service-role-only and the business rules (owner-only, tier caps,
-- expiry checks) live in one place.

-- ────────────────────────────────────────────────────────────────────────────
-- Tier caps — keep in sync with src/lib/orgs/plan.ts on the client.
-- Free 1, Pro 2, Elite 5. The cap counts active members + pending invites.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.org_member_cap(p_org_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce(
    (select plan from public.profiles where id = p_org_id),
    'free'
  )
    when 'free'  then 1
    when 'pro'   then 2
    when 'elite' then 5
    else 1
  end;
$$;

revoke all on function public.org_member_cap(uuid) from public;
grant execute on function public.org_member_cap(uuid) to authenticated;

-- Helper: how many seats are currently occupied (members + pending invites).
create or replace function public.org_seat_count(p_org_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.organization_members where org_id = p_org_id)
    +
    (select count(*) from public.organization_invitations
      where org_id = p_org_id and status = 'pending');
$$;

revoke all on function public.org_seat_count(uuid) from public;
grant execute on function public.org_seat_count(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- invite_admin — owner-only. Decides direct-add vs email-invite based on
-- whether a profile already exists for the email. Enforces the tier cap
-- before either path. Returns a jsonb payload that the API route uses to
-- pick the email template.
--
-- Possible return shapes:
--   { kind: 'direct_add',  user_id, full_name, email, org_name, inviter_name }
--   { kind: 'email_invite', invitation_id, token, email, org_name, inviter_name, expires_at }
--
-- Errors raised with errcode P0001 and a short tag that the API route
-- translates into a user-facing message:
--   not_authenticated, not_org_owner, tier_cap_reached, already_member,
--   already_invited, invalid_email
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.invite_admin(
  p_org_id uuid,
  p_email  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller        uuid := auth.uid();
  v_email_norm    text := lower(trim(p_email));
  v_existing_uid  uuid;
  v_cap           int;
  v_seats         int;
  v_org_name      text;
  v_inviter_name  text;
  v_token         text;
  v_invitation_id uuid;
  v_expires_at    timestamptz;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Naive email sanity check — full validation lives in the UI.
  if v_email_norm is null or v_email_norm = '' or position('@' in v_email_norm) = 0 then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  -- Owner-only.
  if not exists (
    select 1 from public.organization_members
    where org_id = p_org_id and user_id = v_caller and role = 'owner'
  ) then
    raise exception 'not_org_owner' using errcode = 'P0001';
  end if;

  -- Look up by email — case-insensitive.
  select id into v_existing_uid
    from public.profiles
   where lower(email) = v_email_norm
   limit 1;

  -- If they're already a member of this org, short-circuit with a friendly error.
  if v_existing_uid is not null and exists (
    select 1 from public.organization_members
    where org_id = p_org_id and user_id = v_existing_uid
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  -- If there's already a pending invitation for this email, short-circuit.
  if exists (
    select 1 from public.organization_invitations
    where org_id = p_org_id
      and lower(email) = v_email_norm
      and status = 'pending'
  ) then
    raise exception 'already_invited' using errcode = 'P0001';
  end if;

  -- Tier cap check — counts active members AND pending invites. Both paths
  -- add a seat, so a single cap check suffices.
  v_cap   := public.org_member_cap(p_org_id);
  v_seats := public.org_seat_count(p_org_id);
  if v_seats >= v_cap then
    raise exception 'tier_cap_reached' using errcode = 'P0001';
  end if;

  -- Look up display labels for the email payload.
  select coalesce(nullif(trim(org_name), ''),
                  nullif(trim(full_name), ''),
                  email)
    into v_org_name
    from public.profiles
   where id = p_org_id;

  select coalesce(nullif(trim(full_name), ''), email)
    into v_inviter_name
    from public.profiles
   where id = v_caller;

  -- Path A: existing user → direct add.
  if v_existing_uid is not null then
    insert into public.organization_members (org_id, user_id, role)
    values (p_org_id, v_existing_uid, 'admin');

    return jsonb_build_object(
      'kind',         'direct_add',
      'user_id',      v_existing_uid,
      'email',        v_email_norm,
      'org_name',     v_org_name,
      'inviter_name', v_inviter_name
    );
  end if;

  -- Path B: no profile → email invite.
  v_token       := encode(extensions.gen_random_bytes(24), 'hex');
  v_expires_at  := now() + interval '14 days';

  insert into public.organization_invitations (org_id, email, token, invited_by, expires_at)
  values (p_org_id, v_email_norm, v_token, v_caller, v_expires_at)
  returning id into v_invitation_id;

  return jsonb_build_object(
    'kind',          'email_invite',
    'invitation_id', v_invitation_id,
    'token',         v_token,
    'email',         v_email_norm,
    'org_name',      v_org_name,
    'inviter_name',  v_inviter_name,
    'expires_at',    v_expires_at
  );
end;
$$;

revoke all on function public.invite_admin(uuid, text) from public;
grant execute on function public.invite_admin(uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- get_org_invitation_by_token — anon-accessible token lookup for the accept
-- page. Returns null for invalid tokens. SECURITY DEFINER so anonymous
-- callers can read past the is_org_member-only RLS on the table.
-- Returns minimal payload (no caller-controllable fields) and never leaks
-- non-pending invitations beyond status + expiry.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.get_org_invitation_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.organization_invitations%rowtype;
  v_org_name     text;
  v_inviter_name text;
  v_effective_status text;
begin
  select * into v_row
    from public.organization_invitations
   where token = p_token;

  if not found then
    return null;
  end if;

  v_effective_status := v_row.status;
  if v_effective_status = 'pending' and v_row.expires_at < now() then
    v_effective_status := 'expired';
  end if;

  select coalesce(nullif(trim(org_name), ''),
                  nullif(trim(full_name), ''),
                  email)
    into v_org_name
    from public.profiles
   where id = v_row.org_id;

  select coalesce(nullif(trim(full_name), ''), email)
    into v_inviter_name
    from public.profiles
   where id = v_row.invited_by;

  return jsonb_build_object(
    'id',           v_row.id,
    'org_id',       v_row.org_id,
    'email',        v_row.email,
    'status',       v_effective_status,
    'expires_at',   v_row.expires_at,
    'org_name',     v_org_name,
    'inviter_name', v_inviter_name
  );
end;
$$;

revoke all on function public.get_org_invitation_by_token(text) from public;
grant execute on function public.get_org_invitation_by_token(text) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- accept_org_invitation — finalizes an email-invite. Caller must be
-- authenticated AND have an email that matches the invitation's email
-- (case-insensitive). Re-checks the tier cap so a stale invite can't push
-- the org over its limit. Idempotent: re-accepting an already-accepted
-- invitation by the same user is a no-op success.
--
-- Returns: { org_id, org_name }
--
-- Errors: not_authenticated, invitation_not_found, invitation_not_pending,
-- invitation_expired, email_mismatch, tier_cap_reached
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.accept_org_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_row        public.organization_invitations%rowtype;
  v_my_email   text;
  v_cap        int;
  v_seats      int;
  v_org_name   text;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.organization_invitations
   where token = p_token
   for update;

  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0001';
  end if;

  -- Auto-expire on read so stale rows don't accept silently.
  if v_row.status = 'pending' and v_row.expires_at < now() then
    update public.organization_invitations
       set status = 'expired'
     where id = v_row.id;
    raise exception 'invitation_expired' using errcode = 'P0001';
  end if;

  if v_row.status <> 'pending' then
    -- Idempotency: if THIS user already accepted it, just succeed.
    if v_row.status = 'accepted' and exists (
      select 1 from public.organization_members
      where org_id = v_row.org_id and user_id = v_caller
    ) then
      select coalesce(nullif(trim(org_name), ''),
                      nullif(trim(full_name), ''),
                      email)
        into v_org_name
        from public.profiles
       where id = v_row.org_id;
      return jsonb_build_object('org_id', v_row.org_id, 'org_name', v_org_name);
    end if;
    raise exception 'invitation_not_pending' using errcode = 'P0001';
  end if;

  -- Email match check.
  select email into v_my_email from public.profiles where id = v_caller;
  if v_my_email is null or lower(v_my_email) <> lower(v_row.email) then
    raise exception 'email_mismatch' using errcode = 'P0001';
  end if;

  -- Tier cap re-check.
  v_cap   := public.org_member_cap(v_row.org_id);
  v_seats := public.org_seat_count(v_row.org_id);
  -- The pending invite we're accepting counts itself in seats; treat it as
  -- "converting a seat" rather than adding one. So compare seats - 1 to cap.
  if (v_seats - 1) >= v_cap then
    raise exception 'tier_cap_reached' using errcode = 'P0001';
  end if;

  -- Insert membership; on duplicate (e.g. somehow already a member), accept
  -- silently — the goal state is reached either way.
  insert into public.organization_members (org_id, user_id, role)
  values (v_row.org_id, v_caller, 'admin')
  on conflict (org_id, user_id) do nothing;

  update public.organization_invitations
     set status = 'accepted'
   where id = v_row.id;

  select coalesce(nullif(trim(org_name), ''),
                  nullif(trim(full_name), ''),
                  email)
    into v_org_name
    from public.profiles
   where id = v_row.org_id;

  return jsonb_build_object('org_id', v_row.org_id, 'org_name', v_org_name);
end;
$$;

revoke all on function public.accept_org_invitation(text) from public;
grant execute on function public.accept_org_invitation(text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- revoke_org_invitation — owner-only. Marks a pending invitation 'revoked'.
-- Returns the invitation id. No-op on already-non-pending rows.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.revoke_org_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org_id uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select org_id into v_org_id
    from public.organization_invitations
   where id = p_invitation_id;
  if v_org_id is null then
    raise exception 'invitation_not_found' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = v_org_id and user_id = v_caller and role = 'owner'
  ) then
    raise exception 'not_org_owner' using errcode = 'P0001';
  end if;

  update public.organization_invitations
     set status = 'revoked'
   where id = p_invitation_id
     and status = 'pending';

  return p_invitation_id;
end;
$$;

revoke all on function public.revoke_org_invitation(uuid) from public;
grant execute on function public.revoke_org_invitation(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- resend_org_invitation — owner-only. Generates a fresh token and pushes the
-- expiry out to now()+14d on a pending invitation. Returns the new token so
-- the API route can re-send the email. Rejects on non-pending rows.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.resend_org_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_row          public.organization_invitations%rowtype;
  v_new_token    text;
  v_org_name     text;
  v_inviter_name text;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_row from public.organization_invitations
   where id = p_invitation_id for update;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = v_row.org_id and user_id = v_caller and role = 'owner'
  ) then
    raise exception 'not_org_owner' using errcode = 'P0001';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'invitation_not_pending' using errcode = 'P0001';
  end if;

  v_new_token := encode(extensions.gen_random_bytes(24), 'hex');

  update public.organization_invitations
     set token      = v_new_token,
         expires_at = now() + interval '14 days'
   where id = v_row.id;

  select coalesce(nullif(trim(org_name), ''),
                  nullif(trim(full_name), ''),
                  email)
    into v_org_name
    from public.profiles
   where id = v_row.org_id;

  select coalesce(nullif(trim(full_name), ''), email)
    into v_inviter_name
    from public.profiles
   where id = v_caller;

  return jsonb_build_object(
    'invitation_id', v_row.id,
    'token',         v_new_token,
    'email',         v_row.email,
    'org_name',      v_org_name,
    'inviter_name',  v_inviter_name,
    'expires_at',    now() + interval '14 days'
  );
end;
$$;

revoke all on function public.resend_org_invitation(uuid) from public;
grant execute on function public.resend_org_invitation(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- remove_org_member — owner-only. Deletes a non-owner member. Cannot remove
-- the owner (would orphan the org).
--
-- Errors: not_authenticated, not_org_owner, cannot_remove_owner, not_member
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.remove_org_member(
  p_org_id  uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target_role text;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = p_org_id and user_id = v_caller and role = 'owner'
  ) then
    raise exception 'not_org_owner' using errcode = 'P0001';
  end if;

  select role into v_target_role
    from public.organization_members
   where org_id = p_org_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  if v_target_role = 'owner' then
    raise exception 'cannot_remove_owner' using errcode = 'P0001';
  end if;

  delete from public.organization_members
   where org_id = p_org_id and user_id = p_user_id;
end;
$$;

revoke all on function public.remove_org_member(uuid, uuid) from public;
grant execute on function public.remove_org_member(uuid, uuid) to authenticated;

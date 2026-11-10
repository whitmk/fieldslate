-- 0126 — Contact email verification for volunteer sign-ups and officials
-- sign-up (2026-11-09, branch feat/contact-email-verify).
--
-- WHY: the league contact email is the reply-to of every volunteer and
-- officials email, and where the officials notices go. Until now an admin
-- could type any address and it was used at once — a launch blocker in
-- CLAUDE.md ("the league contact email … is unverified").
--
-- THE MODEL — `contact_email` on volunteer_settings and
-- official_signup_settings now only ever holds a CONFIRMED address:
--   * Saving a new address writes it to contact_email_verifications (one row
--     per org and kind), never to the settings table. The address in use
--     (if any) stays in use until the new one is confirmed.
--   * The server route then takes a fresh link for it (service_role only)
--     and emails it to the new address. Only the token's sha256 is stored;
--     the link works once and expires 7 days after it was sent.
--   * Opening the link shows a Confirm button (a GET never confirms, so a mail
--     scanner that opens links can't); Confirm moves the address into the
--     settings table and deletes the row.
--   * So every function that reads contact_email (reply-to in both outbox
--     takes, the officials notices, the contact shown on the public pages,
--     the switch-on checks) is UNCHANGED and only ever sees a confirmed
--     address, and a sign-up switch can't be turned on without one.
--
-- WHY THE TOKEN IS MINTED IN A SECOND, SERVICE-ROLE CALL: the admin's browser
-- may call contact_verify_begin directly. If begin returned the token, an
-- admin could confirm an address they can't read. begin records the request
-- (member + feature + Elite, rate limits); contact_verify_take — service_role
-- only, called by the route right after — mints the token and returns it to
-- the server, which emails it. take only acts on a request made in the last
-- 5 minutes that hasn't been sent.
--
-- RESEND: begin with no address re-requests the waiting one (a new link; the
-- old link stops working). At most one send a minute and 5 a day (UTC) per
-- league and kind, so the button can't be used to flood an address.
--
-- REPLACES set_volunteer_contact_email (0120) and set_official_signup_contact
-- (0124) — both wrote the address straight into the settings table, which is
-- exactly what this closes. They are DROPPED; removing an address is
-- contact_email_remove.
--
-- EXISTING ADDRESSES (2026-11-09: two rows, both the "SRALL" test org, both
-- switches on): each is moved to a waiting row with no link sent, the
-- settings address is cleared and the switch turned OFF. Resend sends the
-- first link. The real league has no row in either table.
--
-- LOCKS when applied: ACCESS EXCLUSIVE on the new table; SHARE ROW EXCLUSIVE
-- on profiles and auth.users (its foreign keys); ROW EXCLUSIVE on
-- volunteer_settings and official_signup_settings (the update of existing
-- rows) — a few rows, well under a second.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The waiting addresses
-- ────────────────────────────────────────────────────────────────────────────
create table public.contact_email_verifications (
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('volunteers', 'official_signup')),
  email        text not null check (
                 length(email) <= 254
                 and email ~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$'),
  token_hash   text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz,
  sent_at      timestamptz,
  expires_at   timestamptz,
  send_day     date,
  send_count   integer not null default 0 check (send_count between 0 and 100),
  created_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (owner_id, kind),
  constraint contact_email_verifications_link_whole
    check ((token_hash is null) = (expires_at is null))
);

comment on table public.contact_email_verifications is
  'A league contact address waiting to be confirmed (0126). Written only by '
  'the 0126 functions; no role may read or write it directly.';

alter table public.contact_email_verifications enable row level security;
revoke all on table public.contact_email_verifications from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Helpers (callable by no role)
-- ────────────────────────────────────────────────────────────────────────────
-- Member → kind → feature switch → (when p_need_elite) Elite. The kind IS the
-- org_features name.
create or replace function public.contact_verify_gate(p_org_id uuid, p_kind text, p_need_elite boolean)
returns void
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan text;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('volunteers', 'official_signup') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if not public.org_feature_on(p_org_id, p_kind) then
    raise exception 'feature_off' using errcode = 'P0001';
  end if;
  if p_need_elite then
    select p.plan into v_plan from public.profiles p where p.id = p_org_id;
    if v_plan is distinct from 'elite' then raise exception 'plan_required' using errcode = 'P0001'; end if;
  end if;
end;
$$;

-- The confirmed address and switch for one org and kind.
create or replace function public.contact_verify_current(p_org_id uuid, p_kind text, out contact text, out switch_on boolean)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_kind = 'volunteers' then
    select s.contact_email, s.link_enabled into contact, switch_on
      from public.volunteer_settings s where s.owner_id = p_org_id;
  else
    select s.contact_email, s.enabled into contact, switch_on
      from public.official_signup_settings s where s.owner_id = p_org_id;
  end if;
  switch_on := coalesce(switch_on, false);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Admin functions (authenticated)
-- ────────────────────────────────────────────────────────────────────────────
-- Ask for a confirmation link. p_email = the new address, or null/blank to
-- resend for the address already waiting. Writes no token: the route calls
-- contact_verify_take next. Statuses: requested / already_confirmed; raises
-- invalid_email, no_pending, too_soon, too_many.
create or replace function public.contact_verify_begin(p_org_id uuid, p_kind text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email   text := nullif(btrim(coalesce(p_email, '')), '');
  v_row     public.contact_email_verifications%rowtype;
  v_current text;
  v_on      boolean;
  v_today   date := (now() at time zone 'utc')::date;
begin
  perform public.contact_verify_gate(p_org_id, p_kind, true);
  -- One request at a time per org and kind.
  perform pg_advisory_xact_lock(hashtextextended('contact_verify:' || p_org_id::text || ':' || p_kind, 0));

  select * into v_row from public.contact_email_verifications v
   where v.owner_id = p_org_id and v.kind = p_kind for update;

  if v_email is null then
    if v_row.owner_id is null then raise exception 'no_pending' using errcode = 'P0001'; end if;
    v_email := v_row.email;
  elsif length(v_email) > 254
     or v_email !~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  select c.contact, c.switch_on into v_current, v_on from public.contact_verify_current(p_org_id, p_kind) c;
  if v_current is not null and lower(v_current) = lower(v_email) then
    -- Already the confirmed address: nothing to send, and any other waiting
    -- address is dropped (the admin went back to the one in use).
    delete from public.contact_email_verifications where owner_id = p_org_id and kind = p_kind;
    return jsonb_build_object('status', 'already_confirmed', 'email', v_current);
  end if;

  if v_row.sent_at is not null and v_row.sent_at > now() - interval '60 seconds' then
    raise exception 'too_soon' using errcode = 'P0001';
  end if;
  if v_row.send_day = v_today and v_row.send_count >= 5 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;

  insert into public.contact_email_verifications
    (owner_id, kind, email, token_hash, requested_at, sent_at, expires_at, send_day, send_count, created_by, updated_at)
  values (p_org_id, p_kind, v_email, null, now(), null, null, v_today, 1, auth.uid(), now())
  on conflict (owner_id, kind) do update
     set email = excluded.email,
         token_hash = null,          -- the previous link stops working now
         requested_at = now(),
         sent_at = null,
         expires_at = null,
         send_count = case when contact_email_verifications.send_day = v_today
                           then contact_email_verifications.send_count + 1 else 1 end,
         send_day = v_today,
         created_by = auth.uid(),
         updated_at = now();

  return jsonb_build_object('status', 'requested', 'email', v_email);
end;
$$;

-- What the card shows: the confirmed address, the switch, and the waiting
-- address (never its token).
create or replace function public.contact_verify_state(p_org_id uuid, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.contact_email_verifications%rowtype;
  v_current text;
  v_on boolean;
begin
  perform public.contact_verify_gate(p_org_id, p_kind, false);
  select c.contact, c.switch_on into v_current, v_on from public.contact_verify_current(p_org_id, p_kind) c;
  select * into v_row from public.contact_email_verifications v where v.owner_id = p_org_id and v.kind = p_kind;
  return jsonb_build_object(
    'contact_email', v_current,
    'switch_on', v_on,
    'pending', case when v_row.owner_id is null then null else jsonb_build_object(
      'email', v_row.email,
      'sent_at', v_row.sent_at,
      'expires_at', v_row.expires_at,
      'expired', v_row.expires_at is not null and v_row.expires_at <= now(),
      'resend_after', case when v_row.sent_at is null then null else v_row.sent_at + interval '60 seconds' end,
      'sends_left_today', case when v_row.send_day = (now() at time zone 'utc')::date
                               then greatest(0, 5 - v_row.send_count) else 5 end
    ) end);
end;
$$;

-- Remove: 'pending' cancels the waiting address (its link stops working);
-- 'contact' clears the confirmed address — refused while the switch is on.
create or replace function public.contact_email_remove(p_org_id uuid, p_kind text, p_what text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_on boolean;
begin
  perform public.contact_verify_gate(p_org_id, p_kind, false);
  if p_what = 'pending' then
    delete from public.contact_email_verifications where owner_id = p_org_id and kind = p_kind;
    return jsonb_build_object('status', 'removed', 'what', 'pending');
  elsif p_what = 'contact' then
    if p_kind = 'volunteers' then
      select s.link_enabled into v_on from public.volunteer_settings s where s.owner_id = p_org_id for update;
      if coalesce(v_on, false) then raise exception 'contact_required' using errcode = 'P0001'; end if;
      update public.volunteer_settings set contact_email = null, updated_at = now(), updated_by = auth.uid()
       where owner_id = p_org_id;
    else
      select s.enabled into v_on from public.official_signup_settings s where s.owner_id = p_org_id for update;
      if coalesce(v_on, false) then raise exception 'contact_required' using errcode = 'P0001'; end if;
      update public.official_signup_settings set contact_email = null, updated_at = now(), updated_by = auth.uid()
       where owner_id = p_org_id;
    end if;
    return jsonb_build_object('status', 'removed', 'what', 'contact');
  end if;
  raise exception 'invalid_argument' using errcode = '22023';
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Server functions (service_role)
-- ────────────────────────────────────────────────────────────────────────────
-- Mint the link for a request begin made in the last 5 minutes and that
-- hasn't been sent. Returns the plain token ONCE (to the route, which emails
-- it); only its sha256 is stored.
create or replace function public.contact_verify_take(p_org_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.contact_email_verifications%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into v_row from public.contact_email_verifications v
   where v.owner_id = p_org_id and v.kind = p_kind
     and v.sent_at is null and v.requested_at > now() - interval '5 minutes'
   for update;
  if v_row.owner_id is null then
    return jsonb_build_object('status', 'nothing');
  end if;
  update public.contact_email_verifications
     set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
         sent_at = now(),
         expires_at = now() + interval '7 days',
         updated_at = now()
   where owner_id = p_org_id and kind = p_kind;
  return jsonb_build_object(
    'status', 'ok',
    'kind', p_kind,
    'email', v_row.email,
    'token', v_token,
    'league_name', (select p.org_name from public.profiles p where p.id = p_org_id));
end;
$$;

-- The confirm page's read: what the link is for. Never consumes it.
-- unknown (bad shape, no such link, used, cancelled, or the feature off) /
-- expired / ok.
create or replace function public.contact_verify_peek(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.contact_email_verifications%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select * into v_row from public.contact_email_verifications v
   where v.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_row.owner_id is null or not public.org_feature_on(v_row.owner_id, v_row.kind) then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'kind', v_row.kind,
      'league_name', (select p.org_name from public.profiles p where p.id = v_row.owner_id));
  end if;
  return jsonb_build_object('status', 'ok', 'kind', v_row.kind, 'email', v_row.email,
    'league_name', (select p.org_name from public.profiles p where p.id = v_row.owner_id));
end;
$$;

-- Confirm: the address becomes the league contact and the link is used up.
-- Same statuses as peek, plus confirmed.
create or replace function public.contact_verify_confirm(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.contact_email_verifications%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select * into v_row from public.contact_email_verifications v
   where v.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   for update;
  if v_row.owner_id is null or not public.org_feature_on(v_row.owner_id, v_row.kind) then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'kind', v_row.kind,
      'league_name', (select p.org_name from public.profiles p where p.id = v_row.owner_id));
  end if;

  if v_row.kind = 'volunteers' then
    insert into public.volunteer_settings (owner_id, contact_email, updated_by)
    values (v_row.owner_id, v_row.email, v_row.created_by)
    on conflict (owner_id) do update
       set contact_email = excluded.contact_email, updated_at = now(), updated_by = excluded.updated_by;
  else
    insert into public.official_signup_settings (owner_id, contact_email, updated_by)
    values (v_row.owner_id, v_row.email, v_row.created_by)
    on conflict (owner_id) do update
       set contact_email = excluded.contact_email, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  delete from public.contact_email_verifications where owner_id = v_row.owner_id and kind = v_row.kind;

  return jsonb_build_object('status', 'confirmed', 'kind', v_row.kind, 'email', v_row.email,
    'league_name', (select p.org_name from public.profiles p where p.id = v_row.owner_id));
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. The old direct writers go
-- ────────────────────────────────────────────────────────────────────────────
drop function public.set_volunteer_contact_email(uuid, text);
drop function public.set_official_signup_contact(uuid, text);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Addresses typed before this migration wait for confirmation
-- ────────────────────────────────────────────────────────────────────────────
insert into public.contact_email_verifications (owner_id, kind, email, created_by)
select s.owner_id, 'volunteers', s.contact_email, s.updated_by
  from public.volunteer_settings s where s.contact_email is not null;
insert into public.contact_email_verifications (owner_id, kind, email, created_by)
select s.owner_id, 'official_signup', s.contact_email,
       (select u.id from auth.users u where u.id = s.updated_by)
  from public.official_signup_settings s where s.contact_email is not null;
update public.volunteer_settings
   set link_enabled = false, contact_email = null, updated_at = now()
 where contact_email is not null;
update public.official_signup_settings
   set enabled = false, contact_email = null, updated_at = now()
 where contact_email is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Privileges
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.contact_verify_gate(uuid, text, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.contact_verify_current(uuid, text)       from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.contact_verify_begin(uuid, text, text)   from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.contact_verify_state(uuid, text)         from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.contact_email_remove(uuid, text, text)   from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.contact_verify_take(uuid, text)          from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.contact_verify_peek(text)                from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.contact_verify_confirm(text)             from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.contact_verify_begin(uuid, text, text) to authenticated;
grant execute on function public.contact_verify_state(uuid, text)       to authenticated;
grant execute on function public.contact_email_remove(uuid, text, text) to authenticated;
grant execute on function public.contact_verify_take(uuid, text)        to service_role;
grant execute on function public.contact_verify_peek(text)              to service_role;
grant execute on function public.contact_verify_confirm(text)           to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Verify (or the whole migration rolls back)
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  f text;
  r text;
  v_auth text[] := array['public.contact_verify_begin(uuid, text, text)', 'public.contact_verify_state(uuid, text)',
                         'public.contact_email_remove(uuid, text, text)'];
  v_svc  text[] := array['public.contact_verify_take(uuid, text)', 'public.contact_verify_peek(text)',
                         'public.contact_verify_confirm(text)'];
  v_none text[] := array['public.contact_verify_gate(uuid, text, boolean)', 'public.contact_verify_current(uuid, text)'];
begin
  foreach f in array v_auth || v_svc || v_none loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') <>
         ((r = 'authenticated' and f = any(v_auth)) or (r = 'service_role' and f = any(v_svc))) then
        raise exception '0126 verify: % EXECUTE on % is wrong', r, f;
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('set_volunteer_contact_email', 'set_official_signup_contact')) then
    raise exception '0126 verify: an old contact writer still exists';
  end if;
  foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
    if has_table_privilege(r, 'public.contact_email_verifications', 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception '0126 verify: % has a privilege on contact_email_verifications', r;
    end if;
  end loop;
  if exists (select 1 from public.volunteer_settings where contact_email is not null)
     or exists (select 1 from public.official_signup_settings where contact_email is not null) then
    raise exception '0126 verify: an unconfirmed address is still in use';
  end if;
end
$v$;

-- 0120 — Volunteer sign-ups, foundation (2026-11-08, branch
-- feat/volunteers-foundation). Nothing here is visible to a league until its
-- row in org_features is switched on, and nothing here writes a game, a
-- division or a season row.
--
-- WHAT.
--   1. `org_features` — the per-org feature switch. NO role holds any
--      privilege on it; Whit turns a feature on in the SQL editor (postgres).
--      This migration inserts NO rows: every org, the real league included,
--      starts with the feature off. Read by `org_feature_on`, which no role
--      may call — only the SECURITY DEFINER functions below reach it.
--   2. `volunteer_settings` — one row per org: the sign-up link's token, its
--      on/off, and the league's CONTACT EMAIL (the reply-to of every
--      volunteer email). A CHECK refuses an enabled link with no contact
--      email, and nothing ever falls back to `profiles.email`. Authenticated
--      members may SELECT their org's row; every write goes through
--      `set_volunteer_contact_email` / `set_volunteer_link` /
--      `reset_volunteer_link`.
--   3. `volunteers` — one row per (org, email). Moved here from 0121 (the plan
--      had it there) because the outbox references it. No role holds any
--      privilege; it is empty until 0121's claim function writes it.
--   4. `volunteer_outbox` — every volunteer email, queued by the database and
--      sent by a server route (`/api/volunteers/outbox/drain`, Vercel Cron +
--      pings). It is also the email log. It holds NO address and NO name: the
--      recipient is read from `volunteers` when the row is taken, and a CHECK
--      refuses a payload carrying an email or name key. `game_moved` rows
--      share a `coalesce_key` (the claim) and only the newest pending one is
--      sent; older ones become `superseded`.
--   5. `volunteer_rate_events` — hashed (sha256 + server salt) IP / email
--      keys for 0121's rate limits. Pruned at 23 HOURS by every outbox take,
--      so with a 5-minute cron no row outlives 24 hours (privacy policy §8:
--      "kept up to 24 hours"). Rate windows must therefore be 23 hours or
--      shorter.
--   6. `volunteer_outbox_take` / `volunteer_outbox_finish` — service_role
--      only. Take: prune, put back rows stuck in `sending` for 10 minutes,
--      supersede older `game_moved` rows, fail rows whose org has the feature
--      off or no contact email, then claim up to N due rows with FOR UPDATE
--      SKIP LOCKED and mark them `sending` — so two drains running at once
--      never send one row twice. Finish acts only on a row still `sending`.
--      service_role holds NO table privilege: these two functions are its
--      only door (stricter than the plan, which granted SELECT/UPDATE).
--   7. THE ARCHIVE WIPE — `wipe_volunteer_data_on_archive`, an AFTER UPDATE
--      OF archived_at trigger on `leagues`, firing only when archived_at goes
--      from NULL to set. It deletes the season's outbox rows, then every
--      volunteer of the org nothing references any more. SECURITY DEFINER on
--      purpose — archiving is a BROWSER update by an authenticated member,
--      who holds no DELETE on these tables; as INVOKER the archive itself
--      would fail. (It is not one of the 0098/0110 guard triggers, which must
--      stay INVOKER because they decide by current_user; this one decides
--      nothing.) Un-archiving (`restore_season`) restores nothing. 0121
--      re-creates this function to delete claims, roles and goals too.
--
-- GATES. Every admin function: `is_org_member` → the switch (`feature_off`)
-- → Elite (`plan_required`) for anything that turns access ON; turning the
-- link OFF needs member + switch only. `is_org_member` is the admin gate
-- because every member is an admin today (CLAUDE.md).
--
-- LOCKS when applied (well under a second): SHARE ROW EXCLUSIVE on `leagues`
-- (CREATE TRIGGER, and the outbox's season FK) and on `profiles` (four FKs) —
-- writes to both wait, reads don't. Nothing on games, divisions or teams.
--
-- Refusals (raised; nothing written): not_authorized, feature_off,
-- plan_required, invalid_email, contact_required, invalid_argument, no_link.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The feature switch
-- ────────────────────────────────────────────────────────────────────────────
create table public.org_features (
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  feature    text not null check (feature in ('volunteers')),
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, feature)
);

comment on table public.org_features is
  'Per-org feature switches. No role holds any privilege: set in the SQL editor '
  'only. Read through org_feature_on (callable by no role).';

alter table public.org_features enable row level security;
revoke all on table public.org_features from public, anon, authenticated, service_role, dashboard_readonly;

create or replace function public.org_feature_on(p_owner_id uuid, p_feature text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- Callable by no role; the SECURITY DEFINER functions reach it as their
  -- owner. Absent row = off.
  select coalesce((select f.enabled from public.org_features f
                    where f.owner_id = p_owner_id and f.feature = p_feature), false);
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Settings: link + contact email
-- ────────────────────────────────────────────────────────────────────────────
create table public.volunteer_settings (
  owner_id         uuid primary key references public.profiles(id) on delete cascade,
  link_token       text not null unique
                     default encode(extensions.gen_random_bytes(32), 'hex')
                     check (link_token ~ '^[0-9a-f]{64}$'),
  link_enabled     boolean not null default false,
  -- The reply-to of every volunteer email. Shape only (one @, no spaces,
  -- quotes, angle brackets, commas or control characters — so it can never
  -- carry a second header or a second address), at most 254 characters.
  contact_email    text
                     check (contact_email is null or (
                       length(contact_email) <= 254
                       and contact_email ~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$')),
  token_changed_at timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  constraint volunteer_settings_link_needs_contact
    check (not link_enabled or contact_email is not null)
);

comment on table public.volunteer_settings is
  'One row per org: the volunteer sign-up link (token, on/off) and the league '
  'contact email used as reply-to. Written only by the 0120 functions.';

alter table public.volunteer_settings enable row level security;

create policy "Org members can read their volunteer settings"
  on public.volunteer_settings
  for select
  to authenticated
  using (public.is_org_member(owner_id));

revoke all on table public.volunteer_settings from public, anon, authenticated, service_role, dashboard_readonly;
grant select on table public.volunteer_settings to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Volunteers (written from 0121 on)
-- ────────────────────────────────────────────────────────────────────────────
create table public.volunteers (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  email_lc           text not null
                       check (email_lc = lower(btrim(email_lc))
                              and length(email_lc) <= 254
                              and email_lc ~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$'),
  first_initial      text not null check (first_initial ~ '^[A-Za-z]$'),
  last_name          text not null
                       check (length(btrim(last_name)) between 1 and 60
                              and last_name !~ '[[:cntrl:]<>]'),
  family_id          uuid references public.volunteers(id) on delete set null,
  adult_confirmed_at timestamptz not null,
  created_at         timestamptz not null default now(),
  unique (owner_id, email_lc)
);

comment on table public.volunteers is
  'One row per (org, email). Volunteer personal data: read and written ONLY '
  'through SECURITY DEFINER functions; no role holds any privilege. Deleted by '
  'the archive wipe once nothing references the row.';

alter table public.volunteers enable row level security;
revoke all on table public.volunteers from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. The outbox (and email log)
-- ────────────────────────────────────────────────────────────────────────────
create table public.volunteer_outbox (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  season_id       uuid not null references public.leagues(id) on delete cascade,
  volunteer_id    uuid not null references public.volunteers(id) on delete cascade,
  kind            text not null check (kind in (
                    'signup_confirmed', 'manage_link', 'canceled_by_volunteer',
                    'switched', 'admin_assigned', 'admin_canceled',
                    'game_moved', 'rained_out', 'makeup_set', 'back_on',
                    'spot_lost', 'shift_canceled', 'reminder', 'nudge')),
  -- Ids, dates and times only. Never an address or a name: the CHECK refuses
  -- the obvious keys, and sim:volunteer-leaks (0121) scans every writer.
  payload         jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(payload) = 'object'
                           and not (payload ?| array['email', 'email_lc', 'to',
                                                     'first_initial', 'last_name', 'name'])),
  -- Rows sharing a key are one email: only the newest pending row is sent
  -- (game_moved: the claim id).
  coalesce_key    text,
  status          text not null default 'pending'
                    check (status in ('pending', 'sending', 'sent', 'failed', 'superseded')),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at       timestamptz,
  sent_at         timestamptz,
  resend_id       text check (resend_id is null or length(resend_id) <= 100),
  error           text check (error is null or length(error) <= 500),
  created_at      timestamptz not null default now()
);

create index volunteer_outbox_due_idx
  on public.volunteer_outbox (next_attempt_at, id)
  where status in ('pending', 'sending');
create index volunteer_outbox_coalesce_idx
  on public.volunteer_outbox (coalesce_key, created_at)
  where status = 'pending' and coalesce_key is not null;
create index volunteer_outbox_season_idx on public.volunteer_outbox (season_id);
create index volunteer_outbox_volunteer_idx on public.volunteer_outbox (volunteer_id);

comment on table public.volunteer_outbox is
  'Every volunteer email, queued in the database and sent by the drain route; '
  'also the email log. No address, no name. service_role reaches it only '
  'through volunteer_outbox_take / volunteer_outbox_finish.';

alter table public.volunteer_outbox enable row level security;
revoke all on table public.volunteer_outbox from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Rate-limit events (hashed keys; pruned at 23 hours)
-- ────────────────────────────────────────────────────────────────────────────
create table public.volunteer_rate_events (
  id       bigint generated always as identity primary key,
  kind     text not null check (kind in ('claim_ip', 'claim_email', 'email_sent')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  at       timestamptz not null default now()
);

create index volunteer_rate_events_key_idx on public.volunteer_rate_events (kind, key_hash, at);
create index volunteer_rate_events_at_idx on public.volunteer_rate_events (at);

alter table public.volunteer_rate_events enable row level security;
revoke all on table public.volunteer_rate_events from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Admin functions
-- ────────────────────────────────────────────────────────────────────────────
-- What the Settings card shows. A member of an org with the feature OFF gets
-- {feature: false} and nothing else — the card is not rendered.
create or replace function public.volunteer_admin_state(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_row  public.volunteer_settings%rowtype;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(p_org_id, 'volunteers') then
    return jsonb_build_object('feature', false);
  end if;

  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  select * into v_row from public.volunteer_settings s where s.owner_id = p_org_id;

  return jsonb_build_object(
    'feature', true,
    'elite', coalesce(v_plan = 'elite', false),
    'settings', case when v_row.owner_id is null then null else jsonb_build_object(
      'link_token', v_row.link_token,
      'link_enabled', v_row.link_enabled,
      'contact_email', v_row.contact_email
    ) end
  );
end;
$$;

-- Set (or clear) the league contact email. Clearing is refused while the
-- link is on. NEVER defaults to the owner's email.
create or replace function public.set_volunteer_contact_email(p_org_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan    text;
  v_email   text := nullif(btrim(coalesce(p_email, '')), '');
  v_enabled boolean;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(p_org_id, 'volunteers') then
    raise exception 'feature_off' using errcode = 'P0001';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is distinct from 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  if v_email is not null and (
       length(v_email) > 254
       or v_email !~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$') then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  select s.link_enabled into v_enabled
    from public.volunteer_settings s where s.owner_id = p_org_id for update;
  if v_email is null and coalesce(v_enabled, false) then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;

  insert into public.volunteer_settings (owner_id, contact_email, updated_by)
  values (p_org_id, v_email, auth.uid())
  on conflict (owner_id) do update
     set contact_email = excluded.contact_email,
         updated_at = now(),
         updated_by = auth.uid();

  return jsonb_build_object('contact_email', v_email);
end;
$$;

-- Turn the sign-up link on or off. ON needs Elite AND a contact email; OFF
-- needs neither (it only removes access) and KEEPS the token.
create or replace function public.set_volunteer_link(p_org_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan    text;
  v_contact text;
  v_token   text;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if not public.org_feature_on(p_org_id, 'volunteers') then
    raise exception 'feature_off' using errcode = 'P0001';
  end if;

  if not p_enabled then
    update public.volunteer_settings
       set link_enabled = false, updated_at = now(), updated_by = auth.uid()
     where owner_id = p_org_id
    returning link_token into v_token;
    return jsonb_build_object('link_enabled', false, 'link_token', v_token);
  end if;

  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is distinct from 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  select s.contact_email into v_contact
    from public.volunteer_settings s where s.owner_id = p_org_id for update;
  if v_contact is null then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;

  update public.volunteer_settings
     set link_enabled = true, updated_at = now(), updated_by = auth.uid()
   where owner_id = p_org_id
  returning link_token into v_token;

  return jsonb_build_object('link_enabled', true, 'link_token', v_token);
end;
$$;

-- Replace the token. The old link stops answering in the same statement; the
-- on/off state is unchanged.
create or replace function public.reset_volunteer_link(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan    text;
  v_token   text;
  v_enabled boolean;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(p_org_id, 'volunteers') then
    raise exception 'feature_off' using errcode = 'P0001';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is distinct from 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  update public.volunteer_settings
     set link_token = encode(extensions.gen_random_bytes(32), 'hex'),
         token_changed_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where owner_id = p_org_id
  returning link_token, link_enabled into v_token, v_enabled;
  if not found then
    raise exception 'no_link' using errcode = 'P0002';
  end if;

  return jsonb_build_object('link_enabled', v_enabled, 'link_token', v_token);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. The drain's two functions (service_role only)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_outbox_take(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 100);
  v_rows  jsonb;
begin
  -- a. Rate-limit keys older than 23 hours go (privacy policy: up to 24h).
  delete from public.volunteer_rate_events where at < now() - interval '23 hours';

  -- b. A drain that died mid-send leaves rows `sending`; after 10 minutes
  --    they are due again. The send carries an idempotency key per row, so a
  --    row that did go out is not sent twice by the provider.
  update public.volunteer_outbox
     set status = 'pending', locked_at = null
   where status = 'sending' and locked_at < now() - interval '10 minutes';

  -- c. One email per coalesce key: every pending row older than the newest
  --    pending row with the same key is superseded.
  update public.volunteer_outbox o
     set status = 'superseded', error = 'superseded by a newer change'
   where o.status = 'pending'
     and o.coalesce_key is not null
     and exists (select 1 from public.volunteer_outbox n
                  where n.coalesce_key = o.coalesce_key
                    and n.status = 'pending'
                    and (n.created_at, n.id) > (o.created_at, o.id));

  -- d. Rows that must not be sent are failed, visibly, never silently kept.
  update public.volunteer_outbox o
     set status = 'failed', error = 'feature_off'
   where o.status = 'pending'
     and not public.org_feature_on(o.owner_id, 'volunteers');
  update public.volunteer_outbox o
     set status = 'failed', error = 'no_contact_email'
   where o.status = 'pending'
     and not exists (select 1 from public.volunteer_settings s
                      where s.owner_id = o.owner_id and s.contact_email is not null);

  -- e. Claim the due rows. SKIP LOCKED: a second drain running at the same
  --    time takes different rows or none.
  with due as (
    select o.id
      from public.volunteer_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
     order by o.next_attempt_at, o.id
     limit v_limit
       for update skip locked
  ), took as (
    update public.volunteer_outbox o
       set status = 'sending', locked_at = now(), attempts = o.attempts + 1
      from due
     where o.id = due.id
    returning o.id, o.owner_id, o.season_id, o.volunteer_id, o.kind, o.payload, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'kind', t.kind,
           'payload', t.payload,
           'attempts', t.attempts,
           'season_id', t.season_id,
           'to', v.email_lc,
           'league_name', p.org_name,
           'reply_to', s.contact_email
         ) order by t.id), '[]'::jsonb)
    into v_rows
    from took t
    join public.volunteers v on v.id = t.volunteer_id
    join public.profiles p on p.id = t.owner_id
    left join public.volunteer_settings s on s.owner_id = t.owner_id;

  return v_rows;
end;
$$;

-- Record a send's outcome. Acts ONLY on a row still `sending`, so a second
-- finish for the same row (or a finish after the 10-minute requeue) changes
-- nothing and says so.
create or replace function public.volunteer_outbox_finish(
  p_id        bigint,
  p_ok        boolean,
  p_resend_id text,
  p_error     text,
  p_retry     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
  v_status   text;
begin
  select o.attempts into v_attempts
    from public.volunteer_outbox o
   where o.id = p_id and o.status = 'sending'
     for update;
  if not found then
    return jsonb_build_object('updated', false);
  end if;

  if coalesce(p_ok, false) then
    update public.volunteer_outbox
       set status = 'sent', sent_at = now(), locked_at = null,
           resend_id = left(p_resend_id, 100), error = null
     where id = p_id;
    v_status := 'sent';
  elsif coalesce(p_retry, false) and v_attempts < 5 then
    update public.volunteer_outbox
       set status = 'pending', locked_at = null,
           next_attempt_at = now() + make_interval(mins => v_attempts * v_attempts),
           error = left(coalesce(p_error, 'send failed'), 500)
     where id = p_id;
    v_status := 'pending';
  else
    update public.volunteer_outbox
       set status = 'failed', locked_at = null,
           error = left(coalesce(p_error, 'send failed'), 500)
     where id = p_id;
    v_status := 'failed';
  end if;

  return jsonb_build_object('updated', true, 'status', v_status);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. The archive wipe
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.wipe_volunteer_data_on_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Fires only on NULL → set (the trigger's WHEN). Deletes the season's
  -- volunteer data, then every volunteer of the org nothing references.
  -- 0121 adds claims, roles and goals here.
  delete from public.volunteer_outbox where season_id = new.id;

  delete from public.volunteers v
   where v.owner_id = new.owner_id
     and not exists (select 1 from public.volunteer_outbox o where o.volunteer_id = v.id);

  return null;
end;
$$;

create trigger wipe_volunteer_data_on_archive
  after update of archived_at on public.leagues
  for each row
  when (old.archived_at is null and new.archived_at is not null)
  execute function public.wipe_volunteer_data_on_archive();

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Function privileges
-- ────────────────────────────────────────────────────────────────────────────
-- Revoke from PUBLIC and from each role (a role-level revoke alone is a silent
-- no-op while PUBLIC holds EXECUTE), then grant back exactly what is needed.
revoke execute on function public.org_feature_on(uuid, text)                     from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_admin_state(uuid)                    from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_volunteer_contact_email(uuid, text)        from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_volunteer_link(uuid, boolean)              from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.reset_volunteer_link(uuid)                     from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_outbox_take(integer)                 from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_outbox_finish(bigint, boolean, text, text, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.wipe_volunteer_data_on_archive()               from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.volunteer_admin_state(uuid)             to authenticated;
grant execute on function public.set_volunteer_contact_email(uuid, text) to authenticated;
grant execute on function public.set_volunteer_link(uuid, boolean)       to authenticated;
grant execute on function public.reset_volunteer_link(uuid)              to authenticated;
grant execute on function public.volunteer_outbox_take(integer)          to service_role;
grant execute on function public.volunteer_outbox_finish(bigint, boolean, text, text, boolean) to service_role;

-- Verify, or the whole migration rolls back.
do $v$
declare
  r text;
  f text;
  t text;
  p text;
begin
  foreach f in array array[
    'public.volunteer_admin_state(uuid)',
    'public.set_volunteer_contact_email(uuid, text)',
    'public.set_volunteer_link(uuid, boolean)',
    'public.reset_volunteer_link(uuid)'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0120 verify: authenticated cannot execute %', f;
    end if;
    foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0120 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.volunteer_outbox_take(integer)',
    'public.volunteer_outbox_finish(bigint, boolean, text, text, boolean)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0120 verify: service_role cannot execute %', f;
    end if;
    foreach r in array array['anon', 'authenticated', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0120 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.org_feature_on(uuid, text)',
    'public.wipe_volunteer_data_on_archive()'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0120 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach t in array array['org_features', 'volunteer_settings', 'volunteers',
                           'volunteer_outbox', 'volunteer_rate_events'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0120 verify: RLS off on %', t;
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        if has_table_privilege(r, 'public.' || t, p)
           and not (t = 'volunteer_settings' and r = 'authenticated' and p = 'SELECT') then
          raise exception '0120 verify: % holds % on %', r, p, t;
        end if;
      end loop;
    end loop;
  end loop;
  if not has_table_privilege('authenticated', 'public.volunteer_settings', 'SELECT') then
    raise exception '0120 verify: authenticated cannot read volunteer_settings';
  end if;

  if exists (select 1 from public.org_features) then
    raise exception '0120 verify: org_features is not empty';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgname = 'wipe_volunteer_data_on_archive'
                    and tgrelid = 'public.leagues'::regclass
                    and tgenabled = 'O') then
    raise exception '0120 verify: archive wipe trigger missing or disabled';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.wipe_volunteer_data_on_archive()'::regprocedure) then
    raise exception '0120 verify: wipe_volunteer_data_on_archive is not SECURITY DEFINER';
  end if;
end
$v$;

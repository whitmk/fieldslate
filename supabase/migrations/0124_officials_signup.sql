-- 0124 — Officials self-sign-up (2026-11-09, branch feat/officials-signup).
-- Plan: docs/plans/official-self-signup.md (decisions of 2026-11-09).
--
-- Rostered officials (`umpires`) claim open umpire spots through a PRIVATE
-- link (only its sha256 is stored). A claim runs the same checks auto-assign
-- runs and writes an ORDINARY game_umpires row, so pay, the pay report, the
-- officials pages and the volunteer tracker need no change. Behind the
-- per-org switch org_features 'official_signup' (no rows inserted here), Elite.
--
-- WHAT IT ADDS
--   1. org_features.feature may be 'official_signup'.
--   2. official_divisions — the divisions an official may work. NO ROWS = EVERY
--      division (decision 1, the availability-window rule). Honoured by the
--      claim, auto-assign (through insert_official_assignments) and, as a
--      warning, the manual picker.
--   3. official_signup_settings (per org): on/off and the officials contact
--      email — the reply-to of every officials email AND where the
--      coordinator's notices go. Never an account email.
--   4. official_signup_links (hash only; one current link per official),
--      official_self_claims (which assignments an official took through a
--      link, and whether the daily digest reported them), official_outbox.
--   5. official_block_reason — the eligibility rule auto-assign uses, as PURE
--      SQL. ONE RULE, TWO LANGUAGES, ONE TABLE: the OFFICIAL-BLOCK-TABLE in
--      scripts/sim/official-signup-sim.sql runs through this function and,
--      in sim:official-claim-rules, through src/lib/umpires/claim-rules.ts.
--   6. official_slot_problem — gathers an official's real rows and asks
--      official_block_reason; claims add: scheduled only, not started,
--      LOCKED division (decision 3), a real slot of the division.
--   7. The link's three public functions (service_role): the page, claim,
--      drop. Drops: only a spot the official took, only while the game is
--      MORE than 48 hours away (decision 6).
--   8. Admin functions (authenticated): state, contact, on/off, divisions,
--      "Copy new link" (decision 4), the help request.
--   9. insert_official_assignments — auto-assign's write, under the same
--      locks as a claim, re-checking every row; a row that no longer fits is
--      returned as skipped, never written (closes the auto-assign/claim race).
--  10. The drain (take/finish, service_role) and the daily digest queue
--      (decision 8: claims in one daily digest; each drop emails at once).
--  11. The archive wipe: links, self-claim marks and the outbox of the season
--      go; assignments stay.
--
-- LOCKS when applied: SHARE ROW EXCLUSIVE on umpires, divisions, leagues,
-- profiles, game_umpires and games (the new foreign keys — blocks WRITES to
-- them, not reads, for the statement); SHARE ROW EXCLUSIVE on leagues for the
-- trigger; ACCESS EXCLUSIVE on org_features (the CHECK swap; no app reads it
-- directly). Each is held only to the end of the migration's transaction.
--
-- Deploy order: apply 0124 BEFORE the code reaches main — auto-assign writes
-- through insert_official_assignments.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The switch
-- ────────────────────────────────────────────────────────────────────────────
alter table public.org_features drop constraint org_features_feature_check;
alter table public.org_features add constraint org_features_feature_check
  check (feature in ('volunteers', 'official_signup'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Tables
-- ────────────────────────────────────────────────────────────────────────────
create table public.official_divisions (
  umpire_id   uuid not null references public.umpires(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (umpire_id, division_id)
);
create index official_divisions_division_idx on public.official_divisions (division_id);

create table public.official_signup_settings (
  owner_id      uuid primary key references public.profiles(id) on delete cascade,
  enabled       boolean not null default false,
  contact_email text check (contact_email is null or (
                  length(contact_email) <= 254
                  and contact_email ~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null,
  constraint official_signup_settings_contact_when_on check (not enabled or contact_email is not null)
);

create table public.official_signup_links (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  umpire_id  uuid not null references public.umpires(id) on delete cascade,
  season_id  uuid not null references public.leagues(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index official_signup_links_current_uniq
  on public.official_signup_links (umpire_id) where revoked_at is null;
create index official_signup_links_season_idx on public.official_signup_links (season_id);

create table public.official_self_claims (
  game_umpire_id uuid primary key references public.game_umpires(id) on delete cascade,
  umpire_id      uuid not null references public.umpires(id) on delete cascade,
  season_id      uuid not null references public.leagues(id) on delete cascade,
  claimed_at     timestamptz not null default now(),
  reported_at    timestamptz
);
create index official_self_claims_season_idx on public.official_self_claims (season_id, reported_at);
create index official_self_claims_umpire_idx on public.official_self_claims (umpire_id, claimed_at);

create table public.official_outbox (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  season_id       uuid not null references public.leagues(id) on delete cascade,
  umpire_id       uuid references public.umpires(id) on delete cascade,
  kind            text not null check (kind in (
                    'help_request', 'claim_confirmed', 'drop_confirmed', 'drop_notice', 'claims_digest')),
  -- Ids, dates and roles only. Never an address or a name.
  payload         jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(payload) = 'object'
                           and not (payload ?| array['email', 'to', 'name', 'official_name', 'contact_email'])),
  status          text not null default 'pending'
                    check (status in ('pending', 'sending', 'sent', 'failed', 'superseded')),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at       timestamptz,
  sent_at         timestamptz,
  resend_id       text check (resend_id is null or length(resend_id) <= 100),
  error           text check (error is null or length(error) <= 500),
  created_at      timestamptz not null default now(),
  -- The official's own emails name an official; the coordinator's digest
  -- doesn't (it lists several).
  constraint official_outbox_umpire_when_needed check (
    (kind = 'claims_digest' and umpire_id is null) or (kind <> 'claims_digest' and umpire_id is not null))
);
create index official_outbox_due_idx on public.official_outbox (status, next_attempt_at);
create index official_outbox_season_idx on public.official_outbox (season_id);
create index official_outbox_umpire_idx on public.official_outbox (umpire_id, kind, created_at);

alter table public.official_divisions       enable row level security;
alter table public.official_signup_settings enable row level security;
alter table public.official_signup_links    enable row level security;
alter table public.official_self_claims     enable row level security;
alter table public.official_outbox          enable row level security;

revoke all on table public.official_divisions       from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on table public.official_signup_settings from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on table public.official_signup_links    from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on table public.official_self_claims     from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on table public.official_outbox          from public, anon, authenticated, service_role, dashboard_readonly;

-- Members read their officials' divisions (edit modal, picker) and which
-- assignments were self-claimed (the "Signed up" tag). Writes: functions only.
create policy "Org members can read official divisions"
  on public.official_divisions for select
  using (exists (select 1 from public.umpires u join public.leagues l on l.id = u.season_id
                  where u.id = official_divisions.umpire_id and public.is_org_member(l.owner_id)));
create policy "Org members can read self claims"
  on public.official_self_claims for select
  using (exists (select 1 from public.leagues l
                  where l.id = official_self_claims.season_id and public.is_org_member(l.owner_id)));
grant select on table public.official_divisions   to authenticated;
grant select on table public.official_self_claims to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Helpers (callable by no role)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.official_org_now(p_owner uuid)
returns timestamp
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- The league's wall clock (profiles.timezone), the house "today" rule.
  select (now() at time zone coalesce((select p.timezone from public.profiles p where p.id = p_owner),
                                      'America/Los_Angeles'))::timestamp;
$$;

create or replace function public.official_game_minutes(p_settings jsonb)
returns integer
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  -- Twin of auto-assign's gameDuration: a numeric game_duration, else 90.
  select case when jsonb_typeof(p_settings -> 'game_duration') = 'number'
              then (p_settings ->> 'game_duration')::numeric::integer else 90 end;
$$;

-- THE RULE. Inputs are what auto-assign has in memory for one candidate; the
-- order is auto-assign's pick order with the division rule after "already on
-- this game". Wall-clock timestamps throughout (0124 never reads an instant
-- in a zone). Twin: blockReason, src/lib/umpires/claim-rules.ts.
create or replace function public.official_block_reason(
  p_on_game              boolean,
  p_division_allowed     boolean,
  p_blackouts            date[],
  p_coaches              boolean,
  p_conflict_of_interest boolean,
  p_start                timestamp,
  p_minutes              integer,
  p_bookings             jsonb,   -- [{"start": "YYYY-MM-DDTHH:MI", "minutes": n}] — the official's other games
  p_windows              jsonb,   -- [{"day": "Sa", "start": "08:00", "end": "12:00"}]
  p_cap                  integer
)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_on_game, false) then 'already_on_game'
    when not coalesce(p_division_allowed, true) then 'division_not_allowed'
    when p_start::date = any (coalesce(p_blackouts, '{}'::date[])) then 'blackout'
    when coalesce(p_coaches, false) then 'coach_conflict'
    when coalesce(p_conflict_of_interest, false) then 'conflict_of_interest'
    when exists (
      select 1 from jsonb_array_elements(coalesce(p_bookings, '[]'::jsonb)) b
       where (b ->> 'start')::timestamp < p_start + make_interval(mins => p_minutes)
         and p_start < (b ->> 'start')::timestamp + make_interval(mins => (b ->> 'minutes')::integer)
    ) then 'time_conflict'
    when jsonb_array_length(coalesce(p_windows, '[]'::jsonb)) > 0 and not exists (
      select 1 from jsonb_array_elements(p_windows) w
       where w ->> 'day' = (array['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])[extract(isodow from p_start)::integer]
         and extract(hour from (w ->> 'start')::time) * 60 + extract(minute from (w ->> 'start')::time)
             <= extract(hour from p_start) * 60 + extract(minute from p_start)
         and extract(hour from p_start) * 60 + extract(minute from p_start) + p_minutes
             <= extract(hour from (w ->> 'end')::time) * 60 + extract(minute from (w ->> 'end')::time)
    ) then 'outside_availability'
    when coalesce(p_cap, 0) > 0 and (
      select count(*) from jsonb_array_elements(coalesce(p_bookings, '[]'::jsonb)) b
       where date_trunc('week', (b ->> 'start')::timestamp) = date_trunc('week', p_start)
    ) >= p_cap then 'over_weekly_limit'
    else null
  end;
$$;

-- The season's slot roles for a division: the first umpires_per_game season
-- roles by sort order (then name — auto-assign orders the same way).
create or replace function public.official_division_slots(p_season_id uuid, p_count integer)
returns table (role_id uuid, role_name text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.id, r.name
    from public.official_roles r
   where r.season_id = p_season_id
   order by r.sort_order, r.name
   limit greatest(coalesce(p_count, 0), 0);
$$;

-- Why this official can't take `p_role` on this game, or null. With
-- p_claim = true (a link claim) it also requires: a scheduled game that has
-- not started, a LOCKED division, and one of the division's real slots.
create or replace function public.official_slot_problem(
  p_umpire_id uuid,
  p_game_id   uuid,
  p_role      text,
  p_claim     boolean
)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_season    uuid;
  v_team      uuid;
  v_cap       integer;
  v_g_league  uuid;
  v_status    text;
  v_home      uuid;
  v_away      uuid;
  v_start     timestamp;
  v_div       uuid;
  v_locked    boolean;
  v_needed    integer;
  v_settings  jsonb;
  v_owner     uuid;
  v_minutes   integer;
begin
  select u.season_id, u.team_id, u.max_games_per_week into v_season, v_team, v_cap
    from public.umpires u where u.id = p_umpire_id;
  if v_season is null then return 'no_official'; end if;

  select g.league_id, g.status, g.home_team_id, g.away_team_id,
         (g.scheduled_at at time zone 'UTC')::timestamp, t.division_id
    into v_g_league, v_status, v_home, v_away, v_start, v_div
    from public.games g left join public.teams t on t.id = g.home_team_id
   where g.id = p_game_id;
  if v_g_league is null or v_g_league <> v_season then return 'no_game'; end if;

  select d.locked, d.umpires_per_game, d.settings into v_locked, v_needed, v_settings
    from public.divisions d where d.id = v_div;
  if v_div is null or coalesce(v_needed, 0) = 0 then return 'no_slot'; end if;

  if coalesce(p_claim, false) then
    select l.owner_id into v_owner from public.leagues l where l.id = v_season;
    if v_status <> 'scheduled' then return 'not_open'; end if;
    if v_start <= public.official_org_now(v_owner) then return 'started'; end if;
    if not coalesce(v_locked, false) then return 'unpublished'; end if;
    if not exists (select 1 from public.official_division_slots(v_season, v_needed) s where s.role_name = p_role) then
      return 'no_slot';
    end if;
  end if;

  if exists (select 1 from public.game_umpires gu where gu.game_id = p_game_id and gu.role = p_role)
     or (select count(*) from public.game_umpires gu where gu.game_id = p_game_id) >= v_needed then
    return 'slot_taken';
  end if;

  v_minutes := public.official_game_minutes(v_settings);

  return public.official_block_reason(
    exists (select 1 from public.game_umpires gu where gu.game_id = p_game_id and gu.umpire_id = p_umpire_id),
    not exists (select 1 from public.official_divisions od where od.umpire_id = p_umpire_id)
      or exists (select 1 from public.official_divisions od where od.umpire_id = p_umpire_id and od.division_id = v_div),
    (select coalesce(array_agg(b.date), '{}'::date[]) from public.official_blackouts b where b.umpire_id = p_umpire_id),
    v_team is not null and (v_team = v_home or v_team = v_away),
    exists (select 1 from public.official_conflicts c
             where c.umpire_id = p_umpire_id and (c.team_id = v_home or (v_away is not null and c.team_id = v_away))),
    v_start,
    v_minutes,
    (select coalesce(jsonb_agg(jsonb_build_object(
              'start', to_char((g2.scheduled_at at time zone 'UTC')::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
              'minutes', public.official_game_minutes(d2.settings))), '[]'::jsonb)
       from public.game_umpires gu2
       join public.games g2 on g2.id = gu2.game_id
       left join public.teams t2 on t2.id = g2.home_team_id
       left join public.divisions d2 on d2.id = t2.division_id
      where gu2.umpire_id = p_umpire_id and gu2.game_id <> p_game_id and g2.status <> 'cancelled'),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'day', a.day_of_week, 'start', to_char(a.start_time, 'HH24:MI'), 'end', to_char(a.end_time, 'HH24:MI'))), '[]'::jsonb)
       from public.official_availability a where a.umpire_id = p_umpire_id),
    v_cap
  );
end;
$$;

-- A game as the page and the emails show it. Never another official's name.
create or replace function public.official_game_json(p_game_id uuid, p_role text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'game_id', g.id,
           'start', to_char((g.scheduled_at at time zone 'UTC')::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
           'minutes', public.official_game_minutes(d.settings),
           'division', d.name,
           'home', ht.name,
           'away', coalesce(awt.name, g.external_team_name),
           'field', case when v.id is null then null
                         when loc.name is null then v.name else loc.name || ' — ' || v.name end,
           'role', p_role)
    from public.games g
    left join public.teams ht on ht.id = g.home_team_id
    left join public.teams awt on awt.id = g.away_team_id
    left join public.divisions d on d.id = ht.division_id
    left join public.venues v on v.id = g.venue_id
    left join public.locations loc on loc.id = v.location_id
   where g.id = p_game_id;
$$;

-- Every open slot this official may see: LOCKED divisions they may work,
-- scheduled games not yet started, slots nobody holds, games they aren't on.
-- `problem` is null when they can take it, else their own reason.
create or replace function public.official_open_spots(p_umpire_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with u as (
    select u.id, u.season_id, l.owner_id from public.umpires u join public.leagues l on l.id = u.season_id
     where u.id = p_umpire_id
  ), slots as (
    select g.id as game_id, s.role_id, s.role_name, (g.scheduled_at at time zone 'UTC')::timestamp as start_wall
      from u
      join public.games g on g.league_id = u.season_id and g.status = 'scheduled'
      join public.teams t on t.id = g.home_team_id
      join public.divisions d on d.id = t.division_id and d.locked and d.umpires_per_game > 0
      cross join lateral public.official_division_slots(u.season_id, d.umpires_per_game) s
     where (g.scheduled_at at time zone 'UTC')::timestamp > public.official_org_now(u.owner_id)
       and (not exists (select 1 from public.official_divisions od where od.umpire_id = u.id)
            or exists (select 1 from public.official_divisions od where od.umpire_id = u.id and od.division_id = d.id))
       and not exists (select 1 from public.game_umpires gu where gu.game_id = g.id and gu.role = s.role_name)
       and not exists (select 1 from public.game_umpires gu where gu.game_id = g.id and gu.umpire_id = u.id)
       and (select count(*) from public.game_umpires gu where gu.game_id = g.id) < d.umpires_per_game
  )
  select coalesce(jsonb_agg(public.official_game_json(s.game_id, s.role_name)
                            || jsonb_build_object('role_id', s.role_id,
                                                  'problem', public.official_slot_problem(p_umpire_id, s.game_id, s.role_name, true))
                            order by s.start_wall, s.role_name), '[]'::jsonb)
    from slots s;
$$;

-- The official a link belongs to, when every gate is open; else nothing.
-- A link never says WHY it doesn't work (switch off, plan, setting off,
-- archived season, revoked): the page reads "this link isn't working".
create or replace function public.official_link_resolve(p_token text)
returns table (umpire_id uuid, season_id uuid, owner_id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select k.umpire_id, k.season_id, l.owner_id
    from public.official_signup_links k
    join public.umpires u on u.id = k.umpire_id and u.season_id = k.season_id
    join public.leagues l on l.id = k.season_id and l.archived_at is null
    join public.profiles p on p.id = l.owner_id and p.plan = 'elite'
    join public.official_signup_settings s on s.owner_id = l.owner_id and s.enabled and s.contact_email is not null
   where p_token ~ '^[0-9a-f]{64}$'
     and k.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and k.revoked_at is null
     and public.org_feature_on(l.owner_id, 'official_signup');
$$;

-- Admin gate: the season's owner, or raise.
create or replace function public.official_signup_gate(p_season_id uuid, p_lock boolean)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner    uuid;
  v_archived timestamptz;
  v_plan     text;
begin
  if p_lock then
    select l.owner_id, l.archived_at into v_owner, v_archived from public.leagues l where l.id = p_season_id for share;
  else
    select l.owner_id, l.archived_at into v_owner, v_archived from public.leagues l where l.id = p_season_id;
  end if;
  if v_owner is null then raise exception 'season_not_found' using errcode = 'P0002'; end if;
  if not public.is_org_member(v_owner) then raise exception 'not_authorized' using errcode = '42501'; end if;
  if not public.org_feature_on(v_owner, 'official_signup') then raise exception 'feature_off' using errcode = 'P0001'; end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then raise exception 'plan_required' using errcode = 'P0001'; end if;
  if v_archived is not null then raise exception 'season_archived' using errcode = 'P0001'; end if;
  return v_owner;
end;
$$;

-- A fresh link for one official: revoke the current one, store the new hash,
-- return the plain token (it exists nowhere else).
create or replace function public.official_mint_link(p_umpire_id uuid, p_season_id uuid)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  update public.official_signup_links set revoked_at = now()
   where umpire_id = p_umpire_id and revoked_at is null;
  insert into public.official_signup_links (token_hash, umpire_id, season_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_umpire_id, p_season_id);
  return v_token;
end;
$$;

-- Officials with a usable email (the same shape rule as the contact email).
create or replace function public.official_email_ok(p_email text)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(length(btrim(p_email)) <= 254
         and btrim(p_email) ~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$', false);
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. The link's public functions (service_role; never raise for a refusal)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.official_signup_page(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ump    uuid;
  v_season uuid;
  v_owner  uuid;
  v_now    timestamp;
begin
  select r.umpire_id, r.season_id, r.owner_id into v_ump, v_season, v_owner
    from public.official_link_resolve(p_token) r;
  if v_ump is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  v_now := public.official_org_now(v_owner);

  return jsonb_build_object(
    'status', 'ok',
    'now', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI'),
    'official', (select jsonb_build_object('name', u.name, 'youth', u.designation = 'youth')
                   from public.umpires u where u.id = v_ump),
    'league_name', (select p.org_name from public.profiles p where p.id = v_owner),
    'season_name', (select l.name from public.leagues l where l.id = v_season),
    'contact_email', (select s.contact_email from public.official_signup_settings s where s.owner_id = v_owner),
    'mine', (select coalesce(jsonb_agg(public.official_game_json(gu.game_id, gu.role)
                      || jsonb_build_object(
                           'game_umpire_id', gu.id,
                           'self_claimed', sc.game_umpire_id is not null,
                           'can_drop', sc.game_umpire_id is not null
                                       and (g.scheduled_at at time zone 'UTC')::timestamp - v_now > interval '48 hours')
                      order by g.scheduled_at, gu.role), '[]'::jsonb)
               from public.game_umpires gu
               join public.games g on g.id = gu.game_id
               left join public.official_self_claims sc on sc.game_umpire_id = gu.id
              where gu.umpire_id = v_ump and g.status <> 'cancelled'
                and (g.scheduled_at at time zone 'UTC')::timestamp > v_now),
    'open', public.official_open_spots(v_ump)
  );
end;
$$;

create or replace function public.official_claim(p_token text, p_game_id uuid, p_role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ump     uuid;
  v_season  uuid;
  v_owner   uuid;
  v_role    text;
  v_problem text;
  v_gu      uuid;
begin
  select r.umpire_id, r.season_id, r.owner_id into v_ump, v_season, v_owner
    from public.official_link_resolve(p_token) r;
  if v_ump is null then return jsonb_build_object('status', 'unknown'); end if;

  select r.name into v_role from public.official_roles r where r.id = p_role_id and r.season_id = v_season;
  if v_role is null then return jsonb_build_object('status', 'no_slot'); end if;

  -- More than 30 claims in an hour through one link is not a person.
  if (select count(*) from public.official_self_claims sc
       where sc.umpire_id = v_ump and sc.claimed_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('status', 'too_many');
  end if;

  -- Lock order everywhere: the official, then the game (insert_official_assignments
  -- takes every official before any game).
  perform pg_advisory_xact_lock(hashtextextended('official-signup:official:' || v_ump::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('official-signup:game:' || p_game_id::text, 0));

  v_problem := public.official_slot_problem(v_ump, p_game_id, v_role, true);
  if v_problem is not null then
    return jsonb_build_object('status', v_problem);
  end if;

  begin
    insert into public.game_umpires (game_id, umpire_id, role, role_id)
    values (p_game_id, v_ump, v_role, p_role_id)
    returning id into v_gu;
  exception when unique_violation then
    return jsonb_build_object('status', 'just_taken');
  end;

  insert into public.official_self_claims (game_umpire_id, umpire_id, season_id) values (v_gu, v_ump, v_season);
  insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload)
  values (v_owner, v_season, v_ump, 'claim_confirmed',
          jsonb_build_object('game_id', p_game_id, 'role', v_role));

  return jsonb_build_object('status', 'claimed', 'game_umpire_id', v_gu);
end;
$$;

create or replace function public.official_drop(p_token text, p_game_umpire_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ump     uuid;
  v_season  uuid;
  v_owner   uuid;
  v_game    uuid;
  v_role    text;
  v_start   timestamp;
  v_self    boolean;
  v_contact text;
  v_n       integer;
begin
  select r.umpire_id, r.season_id, r.owner_id into v_ump, v_season, v_owner
    from public.official_link_resolve(p_token) r;
  if v_ump is null then return jsonb_build_object('status', 'unknown'); end if;
  select s.contact_email into v_contact from public.official_signup_settings s where s.owner_id = v_owner;

  perform pg_advisory_xact_lock(hashtextextended('official-signup:official:' || v_ump::text, 0));

  select gu.game_id, gu.role, (g.scheduled_at at time zone 'UTC')::timestamp,
         exists (select 1 from public.official_self_claims sc where sc.game_umpire_id = gu.id)
    into v_game, v_role, v_start, v_self
    from public.game_umpires gu join public.games g on g.id = gu.game_id
   where gu.id = p_game_umpire_id and gu.umpire_id = v_ump;
  if v_game is null then return jsonb_build_object('status', 'not_found'); end if;

  perform pg_advisory_xact_lock(hashtextextended('official-signup:game:' || v_game::text, 0));

  if not v_self then
    return jsonb_build_object('status', 'not_self_claimed', 'contact_email', v_contact);
  end if;
  -- Decision 6: strictly MORE than 48 hours ahead, league wall clock.
  if not (v_start - public.official_org_now(v_owner) > interval '48 hours') then
    return jsonb_build_object('status', 'change_closed', 'contact_email', v_contact);
  end if;

  delete from public.game_umpires where id = p_game_umpire_id and umpire_id = v_ump;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('status', 'not_found'); end if;

  insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload) values
    (v_owner, v_season, v_ump, 'drop_confirmed', jsonb_build_object('game_id', v_game, 'role', v_role)),
    (v_owner, v_season, v_ump, 'drop_notice',    jsonb_build_object('game_id', v_game, 'role', v_role));

  return jsonb_build_object('status', 'dropped');
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Admin functions (authenticated)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.official_signup_admin_state(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_on   boolean;
  v_mail text;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(p_org_id, 'official_signup') then
    return jsonb_build_object('feature', false);
  end if;
  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  select s.enabled, s.contact_email into v_on, v_mail from public.official_signup_settings s where s.owner_id = p_org_id;
  return jsonb_build_object('feature', true, 'elite', coalesce(v_plan = 'elite', false),
                            'enabled', coalesce(v_on, false), 'contact_email', v_mail);
end;
$$;

create or replace function public.set_official_signup_contact(p_org_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  text;
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_on    boolean;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(p_org_id, 'official_signup') then raise exception 'feature_off' using errcode = 'P0001'; end if;
  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is distinct from 'elite' then raise exception 'plan_required' using errcode = 'P0001'; end if;
  if v_email is not null and not public.official_email_ok(v_email) then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  select s.enabled into v_on from public.official_signup_settings s where s.owner_id = p_org_id for update;
  if v_email is null and coalesce(v_on, false) then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;
  insert into public.official_signup_settings (owner_id, contact_email, updated_by)
  values (p_org_id, v_email, auth.uid())
  on conflict (owner_id) do update
     set contact_email = excluded.contact_email, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('contact_email', v_email);
end;
$$;

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
  if coalesce(p_enabled, false) then
    select p.plan into v_plan from public.profiles p where p.id = p_org_id;
    if v_plan is distinct from 'elite' then raise exception 'plan_required' using errcode = 'P0001'; end if;
    select s.contact_email into v_mail from public.official_signup_settings s where s.owner_id = p_org_id for update;
    if v_mail is null then raise exception 'contact_required' using errcode = 'P0001'; end if;
  end if;
  insert into public.official_signup_settings (owner_id, enabled, updated_by)
  values (p_org_id, coalesce(p_enabled, false), auth.uid())
  on conflict (owner_id) do update
     set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('enabled', coalesce(p_enabled, false));
end;
$$;

-- The divisions an official may work. An empty list = every division.
create or replace function public.set_official_divisions(p_umpire_id uuid, p_division_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid;
  v_ids    uuid[] := coalesce(array(select distinct x from unnest(p_division_ids) x where x is not null), '{}'::uuid[]);
begin
  select u.season_id into v_season from public.umpires u where u.id = p_umpire_id for update;
  if v_season is null then raise exception 'official_not_found' using errcode = 'P0002'; end if;
  perform public.official_signup_gate(v_season, true);
  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from public.divisions d where d.id = x and d.league_id = v_season)) then
    raise exception 'division_not_in_season' using errcode = 'P0001';
  end if;
  delete from public.official_divisions where umpire_id = p_umpire_id and not (division_id = any (v_ids));
  insert into public.official_divisions (umpire_id, division_id)
  select p_umpire_id, x from unnest(v_ids) x
  on conflict do nothing;
  return jsonb_build_object('divisions', cardinality(v_ids));
end;
$$;

-- "Copy new link (the old one stops working)" (decision 4).
create or replace function public.official_issue_link(p_umpire_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid;
  v_owner  uuid;
begin
  select u.season_id into v_season from public.umpires u where u.id = p_umpire_id for update;
  if v_season is null then raise exception 'official_not_found' using errcode = 'P0002'; end if;
  v_owner := public.official_signup_gate(v_season, true);
  if not exists (select 1 from public.official_signup_settings s
                  where s.owner_id = v_owner and s.enabled and s.contact_email is not null) then
    raise exception 'signup_off' using errcode = 'P0001';
  end if;
  return jsonb_build_object('token', public.official_mint_link(p_umpire_id, v_season));
end;
$$;

-- "We need help": one email per chosen official, each with a FRESH link (the
-- old one stops working — the dialog says so). Officials without a usable
-- email, or emailed for help in the last 24 hours, are skipped and named.
create or replace function public.send_official_help_request(p_season_id uuid, p_umpire_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid;
  v_queued  integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  u         record;
  v_token   text;
begin
  v_owner := public.official_signup_gate(p_season_id, true);
  if not exists (select 1 from public.official_signup_settings s
                  where s.owner_id = v_owner and s.enabled and s.contact_email is not null) then
    raise exception 'signup_off' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_umpire_ids), 0) = 0 or cardinality(p_umpire_ids) > 200 then
    raise exception 'bad_selection' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_umpire_ids) x
              where not exists (select 1 from public.umpires uu where uu.id = x and uu.season_id = p_season_id)) then
    raise exception 'official_not_in_season' using errcode = 'P0001';
  end if;

  for u in
    select uu.id, uu.name, uu.email from public.umpires uu
     where uu.id = any (p_umpire_ids) order by uu.name, uu.id for update
  loop
    if not public.official_email_ok(u.email) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('umpire_id', u.id, 'name', u.name, 'reason', 'no_email'));
    elsif exists (select 1 from public.official_outbox o
                   where o.umpire_id = u.id and o.kind = 'help_request'
                     and o.status <> 'failed' and o.created_at > now() - interval '24 hours') then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('umpire_id', u.id, 'name', u.name, 'reason', 'recent'));
    else
      v_token := public.official_mint_link(u.id, p_season_id);
      insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload)
      values (v_owner, p_season_id, u.id, 'help_request', jsonb_build_object('token', v_token));
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object('queued', v_queued, 'skipped', v_skipped);
end;
$$;

-- Auto-assign's write. The engine picks in the browser; this re-checks every
-- row under the claim's locks (every official first, then every game, each in
-- id order) and writes only rows that still fit. A row that no longer fits is
-- returned in `skipped` with its reason — never written, never an error.
-- Member only (auto-assign runs for every league, switch or not).
create or replace function public.insert_official_assignments(p_season_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid;
  r         record;
  v_problem text;
  v_inserted integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  x         uuid;
begin
  select l.owner_id into v_owner from public.leagues l where l.id = p_season_id;
  if v_owner is null then raise exception 'season_not_found' using errcode = 'P0002'; end if;
  if not public.is_org_member(v_owner) then raise exception 'not_authorized' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'bad_rows' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e
              where not (e ? 'game_id' and e ? 'umpire_id' and e ? 'role')
                 or coalesce(btrim(e ->> 'role'), '') = ''
                 or not exists (select 1 from public.umpires u where u.id = (e ->> 'umpire_id')::uuid and u.season_id = p_season_id)
                 or not exists (select 1 from public.games g where g.id = (e ->> 'game_id')::uuid and g.league_id = p_season_id)) then
    raise exception 'row_not_in_season' using errcode = 'P0001';
  end if;

  for x in select distinct (e ->> 'umpire_id')::uuid from jsonb_array_elements(p_rows) e order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('official-signup:official:' || x::text, 0));
  end loop;
  for x in select distinct (e ->> 'game_id')::uuid from jsonb_array_elements(p_rows) e order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('official-signup:game:' || x::text, 0));
  end loop;

  for r in
    select (e ->> 'game_id')::uuid as game_id, (e ->> 'umpire_id')::uuid as umpire_id,
           e ->> 'role' as role, nullif(e ->> 'role_id', '')::uuid as role_id, ord
      from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
     order by ord
  loop
    v_problem := public.official_slot_problem(r.umpire_id, r.game_id, r.role, false);
    if v_problem is null then
      begin
        insert into public.game_umpires (game_id, umpire_id, role, role_id)
        values (r.game_id, r.umpire_id, r.role, r.role_id);
        v_inserted := v_inserted + 1;
      exception when unique_violation then
        v_problem := 'slot_taken';
      end;
    end if;
    if v_problem is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'game_id', r.game_id, 'umpire_id', r.umpire_id, 'role', r.role, 'reason', v_problem));
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. The drain and the daily digest (service_role)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.official_digest_queue()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
  s   record;
begin
  for s in
    select sc.season_id, l.owner_id, array_agg(sc.game_umpire_id order by sc.claimed_at) as ids
      from public.official_self_claims sc
      join public.leagues l on l.id = sc.season_id and l.archived_at is null
     where sc.reported_at is null
     group by sc.season_id, l.owner_id
  loop
    insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload)
    values (s.owner_id, s.season_id, null, 'claims_digest', jsonb_build_object('claim_ids', to_jsonb(s.ids)));
    update public.official_self_claims set reported_at = now() where game_umpire_id = any (s.ids);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('digests', v_n);
end;
$$;

create or replace function public.official_outbox_take(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 100);
  v_rows  jsonb;
begin
  -- A drain that died mid-send: due again after 10 minutes (the send's
  -- idempotency key stops a second delivery).
  update public.official_outbox set status = 'pending', locked_at = null
   where status = 'sending' and locked_at < now() - interval '10 minutes';

  -- Rows that must not be sent fail, visibly.
  update public.official_outbox o set status = 'failed', error = 'feature_off', payload = o.payload - 'token'
   where o.status = 'pending' and not public.org_feature_on(o.owner_id, 'official_signup');
  update public.official_outbox o set status = 'failed', error = 'no_contact_email', payload = o.payload - 'token'
   where o.status = 'pending'
     and not exists (select 1 from public.official_signup_settings s
                      where s.owner_id = o.owner_id and s.contact_email is not null);

  with due as (
    select o.id from public.official_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
     order by o.next_attempt_at, o.id
     limit v_limit
       for update skip locked
  ), took as (
    update public.official_outbox o
       set status = 'sending', locked_at = now(), attempts = o.attempts + 1
      from due where o.id = due.id
    returning o.id, o.owner_id, o.season_id, o.umpire_id, o.kind, o.payload, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'kind', t.kind,
           'payload', t.payload - 'token',
           'attempts', t.attempts,
           'to', case when t.kind in ('drop_notice', 'claims_digest') then s.contact_email else btrim(u.email) end,
           'league_name', p.org_name,
           'reply_to', s.contact_email,
           'season_name', l.name,
           'official_name', u.name,
           'youth', coalesce(u.designation = 'youth', false),
           'link_token', t.payload ->> 'token',
           'game', case when t.kind in ('claim_confirmed', 'drop_confirmed', 'drop_notice')
                        then public.official_game_json((t.payload ->> 'game_id')::uuid, t.payload ->> 'role') end,
           'spots', case when t.kind = 'help_request' then (
                      select coalesce(jsonb_agg(sp order by sp ->> 'start'), '[]'::jsonb)
                        from (select sp from jsonb_array_elements(public.official_open_spots(t.umpire_id)) sp
                               where sp -> 'problem' = 'null'::jsonb
                               order by sp ->> 'start' limit 20) q) end,
           'claims', case when t.kind = 'claims_digest' then (
                       select coalesce(jsonb_agg(public.official_game_json(gu.game_id, gu.role)
                                                 || jsonb_build_object('official_name', uu.name)
                                                 order by g.scheduled_at, uu.name), '[]'::jsonb)
                         from public.game_umpires gu
                         join public.games g on g.id = gu.game_id
                         join public.umpires uu on uu.id = gu.umpire_id
                        where gu.id in (select (jsonb_array_elements_text(t.payload -> 'claim_ids'))::uuid)) end
         ) order by t.id), '[]'::jsonb)
    into v_rows
    from took t
    join public.profiles p on p.id = t.owner_id
    join public.leagues l on l.id = t.season_id
    left join public.umpires u on u.id = t.umpire_id
    left join public.official_signup_settings s on s.owner_id = t.owner_id;

  return v_rows;
end;
$$;

-- Record a send's outcome; acts only on a row still `sending`. A finished
-- row no longer carries its link token.
create or replace function public.official_outbox_finish(
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
  select o.attempts into v_attempts from public.official_outbox o
   where o.id = p_id and o.status = 'sending' for update;
  if not found then return jsonb_build_object('updated', false); end if;

  if coalesce(p_ok, false) then
    update public.official_outbox
       set status = 'sent', sent_at = now(), locked_at = null, payload = payload - 'token',
           resend_id = left(p_resend_id, 100), error = null
     where id = p_id;
    v_status := 'sent';
  elsif coalesce(p_retry, false) and v_attempts < 5 then
    update public.official_outbox
       set status = 'pending', locked_at = null,
           next_attempt_at = now() + make_interval(mins => v_attempts * v_attempts),
           error = left(coalesce(p_error, 'send failed'), 500)
     where id = p_id;
    v_status := 'pending';
  else
    update public.official_outbox
       set status = 'failed', locked_at = null, payload = payload - 'token',
           error = left(coalesce(p_error, 'send failed'), 500)
     where id = p_id;
    v_status := 'failed';
  end if;
  return jsonb_build_object('updated', true, 'status', v_status);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. The archive wipe
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.wipe_official_signup_on_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- NULL → set only (the trigger's WHEN). Assignments stay (they are the
  -- league's officiating and pay record); the sign-up records go.
  delete from public.official_signup_links where season_id = new.id;
  delete from public.official_self_claims  where season_id = new.id;
  delete from public.official_outbox       where season_id = new.id;
  return null;
end;
$$;

create trigger wipe_official_signup_on_archive
  after update of archived_at on public.leagues
  for each row
  when (old.archived_at is null and new.archived_at is not null)
  execute function public.wipe_official_signup_on_archive();

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Function privileges (revoke from PUBLIC, then grant back — the house rule)
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.official_org_now(uuid)                                  from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_game_minutes(jsonb)                            from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_block_reason(boolean, boolean, date[], boolean, boolean, timestamp, integer, jsonb, jsonb, integer)
                                                                                           from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_division_slots(uuid, integer)                  from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_slot_problem(uuid, uuid, text, boolean)        from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_game_json(uuid, text)                          from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_open_spots(uuid)                               from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_link_resolve(text)                             from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_signup_gate(uuid, boolean)                     from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_mint_link(uuid, uuid)                          from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_email_ok(text)                                 from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_signup_page(text)                              from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_claim(text, uuid, uuid)                        from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_drop(text, uuid)                               from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_signup_admin_state(uuid)                       from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_official_signup_contact(uuid, text)                 from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_official_signup_enabled(uuid, boolean)              from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_official_divisions(uuid, uuid[])                    from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_issue_link(uuid)                               from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.send_official_help_request(uuid, uuid[])                from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.insert_official_assignments(uuid, jsonb)                from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_digest_queue()                                 from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_outbox_take(integer)                           from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.official_outbox_finish(bigint, boolean, text, text, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.wipe_official_signup_on_archive()                       from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.official_signup_admin_state(uuid)          to authenticated;
grant execute on function public.set_official_signup_contact(uuid, text)    to authenticated;
grant execute on function public.set_official_signup_enabled(uuid, boolean) to authenticated;
grant execute on function public.set_official_divisions(uuid, uuid[])       to authenticated;
grant execute on function public.official_issue_link(uuid)                  to authenticated;
grant execute on function public.send_official_help_request(uuid, uuid[])   to authenticated;
grant execute on function public.insert_official_assignments(uuid, jsonb)   to authenticated;
grant execute on function public.official_signup_page(text)                 to service_role;
grant execute on function public.official_claim(text, uuid, uuid)          to service_role;
grant execute on function public.official_drop(text, uuid)                  to service_role;
grant execute on function public.official_digest_queue()                    to service_role;
grant execute on function public.official_outbox_take(integer)              to service_role;
grant execute on function public.official_outbox_finish(bigint, boolean, text, text, boolean) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Verify (or the whole migration rolls back)
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  r text;
  f text;
  t text;
  p text;
begin
  foreach f in array array[
    'public.official_signup_admin_state(uuid)', 'public.set_official_signup_contact(uuid, text)',
    'public.set_official_signup_enabled(uuid, boolean)', 'public.set_official_divisions(uuid, uuid[])',
    'public.official_issue_link(uuid)', 'public.send_official_help_request(uuid, uuid[])',
    'public.insert_official_assignments(uuid, jsonb)'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0124 verify: authenticated cannot execute %', f;
    end if;
    foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception '0124 verify: % can execute %', r, f; end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.official_signup_page(text)', 'public.official_claim(text, uuid, uuid)', 'public.official_drop(text, uuid)',
    'public.official_digest_queue()', 'public.official_outbox_take(integer)',
    'public.official_outbox_finish(bigint, boolean, text, text, boolean)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0124 verify: service_role cannot execute %', f;
    end if;
    foreach r in array array['anon', 'authenticated', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception '0124 verify: % can execute %', r, f; end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.official_org_now(uuid)', 'public.official_game_minutes(jsonb)',
    'public.official_block_reason(boolean, boolean, date[], boolean, boolean, timestamp, integer, jsonb, jsonb, integer)',
    'public.official_division_slots(uuid, integer)', 'public.official_slot_problem(uuid, uuid, text, boolean)',
    'public.official_game_json(uuid, text)', 'public.official_open_spots(uuid)', 'public.official_link_resolve(text)',
    'public.official_signup_gate(uuid, boolean)', 'public.official_mint_link(uuid, uuid)', 'public.official_email_ok(text)',
    'public.wipe_official_signup_on_archive()'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception '0124 verify: % can execute %', r, f; end if;
    end loop;
  end loop;

  foreach t in array array['official_divisions', 'official_signup_settings', 'official_signup_links',
                           'official_self_claims', 'official_outbox'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0124 verify: RLS off on %', t;
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        if has_table_privilege(r, 'public.' || t, p)
           and not (r = 'authenticated' and p = 'SELECT' and t in ('official_divisions', 'official_self_claims')) then
          raise exception '0124 verify: % holds % on %', r, p, t;
        end if;
      end loop;
    end loop;
  end loop;

  if exists (select 1 from public.org_features where feature = 'official_signup') then
    raise exception '0124 verify: an org already has official_signup';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'wipe_official_signup_on_archive'
                  and tgrelid = 'public.leagues'::regclass and tgenabled = 'O') then
    raise exception '0124 verify: archive wipe trigger missing or disabled';
  end if;
end
$v$;

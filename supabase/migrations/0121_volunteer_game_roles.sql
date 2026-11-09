-- 0121 — Volunteer sign-ups: game roles and claims (2026-11-08, branch
-- feat/volunteer-game-roles). Built in parts, each with its proof (the
-- proof file is scripts/sim/volunteer-claims-sim.sql):
--   PART 1 (this commit): roles, role divisions, claims, the pure slot-rule
--          twins, role save/delete, the archive wipe extended to claims and
--          roles.
--   PART 2: the sign-up page read, claim, manage page, cancel (public, via
--          service_role only). Switching is CUT from v1 (decided
--          2026-11-08): a volunteer cancels, then signs up again.
--   PART 3: the games trigger and the regenerate reattach.
--   PART 4: the auto-archive hold-back read.
-- Nothing here writes a game, a division, a team or a season, and nothing is
-- visible to a league whose org_features switch is off.
--
-- WHAT (part 1).
--   1. `volunteer_roles` — admin-defined roles per SEASON (GameChanger, field
--      prep…): `per_game` (one set of spots per home game) or `per_team` (one
--      set per our team in the game), 1–10 spots, sign-ups on/off, counts
--      toward the family goal (0123). Name unique per season, trimmed and
--      case-insensitive. Authenticated members may SELECT their org's rows;
--      every write is a function below.
--   2. `volunteer_role_divisions` — the divisions a role applies to.
--   3. `volunteer_claims` — one row per spot taken. The spot is named by
--      game + role + team (per_team) + position; a PARTIAL UNIQUE INDEX on
--      active claims is the guard against two people taking one spot. Every
--      target FK is ON DELETE SET NULL so no path can silently destroy a
--      sign-up; a claim whose target vanished becomes `detached` (part 3).
--      `playoff_game_id` and `snack_shack_block_id` exist for later (playoffs,
--      0122) and are held NULL by a CHECK until then. No role holds any
--      privilege on claims — they name a volunteer.
--   4. Pure slot-rule twins of src/lib/volunteers/slots.ts, callable by no
--      role: `volunteer_slot_state`, `volunteer_slot_targets`,
--      `volunteer_claim_refusal`, `volunteer_change_allowed`. ONE RULE, TWO
--      LANGUAGES, ONE TABLE: the VSLOT / VCHANGE blocks in the proof file.
--   5. `save_volunteer_role` / `delete_volunteer_role` — each its own preview
--      (p_commit = false writes nothing). Lowering spots, removing a division
--      or deleting the role CANCELS the active claims it strands (the most
--      recently claimed spots above the new count go first — the spot numbers
--      are positions, so it is "position > spots") and queues one
--      `shift_canceled` email per claim. A role's kind can't change while it
--      has active claims (`kind_locked`).
--   6. `wipe_volunteer_data_on_archive` re-created: claims, roles and manage
--      links of the season go too, then volunteers nothing references
--      (0120's body plus three deletes).
--   7. A role may START up to 120 minutes before the game (`lead_minutes`,
--      default 0 — field prep at 8:15 for a 9:00 game). The spot ends at
--      game end. `volunteer_spot_start` (pure, callable by no role) is the
--      one definition of a spot's start, used by the claim cutoff, the
--      24-hour window and the overlap check — and pinned by the shared table.
--   8. `volunteer_manage_links` — one row per emailed manage link, holding
--      ONLY the sha256 of its token. Every confirmation email's link opens the
--      volunteer's page for that season; "send a fresh link" (admin, later)
--      revokes them all. No role holds any privilege.
--   9. `volunteer_outbox_finish` re-created (0120's body plus one line): a
--      row that is sent or finally failed loses `payload.manage_token`, so a
--      plain token lives in the database only until its email goes out.
--
-- GATES (every admin function): season exists → `is_org_member(owner)` →
-- switch (`feature_off`) → Elite (`plan_required`) → season not archived
-- (`season_archived`).
--
-- LOCKS when applied: SHARE ROW EXCLUSIVE on `leagues`, `divisions`, `teams`,
-- `games`, `playoff_games`, `snack_shack_blocks` and `profiles` (the new FKs)
-- — writes to those tables wait, reads don't, for well under a second.
--
-- Refusals (raised; nothing written): season_not_found, not_authorized,
-- feature_off, plan_required, season_archived, name_required, name_taken,
-- invalid_kind, invalid_spots, invalid_lead, division_not_in_season,
-- role_not_found, kind_locked. The public functions (part 2) never raise for
-- a refusal: they return {status: …} so the route can word it.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Roles
-- ────────────────────────────────────────────────────────────────────────────
create table public.volunteer_roles (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  season_id          uuid not null references public.leagues(id) on delete cascade,
  name               text not null check (length(btrim(name)) between 1 and 60 and name !~ '[[:cntrl:]]'),
  kind               text not null check (kind in ('per_game', 'per_team')),
  spots              smallint not null check (spots between 1 and 10),
  -- The spot starts this many minutes before the game; it ends at game end.
  lead_minutes       smallint not null default 0 check (lead_minutes between 0 and 120),
  signups_open       boolean not null default true,
  counts_toward_goal boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index volunteer_roles_season_name_uniq
  on public.volunteer_roles (season_id, lower(btrim(name)));
create index volunteer_roles_owner_idx on public.volunteer_roles (owner_id);

alter table public.volunteer_roles enable row level security;

create policy "Org members can read their volunteer roles"
  on public.volunteer_roles for select to authenticated
  using (public.is_org_member(owner_id));

revoke all on table public.volunteer_roles from public, anon, authenticated, service_role, dashboard_readonly;
grant select on table public.volunteer_roles to authenticated;

create table public.volunteer_role_divisions (
  role_id     uuid not null references public.volunteer_roles(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete cascade,
  primary key (role_id, division_id)
);

create index volunteer_role_divisions_division_idx on public.volunteer_role_divisions (division_id);

alter table public.volunteer_role_divisions enable row level security;

create policy "Org members can read their volunteer role divisions"
  on public.volunteer_role_divisions for select to authenticated
  using (exists (select 1 from public.volunteer_roles r
                  where r.id = role_id and public.is_org_member(r.owner_id)));

revoke all on table public.volunteer_role_divisions from public, anon, authenticated, service_role, dashboard_readonly;
grant select on table public.volunteer_role_divisions to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Claims
-- ────────────────────────────────────────────────────────────────────────────
create table public.volunteer_claims (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references public.profiles(id) on delete cascade,
  season_id            uuid not null references public.leagues(id) on delete cascade,
  volunteer_id         uuid not null references public.volunteers(id) on delete cascade,
  -- The team the volunteer's family belongs to (the sign-up form's Team).
  family_team_id       uuid references public.teams(id) on delete set null,
  game_id              uuid references public.games(id) on delete set null,
  playoff_game_id      uuid references public.playoff_games(id) on delete set null,
  snack_shack_block_id uuid references public.snack_shack_blocks(id) on delete set null,
  role_id              uuid references public.volunteer_roles(id) on delete set null,
  -- per_team roles: the team in the game the spot is for.
  for_team_id          uuid references public.teams(id) on delete set null,
  position             smallint not null check (position between 1 and 10),
  status               text not null default 'active'
                         check (status in ('active', 'canceled', 'detached')),
  no_show              boolean not null default false,
  last_reminded_at     timestamptz,
  -- What the spot was when its target vanished (part 3): date, start, team,
  -- role. Never a name.
  detached_from        jsonb check (detached_from is null or jsonb_typeof(detached_from) = 'object'),
  created_by           text not null check (created_by in ('volunteer', 'admin')),
  created_at           timestamptz not null default now(),
  canceled_at          timestamptz,
  constraint volunteer_claims_one_target
    check (status = 'detached'
           or num_nonnulls(game_id, playoff_game_id, snack_shack_block_id) = 1),
  -- v1: game spots only. 0122 drops this for snack shack shifts; playoff
  -- spots come later.
  constraint volunteer_claims_v1_games_only
    check (playoff_game_id is null and snack_shack_block_id is null),
  constraint volunteer_claims_game_has_role
    check (game_id is null or role_id is not null or status <> 'active')
);

-- One person per spot. for_team_id is NULL on per_game spots, so it is
-- coalesced to the nil uuid — two NULLs would otherwise never collide.
create unique index volunteer_claims_one_per_game_spot
  on public.volunteer_claims (game_id, role_id,
                              coalesce(for_team_id, '00000000-0000-0000-0000-000000000000'::uuid),
                              position)
  where status = 'active' and game_id is not null;

create index volunteer_claims_season_idx on public.volunteer_claims (season_id);
create index volunteer_claims_volunteer_idx on public.volunteer_claims (volunteer_id);
create index volunteer_claims_role_idx on public.volunteer_claims (role_id);
create index volunteer_claims_game_idx on public.volunteer_claims (game_id);

alter table public.volunteer_claims enable row level security;
revoke all on table public.volunteer_claims from public, anon, authenticated, service_role, dashboard_readonly;

-- One row per emailed manage link: the sha256 of its token, never the token.
create table public.volunteer_manage_links (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  season_id    uuid not null references public.leagues(id) on delete cascade,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create index volunteer_manage_links_volunteer_idx on public.volunteer_manage_links (volunteer_id, season_id);

alter table public.volunteer_manage_links enable row level security;
revoke all on table public.volunteer_manage_links from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Pure slot-rule twins (callable by no role)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_slot_state(p_status text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  -- Twin of gameSlotState (slots.ts).
  select case p_status
           when 'scheduled' then 'open'
           when 'reschedule_pending' then 'may_move'
           when 'cancelled' then 'rained_out'
           when 'pending_interleague' then 'none'
           else 'closed'
         end;
$$;

create or replace function public.volunteer_slot_targets(
  p_status      text,
  p_kind        text,
  p_interleague boolean,
  p_is_away     boolean,
  p_home_team   uuid,
  p_away_team   uuid,
  p_home_div    uuid,
  p_away_div    uuid,
  p_role_divs   uuid[],
  p_spots       integer
)
returns table (for_team_id uuid, division_id uuid, spots integer, ord integer)
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  -- Twin of slotTargets (slots.ts) for ONE role: none on a game whose status
  -- carries no spots (pending_interleague). The home team's set comes
  -- first (ord 1), then the away team's (ord 2). Spots are clamped to 0–10;
  -- a role with 0 spots carries none.
  select t.for_team_id, t.division_id, least(greatest(coalesce(p_spots, 0), 0), 10), t.ord
    from (
      select null::uuid as for_team_id, p_home_div as division_id, 1 as ord
       where p_kind = 'per_game'
         and p_home_team is not null
         and not (p_interleague and p_is_away)
         and p_home_div = any (p_role_divs)
      union all
      select p_home_team, p_home_div, 1
       where p_kind = 'per_team'
         and p_home_team is not null
         and p_home_div = any (p_role_divs)
      union all
      select p_away_team, p_away_div, 2
       where p_kind = 'per_team'
         and not p_interleague
         and p_home_team is not null
         and p_away_team is not null
         and p_away_div = any (p_role_divs)
    ) t
   where least(greatest(coalesce(p_spots, 0), 0), 10) > 0
     and public.volunteer_slot_state(p_status) <> 'none';
$$;

create or replace function public.volunteer_claim_refusal(
  p_status          text,
  p_start           timestamp,
  p_now             timestamp,
  p_has_target      boolean,
  p_division_locked boolean,
  p_signups_open    boolean
)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  -- Twin of claimRefusal (slots.ts): NULL = the spot may be taken. Same
  -- order: no_slot → rained_out → closed → past → unpublished →
  -- signups_closed. Times are WALL CLOCK in the league's zone.
  select case
           when not coalesce(p_has_target, false) or p_start is null
                or public.volunteer_slot_state(p_status) = 'none' then 'no_slot'
           when public.volunteer_slot_state(p_status) = 'rained_out' then 'rained_out'
           when public.volunteer_slot_state(p_status) = 'closed' then 'closed'
           when p_now is null or p_start <= p_now then 'past'
           when not coalesce(p_division_locked, false) then 'unpublished'
           when not coalesce(p_signups_open, false) then 'signups_closed'
           else null
         end;
$$;

create or replace function public.volunteer_spot_start(p_game_start timestamp, p_lead_minutes integer)
returns timestamp
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  -- Twin of spotStartWall (slots.ts): the game's start minus the role's lead,
  -- the lead clamped to 0–120 whole minutes.
  select p_game_start - make_interval(mins => least(greatest(coalesce(p_lead_minutes, 0), 0), 120));
$$;

create or replace function public.volunteer_change_allowed(p_start timestamp, p_now timestamp)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  -- Twin of canChangeSpot (slots.ts): strictly more than 24 hours ahead,
  -- wall-clock arithmetic.
  select coalesce(p_start - p_now > interval '24 hours', false);
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Admin gate (callable by no role)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_admin_gate(p_season_id uuid, p_lock boolean)
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
  -- Shared by every admin function: returns the season's owner or raises.
  -- p_lock takes the season row FOR SHARE so a concurrent archive waits.
  if p_lock then
    select l.owner_id, l.archived_at into v_owner, v_archived
      from public.leagues l where l.id = p_season_id for share;
  else
    select l.owner_id, l.archived_at into v_owner, v_archived
      from public.leagues l where l.id = p_season_id;
  end if;
  if v_owner is null then
    raise exception 'season_not_found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_owner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.org_feature_on(v_owner, 'volunteers') then
    raise exception 'feature_off' using errcode = 'P0001';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;
  if v_archived is not null then
    raise exception 'season_archived' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

-- Cancels the given active claims and queues one shift_canceled email each.
-- Callable by no role.
create or replace function public.volunteer_cancel_claims(p_claim_ids uuid[], p_role_label text)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  with c as (
    update public.volunteer_claims
       set status = 'canceled', canceled_at = now()
     where id = any (p_claim_ids) and status = 'active'
    returning id, owner_id, season_id, volunteer_id, game_id
  ), q as (
    insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
    select c.owner_id, c.season_id, c.volunteer_id, 'shift_canceled',
           jsonb_build_object('claim_id', c.id, 'game_id', c.game_id, 'role_label', p_role_label)
      from c
    returning 1
  )
  select count(*) into v_n from q;
  return v_n;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Role save / delete
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.save_volunteer_role(
  p_role_id      uuid,
  p_season_id    uuid,
  p_name         text,
  p_kind         text,
  p_spots        integer,
  p_lead_minutes integer,
  p_signups_open boolean,
  p_counts       boolean,
  p_division_ids uuid[],
  p_commit       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner     uuid;
  v_name      text := btrim(coalesce(p_name, ''));
  v_divs      uuid[] := coalesce((select array_agg(distinct d) from unnest(coalesce(p_division_ids, '{}')) d where d is not null), '{}');
  v_role      public.volunteer_roles%rowtype;
  v_cancel    uuid[] := '{}';
  v_id        uuid;
  v_canceled  integer := 0;
begin
  v_owner := public.volunteer_admin_gate(p_season_id, true);

  if v_name = '' or length(v_name) > 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('per_game', 'per_team') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if p_spots is null or p_spots < 1 or p_spots > 10 then
    raise exception 'invalid_spots' using errcode = 'P0001';
  end if;
  if p_lead_minutes is null or p_lead_minutes < 0 or p_lead_minutes > 120 then
    raise exception 'invalid_lead' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_divs) d
              where not exists (select 1 from public.divisions x where x.id = d and x.league_id = p_season_id)) then
    raise exception 'division_not_in_season' using errcode = 'P0001';
  end if;

  if p_role_id is not null then
    select * into v_role from public.volunteer_roles r
     where r.id = p_role_id and r.season_id = p_season_id for update;
    if v_role.id is null then
      raise exception 'role_not_found' using errcode = 'P0002';
    end if;
  end if;

  if exists (select 1 from public.volunteer_roles r
              where r.season_id = p_season_id
                and lower(btrim(r.name)) = lower(v_name)
                and r.id is distinct from p_role_id) then
    raise exception 'name_taken' using errcode = 'P0001';
  end if;

  if v_role.id is not null then
    if v_role.kind <> p_kind and exists (
         select 1 from public.volunteer_claims c where c.role_id = v_role.id and c.status = 'active') then
      raise exception 'kind_locked' using errcode = 'P0001';
    end if;
    -- The claims this change strands: spots above the new count, or games in
    -- a division the role no longer covers. A per_team spot belongs to its
    -- team's division; a per_game spot to the home team's.
    select coalesce(array_agg(c.id), '{}') into v_cancel
      from public.volunteer_claims c
      left join public.games g on g.id = c.game_id
      left join public.teams t on t.id = coalesce(c.for_team_id, g.home_team_id)
     where c.role_id = v_role.id and c.status = 'active'
       and (c.position > p_spots or t.division_id is null or not (t.division_id = any (v_divs)));
  end if;

  if not coalesce(p_commit, false) then
    return jsonb_build_object('committed', false, 'claims_to_cancel', coalesce(array_length(v_cancel, 1), 0));
  end if;

  if v_role.id is null then
    insert into public.volunteer_roles (owner_id, season_id, name, kind, spots, lead_minutes, signups_open,
                                        counts_toward_goal, sort_order)
    values (v_owner, p_season_id, v_name, p_kind, p_spots, p_lead_minutes, coalesce(p_signups_open, true), coalesce(p_counts, true),
            coalesce((select max(r.sort_order) + 1 from public.volunteer_roles r where r.season_id = p_season_id), 0))
    returning id into v_id;
  else
    v_canceled := public.volunteer_cancel_claims(v_cancel, v_role.name);
    update public.volunteer_roles
       set name = v_name, kind = p_kind, spots = p_spots, lead_minutes = p_lead_minutes,
           signups_open = coalesce(p_signups_open, true),
           counts_toward_goal = coalesce(p_counts, true), updated_at = now()
     where id = v_role.id;
    v_id := v_role.id;
    delete from public.volunteer_role_divisions rd where rd.role_id = v_id and not (rd.division_id = any (v_divs));
  end if;

  insert into public.volunteer_role_divisions (role_id, division_id)
  select v_id, d from unnest(v_divs) d
  on conflict do nothing;

  return jsonb_build_object('committed', true, 'role_id', v_id, 'claims_canceled', v_canceled);
end;
$$;

create or replace function public.delete_volunteer_role(p_role_id uuid, p_commit boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role     public.volunteer_roles%rowtype;
  v_cancel   uuid[];
  v_canceled integer;
begin
  select * into v_role from public.volunteer_roles r where r.id = p_role_id;
  if v_role.id is null then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  perform public.volunteer_admin_gate(v_role.season_id, true);
  select * into v_role from public.volunteer_roles r where r.id = p_role_id for update;

  select coalesce(array_agg(c.id), '{}') into v_cancel
    from public.volunteer_claims c where c.role_id = p_role_id and c.status = 'active';

  if not coalesce(p_commit, false) then
    return jsonb_build_object('committed', false, 'claims_to_cancel', coalesce(array_length(v_cancel, 1), 0));
  end if;

  v_canceled := public.volunteer_cancel_claims(v_cancel, v_role.name);
  delete from public.volunteer_roles where id = p_role_id;
  return jsonb_build_object('committed', true, 'claims_canceled', v_canceled);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. The archive wipe, extended (0120's body + claims and roles)
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
  delete from public.volunteer_outbox where season_id = new.id;
  delete from public.volunteer_claims where season_id = new.id;
  delete from public.volunteer_manage_links where season_id = new.id;
  delete from public.volunteer_roles where season_id = new.id;

  delete from public.volunteers v
   where v.owner_id = new.owner_id
     and not exists (select 1 from public.volunteer_outbox o where o.volunteer_id = v.id)
     and not exists (select 1 from public.volunteer_claims c where c.volunteer_id = v.id)
     and not exists (select 1 from public.volunteer_manage_links k where k.volunteer_id = v.id);

  return null;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. PART 2 — public sign-up (service_role only, through the server routes)
-- ────────────────────────────────────────────────────────────────────────────
-- Every public function takes the link token, answers {status: …} and never
-- raises for a refusal. Statuses, in the order they are decided:
--   unknown (no such link, or off — an off link and a reset one look alike),
--   plan (the league is not on Elite), then the call's own answers. The
--   feature switch off reads as `unknown` too, so a link never reveals that
--   the feature exists. Turnstile and the IP are the route's job; the route
--   passes sha256(salt + IP) and sha256(salt + email) for the rate limits.
-- Names and emails NEVER appear in what the sign-up page reads: a filled spot
-- is a count.

-- A game's length in minutes from its division's settings: the TypeScript
-- durationFromSettings rule (a positive number, else 90). Callable by no role.
create or replace function public.volunteer_game_minutes(p_settings jsonb)
returns numeric
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case
           when coalesce(p_settings ->> 'game_duration', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                and (p_settings ->> 'game_duration')::numeric > 0
             then (p_settings ->> 'game_duration')::numeric
           else 90
         end;
$$;

-- The league behind a sign-up link, or NULL when the link is unknown, off,
-- or the feature switch is off. Callable by no role.
create or replace function public.volunteer_link_owner(p_token text)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.owner_id
    from public.volunteer_settings s
   where p_token ~ '^[0-9a-f]{64}$'
     and s.link_token = p_token
     and s.link_enabled
     and public.org_feature_on(s.owner_id, 'volunteers');
$$;

-- The league's wall clock now, in its own timezone. Callable by no role.
create or replace function public.volunteer_org_now(p_owner uuid)
returns timestamp
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (now() at time zone coalesce((select p.timezone from public.profiles p where p.id = p_owner), 'America/Los_Angeles'))::timestamp;
$$;

-- Every open-or-closed spot set of a season, for the page and the claim:
-- one row per (game, role, team) the shared rules allow, with its times and
-- how many spots are taken. Callable by no role.
create or replace function public.volunteer_season_spots(p_season_id uuid)
returns table (
  game_id uuid, role_id uuid, for_team_id uuid, division_id uuid, spots integer,
  game_status text, spot_start timestamp, game_start timestamp, game_end timestamp,
  taken integer, signups_open boolean, division_locked boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with r as (
    select vr.id, vr.kind, vr.spots, vr.lead_minutes, vr.signups_open,
           coalesce(array_agg(rd.division_id) filter (where rd.division_id is not null), '{}') as divs
      from public.volunteer_roles vr
      left join public.volunteer_role_divisions rd on rd.role_id = vr.id
     where vr.season_id = p_season_id
     group by vr.id
  ), g as (
    select g.id, g.status, g.is_away, g.interleague_org_id, g.home_team_id, g.away_team_id,
           (g.scheduled_at at time zone 'UTC')::timestamp as start_wall,
           ht.division_id as home_div, at.division_id as away_div, hd.settings as home_settings
      from public.games g
      join public.teams ht on ht.id = g.home_team_id
      left join public.teams at on at.id = g.away_team_id
      join public.divisions hd on hd.id = ht.division_id
     where g.league_id = p_season_id
  )
  select g.id, r.id, t.for_team_id, t.division_id, t.spots, g.status,
         public.volunteer_spot_start(g.start_wall, r.lead_minutes),
         g.start_wall,
         g.start_wall + make_interval(secs => public.volunteer_game_minutes(g.home_settings) * 60),
         (select count(*)::integer from public.volunteer_claims c
           where c.game_id = g.id and c.role_id = r.id and c.status = 'active'
             and c.for_team_id is not distinct from t.for_team_id),
         r.signups_open,
         coalesce((select d.locked from public.divisions d where d.id = t.division_id), false)
    from g
    cross join r
    cross join lateral public.volunteer_slot_targets(g.status, r.kind, g.interleague_org_id is not null, g.is_away,
                                                     g.home_team_id, g.away_team_id, g.home_div, g.away_div,
                                                     r.divs, r.spots) t;
$$;

-- The sign-up page. p_season_id picks a season when the league has more than
-- one open (a picker, like the public schedule); NULL means the first.
create or replace function public.volunteer_signup_page(p_token text, p_season_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid := public.volunteer_link_owner(p_token);
  v_plan    text;
  v_now     timestamp;
  v_today   date;
  v_seasons jsonb;
  v_season  uuid;
begin
  if v_owner is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    return jsonb_build_object('status', 'plan');
  end if;
  v_now := public.volunteer_org_now(v_owner);
  v_today := v_now::date;

  -- Open seasons: unarchived, at least one locked division, not past the
  -- schedule's own 7-day window.
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.start_date nulls last, l.name, l.id), '[]')
    into v_seasons
    from public.leagues l
   where l.owner_id = v_owner and l.archived_at is null
     and exists (select 1 from public.divisions d where d.league_id = l.id and d.locked)
     and (public.season_last_day(l.id) is null or public.season_last_day(l.id) + 7 >= v_today);

  select (e ->> 'id')::uuid into v_season
    from jsonb_array_elements(v_seasons) e
   where p_season_id is null or (e ->> 'id')::uuid = p_season_id
   limit 1;

  return jsonb_build_object(
    'status', 'ok',
    'league_name', (select p.org_name from public.profiles p where p.id = v_owner),
    'now', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI'),
    'seasons', v_seasons,
    'season_id', v_season,
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.name,
               'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name, t.id)
                                    from public.teams t where t.division_id = d.id), '[]'))
             order by d.priority, d.name, d.id)
        from public.divisions d where d.league_id = v_season and d.locked), '[]'),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', vr.id, 'name', vr.name, 'kind', vr.kind) order by vr.sort_order, vr.name)
        from public.volunteer_roles vr where vr.season_id = v_season and vr.signups_open), '[]'),
    'spots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'game_id', sp.game_id, 'role_id', sp.role_id, 'for_team_id', sp.for_team_id,
               'for_team_name', ft.name, 'division_id', sp.division_id, 'division_name', d.name,
               'home_team_name', ht.name, 'away_team_name', coalesce(at.name, g.external_team_name),
               'interleague', g.interleague_org_id is not null, 'is_away', g.is_away,
               'field', v.name, 'park', loc.name,
               'start', to_char(sp.spot_start, 'YYYY-MM-DD"T"HH24:MI'),
               'game_start', to_char(sp.game_start, 'YYYY-MM-DD"T"HH24:MI'),
               'end', to_char(sp.game_end, 'YYYY-MM-DD"T"HH24:MI'),
               'state', public.volunteer_slot_state(sp.game_status),
               'spots', sp.spots, 'taken', least(sp.taken, sp.spots))
             order by sp.spot_start, d.name, ht.name, sp.role_id, ft.name nulls first)
        from public.volunteer_season_spots(v_season) sp
        join public.games g on g.id = sp.game_id
        join public.teams ht on ht.id = g.home_team_id
        left join public.teams at on at.id = g.away_team_id
        left join public.teams ft on ft.id = sp.for_team_id
        join public.divisions d on d.id = sp.division_id
        left join public.venues v on v.id = g.venue_id
        left join public.locations loc on loc.id = v.location_id
       where sp.division_locked and sp.signups_open and sp.spot_start > v_now), '[]')
  );
end;
$$;

-- Take a spot. Returns {status: 'claimed', claim_id, position} or a refusal:
-- unknown, plan, invalid_input, rate_limited, wrong_team, no_slot,
-- rained_out, closed, past, unpublished, signups_closed, already_signed_up,
-- overlap_confirm_needed (the warning names no spot — decided 2026-11-08),
-- just_taken.
create or replace function public.volunteer_claim(
  p_token           text,
  p_game_id         uuid,
  p_role_id         uuid,
  p_for_team_id     uuid,
  p_division_id     uuid,
  p_team_id         uuid,
  p_first_initial   text,
  p_last_name       text,
  p_email           text,
  p_adult           boolean,
  p_ip_hash         text,
  p_email_hash      text,
  p_confirm_overlap boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid := public.volunteer_link_owner(p_token);
  v_plan    text;
  v_initial text := upper(btrim(coalesce(p_first_initial, '')));
  v_last    text := btrim(coalesce(p_last_name, ''));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_now     timestamp;
  v_season  uuid;
  v_spot    record;
  v_why     text;
  v_vol     uuid;
  v_pos     integer;
  v_claim   uuid;
  v_token   text;
begin
  if v_owner is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    return jsonb_build_object('status', 'plan');
  end if;

  if v_initial !~ '^[A-Z]$'
     or length(v_last) not between 1 and 60 or v_last ~ '[[:cntrl:]<>]'
     or length(v_email) > 254
     or v_email !~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$'
     or not coalesce(p_adult, false)
     or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_email_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  -- Rate limits (windows ≤ 23 hours — the take prunes at 23). Every attempt
  -- that gets this far counts, refused or not.
  if (select count(*) from public.volunteer_rate_events e
       where e.kind = 'claim_ip' and e.key_hash = p_ip_hash and e.at > now() - interval '1 hour') >= 20
     or (select count(*) from public.volunteer_rate_events e
          where e.kind = 'claim_email' and e.key_hash = p_email_hash and e.at > now() - interval '23 hours') >= 10 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  insert into public.volunteer_rate_events (kind, key_hash) values ('claim_ip', p_ip_hash), ('claim_email', p_email_hash);

  -- The family's team: in that division, in a LOCKED division of the game's
  -- season, of this league.
  select g.league_id into v_season
    from public.games g join public.leagues l on l.id = g.league_id
   where g.id = p_game_id and l.owner_id = v_owner and l.archived_at is null
     for key share of g;
  if v_season is null then
    return jsonb_build_object('status', 'no_slot');
  end if;
  if not exists (select 1 from public.teams t join public.divisions d on d.id = t.division_id
                  where t.id = p_team_id and t.division_id = p_division_id
                    and d.league_id = v_season and d.locked) then
    return jsonb_build_object('status', 'wrong_team');
  end if;

  -- One spot set at a time: concurrent claims on it queue here.
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':' || coalesce(p_role_id::text, '') || ':'
                                                 || coalesce(p_for_team_id::text, ''), 121));

  v_now := public.volunteer_org_now(v_owner);
  select * into v_spot from public.volunteer_season_spots(v_season) sp
   where sp.game_id = p_game_id and sp.role_id = p_role_id
     and sp.for_team_id is not distinct from p_for_team_id;
  select g.status into v_why from public.games g where g.id = p_game_id;
  v_why := public.volunteer_claim_refusal(v_why, v_spot.spot_start, v_now, v_spot.game_id is not null,
                                          v_spot.division_locked, v_spot.signups_open);
  if v_why is not null then
    return jsonb_build_object('status', v_why);
  end if;

  select v.id into v_vol from public.volunteers v where v.owner_id = v_owner and v.email_lc = v_email;

  if v_vol is not null then
    if exists (select 1 from public.volunteer_claims c
                where c.volunteer_id = v_vol and c.status = 'active' and c.game_id = p_game_id
                  and c.role_id = p_role_id and c.for_team_id is not distinct from p_for_team_id) then
      return jsonb_build_object('status', 'already_signed_up');
    end if;
    -- Overlap: any active game spot of this email whose [start, end) meets
    -- the new one's. Answered generically; the reply names nothing.
    if not coalesce(p_confirm_overlap, false) and exists (
         select 1
           from public.volunteer_claims c
           join public.games g on g.id = c.game_id
           join public.volunteer_roles vr on vr.id = c.role_id
           join public.teams ht on ht.id = g.home_team_id
           join public.divisions hd on hd.id = ht.division_id
          where c.volunteer_id = v_vol and c.status = 'active'
            and public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes) < v_spot.game_end
            and v_spot.spot_start < (g.scheduled_at at time zone 'UTC')::timestamp
                                    + make_interval(secs => public.volunteer_game_minutes(hd.settings) * 60)) then
      return jsonb_build_object('status', 'overlap_confirm_needed');
    end if;
  end if;

  select min(n) into v_pos
    from generate_series(1, v_spot.spots) n
   where not exists (select 1 from public.volunteer_claims c
                      where c.game_id = p_game_id and c.role_id = p_role_id and c.status = 'active'
                        and c.for_team_id is not distinct from p_for_team_id and c.position = n);
  if v_pos is null then
    return jsonb_build_object('status', 'just_taken');
  end if;

  if v_vol is null then
    -- The first sign-up names the volunteer; a later one with the same email
    -- never renames them (identity is the email, never the name).
    insert into public.volunteers (owner_id, email_lc, first_initial, last_name, adult_confirmed_at)
    values (v_owner, v_email, v_initial, v_last, now())
    returning id into v_vol;
  else
    update public.volunteers set adult_confirmed_at = now() where id = v_vol;
  end if;

  begin
    insert into public.volunteer_claims (owner_id, season_id, volunteer_id, family_team_id, game_id, role_id,
                                         for_team_id, position, created_by)
    values (v_owner, v_season, v_vol, p_team_id, p_game_id, p_role_id, p_for_team_id, v_pos, 'volunteer')
    returning id into v_claim;
  exception when unique_violation then
    return jsonb_build_object('status', 'just_taken');
  end;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.volunteer_manage_links (token_hash, volunteer_id, season_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_vol, v_season);
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
  values (v_owner, v_season, v_vol, 'signup_confirmed',
          jsonb_build_object('claim_id', v_claim, 'manage_token', v_token));

  return jsonb_build_object('status', 'claimed', 'claim_id', v_claim, 'position', v_pos);
end;
$$;

-- The volunteer's own page. Statuses: unknown (no such link, revoked, the
-- season archived, or the feature off), plan, ok.
create or replace function public.volunteer_manage_page(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link  public.volunteer_manage_links%rowtype;
  v_owner uuid;
  v_plan  text;
  v_now   timestamp;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select k.* into v_link from public.volunteer_manage_links k
   where k.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and k.revoked_at is null;
  select l.owner_id into v_owner from public.leagues l where l.id = v_link.season_id and l.archived_at is null;
  if v_owner is null or not public.org_feature_on(v_owner, 'volunteers') then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    return jsonb_build_object('status', 'plan');
  end if;
  v_now := public.volunteer_org_now(v_owner);

  return (
    select jsonb_build_object(
      'status', 'ok',
      'league_name', (select p.org_name from public.profiles p where p.id = v_owner),
      'contact_email', (select s.contact_email from public.volunteer_settings s where s.owner_id = v_owner),
      'first_initial', v.first_initial, 'last_name', v.last_name,
      'claims', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'claim_id', c.id, 'role_name', vr.name, 'for_team_name', ft.name,
                 'family_team_name', fam.name, 'family_division_name', famd.name,
                 'home_team_name', ht.name, 'away_team_name', coalesce(at.name, g.external_team_name),
                 'interleague', g.interleague_org_id is not null, 'is_away', g.is_away,
                 'field', ve.name, 'park', loc.name,
                 'start', to_char(public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes), 'YYYY-MM-DD"T"HH24:MI'),
                 'state', public.volunteer_slot_state(g.status),
                 'can_change', public.volunteer_change_allowed(
                                 public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes), v_now))
               order by g.scheduled_at, vr.name, c.id)
          from public.volunteer_claims c
          join public.games g on g.id = c.game_id
          join public.volunteer_roles vr on vr.id = c.role_id
          join public.teams ht on ht.id = g.home_team_id
          left join public.teams at on at.id = g.away_team_id
          left join public.teams ft on ft.id = c.for_team_id
          left join public.teams fam on fam.id = c.family_team_id
          left join public.divisions famd on famd.id = fam.division_id
          left join public.venues ve on ve.id = g.venue_id
          left join public.locations loc on loc.id = ve.location_id
         where c.volunteer_id = v.id and c.season_id = v_link.season_id and c.status = 'active'), '[]'))
      from public.volunteers v where v.id = v_link.volunteer_id);
end;
$$;

-- Cancel one of the volunteer's own spots. Statuses: unknown, plan,
-- not_found (not this volunteer's active spot), change_closed (24 hours or
-- less before the spot — with the league's contact email), canceled.
create or replace function public.volunteer_cancel(p_token text, p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link  public.volunteer_manage_links%rowtype;
  v_owner uuid;
  v_plan  text;
  v_claim public.volunteer_claims%rowtype;
  v_start timestamp;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select k.* into v_link from public.volunteer_manage_links k
   where k.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and k.revoked_at is null;
  select l.owner_id into v_owner from public.leagues l where l.id = v_link.season_id and l.archived_at is null;
  if v_owner is null or not public.org_feature_on(v_owner, 'volunteers') then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    return jsonb_build_object('status', 'plan');
  end if;

  select c.* into v_claim from public.volunteer_claims c
   where c.id = p_claim_id and c.volunteer_id = v_link.volunteer_id and c.season_id = v_link.season_id
     and c.status = 'active'
     for update;
  if v_claim.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes) into v_start
    from public.games g join public.volunteer_roles vr on vr.id = v_claim.role_id
   where g.id = v_claim.game_id;
  if not public.volunteer_change_allowed(v_start, public.volunteer_org_now(v_owner)) then
    return jsonb_build_object('status', 'change_closed',
      'contact_email', (select s.contact_email from public.volunteer_settings s where s.owner_id = v_owner));
  end if;

  update public.volunteer_claims set status = 'canceled', canceled_at = now() where id = v_claim.id;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
  values (v_owner, v_claim.season_id, v_claim.volunteer_id, 'canceled_by_volunteer', jsonb_build_object('claim_id', v_claim.id));
  return jsonb_build_object('status', 'canceled');
end;
$$;

-- 0120's finish, plus: a row that is done (sent or finally failed) loses its
-- manage token. A row put back for a retry keeps it.
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
           resend_id = left(p_resend_id, 100), error = null,
           payload = payload - 'manage_token'
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
           error = left(coalesce(p_error, 'send failed'), 500),
           payload = payload - 'manage_token'
     where id = p_id;
    v_status := 'failed';
  end if;

  return jsonb_build_object('updated', true, 'status', v_status);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Function privileges
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.volunteer_slot_state(text) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_slot_targets(text, text, boolean, boolean, uuid, uuid, uuid, uuid, uuid[], integer) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_claim_refusal(text, timestamp, timestamp, boolean, boolean, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_change_allowed(timestamp, timestamp) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_spot_start(timestamp, integer) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_game_minutes(jsonb) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_link_owner(text) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_org_now(uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_season_spots(uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_signup_page(text, uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_manage_page(text) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_cancel(text, uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_outbox_finish(bigint, boolean, text, text, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_admin_gate(uuid, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_cancel_claims(uuid[], text) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.delete_volunteer_role(uuid, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.wipe_volunteer_data_on_archive() from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean) to authenticated;
grant execute on function public.delete_volunteer_role(uuid, boolean) to authenticated;
grant execute on function public.volunteer_signup_page(text, uuid) to service_role;
grant execute on function public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean) to service_role;
grant execute on function public.volunteer_manage_page(text) to service_role;
grant execute on function public.volunteer_cancel(text, uuid) to service_role;
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
    'public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean)',
    'public.delete_volunteer_role(uuid, boolean)'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0121 verify: authenticated cannot execute %', f;
    end if;
    foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0121 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.volunteer_slot_state(text)',
    'public.volunteer_slot_targets(text, text, boolean, boolean, uuid, uuid, uuid, uuid, uuid[], integer)',
    'public.volunteer_claim_refusal(text, timestamp, timestamp, boolean, boolean, boolean)',
    'public.volunteer_change_allowed(timestamp, timestamp)',
    'public.volunteer_spot_start(timestamp, integer)',
    'public.volunteer_game_minutes(jsonb)',
    'public.volunteer_link_owner(text)',
    'public.volunteer_org_now(uuid)',
    'public.volunteer_season_spots(uuid)',
    'public.volunteer_admin_gate(uuid, boolean)',
    'public.volunteer_cancel_claims(uuid[], text)',
    'public.wipe_volunteer_data_on_archive()'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0121 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.volunteer_signup_page(text, uuid)',
    'public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean)',
    'public.volunteer_manage_page(text)',
    'public.volunteer_cancel(text, uuid)',
    'public.volunteer_outbox_finish(bigint, boolean, text, text, boolean)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0121 verify: service_role cannot execute %', f;
    end if;
    foreach r in array array['anon', 'authenticated', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0121 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach t in array array['volunteer_roles', 'volunteer_role_divisions', 'volunteer_claims', 'volunteer_manage_links'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0121 verify: RLS off on %', t;
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        if has_table_privilege(r, 'public.' || t, p)
           and not (t in ('volunteer_roles', 'volunteer_role_divisions') and r = 'authenticated' and p = 'SELECT') then
          raise exception '0121 verify: % holds % on %', r, p, t;
        end if;
      end loop;
    end loop;
  end loop;

  if not (select prosecdef from pg_proc where oid = 'public.wipe_volunteer_data_on_archive()'::regprocedure) then
    raise exception '0121 verify: wipe_volunteer_data_on_archive is not SECURITY DEFINER';
  end if;
end
$v$;

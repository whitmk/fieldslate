-- 0121 — Volunteer sign-ups: game roles and claims (2026-11-08, branch
-- feat/volunteer-game-roles). Built in parts, each with its proof (the
-- proof file is scripts/sim/volunteer-claims-sim.sql):
--   PART 1 (this commit): roles, role divisions, claims, the pure slot-rule
--          twins, role save/delete, the archive wipe extended to claims and
--          roles.
--   PART 2: claim / manage / cancel / switch (public, via service_role).
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
--   6. `wipe_volunteer_data_on_archive` re-created: claims and roles of the
--      season go too, then volunteers nothing references (0120's body plus
--      two deletes).
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
-- invalid_kind, invalid_spots, division_not_in_season, role_not_found,
-- kind_locked.

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
  -- sha256 hex of the manage link's token; the token itself is never stored.
  manage_token_hash    text unique check (manage_token_hash is null or manage_token_hash ~ '^[0-9a-f]{64}$'),
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
  -- Twin of slotTargets (slots.ts) for ONE role. The home team's set comes
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
   where least(greatest(coalesce(p_spots, 0), 0), 10) > 0;
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
    insert into public.volunteer_roles (owner_id, season_id, name, kind, spots, signups_open, counts_toward_goal,
                                        sort_order)
    values (v_owner, p_season_id, v_name, p_kind, p_spots, coalesce(p_signups_open, true), coalesce(p_counts, true),
            coalesce((select max(r.sort_order) + 1 from public.volunteer_roles r where r.season_id = p_season_id), 0))
    returning id into v_id;
  else
    v_canceled := public.volunteer_cancel_claims(v_cancel, v_role.name);
    update public.volunteer_roles
       set name = v_name, kind = p_kind, spots = p_spots, signups_open = coalesce(p_signups_open, true),
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
  delete from public.volunteer_roles where season_id = new.id;

  delete from public.volunteers v
   where v.owner_id = new.owner_id
     and not exists (select 1 from public.volunteer_outbox o where o.volunteer_id = v.id)
     and not exists (select 1 from public.volunteer_claims c where c.volunteer_id = v.id);

  return null;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Function privileges
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.volunteer_slot_state(text) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_slot_targets(text, boolean, boolean, uuid, uuid, uuid, uuid, uuid[], integer) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_claim_refusal(text, timestamp, timestamp, boolean, boolean, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_change_allowed(timestamp, timestamp) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_admin_gate(uuid, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_cancel_claims(uuid[], text) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.save_volunteer_role(uuid, uuid, text, text, integer, boolean, boolean, uuid[], boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.delete_volunteer_role(uuid, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.wipe_volunteer_data_on_archive() from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.save_volunteer_role(uuid, uuid, text, text, integer, boolean, boolean, uuid[], boolean) to authenticated;
grant execute on function public.delete_volunteer_role(uuid, boolean) to authenticated;

-- Verify, or the whole migration rolls back.
do $v$
declare
  r text;
  f text;
  t text;
  p text;
begin
  foreach f in array array[
    'public.save_volunteer_role(uuid, uuid, text, text, integer, boolean, boolean, uuid[], boolean)',
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
    'public.volunteer_slot_targets(text, boolean, boolean, uuid, uuid, uuid, uuid, uuid[], integer)',
    'public.volunteer_claim_refusal(text, timestamp, timestamp, boolean, boolean, boolean)',
    'public.volunteer_change_allowed(timestamp, timestamp)',
    'public.volunteer_admin_gate(uuid, boolean)',
    'public.volunteer_cancel_claims(uuid[], text)',
    'public.wipe_volunteer_data_on_archive()'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0121 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach t in array array['volunteer_roles', 'volunteer_role_divisions', 'volunteer_claims'] loop
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

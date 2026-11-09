-- 0123 — Volunteer sign-ups: the tracker (2026-11-09, branch
-- feat/volunteer-tracker). Plan: docs/plans/volunteer-tracker-0123.md
-- (approved 2026-11-09). The proof is scripts/sim/volunteer-tracker-sim.sql.
--
-- DECIDED (2026-11-09):
--   * A season goal: N shifts per family (1–20). Every counted shift is
--     equal; no-shows, canceled and detached sign-ups never count. A spot is
--     WORKED when it is active, dated before today in the league's timezone
--     and not a no-show; UPCOMING when active and dated today or later. A spot
--     on a rained-out game counts as neither ("held") until a makeup is set.
--     Which roles count is the roles' own `counts_toward_goal` (0121).
--   * A family is one volunteer unless an admin merges families. Merges are
--     PER SEASON (`volunteer_family_members`), so archiving removes them; the
--     org-wide `volunteers.family_id` (0120, never used) is dropped.
--     Families whose sign-ups were ALL canceled are still listed (0 worked,
--     short) and can be nudged.
--   * Officials: an official's assigned games count ONLY when an admin sets
--     "Counts for [team]" (`volunteer_official_links`). An email match alone
--     never makes an official count — it only puts a counted official in the
--     matching volunteer's family. Regular season only (game_umpires
--     references games only). A missed game is a no-show on the assignment
--     (`volunteer_official_no_shows`), past games only. NOTHING here changes
--     umpires, game_umpires, assignment, auto-assign or pay; officials code
--     never reads these tables (sim:volunteer-leaks U1).
--   * Families per team: an optional NUMBER (1–60), no names.
--   * The nudge: one email per volunteer, numbers only in the payload,
--     refused while the sign-up link is off or no goal is set, at most once
--     per volunteer per season every 3 days (72 hours, read from the outbox
--     log). Official-only families can't be nudged (they never signed up).
--
-- WHAT.
--   1. Five tables, RLS on, NO privilege for any role (like `volunteers`):
--      volunteer_goals, volunteer_team_family_counts,
--      volunteer_family_members, volunteer_official_links,
--      volunteer_official_no_shows. `volunteers.family_id` dropped.
--   2. `volunteer_tracker_families` (callable by no role) — every family of
--      the season with its members and counts; the ONE place the counting
--      rule lives (the tracker read and the nudge both use it).
--   3. Admin functions (SECURITY DEFINER, `search_path = public, pg_temp`,
--      behind volunteer_admin_gate, EXECUTE authenticated only, none writes
--      activity_log): volunteer_tracker, set_volunteer_goal,
--      set_team_family_count, set_official_counts_for, set_official_no_show,
--      merge_volunteer_families, separate_volunteer_family_member,
--      volunteer_admin_nudge.
--   4. wipe_volunteer_data_on_archive re-created VERBATIM from 0121 plus the
--      five tables (marked).
--   5. Verify.
--
-- LOCKS when applied (well under a second): CREATE TABLE with foreign keys
-- takes SHARE ROW EXCLUSIVE on profiles, leagues, teams, umpires,
-- game_umpires and volunteers (blocks WRITES to them, not reads, for the
-- statement); dropping `volunteers.family_id` takes ACCESS EXCLUSIVE on
-- volunteers. umpires and game_umpires are not ALTERed.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────────────────────
alter table public.volunteers drop column if exists family_id;

create table public.volunteer_goals (
  season_id         uuid primary key references public.leagues(id) on delete cascade,
  owner_id          uuid not null references public.profiles(id) on delete cascade,
  shifts_per_family smallint check (shifts_per_family between 1 and 20),
  officials_count   boolean not null default true,
  updated_at        timestamptz not null default now()
);

create table public.volunteer_team_family_counts (
  team_id    uuid primary key references public.teams(id) on delete cascade,
  season_id  uuid not null references public.leagues(id) on delete cascade,
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  families   smallint not null check (families between 1 and 60),
  updated_at timestamptz not null default now()
);
create index volunteer_team_family_counts_season_idx on public.volunteer_team_family_counts (season_id);

-- A row means "this member was put in family `family_key` by an admin" (a
-- merge, or separating an email-matched official). No row: a volunteer is
-- their own family; a counted official joins the family of the season's
-- volunteer with their email, else their own.
create table public.volunteer_family_members (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references public.leagues(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  volunteer_id uuid references public.volunteers(id) on delete cascade,
  umpire_id    uuid references public.umpires(id) on delete cascade,
  family_key   uuid not null,
  created_at   timestamptz not null default now(),
  constraint volunteer_family_members_one_member check (num_nonnulls(volunteer_id, umpire_id) = 1)
);
create unique index volunteer_family_members_volunteer_uniq
  on public.volunteer_family_members (season_id, volunteer_id) where volunteer_id is not null;
create unique index volunteer_family_members_umpire_uniq
  on public.volunteer_family_members (umpire_id) where umpire_id is not null;

create table public.volunteer_official_links (
  umpire_id          uuid primary key references public.umpires(id) on delete cascade,
  season_id          uuid not null references public.leagues(id) on delete cascade,
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  counts_for_team_id uuid not null references public.teams(id) on delete cascade,
  updated_at         timestamptz not null default now()
);
create index volunteer_official_links_season_idx on public.volunteer_official_links (season_id);

create table public.volunteer_official_no_shows (
  game_umpire_id uuid primary key references public.game_umpires(id) on delete cascade,
  season_id      uuid not null references public.leagues(id) on delete cascade,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  marked_at      timestamptz not null default now()
);
create index volunteer_official_no_shows_season_idx on public.volunteer_official_no_shows (season_id);

alter table public.volunteer_goals enable row level security;
alter table public.volunteer_team_family_counts enable row level security;
alter table public.volunteer_family_members enable row level security;
alter table public.volunteer_official_links enable row level security;
alter table public.volunteer_official_no_shows enable row level security;
revoke all on table public.volunteer_goals from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on table public.volunteer_team_family_counts from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on table public.volunteer_family_members from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on table public.volunteer_official_links from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on table public.volunteer_official_no_shows from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Families and their counts (callable by no role)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_tracker_families(p_season_id uuid, p_owner uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- THE counting rule. Every family of the season: its members (volunteers
  -- with ANY sign-up this season, and counted officials while officials
  -- count), the teams it belongs to, and worked / upcoming / no-shows / held.
  with today as (
    select public.volunteer_org_now(p_owner)::date as d
  ), officials_on as (
    select coalesce((select g.officials_count from public.volunteer_goals g where g.season_id = p_season_id), true) as on_
  ), claims as (
    select c.volunteer_id, c.status, c.no_show, c.family_team_id, c.created_at,
           coalesce(r.counts_toward_goal, false) as counts,
           coalesce(g.status = 'cancelled', false) as held,
           case when c.game_id is not null
                  then public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, r.lead_minutes)::date
                else b.date end as spot_date
      from public.volunteer_claims c
      left join public.volunteer_roles r on r.id = c.role_id
      left join public.games g on g.id = c.game_id
      left join public.snack_shack_blocks b on b.id = c.snack_shack_block_id
     where c.season_id = p_season_id
  ), vols as (
    select v.id, v.first_initial, v.last_name, v.email_lc, min(c.created_at) as first_at,
           count(*) filter (where c.status = 'active' and c.counts and not c.held and not c.no_show
                              and c.spot_date < (select d from today)) as worked,
           count(*) filter (where c.status = 'active' and c.counts and not c.held
                              and c.spot_date >= (select d from today)) as upcoming,
           count(*) filter (where c.status = 'active' and c.no_show) as no_shows,
           count(*) filter (where c.status = 'active' and c.counts and c.held) as held,
           array_remove(array_agg(distinct c.family_team_id), null) as team_ids
      from public.volunteers v
      join claims c on c.volunteer_id = v.id
     group by v.id, v.first_initial, v.last_name, v.email_lc
  ), vol_keys as (
    select v.id, coalesce(fm.family_key, v.id) as k, fm.id is not null as manual
      from vols v
      left join public.volunteer_family_members fm on fm.season_id = p_season_id and fm.volunteer_id = v.id
  ), offs as (
    select u.id, u.name, nullif(lower(btrim(u.email)), '') as email_lc, u.created_at, l.counts_for_team_id
      from public.volunteer_official_links l
      join public.umpires u on u.id = l.umpire_id
     where l.season_id = p_season_id and u.season_id = p_season_id
       and (select on_ from officials_on)
  ), off_games as (
    select gu.umpire_id, gu.id as gu_id, g.status,
           (g.scheduled_at at time zone 'UTC')::date as d,
           exists (select 1 from public.volunteer_official_no_shows n where n.game_umpire_id = gu.id) as ns
      from public.game_umpires gu
      join public.games g on g.id = gu.game_id
     where gu.umpire_id in (select id from offs)
       and g.league_id = p_season_id
       and g.scheduled_at is not null
       and g.status <> 'pending_interleague'
  ), off_counts as (
    select o.id,
           count(og.gu_id) filter (where og.status <> 'cancelled' and not og.ns and og.d < (select d from today)) as worked,
           count(og.gu_id) filter (where og.status <> 'cancelled' and og.d >= (select d from today)) as upcoming,
           count(og.gu_id) filter (where og.status <> 'cancelled' and og.ns) as no_shows,
           count(og.gu_id) filter (where og.status = 'cancelled') as held
      from offs o
      left join off_games og on og.umpire_id = o.id
     group by o.id
  ), off_keys as (
    select o.id,
           coalesce(fm.family_key, mv.k, o.id) as k,
           fm.id is not null as manual,
           mv.id as matched_volunteer_id
      from offs o
      left join public.volunteer_family_members fm on fm.season_id = p_season_id and fm.umpire_id = o.id
      left join lateral (
        select vk.id, vk.k from vols v2 join vol_keys vk on vk.id = v2.id
         where o.email_lc is not null and v2.email_lc = o.email_lc
         order by v2.id limit 1
      ) mv on true
  ), members as (
    select vk.k, false as is_official, v.first_at as sort_at, v.id,
           jsonb_build_object('kind', 'volunteer', 'id', v.id, 'first_initial', v.first_initial,
                              'last_name', v.last_name, 'email', v.email_lc, 'manual', vk.manual) as j,
           v.worked, v.upcoming, v.no_shows, v.held, v.team_ids
      from vols v join vol_keys vk on vk.id = v.id
    union all
    select ok.k, true, o.created_at, o.id,
           jsonb_build_object('kind', 'official', 'id', o.id, 'name', o.name, 'manual', ok.manual,
                              'matched_volunteer_id', ok.matched_volunteer_id,
                              'by_email', not ok.manual and ok.matched_volunteer_id is not null),
           oc.worked, oc.upcoming, oc.no_shows, oc.held, array[o.counts_for_team_id]
      from offs o join off_keys ok on ok.id = o.id join off_counts oc on oc.id = o.id
  )
  select coalesce(jsonb_agg(f order by f ->> 'key'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'key', m.k,
               'members', jsonb_agg(m.j order by m.is_official, m.sort_at, m.id),
               'team_ids', coalesce((select jsonb_agg(distinct t order by t)
                                       from members m2, unnest(m2.team_ids) t where m2.k = m.k), '[]'::jsonb),
               'worked', sum(m.worked)::int,
               'upcoming', sum(m.upcoming)::int,
               'no_shows', sum(m.no_shows)::int,
               'held', sum(m.held)::int) as f
        from members m
       group by m.k
    ) x;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Admin functions
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_tracker(p_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.volunteer_admin_gate(p_season_id, false);
  v_tz    text := (select p.timezone from public.profiles p where p.id = v_owner);
begin
  -- The tracker's ONE read: the goal, what counts, the family counts per
  -- team, every family (names and emails — admins only), the officials
  -- panel and when each volunteer was last nudged.
  return jsonb_build_object(
    'season_id', p_season_id,
    'today', to_char(public.volunteer_org_now(v_owner), 'YYYY-MM-DD'),
    'link_enabled', coalesce((select s.link_enabled from public.volunteer_settings s where s.owner_id = v_owner), false),
    'goal', jsonb_build_object(
      'shifts_per_family', (select g.shifts_per_family from public.volunteer_goals g where g.season_id = p_season_id),
      'officials_count', coalesce((select g.officials_count from public.volunteer_goals g where g.season_id = p_season_id), true)),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'kind', r.kind,
                                          'counts_toward_goal', r.counts_toward_goal)
                       order by r.sort_order, r.created_at, r.id)
        from public.volunteer_roles r where r.season_id = p_season_id), '[]'::jsonb),
    'team_counts', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', t.team_id, 'families', t.families) order by t.team_id)
        from public.volunteer_team_family_counts t where t.season_id = p_season_id), '[]'::jsonb),
    'families', public.volunteer_tracker_families(p_season_id, v_owner),
    'officials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'umpire_id', u.id,
               'name', u.name,
               'counts_for_team_id', l.counts_for_team_id,
               'matched_volunteer_id', (
                 select v.id from public.volunteers v
                  where v.owner_id = v_owner
                    and v.email_lc = nullif(lower(btrim(u.email)), '')
                    and exists (select 1 from public.volunteer_claims c
                                 where c.volunteer_id = v.id and c.season_id = p_season_id)),
               'games', case when l.umpire_id is null then '[]'::jsonb else coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'game_umpire_id', gu.id,
                          'start', to_char((g.scheduled_at at time zone 'UTC')::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
                          'status', g.status,
                          'home_team_id', g.home_team_id,
                          'away_team_id', g.away_team_id,
                          'external_team_name', g.external_team_name,
                          'no_show', exists (select 1 from public.volunteer_official_no_shows n where n.game_umpire_id = gu.id))
                        order by g.scheduled_at, gu.id)
                   from public.game_umpires gu
                   join public.games g on g.id = gu.game_id
                  where gu.umpire_id = u.id and g.league_id = p_season_id
                    and g.scheduled_at is not null and g.status <> 'pending_interleague'), '[]'::jsonb) end)
             order by u.name, u.id)
        from public.umpires u
        left join public.volunteer_official_links l on l.umpire_id = u.id and l.season_id = p_season_id
       where u.season_id = p_season_id), '[]'::jsonb),
    'nudged', coalesce((
      select jsonb_agg(jsonb_build_object('volunteer_id', x.volunteer_id,
                                          'on', to_char(x.last_at at time zone v_tz, 'YYYY-MM-DD'))
                       order by x.volunteer_id)
        from (select o.volunteer_id, max(o.created_at) as last_at
                from public.volunteer_outbox o
               where o.season_id = p_season_id and o.kind = 'nudge' and o.status in ('pending', 'sending', 'sent')
               group by o.volunteer_id) x), '[]'::jsonb));
end;
$$;

create or replace function public.set_volunteer_goal(
  p_season_id         uuid,
  p_shifts            integer,
  p_officials_count   boolean,
  p_counting_role_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.volunteer_admin_gate(p_season_id, true);
begin
  if p_shifts is not null and (p_shifts < 1 or p_shifts > 20) then
    return jsonb_build_object('status', 'invalid_goal');
  end if;
  if p_counting_role_ids is not null and exists (
       select 1 from unnest(p_counting_role_ids) x(id)
        where not exists (select 1 from public.volunteer_roles r where r.id = x.id and r.season_id = p_season_id)) then
    return jsonb_build_object('status', 'invalid_role');
  end if;
  insert into public.volunteer_goals (season_id, owner_id, shifts_per_family, officials_count)
  values (p_season_id, v_owner, p_shifts, coalesce(p_officials_count, true))
  on conflict (season_id) do update
     set shifts_per_family = excluded.shifts_per_family,
         officials_count = excluded.officials_count,
         updated_at = now();
  -- A null list leaves every role's "counts toward the goal" as it is.
  if p_counting_role_ids is not null then
    update public.volunteer_roles r
       set counts_toward_goal = (r.id = any (p_counting_role_ids)), updated_at = now()
     where r.season_id = p_season_id
       and r.counts_toward_goal is distinct from (r.id = any (p_counting_role_ids));
  end if;
  return jsonb_build_object('status', 'saved');
end;
$$;

create or replace function public.set_team_family_count(p_season_id uuid, p_team_id uuid, p_families integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.volunteer_admin_gate(p_season_id, false);
begin
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.league_id = p_season_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_families is null then
    delete from public.volunteer_team_family_counts where team_id = p_team_id;
    return jsonb_build_object('status', 'saved');
  end if;
  if p_families < 1 or p_families > 60 then
    return jsonb_build_object('status', 'invalid_count');
  end if;
  insert into public.volunteer_team_family_counts (team_id, season_id, owner_id, families)
  values (p_team_id, p_season_id, v_owner, p_families)
  on conflict (team_id) do update set families = excluded.families, updated_at = now();
  return jsonb_build_object('status', 'saved');
end;
$$;

create or replace function public.set_official_counts_for(p_season_id uuid, p_umpire_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.volunteer_admin_gate(p_season_id, false);
begin
  -- The ONLY way an official's games start counting. An email match never
  -- does (decided 2026-11-09).
  if not exists (select 1 from public.umpires u where u.id = p_umpire_id and u.season_id = p_season_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_team_id is null then
    delete from public.volunteer_official_links where umpire_id = p_umpire_id;
    return jsonb_build_object('status', 'saved');
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.league_id = p_season_id) then
    return jsonb_build_object('status', 'team_not_in_season');
  end if;
  insert into public.volunteer_official_links (umpire_id, season_id, owner_id, counts_for_team_id)
  values (p_umpire_id, p_season_id, v_owner, p_team_id)
  on conflict (umpire_id) do update set counts_for_team_id = excluded.counts_for_team_id, updated_at = now();
  return jsonb_build_object('status', 'saved');
end;
$$;

create or replace function public.set_official_no_show(p_game_umpire_id uuid, p_no_show boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid;
  v_owner  uuid;
  v_umpire uuid;
  v_status text;
  v_date   date;
begin
  -- Only for a counted official, only on a past game that was played. It
  -- changes no pay: game_umpires is never written here.
  select u.season_id, u.id, g.status, (g.scheduled_at at time zone 'UTC')::date
    into v_season, v_umpire, v_status, v_date
    from public.game_umpires gu
    join public.umpires u on u.id = gu.umpire_id
    join public.games g on g.id = gu.game_id
   where gu.id = p_game_umpire_id and g.league_id = u.season_id;
  if v_season is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_owner := public.volunteer_admin_gate(v_season, false);
  if not exists (select 1 from public.volunteer_official_links l where l.umpire_id = v_umpire) then
    return jsonb_build_object('status', 'not_counted');
  end if;
  if v_date is null or v_status in ('cancelled', 'pending_interleague') then
    return jsonb_build_object('status', 'not_played');
  end if;
  if v_date >= public.volunteer_org_now(v_owner)::date then
    return jsonb_build_object('status', 'not_past');
  end if;
  if coalesce(p_no_show, false) then
    insert into public.volunteer_official_no_shows (game_umpire_id, season_id, owner_id)
    values (p_game_umpire_id, v_season, v_owner)
    on conflict (game_umpire_id) do nothing;
  else
    delete from public.volunteer_official_no_shows where game_umpire_id = p_game_umpire_id;
  end if;
  return jsonb_build_object('status', 'saved');
end;
$$;

create or replace function public.merge_volunteer_families(
  p_season_id    uuid,
  p_keep_member  uuid,
  p_merge_member uuid,
  p_commit       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.volunteer_admin_gate(p_season_id, true);
  v_fams  jsonb;
  v_a     jsonb;
  v_b     jsonb;
  v_key   uuid;
  m       jsonb;
begin
  -- Its own preview (p_commit false writes nothing). Members are named by
  -- id — a volunteer's or a counted official's. Every member of both
  -- families gets a row with ONE new key, so a family never chains.
  perform pg_advisory_xact_lock(hashtextextended('volunteer_family:' || p_season_id::text, 0));
  v_fams := public.volunteer_tracker_families(p_season_id, v_owner);
  select f into v_a from jsonb_array_elements(v_fams) f
   where exists (select 1 from jsonb_array_elements(f -> 'members') x where (x ->> 'id')::uuid = p_keep_member);
  select f into v_b from jsonb_array_elements(v_fams) f
   where exists (select 1 from jsonb_array_elements(f -> 'members') x where (x ->> 'id')::uuid = p_merge_member);
  if v_a is null or v_b is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_a ->> 'key' = v_b ->> 'key' then
    return jsonb_build_object('status', 'same_family');
  end if;
  if not coalesce(p_commit, false) then
    return jsonb_build_object('status', 'ready',
      'members', jsonb_array_length(v_a -> 'members') + jsonb_array_length(v_b -> 'members'));
  end if;
  v_key := gen_random_uuid();
  for m in select x from jsonb_array_elements((v_a -> 'members') || (v_b -> 'members')) x loop
    if m ->> 'kind' = 'official' then
      delete from public.volunteer_family_members where umpire_id = (m ->> 'id')::uuid;
      insert into public.volunteer_family_members (season_id, owner_id, umpire_id, family_key)
      values (p_season_id, v_owner, (m ->> 'id')::uuid, v_key);
    else
      delete from public.volunteer_family_members
       where season_id = p_season_id and volunteer_id = (m ->> 'id')::uuid;
      insert into public.volunteer_family_members (season_id, owner_id, volunteer_id, family_key)
      values (p_season_id, v_owner, (m ->> 'id')::uuid, v_key);
    end if;
  end loop;
  return jsonb_build_object('status', 'merged', 'family_key', v_key);
end;
$$;

create or replace function public.separate_volunteer_family_member(p_season_id uuid, p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.volunteer_admin_gate(p_season_id, true);
  v_fams  jsonb;
  v_f     jsonb;
  v_m     jsonb;
  x       jsonb;
begin
  -- Takes one member out of its family, leaving them on their own.
  perform pg_advisory_xact_lock(hashtextextended('volunteer_family:' || p_season_id::text, 0));
  v_fams := public.volunteer_tracker_families(p_season_id, v_owner);
  select f into v_f from jsonb_array_elements(v_fams) f
   where exists (select 1 from jsonb_array_elements(f -> 'members') y where (y ->> 'id')::uuid = p_member);
  if v_f is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if jsonb_array_length(v_f -> 'members') < 2 then
    return jsonb_build_object('status', 'not_merged');
  end if;
  select y into v_m from jsonb_array_elements(v_f -> 'members') y where (y ->> 'id')::uuid = p_member;
  if v_m ->> 'kind' = 'official' then
    -- An official on their own: a row with their own id as the key (it also
    -- overrides an email match).
    delete from public.volunteer_family_members where umpire_id = p_member;
    insert into public.volunteer_family_members (season_id, owner_id, umpire_id, family_key)
    values (p_season_id, v_owner, p_member, p_member);
  else
    delete from public.volunteer_family_members where season_id = p_season_id and volunteer_id = p_member;
    -- Officials who were in this family only by this volunteer's email stay
    -- in the family, not with the volunteer — or, when the family's key IS
    -- the volunteer (no merge rows), on their own.
    for x in select y from jsonb_array_elements(v_f -> 'members') y
              where y ->> 'kind' = 'official' and coalesce((y ->> 'by_email')::boolean, false)
                and (y ->> 'matched_volunteer_id')::uuid = p_member loop
      insert into public.volunteer_family_members (season_id, owner_id, umpire_id, family_key)
      values (p_season_id, v_owner, (x ->> 'id')::uuid,
              case when (v_f ->> 'key')::uuid = p_member then (x ->> 'id')::uuid else (v_f ->> 'key')::uuid end);
    end loop;
  end if;
  return jsonb_build_object('status', 'separated');
end;
$$;

create or replace function public.volunteer_admin_nudge(p_season_id uuid, p_volunteer_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid := public.volunteer_admin_gate(p_season_id, true);
  v_goal    smallint;
  v_fams    jsonb;
  v_f       jsonb;
  v_id      uuid;
  v_queued  integer := 0;
  v_recent  jsonb := '[]'::jsonb;
  v_missing integer := 0;
begin
  -- One email per volunteer: their family's numbers and the league's sign-up
  -- link (the take attaches it). Never a name or an address in the payload.
  if not coalesce((select s.link_enabled from public.volunteer_settings s where s.owner_id = v_owner), false) then
    return jsonb_build_object('status', 'link_off');
  end if;
  select g.shifts_per_family into v_goal from public.volunteer_goals g where g.season_id = p_season_id;
  if v_goal is null then
    return jsonb_build_object('status', 'no_goal');
  end if;
  v_fams := public.volunteer_tracker_families(p_season_id, v_owner);
  for v_id in select distinct x from unnest(coalesce(p_volunteer_ids, '{}'::uuid[])) x loop
    select f into v_f from jsonb_array_elements(v_fams) f
     where exists (select 1 from jsonb_array_elements(f -> 'members') y
                    where y ->> 'kind' = 'volunteer' and (y ->> 'id')::uuid = v_id);
    if v_f is null then
      v_missing := v_missing + 1;
      continue;
    end if;
    -- At most once every 3 days per volunteer per season (decided 2026-11-09).
    if exists (select 1 from public.volunteer_outbox o
                where o.season_id = p_season_id and o.volunteer_id = v_id and o.kind = 'nudge'
                  and o.status in ('pending', 'sending', 'sent')
                  and o.created_at > now() - interval '72 hours') then
      v_recent := v_recent || to_jsonb(v_id);
      continue;
    end if;
    insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, coalesce_key)
    values (v_owner, p_season_id, v_id, 'nudge',
            jsonb_build_object('goal', v_goal,
                               'worked', (v_f ->> 'worked')::int,
                               'upcoming', (v_f ->> 'upcoming')::int),
            'nudge:' || p_season_id || ':' || v_id);
    v_queued := v_queued + 1;
  end loop;
  return jsonb_build_object('status', 'queued', 'queued', v_queued, 'recent', v_recent, 'not_found', v_missing);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. The archive wipe — VERBATIM from 0121 plus the five tables (marked)
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
  delete from public.volunteer_trigger_failures where season_id = new.id;
  delete from public.volunteer_roles where season_id = new.id;
  -- 0123: the tracker's tables.
  delete from public.volunteer_family_members where season_id = new.id;
  delete from public.volunteer_official_no_shows where season_id = new.id;
  delete from public.volunteer_official_links where season_id = new.id;
  delete from public.volunteer_team_family_counts where season_id = new.id;
  delete from public.volunteer_goals where season_id = new.id;

  delete from public.volunteers v
   where v.owner_id = new.owner_id
     and not exists (select 1 from public.volunteer_outbox o where o.volunteer_id = v.id)
     and not exists (select 1 from public.volunteer_claims c where c.volunteer_id = v.id)
     and not exists (select 1 from public.volunteer_manage_links k where k.volunteer_id = v.id);

  return null;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Grants
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.volunteer_tracker_families(uuid, uuid) from public, anon, authenticated, service_role, dashboard_readonly;

revoke execute on function public.volunteer_tracker(uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_volunteer_goal(uuid, integer, boolean, uuid[]) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_team_family_count(uuid, uuid, integer) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_official_counts_for(uuid, uuid, uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_official_no_show(uuid, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.merge_volunteer_families(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.separate_volunteer_family_member(uuid, uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_admin_nudge(uuid, uuid[]) from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.volunteer_tracker(uuid) to authenticated;
grant execute on function public.set_volunteer_goal(uuid, integer, boolean, uuid[]) to authenticated;
grant execute on function public.set_team_family_count(uuid, uuid, integer) to authenticated;
grant execute on function public.set_official_counts_for(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_official_no_show(uuid, boolean) to authenticated;
grant execute on function public.merge_volunteer_families(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.separate_volunteer_family_member(uuid, uuid) to authenticated;
grant execute on function public.volunteer_admin_nudge(uuid, uuid[]) to authenticated;

revoke execute on function public.wipe_volunteer_data_on_archive() from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Verify, or the whole migration rolls back.
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  f text;
  r text;
  t text;
begin
  foreach f in array array[
    'public.volunteer_tracker(uuid)',
    'public.set_volunteer_goal(uuid, integer, boolean, uuid[])',
    'public.set_team_family_count(uuid, uuid, integer)',
    'public.set_official_counts_for(uuid, uuid, uuid)',
    'public.set_official_no_show(uuid, boolean)',
    'public.merge_volunteer_families(uuid, uuid, uuid, boolean)',
    'public.separate_volunteer_family_member(uuid, uuid)',
    'public.volunteer_admin_nudge(uuid, uuid[])'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0123 verify: authenticated cannot execute %', f;
    end if;
    foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0123 verify: % can execute %', r, f;
      end if;
    end loop;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '0123 verify: % is not SECURITY DEFINER', f;
    end if;
  end loop;

  foreach f in array array[
    'public.volunteer_tracker_families(uuid, uuid)',
    'public.wipe_volunteer_data_on_archive()'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0123 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach t in array array['public.volunteer_goals', 'public.volunteer_team_family_counts',
                           'public.volunteer_family_members', 'public.volunteer_official_links',
                           'public.volunteer_official_no_shows'] loop
    if not (select relrowsecurity from pg_class where oid = t::regclass) then
      raise exception '0123 verify: RLS is off on %', t;
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      foreach f in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(r, t, f) then
          raise exception '0123 verify: % holds % on %', r, f, t;
        end if;
      end loop;
    end loop;
  end loop;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'volunteers' and column_name = 'family_id') then
    raise exception '0123 verify: volunteers.family_id still exists';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.leagues'::regclass and tgenabled = 'O'
        and tgname = 'wipe_volunteer_data_on_archive') <> 1 then
    raise exception '0123 verify: the archive wipe trigger is missing or disabled';
  end if;
end
$v$;

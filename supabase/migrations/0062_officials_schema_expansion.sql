-- Officials schema expansion.
--
-- 1. Contact/scheduling/notes columns on umpires.
-- 2. official_roles — season-scoped, normalized role presets (the existing
--    free-text role strings in game_umpires/umpire_role_rates stay for
--    backward compatibility; new writes carry both role text and role_id).
-- 3. official_availability / official_blackouts / official_certifications —
--    per-official scheduling constraints and credentials.
-- 4. Nullable role_id on game_umpires + umpire_role_rates (existing rows
--    keep text roles, role_id null).
-- 5. toggle_assignment_paid RPC — first write path for game_umpires.paid
--    (column existed since 0026 with no writer).
-- 6. Seed official_roles for existing seasons from leagues.sport. sport is
--    unconstrained text with capitalized live values ('Baseball', 'Soccer',
--    'Softball') — matched by CASE, never assumed to be an enum.
--
-- RLS mirrors the 0049 convention: one FOR ALL "Org members can manage"
-- policy per table via is_org_member(l.owner_id).

-- ── 1. Umpire columns ────────────────────────────────────────────────────────

alter table public.umpires
  add column email text,
  add column phone text,
  add column max_games_per_week integer,
  add column notes text;

-- ── 2. official_roles ────────────────────────────────────────────────────────

create table public.official_roles (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(season_id, name)
);

create index official_roles_season_id_idx on public.official_roles(season_id);

alter table public.official_roles enable row level security;

create policy "Org members can manage official_roles"
  on public.official_roles for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = official_roles.season_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = official_roles.season_id
        and public.is_org_member(l.owner_id)
    )
  );

grant all on public.official_roles to authenticated;

-- ── 3. official_availability ─────────────────────────────────────────────────

create table public.official_availability (
  id uuid primary key default gen_random_uuid(),
  umpire_id uuid not null references public.umpires(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('Mo','Tu','We','Th','Fr','Sa','Su')),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now()
);

create index official_availability_umpire_id_idx on public.official_availability(umpire_id);

alter table public.official_availability enable row level security;

create policy "Org members can manage official_availability"
  on public.official_availability for all
  using (
    exists (
      select 1 from public.umpires u
      join public.leagues l on l.id = u.season_id
      where u.id = official_availability.umpire_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.umpires u
      join public.leagues l on l.id = u.season_id
      where u.id = official_availability.umpire_id
        and public.is_org_member(l.owner_id)
    )
  );

grant all on public.official_availability to authenticated;

-- ── 4. official_blackouts ────────────────────────────────────────────────────

create table public.official_blackouts (
  id uuid primary key default gen_random_uuid(),
  umpire_id uuid not null references public.umpires(id) on delete cascade,
  date date not null,
  note text,
  created_at timestamptz not null default now(),
  unique(umpire_id, date)
);

create index official_blackouts_umpire_id_idx on public.official_blackouts(umpire_id);

alter table public.official_blackouts enable row level security;

create policy "Org members can manage official_blackouts"
  on public.official_blackouts for all
  using (
    exists (
      select 1 from public.umpires u
      join public.leagues l on l.id = u.season_id
      where u.id = official_blackouts.umpire_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.umpires u
      join public.leagues l on l.id = u.season_id
      where u.id = official_blackouts.umpire_id
        and public.is_org_member(l.owner_id)
    )
  );

grant all on public.official_blackouts to authenticated;

-- ── 5. official_certifications ───────────────────────────────────────────────

create table public.official_certifications (
  id uuid primary key default gen_random_uuid(),
  umpire_id uuid not null references public.umpires(id) on delete cascade,
  name text not null,
  issued_date date,
  expiry_date date,
  created_at timestamptz not null default now()
);

create index official_certifications_umpire_id_idx on public.official_certifications(umpire_id);

alter table public.official_certifications enable row level security;

create policy "Org members can manage official_certifications"
  on public.official_certifications for all
  using (
    exists (
      select 1 from public.umpires u
      join public.leagues l on l.id = u.season_id
      where u.id = official_certifications.umpire_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.umpires u
      join public.leagues l on l.id = u.season_id
      where u.id = official_certifications.umpire_id
        and public.is_org_member(l.owner_id)
    )
  );

grant all on public.official_certifications to authenticated;

-- ── 6. role_id on game_umpires (role text stays; existing rows untouched) ────

alter table public.game_umpires
  add column role_id uuid references public.official_roles(id) on delete set null;

-- ── 7. role_id on umpire_role_rates (same pattern) ───────────────────────────

alter table public.umpire_role_rates
  add column role_id uuid references public.official_roles(id) on delete set null;

-- ── 8. Write path for game_umpires.paid ──────────────────────────────────────
-- Column existed since 0026 with no writer. Membership is enforced inside the
-- UPDATE (the function is security definer, so RLS alone wouldn't gate it).

create or replace function public.toggle_assignment_paid(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_umpires
  set paid = not paid
  where id = p_assignment_id
    and exists (
      select 1 from games g
      join leagues l on l.id = g.league_id
      where g.id = game_umpires.game_id
        and is_org_member(l.owner_id)
    );
end;
$$;

revoke all on function public.toggle_assignment_paid(uuid) from public;
grant execute on function public.toggle_assignment_paid(uuid) to authenticated;

-- ── 9. Seed official_roles for existing seasons ──────────────────────────────
-- leagues.sport is unconstrained text (capitalized live values); CASE-match
-- the known sports and fall back to generic labels for anything else.

insert into public.official_roles (season_id, name, sort_order)
select
  l.id,
  role.name,
  role.sort_order
from public.leagues l
cross join lateral (
  values
    (case l.sport
      when 'Baseball' then 'Plate Umpire'
      when 'Softball' then 'Plate Umpire'
      when 'Soccer'   then 'Referee'
      when 'Football' then 'Referee'
      when 'Basketball' then 'Referee'
      when 'Volleyball' then 'Referee'
      when 'Lacrosse' then 'Referee'
      when 'Hockey'   then 'Referee'
      else 'Official'
    end, 0),
    (case l.sport
      when 'Baseball'  then 'Base Umpire'
      when 'Softball'  then 'Base Umpire'
      when 'Soccer'    then 'Assistant Referee'
      when 'Football'  then 'Umpire'
      when 'Basketball' then 'Umpire'
      when 'Volleyball' then 'Assistant Referee'
      when 'Lacrosse'  then 'Umpire'
      when 'Hockey'    then 'Linesman'
      else 'Official 2'
    end, 1),
    (case l.sport
      when 'Soccer'    then 'Fourth Official'
      when 'Football'  then 'Line Judge'
      when 'Volleyball' then 'Line Judge'
      when 'Lacrosse'  then 'Field Judge'
      else null
    end, 2),
    (case l.sport
      when 'Football' then 'Back Judge'
      else null
    end, 3),
    (case l.sport
      when 'Football' then 'Side Judge'
      else null
    end, 4)
) as role(name, sort_order)
where role.name is not null
on conflict (season_id, name) do nothing;

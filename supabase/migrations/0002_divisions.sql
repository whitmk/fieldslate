-- Divisions
create table public.divisions (
  id uuid primary key default uuid_generate_v4(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  team_count integer not null default 8,
  start_date date,
  end_date date,
  settings jsonb not null default '{}',
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.divisions enable row level security;

create policy "League owners can manage divisions"
  on public.divisions for all
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = divisions.league_id
      and leagues.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.leagues
      where leagues.id = divisions.league_id
      and leagues.owner_id = auth.uid()
    )
  );

create trigger set_divisions_updated_at before update on public.divisions
  for each row execute procedure public.set_updated_at();

-- Division ↔ venue assignments
create table public.division_venues (
  division_id uuid not null references public.divisions(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  primary key (division_id, venue_id)
);

alter table public.division_venues enable row level security;

create policy "League owners can manage division venues"
  on public.division_venues for all
  using (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = division_venues.division_id
      and l.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = division_venues.division_id
      and l.owner_id = auth.uid()
    )
  );

-- Grants
grant select, insert, update, delete on public.divisions to authenticated;
grant select, insert, update, delete on public.division_venues to authenticated;

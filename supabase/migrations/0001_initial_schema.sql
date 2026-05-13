-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (synced from auth.users via trigger)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  role text not null default 'admin' check (role in ('admin', 'manager', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Leagues
create table public.leagues (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  sport text not null,
  season text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leagues enable row level security;

create policy "Owners can manage own leagues"
  on public.leagues for all
  using (auth.uid() = owner_id);

-- Venues
create table public.venues (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  address text,
  city text,
  state text,
  capacity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.venues enable row level security;

create policy "Owners can manage own venues"
  on public.venues for all
  using (auth.uid() = owner_id);

-- Teams
create table public.teams (
  id uuid primary key default uuid_generate_v4(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  logo_url text,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teams enable row level security;

create policy "League owners can manage teams"
  on public.teams for all
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = teams.league_id
      and leagues.owner_id = auth.uid()
    )
  );

-- Games
create table public.games (
  id uuid primary key default uuid_generate_v4(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  venue_id uuid references public.venues(id),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (
    status in ('scheduled', 'in_progress', 'completed', 'cancelled', 'postponed')
  ),
  home_score integer,
  away_score integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.games enable row level security;

create policy "League owners can manage games"
  on public.games for all
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = games.league_id
      and leagues.owner_id = auth.uid()
    )
  );

-- Updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_leagues_updated_at before update on public.leagues
  for each row execute procedure public.set_updated_at();

create trigger set_venues_updated_at before update on public.venues
  for each row execute procedure public.set_updated_at();

create trigger set_teams_updated_at before update on public.teams
  for each row execute procedure public.set_updated_at();

create trigger set_games_updated_at before update on public.games
  for each row execute procedure public.set_updated_at();

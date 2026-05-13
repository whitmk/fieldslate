create table if not exists public.blackout_dates (
  id uuid primary key default uuid_generate_v4(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  date date not null,
  label text,
  created_at timestamptz not null default now()
);

alter table public.blackout_dates enable row level security;

create policy "League owners can manage blackout dates"
  on public.blackout_dates for all
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = blackout_dates.league_id
      and leagues.owner_id = auth.uid()
    )
  );

create index if not exists blackout_dates_league_id_idx
  on public.blackout_dates (league_id);

create unique index if not exists blackout_dates_league_date_uidx
  on public.blackout_dates (league_id, date);

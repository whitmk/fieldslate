-- Create practices table for storing team practice sessions

create table public.practices (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  venue_id uuid references public.venues(id) on delete set null,
  scheduled_date date not null,
  start_time text not null,  -- 'HH:MM' 24-hour format
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now()
);

create index practices_division_id_idx on public.practices (division_id);
create index practices_team_id_idx on public.practices (team_id);
create index practices_league_id_date_idx on public.practices (league_id, scheduled_date);

alter table public.practices enable row level security;

create policy "League members can read practices"
  on public.practices for select
  using (
    league_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "League members can insert practices"
  on public.practices for insert
  with check (
    league_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "League members can update practices"
  on public.practices for update
  using (
    league_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "League members can delete practices"
  on public.practices for delete
  using (
    league_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

grant all on public.practices to authenticated;

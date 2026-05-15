-- Snack Shack: per-season configuration and block schedule.

-- Settings: one row per season, captures the wizard configuration
create table public.snack_shack_settings (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.leagues(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days_of_week jsonb not null default '[]'::jsonb,
  time_blocks_by_day jsonb not null default '{}'::jsonb,
  home_venue_ids jsonb not null default '[]'::jsonb,
  scheduling_preference text not null default 'prefer_game_days'
    check (scheduling_preference in ('prefer_game_days', 'prefer_off_days')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(season_id)
);

create index snack_shack_settings_season_id_idx on public.snack_shack_settings (season_id);

alter table public.snack_shack_settings enable row level security;

create policy "Season owners can read snack shack settings"
  on public.snack_shack_settings for select
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can insert snack shack settings"
  on public.snack_shack_settings for insert
  with check (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can update snack shack settings"
  on public.snack_shack_settings for update
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can delete snack shack settings"
  on public.snack_shack_settings for delete
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

grant all on public.snack_shack_settings to authenticated;

-- Blocks: one row per date+timeslot assignment
create table public.snack_shack_blocks (
  id uuid primary key default gen_random_uuid(),
  snack_shack_id uuid not null references public.snack_shack_settings(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  assigned_team_id uuid null references public.teams(id) on delete set null,
  is_recurring boolean not null default true,
  created_at timestamptz not null default now()
);

create index snack_shack_blocks_snack_shack_id_idx on public.snack_shack_blocks (snack_shack_id);
create index snack_shack_blocks_date_idx on public.snack_shack_blocks (date);

alter table public.snack_shack_blocks enable row level security;

create policy "Season owners can read snack shack blocks"
  on public.snack_shack_blocks for select
  using (
    snack_shack_id in (
      select s.id from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Season owners can insert snack shack blocks"
  on public.snack_shack_blocks for insert
  with check (
    snack_shack_id in (
      select s.id from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Season owners can update snack shack blocks"
  on public.snack_shack_blocks for update
  using (
    snack_shack_id in (
      select s.id from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Season owners can delete snack shack blocks"
  on public.snack_shack_blocks for delete
  using (
    snack_shack_id in (
      select s.id from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where l.owner_id = auth.uid()
    )
  );

grant all on public.snack_shack_blocks to authenticated;

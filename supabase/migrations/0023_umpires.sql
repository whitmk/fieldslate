-- Create umpires table — roster of officials available to a season's games.
-- season_id refers to the leagues table; "season" is the UI-facing rename.

create table public.umpires (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  designation text not null check (designation in ('youth', 'adult')),
  created_at timestamptz not null default now()
);

create index umpires_season_id_idx on public.umpires (season_id);

alter table public.umpires enable row level security;

create policy "Season owners can read umpires"
  on public.umpires for select
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can insert umpires"
  on public.umpires for insert
  with check (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can update umpires"
  on public.umpires for update
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

create policy "Season owners can delete umpires"
  on public.umpires for delete
  using (
    season_id in (
      select id from public.leagues where owner_id = auth.uid()
    )
  );

grant all on public.umpires to authenticated;

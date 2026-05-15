-- Add interleague toggle to divisions
alter table public.divisions
  add column plays_interleague boolean not null default false;

-- Per-division, per-org game count
create table public.division_interleague_games (
  id                 uuid        primary key default gen_random_uuid(),
  division_id        uuid        not null references public.divisions(id) on delete cascade,
  interleague_org_id uuid        not null references public.interleague_orgs(id) on delete cascade,
  game_count         integer     not null default 0 check (game_count >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (division_id, interleague_org_id)
);

alter table public.division_interleague_games enable row level security;

create policy "Division owners can select division_interleague_games"
  on public.division_interleague_games for select
  using (
    division_id in (
      select d.id from public.divisions d
      join public.leagues l on l.id = d.league_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Division owners can insert division_interleague_games"
  on public.division_interleague_games for insert
  with check (
    division_id in (
      select d.id from public.divisions d
      join public.leagues l on l.id = d.league_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Division owners can update division_interleague_games"
  on public.division_interleague_games for update
  using (
    division_id in (
      select d.id from public.divisions d
      join public.leagues l on l.id = d.league_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Division owners can delete division_interleague_games"
  on public.division_interleague_games for delete
  using (
    division_id in (
      select d.id from public.divisions d
      join public.leagues l on l.id = d.league_id
      where l.owner_id = auth.uid()
    )
  );

-- Reuse trigger function from migration 0028
create trigger division_interleague_games_set_updated_at
  before update on public.division_interleague_games
  for each row execute function public.set_updated_at();

grant all on public.division_interleague_games to authenticated;

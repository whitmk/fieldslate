-- Per-game umpire assignments.
-- Each row binds an umpire to a role on a specific game.

create table public.game_umpires (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  umpire_id uuid not null references public.umpires(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now()
);

create index game_umpires_game_id_idx on public.game_umpires (game_id);
create index game_umpires_umpire_id_idx on public.game_umpires (umpire_id);

-- One umpire can hold only one role on a given game, and a role can be filled
-- by only one umpire on a given game.
create unique index game_umpires_unique_umpire_per_game
  on public.game_umpires (game_id, umpire_id);
create unique index game_umpires_unique_role_per_game
  on public.game_umpires (game_id, role);

alter table public.game_umpires enable row level security;

create policy "Season owners can read game umpires"
  on public.game_umpires for select
  using (
    game_id in (
      select g.id from public.games g
      join public.leagues l on l.id = g.league_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Season owners can insert game umpires"
  on public.game_umpires for insert
  with check (
    game_id in (
      select g.id from public.games g
      join public.leagues l on l.id = g.league_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Season owners can update game umpires"
  on public.game_umpires for update
  using (
    game_id in (
      select g.id from public.games g
      join public.leagues l on l.id = g.league_id
      where l.owner_id = auth.uid()
    )
  );

create policy "Season owners can delete game umpires"
  on public.game_umpires for delete
  using (
    game_id in (
      select g.id from public.games g
      join public.leagues l on l.id = g.league_id
      where l.owner_id = auth.uid()
    )
  );

grant all on public.game_umpires to authenticated;

-- Allow games rows to represent interleague games where the away team is an
-- external organization rather than a team in our DB. Adds interleague_org_id
-- and relaxes away_team_id to nullable, with a CHECK to ensure every game
-- still has at least one form of opponent.

alter table public.games
  alter column away_team_id drop not null;

alter table public.games
  add column interleague_org_id uuid references public.interleague_orgs(id) on delete set null;

create index if not exists games_interleague_org_id_idx on public.games(interleague_org_id);

alter table public.games
  add constraint games_opponent_required check (
    away_team_id is not null or interleague_org_id is not null
  );

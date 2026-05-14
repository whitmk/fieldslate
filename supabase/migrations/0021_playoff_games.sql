-- Playoff bracket game records
create table if not exists public.playoff_games (
  id              uuid primary key default gen_random_uuid(),
  playoff_id      uuid not null references public.playoffs(id) on delete cascade,
  league_id       uuid not null references public.leagues(id) on delete cascade,
  division_id     uuid not null references public.divisions(id) on delete cascade,
  round           text not null,        -- e.g. "R1","R2","WF","LF","GF","RR1"
  game_number     integer not null,
  home_team_id    uuid references public.teams(id) on delete set null,
  away_team_id    uuid references public.teams(id) on delete set null,
  venue_id        uuid references public.venues(id) on delete set null,
  scheduled_date  date,
  start_time      time,
  status          text not null default 'scheduled'
                    check (status in ('scheduled','in_progress','completed','cancelled')),
  winner_id       uuid references public.teams(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.playoff_games enable row level security;

create policy "owners manage playoff_games"
  on public.playoff_games
  for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_id
        and l.owner_id = auth.uid()
    )
  );

grant all on public.playoff_games to authenticated;

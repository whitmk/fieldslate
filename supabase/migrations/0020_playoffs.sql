-- Creates the playoffs table.
-- One playoff record per (league_id, division_id) pair; the unique constraint
-- allows upsert by conflict without needing to know the row id.

create table public.playoffs (
  id                          uuid        primary key default gen_random_uuid(),
  league_id                   uuid        not null references public.leagues(id)   on delete cascade,
  division_id                 uuid        not null references public.divisions(id) on delete cascade,
  format                      text        not null
                                check (format in ('single_elimination', 'double_elimination', 'round_robin')),
  seeding                     jsonb       not null default '[]'::jsonb,
  start_date                  date,
  end_date                    date,
  playing_days                text[]      not null default '{}'::text[],
  day_windows                 jsonb       not null default '{}'::jsonb,
  venue_assignments           jsonb       not null default '[]'::jsonb,
  cross_division_enabled      boolean     not null default false,
  cross_division_opponent_id  uuid        references public.divisions(id),
  status                      text        not null default 'draft'
                                check (status in ('draft', 'active', 'completed')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  unique (league_id, division_id)
);

alter table public.playoffs enable row level security;

create policy "League owners manage playoffs"
  on public.playoffs
  for all
  using (
    exists (
      select 1 from public.leagues
      where leagues.id    = playoffs.league_id
        and leagues.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.leagues
      where leagues.id    = playoffs.league_id
        and leagues.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.playoffs to authenticated;

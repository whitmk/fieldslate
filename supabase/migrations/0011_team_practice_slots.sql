-- Recurring practice slots pinned per team per division
create table public.team_practice_slots (
  id           uuid primary key default uuid_generate_v4(),
  team_id      uuid not null references public.teams(id)     on delete cascade,
  division_id  uuid not null references public.divisions(id) on delete cascade,
  day_of_week  text not null check (day_of_week in ('Mo','Tu','We','Th','Fr','Sa','Su')),
  start_time   text not null,  -- 'HH:MM' 24-hour
  venue_id     uuid references public.venues(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (team_id, division_id)
);

alter table public.team_practice_slots enable row level security;

create policy "League owners can manage practice slots"
  on public.team_practice_slots for all
  using (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = team_practice_slots.division_id
        and l.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = team_practice_slots.division_id
        and l.owner_id = auth.uid()
    )
  );

create trigger set_team_practice_slots_updated_at
  before update on public.team_practice_slots
  for each row execute procedure public.set_updated_at();

grant select, insert, update, delete on public.team_practice_slots to authenticated;

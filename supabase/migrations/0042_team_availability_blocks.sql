-- Hard unavailability windows per team. The auto-assign engine must never
-- place a team on a (day, time) that falls inside one of these blocks —
-- they override preferred_days / preferred_time_id / preferred_field_id.
--
-- Day codes use the same 2-char convention as every other day-of-week
-- column in this schema (teams.preferred_days, practice_slots.practice_days,
-- practice_time_slots.days_of_week): Mo, Tu, We, Th, Fr, Sa, Su.

create table public.team_availability_blocks (
  id          uuid        primary key default gen_random_uuid(),
  team_id     uuid        not null references public.teams(id) on delete cascade,
  day_of_week text        not null
    check (day_of_week in ('Mo','Tu','We','Th','Fr','Sa','Su')),
  -- Null start_time + null end_time = whole day blocked. Otherwise both must
  -- be set, with end strictly after start.
  start_time  time,
  end_time    time,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint team_availability_blocks_time_shape check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index team_availability_blocks_team_idx
  on public.team_availability_blocks (team_id, day_of_week);

alter table public.team_availability_blocks enable row level security;

create policy "League owners manage team availability blocks"
  on public.team_availability_blocks for all
  using (
    team_id in (
      select t.id from public.teams t
      join public.leagues l on l.id = t.league_id
      where l.owner_id = auth.uid()
    )
  )
  with check (
    team_id in (
      select t.id from public.teams t
      join public.leagues l on l.id = t.league_id
      where l.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.team_availability_blocks to authenticated;

create trigger team_availability_blocks_set_updated_at
  before update on public.team_availability_blocks
  for each row execute function public.set_updated_at();

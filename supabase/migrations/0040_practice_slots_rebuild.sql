-- Practice slot system rebuild (Phase 1).
-- Practices are advisory only — completely decoupled from games. They don't
-- reserve fields, don't appear in game exports, and don't auto-cancel on
-- game days. The old `practices` table (individual practice instances) is
-- renamed to `practices_legacy` to preserve historical data; it can be
-- dropped in a follow-up once we're confident no readers remain.

alter table public.practices rename to practices_legacy;
alter index public.practices_pkey rename to practices_legacy_pkey;

-- Per-division labeled time presets. The admin picks which slots their
-- division uses ("5:00 PM", "6:30 PM", …) and the grid is built from these.
create table public.practice_time_slots (
  id               uuid        primary key default gen_random_uuid(),
  division_id      uuid        not null references public.divisions(id) on delete cascade,
  label            text        not null,
  start_time       time        not null,
  duration_minutes integer     not null default 90 check (duration_minutes > 0),
  sort_order       integer     not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index practice_time_slots_division_idx
  on public.practice_time_slots (division_id, sort_order, start_time);

alter table public.practice_time_slots enable row level security;

create policy "League owners manage practice time slots"
  on public.practice_time_slots for all
  using (
    division_id in (
      select d.id from public.divisions d
      join public.leagues l on l.id = d.league_id
      where l.owner_id = auth.uid()
    )
  )
  with check (
    division_id in (
      select d.id from public.divisions d
      join public.leagues l on l.id = d.league_id
      where l.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.practice_time_slots to authenticated;

create trigger practice_time_slots_set_updated_at
  before update on public.practice_time_slots
  for each row execute function public.set_updated_at();

-- Unified practice slots table — recurring (day-of-week array, no date) or
-- one-off (single date, no days). type column gates which is which.
create table public.practice_slots (
  id             uuid        primary key default gen_random_uuid(),
  team_id        uuid        not null references public.teams(id) on delete cascade,
  time_slot_id   uuid        references public.practice_time_slots(id) on delete set null,
  field_id       uuid        references public.venues(id) on delete set null,
  type           text        not null default 'recurring'
                 check (type in ('recurring', 'one_off')),
  practice_days  text[]      not null default '{}'::text[],
  date           date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- A recurring slot needs at least one day; a one-off needs a date.
  constraint practice_slots_type_shape check (
    (type = 'recurring' and array_length(practice_days, 1) >= 1 and date is null)
    or (type = 'one_off' and date is not null)
  )
);

create index practice_slots_team_idx
  on public.practice_slots (team_id);
create index practice_slots_time_slot_idx
  on public.practice_slots (time_slot_id);
create index practice_slots_one_off_idx
  on public.practice_slots (date)
  where type = 'one_off';

alter table public.practice_slots enable row level security;

create policy "League owners manage practice slots"
  on public.practice_slots for all
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

grant select, insert, update, delete on public.practice_slots to authenticated;

create trigger practice_slots_set_updated_at
  before update on public.practice_slots
  for each row execute function public.set_updated_at();

-- Team-level practice preferences. Null fields = "any" for the auto-assign
-- engine. practices_per_week is the cadence target; 0 means this team
-- doesn't practice.
alter table public.teams
  add column practices_per_week integer not null default 0
    check (practices_per_week between 0 and 4),
  add column preferred_days      text[],
  add column preferred_time_id   uuid references public.practice_time_slots(id) on delete set null,
  add column preferred_field_id  uuid references public.venues(id) on delete set null;

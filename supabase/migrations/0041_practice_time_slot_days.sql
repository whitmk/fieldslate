-- Scope practice time-slot presets to specific days of the week.
-- Previously a 5pm slot implicitly applied to all 7 days, so the grid
-- would render "Open" at 5pm on Sunday even when nobody practices
-- Sundays. This column lets a slot say "I'm a weekday slot" or "I'm a
-- weekend slot" so the grid and the auto-assign engine ignore days
-- the slot doesn't cover.
--
-- Day codes match the 2-char convention already used by teams.preferred_days
-- and practice_slots.practice_days: Mo, Tu, We, Th, Fr, Sa, Su.

alter table public.practice_time_slots
  add column days_of_week text[]
    not null
    default array['Mo','Tu','We','Th','Fr','Sa','Su']::text[];

-- Backfill existing rows to the full week so current behavior is preserved
-- exactly when this ships. (The default would handle new rows, but existing
-- rows need an explicit update.)
update public.practice_time_slots
  set days_of_week = array['Mo','Tu','We','Th','Fr','Sa','Su']::text[]
  where days_of_week is null
     or array_length(days_of_week, 1) is null;

alter table public.practice_time_slots
  add constraint practice_time_slots_days_of_week_nonempty
  check (array_length(days_of_week, 1) >= 1);

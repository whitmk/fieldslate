-- Add separate season date range for practice scheduling.
-- Falls back to divisions.start_date / end_date when null.
alter table public.divisions
  add column practice_season_start date,
  add column practice_season_end   date;

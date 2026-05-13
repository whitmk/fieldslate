-- Allow multiple practice slots per team per division
-- The previous unique(team_id, division_id) constraint only permitted one row
alter table public.team_practice_slots
  drop constraint team_practice_slots_team_id_division_id_key;

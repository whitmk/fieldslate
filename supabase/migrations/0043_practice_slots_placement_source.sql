-- Track whether a practice_slot was placed by hand or by the auto-assign
-- engine. The grid renders a lock icon on manual chips and the slot edit
-- modal shows a "Manual"/"Auto" badge. Engine still layers on top of every
-- existing slot regardless of source — this is purely informational.
--
-- Backfill all existing rows to 'manual' on purpose: an admin who built the
-- current grid by hand expects those placements to stick. They can re-run
-- auto-assign for fresh placements whenever they want.

alter table public.practice_slots
  add column placement_source text not null default 'manual'
    check (placement_source in ('manual', 'auto'));

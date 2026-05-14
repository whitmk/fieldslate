-- Allow 'unscheduled' as a status for practice slots the generator could not fill.
-- These placeholder rows persist in the practices table so the division detail page
-- can surface them as actionable critical-alert items; they are deleted and re-created
-- on every generator run, and updated to 'scheduled' when manually placed.

alter table public.practices
  drop constraint if exists practices_status_check;

alter table public.practices
  add constraint practices_status_check
  check (status in ('scheduled', 'cancelled', 'unscheduled'));

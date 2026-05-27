-- Per-venue weekly availability windows (mirrors divisions.settings.day_windows
-- shape). Absent day key = closed that day. Existing venues default to {} and
-- availability_configured=false so the engine refuses to schedule against them
-- until the admin explicitly sets hours.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS availability jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS availability_configured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN venues.availability IS
  'Per-day open windows {Mo: {start: "HH:MM", end: "HH:MM"}, ...}. Absent day = closed.';
COMMENT ON COLUMN venues.availability_configured IS
  'True once an admin has explicitly saved hours for this venue. Scheduling paths skip venues where this is false.';

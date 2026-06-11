-- 0066: first-run setup wizard dismissed flag.
--
-- The (dashboard) layout redirects brand-new org owners (zero venues, zero
-- active seasons, never invited to another org) to /setup until they finish
-- or dismiss. Lives on profiles because an org IS its owner's profile row
-- (no organizations table) — same home as org_name (0044) and pending_plan
-- (0061). Writable through the existing "Users can update own profile"
-- UPDATE policy (0001); no trigger changes needed.

alter table public.profiles
  add column setup_dismissed boolean not null default false;

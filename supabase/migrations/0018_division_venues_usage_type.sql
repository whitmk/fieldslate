-- Add per-division, per-venue usage flags.
-- Existing rows default to both allowed (backward compatible).
alter table public.division_venues
  add column allow_games     boolean not null default true,
  add column allow_practices boolean not null default true;

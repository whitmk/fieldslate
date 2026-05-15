-- Add umpire requirement columns to divisions.
-- umpires_per_game: 0 means no umpires required for the division.
-- umpire_roles: ordered list of role labels (e.g. ["Plate", "Field"]); length matches umpires_per_game.

alter table public.divisions
  add column if not exists umpires_per_game integer not null default 0
    check (umpires_per_game >= 0 and umpires_per_game <= 4),
  add column if not exists umpire_roles jsonb not null default '[]'::jsonb;

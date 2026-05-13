-- Add venue_type to venues (game = game use only, practice = practice only, both = either)
alter table public.venues
  add column venue_type text not null default 'game'
  check (venue_type in ('game', 'practice', 'both'));

-- Add activities_per_week to divisions (total games + practices combined per team per week)
alter table public.divisions
  add column activities_per_week integer not null default 2;

-- Add practice_venue_id to divisions (default venue for practice sessions)
alter table public.divisions
  add column practice_venue_id uuid references public.venues(id) on delete set null;

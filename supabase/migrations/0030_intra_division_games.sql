-- Nullable so existing rows fall back to settings.games_per_team in the generator
alter table public.divisions
  add column intra_division_games_per_team integer;

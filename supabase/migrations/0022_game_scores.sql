-- Add score columns to playoff_games
ALTER TABLE playoff_games
  ADD COLUMN home_score integer,
  ADD COLUMN away_score integer;

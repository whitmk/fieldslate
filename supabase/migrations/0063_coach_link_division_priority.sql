-- Coach link + division priority.
--
-- 1. umpires.team_id — optional link to the team an official coaches, so
--    assignment surfaces can flag coach conflicts (official assigned to a
--    game involving their own team). ON DELETE SET NULL: deleting the team
--    keeps the official.
-- 2. divisions.priority — auto-assign ordering preference (lower = assigned
--    first). Default 0; the officials page exposes drag-to-reorder which
--    writes sequential values.

ALTER TABLE umpires
  ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE divisions
  ADD COLUMN priority integer NOT NULL DEFAULT 0;

CREATE INDEX umpires_team_id_idx ON umpires(team_id);
CREATE INDEX divisions_priority_idx ON divisions(priority);

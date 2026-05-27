-- Adds a dedicated archived_at timestamp on leagues (a.k.a. "seasons" in
-- product copy). NULL = active; non-NULL = archived (with the timestamp).
--
-- The existing leagues.status column already supports an 'archived' value;
-- new app code keeps the two in sync (archive sets both; unarchive clears
-- archived_at and sets status='active'). archived_at is the source of truth
-- for filter/list logic; status drives the visual pill via existing code.

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN leagues.archived_at IS
  'Timestamp the season was archived. NULL = active. App code keeps in sync with status (archive sets both; unarchive clears both).';

-- Filter index — list pages query owner_id + a NULL/NOT NULL test on
-- archived_at every load.
CREATE INDEX IF NOT EXISTS leagues_owner_id_archived_at_idx
  ON leagues (owner_id, archived_at);

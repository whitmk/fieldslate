-- Proof for 0121 (volunteer game roles + claims). THE BODY ARRIVES WITH THE
-- MIGRATION (branch feat/volunteer-game-roles, commit 2). Today this file
-- holds only the two case tables below, which are the ONE copy of the slot
-- rules shared by both languages:
--
--   * npm run sim:volunteer-slots parses each block and runs every row
--     through src/lib/volunteers/slots.ts (VT1, VC1);
--   * the 0121 proof will run the same rows through the SQL functions.
--
-- Change a rule in one language alone and its side goes red. Each marker sits
-- alone on its own line, one row per line; never add a second copy.
--
-- VSLOT table — one game, one role. The home team is in division H, the away
-- team (when there is one) in division A. Columns:
--   id, status, interleague, is_away, has_away_team, role kind,
--   H in the role, A in the role, locked divisions (both/home/away/none),
--   when the game starts relative to now 2026-11-10T12:00
--     (past = 2026-11-09T12:00, started = 11:59, now = 12:00,
--      soon = 12:30, future = 2026-11-20T10:00),
--   sign-ups open, expected spot sets, expected refusal for the FIRST spot
--   set (home team's before the away team's; null = may be taken;
--   no_slot when there are none).
--
-- VSLOT-TABLE-BEGIN
  ('V01', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, null),
  ('V02', 'scheduled',           false, false, true,  'per_team', true,  true,  'both', 'future',  true,  2, null),
  ('V03', 'scheduled',           false, false, true,  'per_team', true,  false, 'both', 'future',  true,  1, null),
  ('V04', 'scheduled',           false, false, true,  'per_team', false, true,  'away', 'future',  true,  1, null),
  ('V05', 'scheduled',           true,  false, false, 'per_game', true,  false, 'home', 'future',  true,  1, null),
  ('V06', 'scheduled',           true,  true,  false, 'per_game', true,  false, 'home', 'future',  true,  0, 'no_slot'),
  ('V07', 'scheduled',           true,  true,  false, 'per_team', true,  false, 'home', 'future',  true,  1, null),
  ('V08', 'scheduled',           true,  false, false, 'per_team', true,  false, 'home', 'future',  true,  1, null),
  ('V09', 'pending_interleague', true,  false, false, 'per_team', true,  false, 'both', 'future',  true,  0, 'no_slot'),
  ('V10', 'reschedule_pending',  false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, null),
  ('V11', 'cancelled',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, 'rained_out'),
  ('V12', 'completed',           false, false, true,  'per_game', true,  true,  'both', 'future',  true,  1, 'closed'),
  ('V13', 'in_progress',         false, false, true,  'per_team', true,  true,  'both', 'future',  true,  2, 'closed'),
  ('V14', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'past',    true,  1, 'past'),
  ('V15', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'started', true,  1, 'past'),
  ('V16', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'now',     true,  1, 'past'),
  ('V17', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'soon',    true,  1, null),
  ('V18', 'scheduled',           false, false, true,  'per_game', false, true,  'both', 'future',  true,  0, 'no_slot'),
  ('V19', 'scheduled',           false, false, true,  'per_game', true,  true,  'none', 'future',  true,  1, 'unpublished'),
  ('V20', 'scheduled',           false, false, true,  'per_game', true,  true,  'away', 'future',  true,  1, 'unpublished'),
  ('V21', 'scheduled',           false, false, true,  'per_team', true,  true,  'away', 'future',  true,  2, 'unpublished'),
  ('V22', 'scheduled',           false, false, true,  'per_game', true,  true,  'both', 'future',  false, 1, 'signups_closed'),
  ('V23', 'cancelled',           false, false, true,  'per_game', true,  true,  'both', 'past',    true,  1, 'rained_out'),
  ('V24', 'scheduled',           false, false, false, 'per_team', true,  true,  'both', 'future',  true,  1, null),
  ('V25', 'scheduled',           true,  true,  false, 'per_team', true,  false, 'none', 'future',  true,  1, 'unpublished'),
  ('V26', 'reschedule_pending',  true,  true,  false, 'per_game', true,  false, 'home', 'future',  true,  0, 'no_slot'),
  ('V27', 'cancelled',           false, false, true,  'per_game', true,  true,  'none', 'future',  false, 1, 'rained_out'),
  ('V28', 'scheduled',           false, false, true,  'per_team', false, false, 'both', 'future',  true,  0, 'no_slot')
-- VSLOT-TABLE-END
--
-- VCHANGE table — may a volunteer still change or cancel a spot? Columns:
--   id, spot start (wall clock), now (wall clock), allowed. Strictly more
--   than 24 hours ahead; exactly 24 hours is too late.
--
-- VCHANGE-TABLE-BEGIN
  ('C01', '2026-11-11T12:01', '2026-11-10T12:00', true),
  ('C02', '2026-11-11T12:00', '2026-11-10T12:00', false),
  ('C03', '2026-11-11T11:59', '2026-11-10T12:00', false),
  ('C04', '2026-12-01T09:00', '2026-11-29T09:00', true),
  ('C05', '2026-12-01T09:00', '2026-11-30T09:01', false),
  ('C06', '2027-01-01T10:00', '2026-12-31T09:59', true),
  ('C07', '2026-11-10T10:00', '2026-11-10T12:00', false),
  ('C08', '2026-11-08T10:00', '2026-11-01T10:00', true)
-- VCHANGE-TABLE-END

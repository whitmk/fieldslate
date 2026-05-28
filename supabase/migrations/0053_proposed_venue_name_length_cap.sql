-- Length cap on `proposed_venue_name` — defense in depth.
--
-- This column receives recipient-submitted free text from external
-- (non-FieldSlate) interleague parties via accept_interleague_invite and the
-- reschedule counter flows. The 5 ingestion route handlers now reject any
-- value > 200 chars before reaching the DB (see
-- src/lib/interleague/validate-venue-name.ts), but a CHECK constraint
-- guarantees the invariant even if a new write path is added later that
-- forgets to validate.
--
-- Pre-flight at apply time (Batch E):
--   select max(length(proposed_venue_name)) from games;                          -- 21 (12 rows)
--   select max(length(proposed_venue_name)) from interleague_reschedule_requests; -- 0 (0 rows)
-- Both well under 200, so the constraint applies without backfill.

alter table public.games
  add constraint games_proposed_venue_name_length
  check (proposed_venue_name is null or length(proposed_venue_name) <= 200);

alter table public.interleague_reschedule_requests
  add constraint interleague_reschedule_requests_proposed_venue_name_length
  check (proposed_venue_name is null or length(proposed_venue_name) <= 200);

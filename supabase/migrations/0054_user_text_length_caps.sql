-- Length caps on remaining user-submitted free-text columns.
--
-- Defense-in-depth pair with the app-layer validators in
-- src/lib/validation/text-length.ts (LIMITS constants). The 8 ingestion
-- routes that write these columns now reject overlong inputs with a 400
-- before the DB ever sees them; these CHECK constraints guarantee the
-- invariant for any future write path (or direct PostgREST call from a
-- rogue client) that forgets to validate.
--
-- Pre-flight at apply time (Batch F):
--   games.external_team_name              max  11 (16 rows) — cap 100
--   interleague_invites.personal_note     max  41 ( 3 rows) — cap 2000
--   interleague_invites.decline_reason    max   0 ( 0 rows) — cap 2000
--   interleague_reschedule_requests.note  max   0 ( 0 rows) — cap 2000
--   profiles.org_name                     max  33 ( 3 rows) — cap 100
-- All well under their caps, so the constraints apply without backfill.
--
-- Note: profiles.org_name has no server-side API route — the settings UI
-- writes directly to PostgREST via the client. This CHECK is the only
-- server-side enforcement; the existing client-side cap (80) gives UX
-- feedback inside that headroom.

alter table public.games
  add constraint games_external_team_name_length
  check (external_team_name is null or length(external_team_name) <= 100);

alter table public.interleague_invites
  add constraint interleague_invites_personal_note_length
  check (personal_note is null or length(personal_note) <= 2000);

alter table public.interleague_invites
  add constraint interleague_invites_decline_reason_length
  check (decline_reason is null or length(decline_reason) <= 2000);

alter table public.interleague_reschedule_requests
  add constraint interleague_reschedule_requests_note_length
  check (note is null or length(note) <= 2000);

alter table public.profiles
  add constraint profiles_org_name_length
  check (org_name is null or length(org_name) <= 100);

// Length cap for `proposed_venue_name` on `games` and
// `interleague_reschedule_requests`. Both columns receive recipient-submitted
// free text from external (non-FieldSlate) interleague parties — see the DB
// CHECK constraints in migration 0053. Keep this constant in sync if the
// constraint ever moves.
export const VENUE_NAME_MAX = 200;

export type VenueNameResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

// Validate a recipient-submitted venue name. Empty / whitespace / non-string
// inputs collapse to null (no proposed name is valid). A trimmed value that
// exceeds VENUE_NAME_MAX is REJECTED rather than truncated — a truncated venue
// name is meaningless and the recipient should know their input was too long.
export function validateVenueName(raw: unknown): VenueNameResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: true, value: null };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > VENUE_NAME_MAX) {
    return {
      ok: false,
      error: `Venue name must be ${VENUE_NAME_MAX} characters or fewer`,
    };
  }
  return { ok: true, value: trimmed };
}

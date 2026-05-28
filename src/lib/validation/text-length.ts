// Length caps for user-submitted free-text columns. Keep these in sync with
// the DB CHECK constraints in migrations 0053 (proposed_venue_name) and 0054
// (external_team_name, personal_note, decline_reason, reschedule note, org_name).
//
// Rationale per tier:
//   - VENUE_NAME: 200 — venue names can be long ("Marshall Mountain Lions Stadium, Field 3")
//   - TEAM_NAME / ORG_NAME: 100 — display strings; line-wrap pain above ~80
//   - NOTE: 2000 — long-form free text but still rejectable as DoS payload
export const LIMITS = {
  VENUE_NAME: 200,
  TEAM_NAME: 100,
  NOTE: 2000,
  ORG_NAME: 100,
} as const;

export type TextLengthResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

// Validate user-submitted text against a length cap. Empty / whitespace /
// non-string inputs collapse to null. A trimmed value exceeding `max` is
// REJECTED rather than truncated — truncation produces meaningless data and
// the caller should know their input was too long.
export function validateText(
  input: unknown,
  max: number,
  errorMessage: string,
): TextLengthResult {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: true, value: null };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > max) return { ok: false, error: errorMessage };
  return { ok: true, value: trimmed };
}

// Convenience wrappers — keep one place per column so error messages stay
// consistent between routes.
export function validateVenueName(input: unknown): TextLengthResult {
  return validateText(
    input,
    LIMITS.VENUE_NAME,
    `Venue name must be ${LIMITS.VENUE_NAME} characters or fewer`,
  );
}

export function validateTeamName(input: unknown): TextLengthResult {
  return validateText(
    input,
    LIMITS.TEAM_NAME,
    `Team name must be ${LIMITS.TEAM_NAME} characters or fewer`,
  );
}

export function validateNote(input: unknown): TextLengthResult {
  return validateText(
    input,
    LIMITS.NOTE,
    `Note must be ${LIMITS.NOTE} characters or fewer`,
  );
}

export function validateOrgName(input: unknown): TextLengthResult {
  return validateText(
    input,
    LIMITS.ORG_NAME,
    `Organization name must be ${LIMITS.ORG_NAME} characters or fewer`,
  );
}

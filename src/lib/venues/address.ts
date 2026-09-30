// Field / park street address (0100) — the ONE place its rules live.
//
// The address exists so the team calendar feed's LOCATION line can carry it
// (a phone then opens the field in Maps). It is shown to admins on the Venues
// page and NOWHERE else: not printed, not exported, not on a partner page.
// The reader (get_team_calendar_by_token) resolves venue-else-park in SQL;
// `effectiveAddress` is its TypeScript twin for the Venues card, and the two
// must agree: the venue's own address wins, a blank one falls to the park's.
//
// The database CHECK (0100) refuses more than 200 characters and any control
// character. Everything softer — trimming, collapsing runs of whitespace,
// blank-as-null — happens here, before a write, so the CHECK is a backstop
// and not the thing a user meets.

export const ADDRESS_MAX_LENGTH = 200;

/** Trim, collapse internal whitespace (including pasted newlines and tabs)
 *  to one space, and read an empty result as null — never "" in the
 *  database. */
export function normalizeAddress(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length === 0 ? null : v;
}

/** The address a field is reached at: its own, else its park's, else null.
 *  Mirrors the reader's coalesce so the Venues card and the feed agree. */
export function effectiveAddress(
  venue: { address?: string | null },
  location?: { address?: string | null } | null,
): string | null {
  return normalizeAddress(venue.address) ?? normalizeAddress(location?.address) ?? null;
}

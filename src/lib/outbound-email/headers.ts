// The From and Reply-To of every league email FieldSlate sends on a league's
// behalf (volunteer sign-ups, officials sign-up), and the error text that goes
// into an outbox log. Pure — no I/O, no clock. Lifted VERBATIM from
// src/lib/volunteers/email-headers.ts (2026-11-09) so the officials code can
// use it without crossing the volunteer fence (sim:volunteer-leaks U1); that
// file now re-exports from here.
//
// From is "<League> via FieldSlate <FieldSlate's address>". The league name
// is text an admin typed (profiles.org_name), so it is sanitized before it
// goes into a header: no control characters (CR/LF would start a new header),
// no quotes, backslashes or angle brackets (they would end the quoted name or
// open a second address), no bidi controls (they can make the name read as
// something else), whitespace collapsed, at most 60 characters.
//
// The address shape below is the SAME rule as the CHECKs in migration 0120
// (volunteer_settings.contact_email, volunteers.email_lc). sim:volunteer-email
// [X1] reads the migration and fails if the two drift.

/** One @, no whitespace, control characters, quotes, angle brackets, commas,
 *  semicolons, colons, parentheses or backslashes; a dot after the @. */
export const EMAIL_SHAPE =
  /^[^@\s\p{Cc}<>"(),;:\\]+@[^@\s\p{Cc}<>"(),;:\\]+\.[^@\s\p{Cc}<>"(),;:\\]+$/u;
export const EMAIL_MAX = 254;

/** The display name used when the league has no usable name. */
export const FALLBACK_LEAGUE_NAME = "Your league";
const NAME_MAX = 60;

export function isEmailShape(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= EMAIL_MAX && EMAIL_SHAPE.test(value);
}

/** The league name, safe for a quoted display name. */
export function safeDisplayName(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    // Control characters, line/paragraph separators and bidi controls go.
    .replace(/[\p{Cc}\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/["\\<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = Array.from(cleaned).slice(0, NAME_MAX).join("").trim();
  return cut || FALLBACK_LEAGUE_NAME;
}

/** FieldSlate's bare sending address, from RESEND_FROM_EMAIL (which may be
 *  "Name <addr>" or "addr"). Null when it isn't a usable address. */
export function bareFromAddress(envFrom: string | null | undefined): string | null {
  const s = (envFrom ?? "").trim();
  const inAngles = s.match(/<([^<>]+)>\s*$/);
  const addr = (inAngles ? inAngles[1] : s).trim();
  return isEmailShape(addr) ? addr : null;
}

/** `"<League> via FieldSlate" <addr>`. */
export function leagueFromHeader(leagueName: string | null | undefined, address: string): string {
  return `"${safeDisplayName(leagueName)} via FieldSlate" <${address}>`;
}

/** The reply-to, or null when it isn't a single plain address. */
export function safeReplyTo(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  return isEmailShape(s) ? s : null;
}

/** Error text for the outbox log: no addresses, no control characters, at
 *  most 500 characters (the column's CHECK). */
export function scrubError(raw: unknown): string {
  const s = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "send failed";
  const out = s
    .replace(/[^\s@<>"]+@[^\s@<>"]+/g, "[address]")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (out || "send failed").slice(0, 500);
}

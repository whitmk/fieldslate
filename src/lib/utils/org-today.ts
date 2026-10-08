// "Today" for a league, and whether a stored game date is on or before it.
// ONE definition, shared by every browser-side rule that asks "has this
// happened yet?" — the snack shack's frozen past and "Record where it was
// played". Do NOT use the other "past" checks in this repo for a new rule:
// the Schedule page's `todayLocalDateString` reads the SERVER clock (UTC on
// Vercel), the `new Date().toISOString()` comparisons are off by the org's UTC
// offset against wall-clock-at-+00 storage, and the slot list reads the
// BROWSER's local date.
//
// THE RULE: the wall-clock DATE PART of `scheduled_at` (the house convention —
// read the string, never parse the instant) compared with today in the ORG's
// timezone (profiles.timezone). The database applies the same rule as
// `(now() at time zone <org timezone>)::date` — record_game_played (0106) does
// exactly that, so the form and the fence cannot disagree about which day it is.

/** Today's date, "YYYY-MM-DD", in an IANA zone. Throws on an unknown zone —
 *  a wrong "today" would freeze or unfreeze the wrong day silently. */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  if (!y || !m || !d) throw new Error(`todayInTimezone: could not format a date in ${timeZone}`);
  return `${y}-${m}-${d}`;
}

/** The wall-clock date of a stored or bare timestamp — "2026-10-04T10:00:00+00:00"
 *  → "2026-10-04". Never parses the instant. */
export function wallClockDate(iso: string): string {
  return iso.substring(0, 10);
}

/** Whether a game dated `iso` is strictly before `today` — a past day. A game
 *  later today is NOT past (auto-assign still staffs it). */
export function isBeforeToday(iso: string, today: string): boolean {
  return wallClockDate(iso) < today;
}

/** Whether a game dated `iso` is on or before `today` ("YYYY-MM-DD"). */
export function isOnOrBeforeToday(iso: string, today: string): boolean {
  return wallClockDate(iso) <= today;
}

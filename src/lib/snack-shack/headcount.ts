// How many people a snack shack shift needs (0119). Pure — no React, no data
// access. EVERY surface asks these functions; nothing computes a headcount or
// words one on its own.
//
// THE RULE (decided 2026-11-07):
//   - A season sets `people_per_shift` (1–20, default 1).
//   - A shift may override it with `people_needed` (1–20); null = the
//     season's number. The effective count is the override, else the season.
//   - The FULL-SCHEDULE print shows "3 people" ONLY when the effective count
//     is above 1 (`headcountPrintLine`). Team prints and both emails never
//     show a headcount.
//   - Regenerate carries a shift's override to its same-start replacement,
//     like a note (0119's RPC).
// The 1–20 bounds mirror 0119's CHECKs; change both together.

export const PEOPLE_MIN = 1;
export const PEOPLE_MAX = 20;

/** The choices a people control offers, PEOPLE_MIN..PEOPLE_MAX. */
export const PEOPLE_OPTIONS: readonly number[] = Array.from(
  { length: PEOPLE_MAX - PEOPLE_MIN + 1 },
  (_, i) => PEOPLE_MIN + i,
);

/** A count the database will accept. */
export function isValidPeople(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= PEOPLE_MIN && n <= PEOPLE_MAX;
}

/** The season's number as stored, or 1 when it is missing or unusable (a row
 *  read before 0119, or a value the CHECK would refuse). */
export function seasonPeople(raw: unknown): number {
  const n = Number(raw);
  return isValidPeople(n) ? n : PEOPLE_MIN;
}

export type HeadcountSource = { people_needed?: number | null };

/** The people a shift needs: its own override, else the season's number. */
export function effectivePeople(block: HeadcountSource, seasonDefault: number): number {
  const own = block.people_needed;
  return own != null && isValidPeople(Number(own)) ? Number(own) : seasonPeople(seasonDefault);
}

/** "1 person" / "3 people". */
export function peopleLabel(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

/** The full-schedule print's headcount: "3 people" when the effective count is
 *  above 1, else "" (nothing printed). The ONLY way a headcount reaches a
 *  print — and only the full-schedule print. */
export function headcountPrintLine(block: HeadcountSource, seasonDefault: number): string {
  const n = effectivePeople(block, seasonDefault);
  return n > 1 ? peopleLabel(n) : "";
}

/** The admin list's line for a shift: shown only when the effective count is
 *  above 1 or the shift has its own number, so a season at 1 with no overrides
 *  reads exactly as before. */
export function headcountListLine(block: HeadcountSource, seasonDefault: number): string | null {
  const n = effectivePeople(block, seasonDefault);
  const own = block.people_needed != null;
  if (!own && n <= 1) return null;
  return own ? `${peopleLabel(n)} (this shift)` : peopleLabel(n);
}

/** The per-shift control's choices: "" = the season's number, then 1..20. */
export function overrideOptionLabel(value: number | null, seasonDefault: number): string {
  return value == null ? `Season default (${peopleLabel(seasonPeople(seasonDefault))})` : peopleLabel(value);
}

/** A per-shift control's value back to what is stored: "" → null. */
export function overrideFromInput(v: string): number | null {
  if (v === "") return null;
  const n = Number(v);
  return isValidPeople(n) ? n : null;
}

/** The regenerate preview's words for a carried or lost override. */
export function headcountCarryText(peopleNeeded: number | null | undefined): string {
  return peopleNeeded != null ? `needs ${peopleLabel(peopleNeeded)}` : "";
}

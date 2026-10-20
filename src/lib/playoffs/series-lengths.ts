// Series lengths and the series home rule — no imports at all, so the planner
// (bracket-plan.ts) can use them without an import cycle. Everything else
// about series is in series.ts; names are in series-names.ts.

/** A round is 1 game, or best of 3, 5 or 7 (decided 2026-10-20). */
export const SERIES_LENGTHS = [1, 3, 5, 7] as const;
export type SeriesLength = (typeof SERIES_LENGTHS)[number];

/** Round label ("R1", "R2", "SF", "F") → its series length. A round that
 *  isn't listed is 1 game — which is how every bracket works today. Stored in
 *  `playoffs.series_by_round` (0114). */
export type SeriesByRound = Partial<Record<string, SeriesLength>>;

export function isSeriesLength(n: unknown): n is SeriesLength {
  return typeof n === "number" && (SERIES_LENGTHS as readonly number[]).includes(n);
}

/** A round's length; anything missing or not 1/3/5/7 reads as 1. */
export function seriesLengthFor(map: SeriesByRound | null | undefined, round: string): SeriesLength {
  const n = map?.[round];
  return isSeriesLength(n) ? n : 1;
}

/** True when any round is longer than 1 game. */
export function hasSeries(map: SeriesByRound | null | undefined): boolean {
  return Object.values(map ?? {}).some((n) => isSeriesLength(n) && n > 1);
}

/** Only the valid entries of a stored value; everything else is dropped. */
export function parseSeriesByRound(raw: unknown): SeriesByRound {
  const out: SeriesByRound = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isSeriesLength(v) && v > 1) out[k] = v;
  }
  return out;
}

/** Wins that decide a series: 2 of 3, 3 of 5, 4 of 7 (1 of 1). */
export function winsNeeded(length: number): number {
  return Math.floor(length / 2) + 1;
}

/** A team's TRUE seed — its place in the seeding list (1 = top), or null when
 *  it has none. In Stage 2 of a two-stage setup it is the seed the admin gave. */
export type SeedOf = (teamId: string) => number | null;

/**
 * Home and away for game `k` of a series between the teams in bracket slots A
 * and B (A = the slot a round's home team sits in today). Until BOTH teams are
 * known nothing is decided: each team stays in its bracket slot and no home
 * team is shown publicly. Once both are known, the higher true seed (lower
 * number) is home in games 1, 3, 5 and 7 and away in 2, 4 and 6 (decided
 * 2026-10-20). A team with no seed counts below one that has a seed; with no
 * seeds at all slot A is treated as the higher seed.
 */
export function seriesHomeAway(
  k: number,
  slotA: string | null,
  slotB: string | null,
  seedOf: SeedOf,
): { home: string | null; away: string | null } {
  if (!slotA || !slotB) return { home: slotA, away: slotB };
  const a = seedOf(slotA);
  const b = seedOf(slotB);
  const bIsHigher = b !== null && (a === null || b < a);
  const top = bIsHigher ? slotB : slotA;
  const other = bIsHigher ? slotA : slotB;
  return k % 2 === 1 ? { home: top, away: other } : { home: other, away: top };
}

// Resolving a division's game duration out of `divisions.settings`.
//
// WHERE THE DATA COMES FROM. The Schedule page's existing divisions query — the
// one that already feeds the division filter dropdown and the Add Game modal —
// selects one extra projected key:
//
//     .select("id, name, league_id, game_duration:settings->game_duration")
//
// PostgREST projects that single jsonb key SERVER-SIDE, so the rest of
// `settings` never reaches the wire. That matters: `settings` also carries the
// division's whole `teams[]` array with coach metadata (2,167 bytes for the
// largest live division, 7,868 across one season's five).
//
// NEVER EMBED `division:divisions(settings)` ON THE GAMES QUERY. That ships the
// entire blob once PER GAME ROW. Measured on SRALL Fall 2026 (272 games,
// 2026-08-21): +479,118 bytes onto a 184,267-byte response — a 2.6x blow-up to
// carry one integer per division. The projected key on the divisions read costs
// 338 bytes for the same season, on a request the page was making anyway.
//
// NO FABRICATED FALLBACK — DELIBERATE. There are currently fifteen sites in this
// repo that resolve a game duration, under four different fallback policies
// (throw / 90-with-a-finite-positive-test / 90-via-`?? 90` / 0). Baking any one
// of them in here would silently pick a winner for every future consumer. A
// division whose duration is unusable is simply ABSENT from the map, so the
// caller sees `undefined` and decides for itself whether that means "start time
// only", "duration not set", or some default of its own.
//
// THE USABILITY TEST mirrors `isUsableDuration` in detect-conflicts.ts, for the
// same two reasons stated there: `typeof x === "number"` is TRUE for NaN, and a
// zero or negative duration collapses into a zero-length span that silently
// matches nothing. Finite AND positive, never a typeof check.

/** One row of the Schedule page's divisions read. `game_duration` is the raw
 *  projected jsonb value, so it arrives as whatever was stored — number,
 *  string, null, or absent — hence `unknown`. */
export type DivisionDurationRow = {
  id: string;
  game_duration?: unknown;
};

/**
 * division id → game duration in minutes, for every row whose
 * `settings.game_duration` is a finite, positive number.
 *
 * Rows with a missing, zero, negative, non-finite, or non-numeric duration are
 * OMITTED rather than defaulted — see the header.
 *
 * Pure: no read, no throw. It cannot fail independently of the divisions query
 * it is fed from, which is the point of taking rows rather than a client — if
 * that read fails, the caller's division list is already visibly empty.
 */
export function gameDurationsFromDivisionRows(
  rows: DivisionDurationRow[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const minutes = Number(row.game_duration);
    if (Number.isFinite(minutes) && minutes > 0) out.set(row.id, minutes);
  }
  return out;
}

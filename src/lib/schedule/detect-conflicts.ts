// Pure venue-conflict detection — no "use client", safe to import in server
// components. `detectScheduleConflicts` in generate-schedule.ts is the
// client-side wrapper; it shares THIS file's predicate rather than carrying a
// second copy, so the two can no longer drift.
//
// ── The model: real spans, and the LATER game's buffer ───────────────────────
//
// Two games conflict when their real spans overlap, where each game's span is
// [start, start + ITS OWN division's game_duration) — half-open, so a game
// starting exactly when another ends does NOT conflict. Separation between them
// is governed by the LATER game's `buffer_minutes`, applied by pushing the later
// game's start BACK by its own buffer before the overlap test.
//
// WHY THE LATER GAME'S BUFFER, AND WHY `max()` IS WRONG. The buffer exists so
// the ARRIVING team can warm up and take the field. It is not the departing
// game's teardown allowance. So the gap a pairing needs is whatever the game
// showing up next needs — not the bigger of the two, and not the incumbent's.
//
// `max(bufA, bufB)` is the rule most people reach for when making a one-sided
// rule symmetric, and it is WRONG: it reproduced all 8 live SRALL false
// positives exactly (Majors 120+60 followed by Minors 105+30 with 30 minutes of
// real daylight between them). Earlier-game's-buffer reproduces the same 8. Both
// are ruled out. A consequence to expect and NOT "fix": a division's buffer no
// longer protects the gap after its OWN games — a Majors game ending at 3:00 can
// be followed by Minors at 3:30, because Minors needs 30. That is correct.
//
// This must agree with the reschedule picker (`candidateClearsSpan` in
// reschedule-slots.ts, which uses the PLACING division's buffer) in every case
// that matters: there, the placing game is the one arriving. Same rule, stated
// from the two different vantage points those surfaces have. If you change one,
// change the other.
//
// DO NOT reuse `candidateClearsSpan` here. It is deliberately ASYMMETRIC — the
// buffer belongs to the placing side, and it pads BOTH sides of the candidate.
// A detector has no placing side; both games already exist. Inheriting it would
// smuggle in an unmade decision.
//
// `spansOverlap` IS reused (imported below) — it is the minute-based wall-clock
// half-open primitive, and sharing it is what keeps detector and picker in
// agreement about what "overlap" means.

import { spansOverlap } from "./reschedule-slots";

export interface ConflictInputGame {
  id: string;
  scheduled_at: string;
  venue_id: string | null;
  venue_name: string;
  home_team_name: string;
  away_team_name: string;
  division_name?: string;
  /**
   * THIS game's own division `game_duration`, in minutes. Optional ONLY as a
   * migration bridge — see `detectConflicts`. Supply it.
   */
  durationMin?: number;
  /** THIS game's own division `buffer_minutes`. Same bridge caveat. */
  bufferMin?: number;
}

export interface DetectedConflict {
  venueId: string;
  venueName: string;
  date: string;
  gameIds: string[];
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Wall-clock start minute of a stored `scheduled_at`.
 *
 * SUBSTRING ONLY — never `new Date()`. Rows store the admin's intended
 * wall-clock tagged +00 ("2026-10-24T13:00:00+00" = a 1 PM game); parsing the
 * instant would shift the time by the viewer's offset in any non-UTC zone.
 * Postgres also returns a space instead of `T`, which the substring handles.
 */
function startMinOf(scheduledAt: string): number {
  return timeToMinutes(scheduledAt.substring(11, 16));
}

/**
 * Do two games at the same venue on the same date conflict?
 *
 * The single predicate behind BOTH the league page's badge membership and its
 * "Conflicts with" peer list, so those two can no longer disagree about the same
 * pair. See this file's header for the model and why the later game's buffer
 * governs.
 *
 * Caller must have already established same venue + same DATE — this compares
 * wall-clock minutes only and does not look at the date.
 */
export function venueGamesConflict(
  a: { scheduled_at: string; durationMin: number; bufferMin: number },
  b: { scheduled_at: string; durationMin: number; bufferMin: number },
): boolean {
  const aStart = startMinOf(a.scheduled_at);
  const bStart = startMinOf(b.scheduled_at);

  // Identify which game arrives second; ties (identical starts) are a genuine
  // double-booking and overlap regardless of which is called "later".
  const [earlier, later, earlierStart, laterStart] =
    aStart <= bStart ? [a, b, aStart, bStart] : [b, a, bStart, aStart];

  const buf = Math.max(0, Number(later.bufferMin) || 0);

  // The later game's required separation is modelled by pulling its start back
  // by its own buffer; if that padded span still overlaps the earlier game's
  // real span, the arriving team cannot get the field in time.
  return spansOverlap(
    { startMin: earlierStart, durationMin: Math.max(0, Number(earlier.durationMin) || 0) },
    { startMin: laterStart - buf, durationMin: Math.max(0, Number(later.durationMin) || 0) + buf },
  );
}

/** True when every game carries its own duration — the real-span model's
 *  precondition. See `detectConflicts` for what happens when it doesn't. */
function hasPerGameDurations(games: ConflictInputGame[]): boolean {
  return games.every((g) => typeof g.durationMin === "number");
}

/**
 * Venue conflicts, grouped one record per (venue, date).
 *
 * `conflicting` is a Set, so a game appears at most once per record and a
 * 2-game collision yields ONE record with two `gameIds` — the count downstream
 * is therefore a count of GAMES, not of conflicts.
 *
 * MIGRATION BRIDGE — read before deleting the legacy branch. When every game
 * carries `durationMin`, the real-span model above runs. When they do not, the
 * OLD start-distance model runs against the `gameDuration`/`bufferMinutes`
 * scalars, preserving today's exact behavior for callers that have not been
 * migrated yet. That fallback exists so this fix could land on the league page
 * without changing the division panel badge, the conflict resolver, or the
 * generator's post-write conflict report, which still pass scalars and are
 * out of scope. It is a BRIDGE, not a design: the legacy branch is wrong (it
 * over-reserves and under-reserves — see the header) and should be deleted as
 * soon as those three callers supply per-game durations. Do not add new
 * scalar-only callers.
 */
export function detectConflicts(
  games: ConflictInputGame[],
  gameDuration: number,
  bufferMinutes: number,
): DetectedConflict[] {
  const realSpan = hasPerGameDurations(games);
  const legacyMinGap = Number(gameDuration) + Number(bufferMinutes);
  const byVenueDay = new Map<string, ConflictInputGame[]>();

  for (const g of games) {
    if (!g.venue_id) continue;
    // Date bucket from the wall-clock SUBSTRING, never a parsed instant.
    const key = `${g.venue_id}:${g.scheduled_at.substring(0, 10)}`;
    if (!byVenueDay.has(key)) byVenueDay.set(key, []);
    byVenueDay.get(key)!.push(g);
  }

  const results: DetectedConflict[] = [];

  for (const group of Array.from(byVenueDay.values())) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const conflicting = new Set<ConflictInputGame>();

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const hit = realSpan
          ? venueGamesConflict(
              { scheduled_at: a.scheduled_at, durationMin: a.durationMin!, bufferMin: a.bufferMin ?? 0 },
              { scheduled_at: b.scheduled_at, durationMin: b.durationMin!, bufferMin: b.bufferMin ?? 0 },
            )
          : Math.abs(startMinOf(a.scheduled_at) - startMinOf(b.scheduled_at)) < legacyMinGap;
        if (hit) {
          conflicting.add(a);
          conflicting.add(b);
        }
      }
    }

    if (conflicting.size > 0) {
      const arr = Array.from(conflicting);
      results.push({
        venueId: arr[0].venue_id!,
        venueName: arr[0].venue_name,
        date: arr[0].scheduled_at.substring(0, 10),
        gameIds: arr.map((g) => g.id),
      });
    }
  }

  return results;
}

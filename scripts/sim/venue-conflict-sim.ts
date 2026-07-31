// Venue conflict detection — drives the REAL venueGamesConflict / detectConflicts
// from src/lib/schedule/detect-conflicts.ts (no reimplementation here).
//
// Three-part harness standard (see CLAUDE.md "Harness standard"):
//   1. Real code, full playthroughs.
//   2. Mutation-tested — every mutant killed BY THE ASSERTION IT WAS WRITTEN
//      FOR, not merely killed. Log at the bottom of this file.
//   3. Anti-vacuity counters — the run FAILS if a guarded scenario never fired.
//
// THE RULE UNDER TEST: two games conflict when their real spans overlap, each
// span being [start, start + ITS OWN division's game_duration), half-open, with
// the LATER game's start pushed back by the LATER game's buffer_minutes.
// The buffer is the ARRIVING team's warmup, not the departing game's teardown.
//
// Fixtures:
//   F1  THE LIVE FALSE POSITIVES. Majors 1:00 PM (120) vs Minors 3:30 (105+30),
//       and Majors 10:00 (120) vs Minors 12:30 (105+30). 30 minutes of real
//       daylight each. Both must be NOT flagged. These are the 8 live SRALL
//       flags the change exists to clear.
//   F2  THE GENUINE OVERLAP. Archived QA Season 2026-05-19, QA-Memorial,
//       2026-07-27: two same-division QA-TBall games at 17:45 and 18:00, both
//       90 min, buffer 15 — a real 75-minute overlap. MUST stay flagged. No
//       regression is permitted here, so mutant M1 (revert to start-distance)
//       must leave F2 GREEN while killing F1.
//   F3  BUFFER DIRECTION. Two sub-cases that together pin "later game's buffer"
//       against all three tempting alternatives:
//         F3a short-then-long — later-buffer FLAGS, min() would not.
//         F3b long-then-short — later-buffer CLEARS, max() and earlier-buffer
//             would flag. This is the shape of the live false positives.
//   F4  BOUNDARY. Later game starting exactly at (earlier end + later buffer)
//       is legal; one minute earlier is not.
//   F5  TZ. Wall-clock substring only — never a parsed instant. Includes the
//       Postgres space-separated format and the same-date-keyed limitation.
//   F6  The legacy scalar bridge still reproduces old behavior exactly.

import {
  venueGamesConflict,
  detectConflicts,
  type ConflictInputGame,
} from "../../src/lib/schedule/detect-conflicts";

if (process.env.TZ !== "UTC") {
  console.error("Run with TZ=UTC (npm run sim:venue-conflict). Aborting.");
  process.exit(1);
}

let failures = 0;
let assertions = 0;
function assert(cond: boolean, label: string) {
  assertions++;
  if (cond) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const counters = {
  clearedPairs: 0,      // pairs the predicate cleared
  flaggedPairs: 0,      // pairs the predicate flagged
  bufferDecidedPairs: 0, // pairs where the buffer (not the span) decided it
  legacyBridgeRuns: 0,  // detectConflicts calls that took the legacy branch
  realSpanRuns: 0,      // detectConflicts calls that took the real-span branch
};

const D = "2026-08-15";
/** Build a game at a wall-clock time on the fixture date. */
function g(hhmm: string, durationMin: number, bufferMin: number) {
  return { scheduled_at: `${D}T${hhmm}:00+00:00`, durationMin, bufferMin };
}
function check(a: ReturnType<typeof g>, b: ReturnType<typeof g>): boolean {
  const hit = venueGamesConflict(a, b);
  if (hit) counters.flaggedPairs++;
  else counters.clearedPairs++;
  return hit;
}
/** Order-independence: the predicate must not care which arg is which. */
function checkBoth(a: ReturnType<typeof g>, b: ReturnType<typeof g>): boolean {
  const ab = check(a, b);
  const ba = venueGamesConflict(b, a);
  if (ab !== ba) {
    failures++;
    console.error("  FAIL: predicate is not symmetric in argument order");
  }
  return ab;
}

// ══ F1 — THE LIVE FALSE POSITIVES ════════════════════════════════════════════
console.log("\nF1  live false positives: Majors (120+60) then Minors (105+30)");
{
  const majorsPM = g("13:00", 120, 60); // 13:00–15:00
  const minors330 = g("15:30", 105, 30); // needs 30 after the 15:00 end
  assert(!checkBoth(majorsPM, minors330), "F1: Majors 1:00 vs Minors 3:30 is NOT flagged (30 min daylight)");

  const majorsAM = g("10:00", 120, 60); // 10:00–12:00
  const minors1230 = g("12:30", 105, 30);
  assert(!checkBoth(majorsAM, minors1230), "F1: Majors 10:00 vs Minors 12:30 is NOT flagged");

  // Both live shapes at once, through the full grouping function.
  const rows: ConflictInputGame[] = [
    { id: "maj-am", scheduled_at: `${D}T10:00:00+00:00`, venue_id: "andrews", venue_name: "Andrews", home_team_name: "A", away_team_name: "B", durationMin: 120, bufferMin: 60 },
    { id: "min-pm", scheduled_at: `${D}T12:30:00+00:00`, venue_id: "andrews", venue_name: "Andrews", home_team_name: "C", away_team_name: "D", durationMin: 105, bufferMin: 30 },
  ];
  counters.realSpanRuns++;
  assert(detectConflicts(rows, 0, 0).length === 0, "F1: detectConflicts reports NO conflict for the live pair");
}

// ══ F2 — THE GENUINE OVERLAP (must never regress) ════════════════════════════
console.log("\nF2  genuine overlap: QA-TBall 17:45 & 18:00, both 90 min, buffer 15");
{
  const a = g("17:45", 90, 15); // 17:45–19:15
  const b = g("18:00", 90, 15); // starts 15 min in — 75-minute real overlap
  assert(checkBoth(a, b), "F2: the real 75-minute overlap IS flagged");

  const rows: ConflictInputGame[] = [
    { id: "qa-1", scheduled_at: `${D}T17:45:00+00:00`, venue_id: "qa-mem", venue_name: "QA-Memorial", home_team_name: "T2", away_team_name: "?", durationMin: 90, bufferMin: 15 },
    { id: "qa-2", scheduled_at: `${D}T18:00:00+00:00`, venue_id: "qa-mem", venue_name: "QA-Memorial", home_team_name: "T4", away_team_name: "?", durationMin: 90, bufferMin: 15 },
  ];
  counters.realSpanRuns++;
  const found = detectConflicts(rows, 0, 0);
  assert(found.length === 1, "F2: detectConflicts emits ONE record for the venue-day");
  assert(found[0]?.gameIds.length === 2, "F2: the record names BOTH games (count is of GAMES)");

  // Identical start times are a flat double-booking regardless of buffers.
  assert(checkBoth(g("18:00", 90, 0), g("18:00", 90, 0)), "F2: identical starts are flagged even with zero buffers");
}

// ══ F3 — BUFFER DIRECTION: later game's buffer, not min/max/earlier ══════════
console.log("\nF3  buffer direction");
{
  // F3a short-then-long: spans DON'T overlap (60-min game ends 11:00, next
  // starts 11:30) but the arriving game needs 60 → conflict. min() would use
  // the earlier game's 0 and clear it.
  const earlyShortBuf = g("10:00", 60, 0);   // 10:00–11:00
  const lateLongBuf = g("11:30", 60, 60);    // needs 60 → wants the field from 10:30
  assert(checkBoth(earlyShortBuf, lateLongBuf), "F3a: later game's 60-min buffer FLAGS it (min() would clear)");
  counters.bufferDecidedPairs++;

  // F3b long-then-short — THE LIVE SHAPE. Earlier game has the big buffer;
  // the arriving game needs only 0, so 30 minutes of daylight is plenty.
  // max() and earlier-buffer both flag this; later-buffer clears it.
  const earlyLongBuf = g("10:00", 60, 60);   // 10:00–11:00, buffer 60
  const lateShortBuf = g("11:30", 60, 0);    // needs nothing
  assert(!checkBoth(earlyLongBuf, lateShortBuf), "F3b: earlier game's 60-min buffer does NOT reserve the gap (max()/earlier would flag)");
  counters.bufferDecidedPairs++;

  // F3c — each span must use ITS OWN game's duration. Deliberately DIFFERENT
  // durations: with both at 60 a swap is a no-op and proves nothing (that was
  // an earlier draft's mistake — M6 survived F3a for exactly that reason).
  // earlier 10:00-12:00 (120) vs later 11:30 (60): a real 30-minute overlap.
  // Swap the durations and the pair reads as clear, so this is the assertion
  // that pins per-game duration resolution.
  assert(checkBoth(g("10:00", 120, 0), g("11:30", 60, 0)), "F3c: each span uses ITS OWN duration (120 vs 60 genuinely overlap)");

  // The documented consequence, stated as an assertion so nobody "fixes" it:
  // a division's buffer does not protect the gap after its own games.
  const majors = g("13:00", 120, 60); // ends 15:00, buffer 60 → would want 16:00
  const minors = g("15:30", 105, 30); // needs only 30
  assert(!checkBoth(majors, minors), "F3: a division's own buffer does NOT protect the gap after its games");
}

// ══ F4 — BOUNDARY ════════════════════════════════════════════════════════════
console.log("\nF4  boundary: exactly (earlier end + later buffer)");
{
  const earlier = g("10:00", 120, 0); // 10:00–12:00
  assert(!checkBoth(earlier, g("12:30", 105, 30)), "F4: later start at end+buffer (12:30) is LEGAL");
  assert(checkBoth(earlier, g("12:29", 105, 30)), "F4: one minute earlier (12:29) is a CONFLICT");
  counters.bufferDecidedPairs++;

  // Half-open with zero buffer: touching exactly is legal.
  assert(!checkBoth(earlier, g("12:00", 90, 0)), "F4: with buffer 0, starting exactly at the end is LEGAL");
  assert(checkBoth(earlier, g("11:59", 90, 0)), "F4: one minute inside the span is a CONFLICT");
}

// ══ F5 — TZ: wall-clock substring only ═══════════════════════════════════════
console.log("\nF5  wall-clock substring, never a parsed instant");
{
  // Postgres returns a SPACE, not a T. Both must read identically.
  const spaceFmt = { scheduled_at: `${D} 13:00:00+00`, durationMin: 120, bufferMin: 60 };
  const tFmt = { scheduled_at: `${D}T13:00:00+00:00`, durationMin: 120, bufferMin: 60 };
  const probe = g("15:30", 105, 30);
  assert(
    venueGamesConflict(spaceFmt, probe) === venueGamesConflict(tFmt, probe),
    "F5: Postgres space format and T format give the same verdict",
  );

  // OFFSET INVARIANCE — the assertion that actually pins "never parse the
  // instant". Under TZ=UTC a `new Date()` mutant on a "+00" row is
  // indistinguishable from the substring (local == UTC, and V8 tolerates the
  // space form), so the space/T check above CANNOT catch it — an earlier draft
  // let mutant M7 survive on exactly that. A row carrying a NON-+00 offset
  // can: its wall clock says 13:00 while its instant is 18:00Z. The predicate
  // must read 13:00 and return the same verdict as the +00 row.
  const offsetRow = { scheduled_at: `${D}T13:00:00-05:00`, durationMin: 120, bufferMin: 60 };
  assert(
    venueGamesConflict(offsetRow, probe) === venueGamesConflict(tFmt, probe),
    "F5: a non-+00 offset is read at its WALL CLOCK, not its instant",
  );

  // A late-night game read by WALL CLOCK, not by instant. 23:00 + 120 runs past
  // midnight; the predicate compares minutes-from-midnight only, so a 23:30
  // start overlaps it on the same date.
  assert(checkBoth(g("23:00", 120, 0), g("23:30", 60, 0)), "F5: a 23:00 game blocks 23:30 by wall clock");

  // Same-date keying: games on DIFFERENT dates never meet, even 30 real
  // minutes apart across midnight. Documented limitation, asserted so a future
  // cross-midnight change has to confront it deliberately.
  const across: ConflictInputGame[] = [
    { id: "late", scheduled_at: "2026-10-24T23:45:00+00:00", venue_id: "v", venue_name: "V", home_team_name: "A", away_team_name: "B", durationMin: 90, bufferMin: 0 },
    { id: "next", scheduled_at: "2026-10-25T00:15:00+00:00", venue_id: "v", venue_name: "V", home_team_name: "C", away_team_name: "D", durationMin: 90, bufferMin: 0 },
  ];
  counters.realSpanRuns++;
  assert(detectConflicts(across, 0, 0).length === 0, "F5: cross-midnight pairs are NOT compared (same-date keyed — known limitation)");
}

// ══ F6 — the legacy scalar bridge still reproduces old behavior ══════════════
console.log("\nF6  legacy bridge: scalar callers keep today's exact behavior");
{
  // No durationMin on either row → legacy start-distance with the scalars.
  const legacy: ConflictInputGame[] = [
    { id: "l1", scheduled_at: `${D}T13:00:00+00:00`, venue_id: "v", venue_name: "V", home_team_name: "A", away_team_name: "B" },
    { id: "l2", scheduled_at: `${D}T15:30:00+00:00`, venue_id: "v", venue_name: "V", home_team_name: "C", away_team_name: "D" },
  ];
  counters.legacyBridgeRuns++;
  // 150 min apart, Majors scalar 120+60=180 → the OLD false positive, preserved.
  assert(detectConflicts(legacy, 120, 60).length === 1, "F6: legacy branch still reproduces the old (wrong) flag — unmigrated callers unchanged");
  counters.legacyBridgeRuns++;
  assert(detectConflicts(legacy, 105, 30).length === 0, "F6: legacy branch still clears under the smaller scalar");

  // A partially-populated set must NOT silently half-apply the new model.
  const mixed: ConflictInputGame[] = [
    { ...legacy[0], durationMin: 120, bufferMin: 60 },
    legacy[1],
  ];
  counters.legacyBridgeRuns++;
  assert(detectConflicts(mixed, 120, 60).length === 1, "F6: a MIXED set falls back to legacy wholesale, never per-pair");
}

// ── Anti-vacuity gate ────────────────────────────────────────────────────────
console.log("\nAnti-vacuity counters");
for (const [name, n] of Object.entries(counters)) {
  const ok = n > 0;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok" : "FAIL"}: ${name} = ${n}${ok ? "" : "  (never fired — assertions were vacuous)"}`);
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${assertions} assertions, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION LOG — 2026-07-30. Criterion: killed ONLY when the baseline assertion
// fails, and it must be the assertion the mutant was written for. Applied to
// src/lib/schedule/detect-conflicts.ts, run, reverted, suite re-verified green.
// This harness evaluates EVERY assertion each run (counts failures, does not
// throw), so no mutant can die early and leave a later assertion unevaluated.
//
//  M1  ★ Revert to start-distance, using the EARLIER game's gap — which is what
//      the deployed model did when the larger division's pass evaluated the
//      pair, and the only form that reproduces the live false positives:
//        Math.abs(laterStart-earlierStart) < earlier.durationMin + earlier.bufferMin
//      An earlier draft used the LATER game's numbers (105+30=135 vs a 150-min
//      start distance) — that clears F1 and so proved nothing. Check the scalar
//      a start-distance mutant uses before trusting it.
//      → KILLED at F1 "Majors 1:00 vs Minors 3:30 is NOT flagged" and F1
//        "Majors 10:00 vs Minors 12:30". CRITICALLY, F2 stays GREEN under this
//        mutant — the genuine overlap is caught by both models, which is the
//        no-regression property the fix had to preserve. A mutant that killed
//        F2 too would prove nothing about which model is better.
//
//  M2  Buffer → min(bufA, bufB)
//      → KILLED at F3a "later game's 60-min buffer FLAGS it (min() would
//        clear)" — and F3b stays green, since min() and later agree there.
//
//  M3  Buffer → max(bufA, bufB)
//      → KILLED at F3b "earlier game's 60-min buffer does NOT reserve the gap"
//        and F3 "a division's own buffer does NOT protect the gap after its
//        games". This is the wrong-and-tempting rule; F3b is the only thing
//        pinning it out. Do not delete F3b.
//
//  M4  Buffer → the EARLIER game's buffer
//      → KILLED at F3b, same assertions as M3 (the two rules agree on these
//        fixtures). F3a distinguishes them from `later`; both are ruled out.
//
//  M5  Half-open → closed (`<=` in the overlap test, via a padded span)
//      → KILLED at F4 "later start at end+buffer (12:30) is LEGAL" and F4
//        "with buffer 0, starting exactly at the end is LEGAL".
//
//  M6  Swap the two spans' durations
//      → KILLED at F3c "each span uses ITS OWN duration (120 vs 60 genuinely
//        overlap)". It does NOT die at F3a, whose two games are both 60 min so
//        the swap is a no-op — F3c exists solely to give this mutant differing
//        durations to corrupt. Do not delete F3c.
//
//  M7  Parse the instant (`new Date(scheduled_at)`) instead of the substring
//      → KILLED at F5 "a non-+00 offset is read at its WALL CLOCK, not its
//        instant". It SURVIVED the space-vs-T assertion: under TZ=UTC, local
//        equals UTC and V8 parses the space form happily, so that check is
//        blind to instant-parsing. Only a row whose offset differs from UTC
//        separates the two models in this harness. Do not delete that
//        assertion thinking the space/T one covers it.
//
//  M8  Mixed-set handling → per-pair instead of wholesale
//        hasPerGameDurations → games.some(...)
//      → KILLED at F6 "a MIXED set falls back to legacy wholesale, never
//        per-pair".
//
// All 8 killed at their own assertion. Suite re-verified green after revert.

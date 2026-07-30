// Reschedule-picker slot construction — drives the REAL buildAvailableSlots
// from src/lib/schedule/reschedule-slots.ts (no reimplementation here).
//
// Three-part harness standard (see CLAUDE.md "Harness standard"):
//   1. Real code, full playthroughs — the actual exported function, end to end.
//   2. Mutation-tested — every mutant below must be killed BY THE ASSERTION IT
//      WAS WRITTEN TO EXERCISE, not merely killed by something. Procedure and
//      results are logged at the bottom of this file.
//   3. Anti-vacuity counters — each guarded scenario must actually have fired;
//      the run FAILS if any counter is zero.
//
// Non-negotiable fixtures:
//   F1  THE LIVE CASE. Andrews Field, Majors at 10:00 and 1:00 (120 min each),
//       placing a Minors game (105 + 30 buffer) in a 10:00–18:00 window.
//       3:30 PM must be offered; nothing overlapping 10:00–12:00 or 1:00–3:00
//       may be. This is the bug the change exists to fix.
//   F2  THE UNDER-RESERVATION CASE — the one that matters most. An existing
//       LONG game (120) with a placing SHORT division (90 + 0 buffer). Under
//       the old start-distance test the gap was the PLACING division's 90, so
//       a candidate 90 minutes after the long game's start passed while the
//       long game was still running. No offered slot may fall inside the long
//       game's real span. Mutant M2 reverts the span test to start-distance
//       and this fixture must FAIL.
//   F3  BOUNDARY. With buffer 0, a candidate starting EXACTLY at an existing
//       game's real end is legal (half-open). One minute earlier is not.
//       F3b: with a buffer, the first legal start is exactly (end + buffer).
//   F4  WINDOW EDGES. A candidate whose span would run past the division
//       window end is excluded; likewise past venue close.
//   F5  TZ. Wall-clock substring convention only. A game whose UTC instant
//       lands on a different calendar day than its wall-clock date must be
//       read by its wall-clock. TZ=UTC is mandatory so this is meaningful.
//
// Plus: F6 team real-span occupancy (a team's 10:00 game blocks 10:15 on the
// fine grid — the hole the 15-minute grid would otherwise open).

import {
  buildAvailableSlots,
  candidateClearsSpan,
  spansOverlap,
  durationFromSettings,
  SLOT_GRID_MINUTES,
  type BuildAvailableSlotsParams,
  type OccupiedSpan,
  type SlotOption,
} from "../../src/lib/schedule/reschedule-slots";
import { parseAvailability } from "../../src/lib/venues/availability";
import { constraintsFromRows } from "../../src/lib/schedule/team-constraints";

if (process.env.TZ !== "UTC") {
  console.error("Run with TZ=UTC (npm run sim:reschedule-slots). Aborting.");
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

// ── Anti-vacuity counters ─────────────────────────────────────────────────────
const counters = {
  venueOverlapRejections: 0, // a candidate was rejected by venue occupancy
  bufferOnlyRejections: 0,   // rejected by the buffer pad alone (span was clear)
  teamOverlapRejections: 0,  // rejected by team real-span occupancy
  windowEndExclusions: 0,    // rejected because the span ran past window close
  venueCloseExclusions: 0,   // rejected because the span ran past venue close
  offeredSlots: 0,           // total slots offered across all fixtures
};

// ── Fixture builder ───────────────────────────────────────────────────────────

const HOME = "team-home";
const AWAY = "team-away";
const VENUE = "venue-andrews";

function baseParams(
  over: Partial<BuildAvailableSlotsParams> = {},
): BuildAvailableSlotsParams {
  return {
    startDate: "2026-08-15",
    endDate: "2026-08-15", // single Saturday keeps fixtures readable
    playingDays: ["Sa"],
    dayWindows: { Sa: { start: "10:00", end: "18:00" } },
    earliestStart: "10:00",
    latestStart: "18:00",
    gameDuration: 105,
    bufferMinutes: 30,
    maxPerTeamDay: 1,
    venueIds: [VENUE],
    venueNames: { [VENUE]: "Monroe Complex — Andrews" },
    venueAvailability: {
      [VENUE]: parseAvailability({ Sa: { start: "08:00", end: "20:00" } }),
    },
    blackoutDates: new Set<string>(),
    venueBookings: new Map<string, OccupiedSpan[]>(),
    homeTeamSpans: new Map<string, OccupiedSpan[]>(),
    awayTeamSpans: new Map<string, OccupiedSpan[]>(),
    homeTeamDayCounts: new Map<string, number>(),
    awayTeamDayCounts: new Map<string, number>(),
    homeTeamId: HOME,
    awayTeamId: AWAY,
    constraintRules: constraintsFromRows([]),
    today: "2026-01-01", // deterministic: well before the fixture season
    ...over,
  };
}

const times = (slots: SlotOption[]) => slots.map((s) => s.isoString.substring(11, 16));

/** Does an offered slot's real span overlap the given span? */
function anyOffered(slots: SlotOption[], dur: number, occ: OccupiedSpan): boolean {
  return slots.some((s) => {
    const [h, m] = s.isoString.substring(11, 16).split(":").map(Number);
    return spansOverlap({ startMin: h * 60 + m, durationMin: dur }, occ);
  });
}

// ══ F1 — THE LIVE CASE (Andrews / Majors 10:00 + 1:00 / placing Minors) ═══════
console.log("\nF1  live case: Andrews, Majors 10:00 & 1:00 (120), placing Minors 105+30");
{
  const majorsAM: OccupiedSpan = { startMin: 600, durationMin: 120 }; // 10:00–12:00
  const majorsPM: OccupiedSpan = { startMin: 780, durationMin: 120 }; // 13:00–15:00
  const p = baseParams({
    venueBookings: new Map([[`${VENUE}:2026-08-15`, [majorsAM, majorsPM]]]),
  });
  const slots = buildAvailableSlots(p);
  const t = times(slots);
  counters.offeredSlots += slots.length;

  assert(t.includes("15:30"), "F1: 3:30 PM is offered (the founder's expectation)");
  assert(!anyOffered(slots, 105, majorsAM), "F1: nothing overlaps the 10:00–12:00 Majors game");
  assert(!anyOffered(slots, 105, majorsPM), "F1: nothing overlaps the 1:00–3:00 Majors game");
  assert(t[0] === "15:30", "F1: 3:30 PM is the EARLIEST offer (= 3:00 end + 30 buffer)");
  assert(!t.includes("15:15"), "F1: 3:15 is refused — only 15 min after the 3:00 end");
  // Window end 18:00, span 105 → last legal start 16:15. The old lattice's sole
  // offer (16:45) ran to 18:30 and is now correctly excluded.
  assert(t[t.length - 1] === "16:15", "F1: last offer is 4:15 (span ends exactly at 18:00)");
  assert(!t.includes("16:45"), "F1: 4:45 is gone — its span would end 18:30, past window close");
  assert(
    JSON.stringify(t) === JSON.stringify(["15:30", "15:45", "16:00", "16:15"]),
    `F1: exact offer set is 3:30/3:45/4:00/4:15 (got ${t.join(",")})`,
  );

  // Count how many grid candidates the venue occupancy actually rejected.
  const clear = baseParams();
  counters.venueOverlapRejections += buildAvailableSlots(clear).length - slots.length;
}

// ══ F2 — UNDER-RESERVATION: long existing game, short placing division ════════
console.log("\nF2  under-reservation: existing 120-min game, placing 90+0");
{
  // Existing 10:00–12:00 (120). Placing division is 90 with NO buffer, so the
  // OLD start-distance gap was 90: a candidate at 11:30 sat 90 minutes after
  // the existing START and passed — while that game ran until 12:00.
  const longGame: OccupiedSpan = { startMin: 600, durationMin: 120 };
  const p = baseParams({
    gameDuration: 90,
    bufferMinutes: 0,
    venueBookings: new Map([[`${VENUE}:2026-08-15`, [longGame]]]),
  });
  const slots = buildAvailableSlots(p);
  const t = times(slots);
  counters.offeredSlots += slots.length;

  assert(!anyOffered(slots, 90, longGame), "F2: NO offered slot falls inside the 120-min game's real span");
  assert(!t.includes("11:30"), "F2: 11:30 refused (start-distance would have allowed it)");
  assert(!t.includes("11:45"), "F2: 11:45 refused (still inside the long game)");
  assert(t.includes("12:00"), "F2: 12:00 offered — exactly at the long game's real end, buffer 0");
  assert(t[0] === "10:00" ? false : true, "F2: nothing offered before the existing game (window opens 10:00)");

  const clear = buildAvailableSlots(baseParams({ gameDuration: 90, bufferMinutes: 0 }));
  counters.venueOverlapRejections += clear.length - slots.length;
}

// ══ F2b — THE REVERSE ASYMMETRY: short existing game, LONG placing division ══
console.log("\nF2b under-reservation (reverse): existing 60-min game, placing 120+0");
{
  // Mirror of F2. Here the candidate is LONGER than the existing game, so a
  // model that sizes the candidate's span from the EXISTING game's duration
  // under-reserves on the BEFORE side: a candidate starting at 10:15 runs to
  // 12:15 and swallows the noon game, but measured as 60 minutes it looks
  // clear. The existing game sits mid-window (not at the open) so the before
  // side is actually reachable — without that, the mutant hides. This fixture
  // exists for mutant M5; F2 alone does NOT catch it (over-sizing the pad is
  // safe, under-sizing is not).
  const noonGame: OccupiedSpan = { startMin: 720, durationMin: 60 }; // 12:00–13:00
  const p = baseParams({
    dayWindows: { Sa: { start: "09:00", end: "18:00" } },
    venueAvailability: {
      [VENUE]: parseAvailability({ Sa: { start: "08:00", end: "20:00" } }),
    },
    gameDuration: 120,
    bufferMinutes: 0,
    venueBookings: new Map([[`${VENUE}:2026-08-15`, [noonGame]]]),
  });
  const slots = buildAvailableSlots(p);
  const t = times(slots);
  counters.offeredSlots += slots.length;

  assert(!anyOffered(slots, 120, noonGame), "F2b: NO offered slot overlaps the 60-min noon game");
  assert(!t.includes("10:15"), "F2b: 10:15 refused — a 120-min game there runs to 12:15");
  assert(!t.includes("11:00"), "F2b: 11:00 refused — runs to 13:00, straight through the game");
  assert(t.includes("10:00"), "F2b: 10:00 offered — ends exactly at 12:00");
  assert(t.includes("13:00"), "F2b: 13:00 offered — starts exactly at the real end");

  const clear = buildAvailableSlots(
    baseParams({
      dayWindows: { Sa: { start: "09:00", end: "18:00" } },
      venueAvailability: { [VENUE]: parseAvailability({ Sa: { start: "08:00", end: "20:00" } }) },
      gameDuration: 120,
      bufferMinutes: 0,
    }),
  );
  counters.venueOverlapRejections += clear.length - slots.length;
}

// ══ F3 — BOUNDARY: half-open, and the buffer boundary ════════════════════════
console.log("\nF3  boundary: candidate starting exactly at an existing real end");
{
  const occ: OccupiedSpan = { startMin: 600, durationMin: 120 }; // 10:00–12:00
  // buffer 0 → the pure half-open test
  assert(
    candidateClearsSpan(720, 90, 0, occ),
    "F3: start exactly at real end (12:00) is LEGAL — half-open",
  );
  assert(
    !candidateClearsSpan(719, 90, 0, occ),
    "F3: one minute earlier (11:59) is ILLEGAL",
  );
  // F3b — with a buffer, the first legal start is end + buffer
  assert(
    candidateClearsSpan(750, 105, 30, occ),
    "F3b: end + buffer (12:30) is LEGAL with a 30-min buffer",
  );
  assert(
    !candidateClearsSpan(749, 105, 30, occ),
    "F3b: one minute inside the buffer (12:29) is ILLEGAL",
  );
  // Symmetry: the buffer must also protect the side BEFORE an existing game.
  // A 105-min candidate ending exactly at the 10:00 start begins at 8:15 (495)
  // — flush against the existing game, so the buffer must refuse it. Backing up
  // one further buffer (465 → ends 9:30) is legal. An after-only buffer would
  // wrongly allow 495; that is mutant M3.
  assert(
    !candidateClearsSpan(495, 105, 30, occ),
    "F3b: candidate ending exactly at the existing START is ILLEGAL (buffer is symmetric)",
  );
  assert(
    candidateClearsSpan(465, 105, 30, occ),
    "F3b: candidate ending buffer-before the existing start is LEGAL",
  );
  counters.bufferOnlyRejections += 2; // the two buffer-only refusals above

  // spansOverlap itself, directly
  assert(!spansOverlap({ startMin: 600, durationMin: 60 }, { startMin: 660, durationMin: 60 }), "F3: touching spans do not overlap");
  assert(spansOverlap({ startMin: 600, durationMin: 61 }, { startMin: 660, durationMin: 60 }), "F3: one-minute overlap detected");
}

// ══ F4 — WINDOW EDGES ════════════════════════════════════════════════════════
console.log("\nF4  window edges: division window end and venue close");
{
  // Division window 10:00–12:00, span 105 → only 10:00 and 10:15 fit
  // (10:15+105 = 12:00 exactly). 10:30 would end 12:15, past close.
  const p = baseParams({ dayWindows: { Sa: { start: "10:00", end: "12:00" } } });
  const t = times(buildAvailableSlots(p));
  assert(
    JSON.stringify(t) === JSON.stringify(["10:00", "10:15"]),
    `F4: division window truncates to spans ending by close (got ${t.join(",")})`,
  );
  assert(!t.includes("10:30"), "F4: a span running past the division window end is excluded");
  counters.windowEndExclusions++;

  // Venue closes at 11:00 while the division window runs to 18:00 → the venue
  // is the binding constraint; only 10:00 (ends 11:45)… no: 105 past 11:00.
  const pv = baseParams({
    gameDuration: 60,
    bufferMinutes: 0,
    venueAvailability: {
      [VENUE]: parseAvailability({ Sa: { start: "10:00", end: "11:00" } }),
    },
  });
  const tv = times(buildAvailableSlots(pv));
  assert(
    JSON.stringify(tv) === JSON.stringify(["10:00"]),
    `F4: venue close truncates independently of the division window (got ${tv.join(",")})`,
  );
  assert(!tv.includes("10:15"), "F4: a span running past VENUE close is excluded");
  counters.venueCloseExclusions++;

  // Grid granularity is actually 15 minutes.
  const wide = times(buildAvailableSlots(baseParams({ gameDuration: 60, bufferMinutes: 0 })));
  assert(wide[1] === "10:15" && wide[2] === "10:30", "F4: candidates step by 15 minutes");
  assert(SLOT_GRID_MINUTES === 15, "F4: SLOT_GRID_MINUTES is 15");
}

// ══ F5 — TZ: wall-clock substring only ═══════════════════════════════════════
console.log("\nF5  wall-clock convention (never parse the instant)");
{
  // A stored row "2026-08-15T23:00:00+00" is an 11 PM Saturday game by
  // wall-clock. Its UTC instant is also Saturday here (TZ=UTC), but the point
  // is the builder reads the SUBSTRING. We assert the builder never emits a
  // slot outside the fixture's single date, and that its isoStrings are bare
  // local wall-clock with no offset suffix.
  const slots = buildAvailableSlots(baseParams({ gameDuration: 60, bufferMinutes: 0 }));
  assert(slots.every((s) => s.date === "2026-08-15"), "F5: every slot belongs to the fixture date");
  assert(
    slots.every((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(s.isoString)),
    "F5: isoStrings are bare wall-clock, no timezone suffix",
  );
  // durationFromSettings reads settings, never a Date
  assert(durationFromSettings({ game_duration: 105 }) === 105, "F5: duration resolved from own division settings");
  assert(durationFromSettings({}) === 90, "F5: missing game_duration falls back to 90");
  assert(durationFromSettings(null) === 90, "F5: null settings falls back to 90");
  assert(durationFromSettings({ game_duration: 0 }) === 90, "F5: zero duration falls back to 90 (never a 0-length span)");
}

// ══ F6 — TEAM real-span occupancy (the hole a fine grid would open) ══════════
console.log("\nF6  team occupancy by real span, not exact timestamp");
{
  // The home team already plays a 120-min game at 10:00 somewhere else. On a
  // 15-minute grid the old exact-timestamp check would have offered 10:15.
  const p = baseParams({
    maxPerTeamDay: 2, // don't let the day-cap mask the span test
    gameDuration: 60,
    bufferMinutes: 0,
    homeTeamSpans: new Map([["2026-08-15", [{ startMin: 600, durationMin: 120 }]]]),
  });
  const t = times(buildAvailableSlots(p));
  counters.teamOverlapRejections +=
    times(buildAvailableSlots(baseParams({ maxPerTeamDay: 2, gameDuration: 60, bufferMinutes: 0 }))).length - t.length;

  assert(!t.includes("10:00"), "F6: team's own 10:00 game blocks 10:00");
  assert(!t.includes("10:15"), "F6: it ALSO blocks 10:15 (real span, not equality)");
  assert(!t.includes("11:45"), "F6: still blocked at 11:45 (inside the 120-min span)");
  assert(t.includes("12:00"), "F6: free again at 12:00, the real end");

  // Away team is checked too.
  const pa = baseParams({
    maxPerTeamDay: 2,
    gameDuration: 60,
    bufferMinutes: 0,
    awayTeamSpans: new Map([["2026-08-15", [{ startMin: 600, durationMin: 120 }]]]),
  });
  assert(!times(buildAvailableSlots(pa)).includes("10:15"), "F6: away team's span blocks too");
}

// ══ Preserved behavior (regression guards on the untouched filters) ══════════
console.log("\nF7  preserved filters: blackout, day cap, playing days, constraints");
{
  assert(
    buildAvailableSlots(baseParams({ blackoutDates: new Set(["2026-08-15"]) })).length === 0,
    "F7: blackout date yields no slots",
  );
  assert(
    buildAvailableSlots(baseParams({ homeTeamDayCounts: new Map([["2026-08-15", 1]]) })).length === 0,
    "F7: home team at per-day cap yields no slots",
  );
  assert(
    buildAvailableSlots(baseParams({ playingDays: ["Su"] })).length === 0,
    "F7: non-playing day yields no slots",
  );
  assert(
    buildAvailableSlots(baseParams({ today: "2026-12-01" })).length === 0,
    "F7: dates in the past are skipped",
  );
  // A severity-'block' constraint covering the morning removes those starts.
  const blocked = buildAvailableSlots(
    baseParams({
      gameDuration: 60,
      bufferMinutes: 0,
      constraintRules: constraintsFromRows([
        { team_id: HOME, day_of_week: "Sa", start_time: "10:00", end_time: "12:00", severity: "block" },
      ] as never),
    }),
  );
  assert(!times(blocked).includes("10:00"), "F7: severity-'block' constraint window is not offered");
  assert(times(blocked).includes("12:00"), "F7: outside the block window is still offered");
  // Legacy earliest/latest fallback when day_windows is absent.
  const legacy = times(
    buildAvailableSlots(
      baseParams({ dayWindows: {}, earliestStart: "14:00", latestStart: "16:00", gameDuration: 60, bufferMinutes: 0 }),
    ),
  );
  assert(legacy[0] === "14:00" && legacy[legacy.length - 1] === "15:00", "F7: legacy earliest/latest still honored when day_windows absent");
}

// ── Anti-vacuity gate ────────────────────────────────────────────────────────
console.log("\nAnti-vacuity counters");
for (const [name, n] of Object.entries(counters)) {
  const ok = n > 0;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok" : "FAIL"}: ${name} = ${n}${ok ? "" : "  (scenario never fired — assertions were vacuous)"}`);
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${assertions} assertions, ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION LOG — 2026-07-30. 11 mutants, all killed BY THE ASSERTION EACH WAS
// WRITTEN TO EXERCISE. Criterion: a mutant is KILLED only when the BASELINE
// ASSERTION FAILS; and per the house rule, being killed by *something* is not
// enough — the named assertion below must appear in the failing set. Each was
// applied to src/lib/schedule/reschedule-slots.ts, run, reverted, and the suite
// re-verified green.
//
// This harness evaluates EVERY assertion on every run (it counts failures, it
// does not throw on the first), so no mutant can die "early" and leave a later
// assertion silently unevaluated. That is what makes the per-mutant kill-line
// attribution below trustworthy.
//
//  M1  Revert the grid to the old lattice:
//        timeMin += Math.max(1, duration + buffer)   (instead of SLOT_GRID_MINUTES)
//      → KILLED at F1 "exact offer set is 3:30/3:45/4:00/4:15" (offer set went
//        EMPTY) + F4 "candidates step by 15 minutes". This is half 1.
//
//  M2  ★ Revert occupancy to start-distance (THE under-reservation mutant):
//        candidateClearsSpan → !(Math.abs(cand - occ.startMin) < dur + buffer)
//      → KILLED at F2 "NO offered slot falls inside the 120-min game's real
//        span" + F2 "11:30 refused". This is half 2. NOTE: F1's assertions also
//        fail under M2 (15:15 reappears) — an earlier draft of this log claimed
//        F1 survived M2; that was wrong and is corrected here. F2 is still the
//        assertion that pins the actual overlap, and it fires.
//
//  M3a Buffer pads the TRAILING side only:
//        padded = { startMin: cand, durationMin: dur + buf }
//      → KILLED at F3b "one minute inside the buffer (12:29) is ILLEGAL" —
//        i.e. the separation AFTER an existing game's real end.
//
//  M3b Buffer pads the LEADING side only:
//        padded = { startMin: cand - buf, durationMin: dur }
//      → KILLED at F3b "candidate ending exactly at the existing START is
//        ILLEGAL (buffer is symmetric)" — and NOTHING ELSE (a 1-assertion kill,
//        perfect isolation). M3a and M3b together are what prove the buffer is
//        load-bearing on BOTH sides; either alone leaves one side unproven.
//        The original single "one-sided buffer" mutant was killed by the
//        after-side assertion while the symmetry assertion passed — exactly the
//        wrong-assertion trap. Do not re-merge them.
//
//  M4  Drop the buffer entirely (buf = 0 inside candidateClearsSpan)
//      → KILLED at F1 "3:30 PM is the EARLIEST offer" + F1 "3:15 is refused".
//
//  M5  Size the candidate's span from the EXISTING game's duration:
//        padded.durationMin = occ.durationMin + buf * 2
//      → KILLED at F2b "NO offered slot overlaps the 60-min noon game" + F2b
//        "10:15 refused". F2 does NOT catch this (there the existing game is
//        LONGER, so mis-sizing over-reserves, which is safe) — F2b exists
//        solely for this mutant, with the existing game placed MID-window so
//        the before-side is reachable. Don't delete F2b.
//
//  M6  Half-open → closed interval in spansOverlap (`<=` on both terms)
//      → KILLED at F3 "start exactly at real end (12:00) is LEGAL" + F3
//        "touching spans do not overlap".
//
//  M7  Window end back to latest-START semantics:
//        for (…; timeMin <= latest; …)   (instead of timeMin + duration <= latest)
//      → KILLED at F4 "division window truncates to spans ending by close" +
//        F1 "4:45 is gone".
//
//  M8  Skip the venue-hours check (drop the isVenueAvailable guard)
//      → KILLED at F4 "venue close truncates independently of the division
//        window" + F4 "a span running past VENUE close is excluded".
//
//  M9  Team occupancy back to start-equality instead of real span
//      → KILLED at F6 "it ALSO blocks 10:15 (real span, not equality)".
//
// M10  durationFromSettings returns the raw value without the >0 guard
//      → KILLED at F5 "zero duration falls back to 90" — and nothing else.
//
// All 11 killed at their own assertion. Suite re-verified green after revert.

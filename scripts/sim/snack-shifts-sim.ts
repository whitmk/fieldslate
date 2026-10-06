// Snack shack derived-shifts harness — drives the REAL pure library
// (src/lib/snack-shack/derive-shifts.ts). Run: `npm run sim:snack-shifts`
// (three host timezones: UTC, America/Los_Angeles, Pacific/Kiritimati — every
// expected value is a literal, so a result that moves with the host zone fails
// instead of agreeing with itself); mutants: `npm run sim:snack-shifts:mutants`.
//
// PARTS and what each pins:
//   C  WHICH GAMES COUNT: attached venues only; countsAsScheduledGame (a
//      rained-out game and a pending proposal do not open the shack; an away
//      interleague game has no venue of ours); an assumed duration is reported.
//   S  (runs before W/G so a division mutant dies at its own line, not at a
//      window fixture that happens to divide)
//   W  WINDOW: opens openBefore before the first start, closes closeAfter
//      after the last END (per-game duration, not the last start).
//   G  GAPS: a 60-minute break splits, a 59-minute one does not; with 30/30
//      offsets a 60-minute break would make the windows touch, so it stays
//      one window (overlap merge); 61 minutes splits.
//   D  DAYS: a counting game on a closed weekday makes no shifts and is listed
//      with its venue (the weekday makeups the real league has today).
//   S  DIVISION: fewest shifts of ≤ max; the leftover is the LAST shift;
//      real-league-shaped windows 345–645 min at a 2h max, every length ≤ max,
//      lengths sum to the window, count is ceil(total/max) (or one fewer when
//      absorbed).
//   L  LEFTOVER: under 60 → absorbed; default "last"; "first"; "split" to the
//      minute with the odd minutes on the EARLIER shifts; exactly 60 stands;
//      90 stands; the choice is keyed by date+window start and a choice whose
//      window moved is reported stale and the default applies.
//   A  ASSIGNMENT (2026-10-06): every pick is checked against GAME INTERVALS,
//      never dates, by the harness's OWN overlap check (`sim-side` below, not
//      the library's): a team is never given a shift that overlaps one of its
//      games from 30 minutes before the start to the end — home, away,
//      playoff, pending, at any venue; the buffer alone excludes a team whose
//      game starts 15 minutes after the shift; the hard rule runs BEFORE
//      equity (an eligible team with one more shift beats a blocked team with
//      fewer); with nobody free the shift is UNASSIGNED and flagged, never a
//      playing team; game days prefer a team at the park (home OR away) whose
//      game clears the shift, then off-day teams, then anyone, flagging the
//      fallback; off days keep evenness first and flag a busy pick; a seeded
//      sweep of 300 random Saturdays runs the same check on every pick.
//   P  PRESERVATION: a stored derived row whose date/start/end is unchanged is
//      kept with its assignment; a changed one is removed (its assignment
//      reported) and the new slot is assigned; manual rows are never touched;
//      the equity counter is seeded with the kept rows.
//   T  STALENESS: the diff names exactly the dates that differ, including a
//      date that lost all its games and a date whose shifts merely moved.
//   F  THE PLAN (regenerate-plan.ts): stored derived rows BEFORE today (in
//      the org's zone) ride the RPC payload unchanged and no derived shift
//      for a past date is added; upcoming unchanged rows are kept; a
//      same-start/different-end pair is a "changed" shift; staleness looks
//      at upcoming dates only; the equity pick is seeded with frozen past
//      rows; todayInTimezone; the legacy notice; the max-shift help text;
//      (0104) a note/cash person on a changed row is `carried`, on a removed
//      row `lost`.
//   X  WALL-CLOCK: a 19:45 end on a +00 wall-clock stays 19:45 in every host
//      zone; the library never hands scheduled_at to `new Date`.
//
// ANTI-VACUITY counters (a zero fails the run): absorb offered, absorb
// defaulted, split windows, merged-by-overlap days, closed-day games, kept
// assignments, removed rows that carried an assignment, stale choices,
// assumed durations, an exactly-60 leftover standing, a ≥60 short shift
// standing, a window with a single shift; (A) teams excluded ONLY by the
// buffer, by an away game, by a playoff game; shifts left unfilled; game-day
// picks that fell out of tier 1; off-day picks of a busy team; sweep picks
// made with at least one team blocked.
//
// ── MUTATION LOG (2026-10-05) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST.
// 20/20 killed at their own assertion (snack-shifts-mutants.ts). The FIRST
// run had five killed at the WRONG assertion, every one an ordering fault in
// this file, not a library fault — recorded so nobody "simplifies" the order:
//   SM2 (venue filter) died at the composite "3 of 7 count" line, which sat
//       before the venue-specific line — the count is now LAST ([C4]).
//   SM5 (last start, not last end) died at [W1] because W1 also asserted
//       "one window" and the mutant's early maxEnd made a gap split the day —
//       W1 now checks only the first window's start; W2 owns the count+end.
//   SM10 (floor) and SM13 (offer at exactly 60) both died at [G6], a window
//       fixture whose division happened to be sensitive — the division
//       section now runs BEFORE the gap section, G6's leftover is 75 (not
//       exactly 60), and the S5 sweep's bound is structural (max+60) so the
//       exact boundary is [L4]'s line alone.
//   SM19 (count-only staleness) died at a [T1] case whose shift COUNT also
//       changed — the same-count-different-time case ([T3]) now runs first.
// 2026-10-05 (0104): SM26/SM27 (carried / lost dropped from the plan) killed
// at [F10] / [F11] on the first run; 27/27.
// 2026-10-06 (assignment overlap guard, section A): NM1–NM9 added; 36/36
// killed at their own assertion on the SECOND run. The first run had three
// at the wrong line, all harness faults, recorded so the fixtures stay as
// they are:
//   NM2 (away ignored) died at [A1] — A1's overlap fixture carried an AWAY
//       team (Bravo), so the away side was observable one line early. A1 now
//       uses a home team with an external opponent; A3 owns the away side.
//   NM4 (filter after equity) died at [A3] — an "away team with 0 shifts vs
//       free team with 1" case had crept into A3, which is an EQUITY-ORDER
//       case. It is gone; [A5] is the only equity-order line.
//   SM18 (equity not seeded) died at [A8] — A8 seeded a kept row to give
//       Charlie a shift. It now assigns TWO slots in one call instead, so
//       the seeding is exercised nowhere before [P5].
// The sweep did not produce an unfilled shift (12 teams, ≤8 games); the
// unfilled case is pinned by A3/A6's fixed fixtures and by NM5.
// Also from the first run: four fixtures accidentally carried a ≥60-minute
// break and the library split them correctly ([W3], [G6], [L7], [X1]); the
// real league's Saturdays have no break over 30 minutes across three fields,
// and the fixtures now say so.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ABSORB_OFFER_UNDER_MIN,
  GAP_SPLIT_MIN,
  GAME_BUFFER_AFTER_MIN,
  GAME_BUFFER_BEFORE_MIN,
  assignNewShifts,
  assignmentFlagLine,
  assignmentGamesFromPlayoffRows,
  assignmentGamesFromRows,
  assignmentIndexFromGames,
  closedDayLine,
  countingSpansByDate,
  deriveShifts,
  divideWindow,
  flattenShifts,
  reconcileWithStored,
  storedAssignmentFlag,
  resolveGameDurations,
  stalenessDiff,
  stalenessSummary,
  windowsFromSpans,
  type AssignmentGame,
  type AssignedSlot,
  type DerivationGame,
  type ShiftRule,
  type ShiftSlot,
  type StoredAbsorbChoice,
  type StoredShiftRow,
} from "../../src/lib/snack-shack/derive-shifts";
import {
  LEGACY_SHIFTS_NOTICE,
  assignmentChangeLines,
  buildRegeneratePlan,
  legacyShiftsNotice,
  maxShiftHelpText,
  todayInTimezone,
  upcomingStaleness,
} from "../../src/lib/snack-shack/regenerate-plan";

const ROOT = join(__dirname, "../..");
const failures: string[] = [];
let checks = 0;
function ok(cond: boolean, tag: string, label: string, detail = "") {
  checks++;
  if (cond) console.log(`  ok: [${tag}] ${label}`);
  else {
    failures.push(`[${tag}] ${label}`);
    console.error(`  FAIL: [${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try { fn(); } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    failures.push(`[CRASH-${name}] ${msg}`);
    console.error(`  FAIL: [CRASH-${name}] ${msg}`);
  }
}
const counters = {
  absorbOffered: 0,
  absorbDefaulted: 0,
  splitWindows: 0,
  mergedByOverlap: 0,
  closedDayGames: 0,
  keptAssignments: 0,
  removedWithAssignment: 0,
  staleChoices: 0,
  assumedDurations: 0,
  exactly60Stands: 0,
  shortShiftStands: 0,
  singleShiftWindow: 0,
  frozenPastRows: 0,
  changedShifts: 0,
  carriedItems: 0,
  lostItems: 0,
  // A
  blockedOnlyByBuffer: 0,
  blockedByAway: 0,
  blockedByPlayoff: 0,
  unfilledShifts: 0,
  gameDayFallbacks: 0,
  offDayBusyPicks: 0,
  sweepPicksWithSomeoneBlocked: 0,
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HOME = ["andrews", "memorial", "rca"];
const RULE: ShiftRule = { openBeforeMin: 30, closeAfterMin: 30, maxShiftMin: 120, daysOpen: ["Sa"], homeVenueIds: HOME };
const NO_OFFSETS: ShiftRule = { ...RULE, openBeforeMin: 0, closeAfterMin: 0 };

let seq = 0;
function game(date: string, hhmm: string, durationMin: number, opts: Partial<DerivationGame> = {}): DerivationGame {
  seq++;
  return {
    id: `g${seq}`,
    scheduled_at: `${date}T${hhmm}:00+00:00`,
    status: "scheduled",
    venue_id: "andrews",
    venue_name: "Andrews Field @ Monroe Complex (SRALL)",
    durationMin,
    durationDefaulted: false,
    ...opts,
  };
}
const times = (r: ReturnType<typeof deriveShifts>, date: string) =>
  r.days.find((d) => d.date === date)?.windows.map((w) => w.shifts.map((s) => `${s.start}-${s.end}`)) ?? null;

// ─── C: which games count ────────────────────────────────────────────────────

section("C: which games count", () => {
  const games = [
    game("2026-08-15", "10:00", 120),
    game("2026-08-15", "13:00", 105, { status: "cancelled" }),           // rained out — must not extend the day
    game("2026-08-15", "15:00", 120, { status: "pending_interleague" }), // unagreed proposal
    game("2026-08-15", "16:00", 120, { venue_id: "perry", venue_name: "Perry Field @ Wright Complex (WSLL)" }), // another park
    game("2026-08-15", "17:00", 120, { venue_id: null }),                // away interleague
    game("2026-08-15", "12:00", 60, { status: "reschedule_pending" }),   // confirmed, change outstanding — counts
    game("2026-08-15", "08:00", 90, { status: "completed" }),            // counts
  ];
  const { byDate, assumedDurationGameIds } = countingSpansByDate(games, RULE);
  const spans = byDate.get("2026-08-15") ?? [];
  ok(!spans.some((s) => s.gameId === games[1].id), "C1", "the rained-out (cancelled) game does not count");
  ok(!spans.some((s) => s.gameId === games[2].id), "C1", "the pending interleague proposal does not count");
  ok(!spans.some((s) => s.gameId === games[3].id), "C2", "a game at a non-attached venue does not count");
  ok(!spans.some((s) => s.gameId === games[4].id), "C2", "an away interleague game (venue null) does not count");
  ok(spans.some((s) => s.gameId === games[5].id) && spans.some((s) => s.gameId === games[6].id), "C3", "reschedule_pending and completed games count");
  ok(spans.length === 3, "C4", "only attached-venue games that countsAsScheduledGame count (3 of 7)", JSON.stringify(spans.map((s) => s.gameId)));
  ok(assumedDurationGameIds.length === 0, "U1", "no assumed durations when every division has one");

  const raw = resolveGameDurations([
    { id: "r1", scheduled_at: "2026-08-15T10:00:00+00:00", status: "scheduled", venue_id: "andrews", game_duration: 180 },
    { id: "r2", scheduled_at: "2026-08-15T13:00:00+00:00", status: "scheduled", venue_id: "andrews", game_duration: "105" },
    { id: "r3", scheduled_at: "2026-08-15T15:00:00+00:00", status: "scheduled", venue_id: "andrews", game_duration: null },
    { id: "r4", scheduled_at: "2026-08-15T16:00:00+00:00", status: "scheduled", venue_id: "andrews", game_duration: 0 },
  ]);
  ok(raw[0].durationMin === 180 && !raw[0].durationDefaulted && raw[1].durationMin === 105 && !raw[1].durationDefaulted, "U2", "numeric and numeric-string durations resolve as-is");
  ok(raw[2].durationMin === 90 && raw[2].durationDefaulted && raw[3].durationMin === 90 && raw[3].durationDefaulted, "U2", "null and zero resolve to 90 AND are flagged (planSettingsFromDivision policy)");
  const r = countingSpansByDate(raw, RULE);
  ok(r.assumedDurationGameIds.join(",") === "r3,r4", "U1", "the assumed-duration games are reported by id", r.assumedDurationGameIds.join(","));
  counters.assumedDurations += r.assumedDurationGameIds.length;
});

// ─── S: division into the fewest shifts ──────────────────────────────────────

section("S: fewest shifts of max or less", () => {
  const d510 = divideWindow(510, 120, null);
  ok(d510.lengths.length === 4 && d510.leftoverMin === 30, "S1", "510 min at a 2h max: ceil(510/120)=5 shifts before absorb, leftover 30 (then absorbed → 4)", JSON.stringify(d510));
  const d570 = divideWindow(570, 120, null);
  ok(JSON.stringify(d570.lengths) === JSON.stringify([120, 120, 120, 120, 90]) && !d570.offered, "S2", "570 min: 4×120 + 90, the 90-minute short shift stands (no offer)", JSON.stringify(d570));
  if (!d570.offered && d570.leftoverMin >= 60) counters.shortShiftStands++;
  const d345 = divideWindow(345, 180, null);
  ok(JSON.stringify(d345.lengths) === JSON.stringify([180, 165]), "S1", "345 min at a 3h max: 180 + 165 (the leftover is the LAST shift)", JSON.stringify(d345));
  const d100 = divideWindow(100, 120, null);
  ok(JSON.stringify(d100.lengths) === JSON.stringify([100]) && !d100.offered, "S3", "a window shorter than the max is one shift, never offered", JSON.stringify(d100));
  if (d100.lengths.length === 1) counters.singleShiftWindow++;
  const d240 = divideWindow(240, 120, null);
  ok(JSON.stringify(d240.lengths) === JSON.stringify([120, 120]) && !d240.offered, "S4", "an exact multiple divides evenly, no offer", JSON.stringify(d240));
  // Real-league-shaped sweep: every window from 345 to 645 at a 2h max.
  let bad = 0;
  for (let total = 345; total <= 645; total++) {
    for (const choice of [null, "first", "last", "split"] as const) {
      const d = divideWindow(total, 120, choice);
      const sum = d.lengths.reduce((a, b) => a + b, 0);
      const n = Math.ceil(total / 120);
      const expectedCount = d.offered ? n - 1 : n;
      const maxLen = Math.max(...d.lengths);
      // Structural bound only — the exact "under 60" boundary is [L4]'s line.
      const maxAllowed = d.offered ? 120 + ABSORB_OFFER_UNDER_MIN : 120;
      if (sum !== total || d.lengths.length !== expectedCount || maxLen > maxAllowed || d.lengths.some((l) => l <= 0)) bad++;
    }
  }
  ok(bad === 0, "S5", "345–645 min at 2h: lengths sum to the window, count is ceil(total/max) (one fewer when absorbed), no shift over max+60, none empty", `${bad} bad`);
});

// ─── W: the window ───────────────────────────────────────────────────────────

section("W: window from first start and last end", () => {
  // A real-shaped Saturday across three fields, no break over 30 min: last START 15:30, last END 16:45.
  const spans = countingSpansByDate([
    game("2026-08-22", "10:00", 120), game("2026-08-22", "12:00", 105, { venue_id: "memorial" }), game("2026-08-22", "13:30", 75, { venue_id: "rca" }),
    game("2026-08-22", "14:30", 120, { venue_id: "memorial" }), game("2026-08-22", "15:30", 75),
  ], RULE).byDate.get("2026-08-22")!;
  const w = windowsFromSpans(spans, RULE);
  ok(w[0].startMin === 9 * 60 + 30, "W1", "opens 30 min before the first game (09:30)", JSON.stringify(w));
  ok(w.length === 1 && w[0].endMin === 16 * 60 + 45 + 30, "W2", "closes 30 min after the last game ENDS (17:15), not after the last start", JSON.stringify(w));
  const w0 = windowsFromSpans(spans, NO_OFFSETS);
  ok(w0[0].startMin === 600 && w0[0].endMin === 16 * 60 + 45, "W3", "zero offsets: the window is exactly first start to last end");
  // A long game that ends after a later, shorter game started: the END governs.
  const spans2 = countingSpansByDate([game("2026-08-22", "10:00", 180, { venue_id: "rca" }), game("2026-08-22", "11:00", 60)], RULE).byDate.get("2026-08-22")!;
  const w2 = windowsFromSpans(spans2, NO_OFFSETS);
  ok(w2.length === 1 && w2[0].endMin === 13 * 60, "W2", "the last END (13:00 from the 180-min game) governs, not the last-starting game's end");
});

// ─── G: gaps and overlap merge ───────────────────────────────────────────────

section("G: gaps split, overlap merges", () => {
  const gapGames = (gapMin: number, date = "2026-09-12") => [game(date, "09:00", 120), game(date, minToHHMM(11 * 60 + gapMin), 120)];
  const sixty = windowsFromSpans(countingSpansByDate(gapGames(60), RULE).byDate.get("2026-09-12")!, NO_OFFSETS);
  ok(sixty.length === 2 && sixty[0].endMin === 11 * 60 && sixty[1].startMin === 12 * 60, "G1", "a 60-minute break splits the day into two windows", JSON.stringify(sixty));
  if (sixty.length === 2) counters.splitWindows++;
  const fiftyNine = windowsFromSpans(countingSpansByDate(gapGames(59), RULE).byDate.get("2026-09-12")!, NO_OFFSETS);
  ok(fiftyNine.length === 1 && fiftyNine[0].startMin === 9 * 60 && fiftyNine[0].endMin === 13 * 60 + 59, "G2", "a 59-minute break stays one window", JSON.stringify(fiftyNine));
  // 30/30 offsets: close 11:30, reopen 11:30 — touching — one window.
  const merged = windowsFromSpans(countingSpansByDate(gapGames(60), RULE).byDate.get("2026-09-12")!, RULE);
  ok(merged.length === 1 && merged[0].startMin === 8 * 60 + 30 && merged[0].endMin === 14 * 60 + 30, "G3", "a 60-minute break with 30/30 offsets would make the windows touch, so it stays ONE window", JSON.stringify(merged));
  if (merged.length === 1) counters.mergedByOverlap++;
  const split61 = windowsFromSpans(countingSpansByDate(gapGames(61), RULE).byDate.get("2026-09-12")!, RULE);
  ok(split61.length === 2 && split61[0].endMin === 11 * 60 + 30 && split61[1].startMin === 11 * 60 + 31, "G4", "a 61-minute break with 30/30 offsets closes 11:30 and reopens 11:31 — two windows", JSON.stringify(split61));
  // Three games with gaps either side: 9–11, 12:30–14:30, 16:00–18:00 → three windows at 0/0.
  const three = windowsFromSpans(countingSpansByDate([game("2026-09-12", "09:00", 120), game("2026-09-12", "12:30", 120), game("2026-09-12", "16:00", 120)], RULE).byDate.get("2026-09-12")!, NO_OFFSETS);
  ok(three.length === 3 && three.map((w) => w.gameIds.length).join(",") === "1,1,1", "G5", "every qualifying break splits — three windows", JSON.stringify(three));
  // Each window divides INDEPENDENTLY: 9:00–11:00 and 12:00–14:00 at a 90 max → 2 shifts each.
  // Each window divides INDEPENDENTLY: 9:00–11:45 and 12:45–15:30 (a 60-min break) at a 90 max → 90 + 75 each.
  const r = deriveShifts([game("2026-09-12", "09:00", 165), game("2026-09-12", "12:45", 165)], { ...NO_OFFSETS, maxShiftMin: 90 }, []);
  ok(JSON.stringify(times(r, "2026-09-12")) === JSON.stringify([["09:00-10:30", "10:30-11:45"], ["12:45-14:15", "14:15-15:30"]]), "G6", "two windows divide independently (90 + 75 each)", JSON.stringify(times(r, "2026-09-12")));
});

function minToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// ─── D: days the shack can open ──────────────────────────────────────────────

section("D: closed weekdays", () => {
  // The real league's weekday makeups: Thu 10-01 Rookies, Fri 10-02 Majors, Wed 10-14 Minors, one game each at Monroe.
  const games = [
    game("2026-10-01", "17:30", 75, { venue_id: "rca", venue_name: "RCA Field @ Monroe Complex (SRALL)" }),
    game("2026-10-02", "17:30", 120, { venue_id: "memorial", venue_name: "Memorial Field @ Monroe Complex (SRALL)" }),
    game("2026-10-14", "17:30", 105),
    game("2026-10-03", "10:00", 120),
  ];
  const r = deriveShifts(games, RULE, []);
  ok(r.days.length === 1 && r.days[0].date === "2026-10-03", "D1", "a counting game on a closed weekday produces NO shifts (only Saturday opens)", JSON.stringify(r.days.map((d) => d.date)));
  ok(r.closedDays.map((c) => `${c.date}:${c.day}:${c.gameCount}`).join(",") === "2026-10-01:Th:1,2026-10-02:Fr:1,2026-10-14:We:1", "D2", "every closed-day game is listed with its weekday and count", JSON.stringify(r.closedDays));
  counters.closedDayGames += r.closedDays.length;
  ok(closedDayLine(r.closedDays[0]) === "Thu, Oct 1 — game at RCA Field @ Monroe Complex (SRALL), shack not open that day", "D3", "the page line names the date, the venue and says the shack is not open", closedDayLine(r.closedDays[0]));
  const two = deriveShifts([game("2026-10-01", "17:30", 75, { venue_id: "rca", venue_name: "RCA" }), game("2026-10-01", "17:30", 75, { venue_id: "andrews", venue_name: "Andrews" })], RULE, []);
  ok(closedDayLine(two.closedDays[0]) === "Thu, Oct 1 — 2 games at Andrews, RCA, shack not open that day", "D3", "two games read '2 games' with the venues sorted", closedDayLine(two.closedDays[0]));
  const opened = deriveShifts(games, { ...RULE, daysOpen: ["Sa", "Th"] }, []);
  ok(opened.days.map((d) => d.date).join(",") === "2026-10-01,2026-10-03" && opened.closedDays.length === 2, "D4", "adding Thursday to daysOpen opens that makeup and leaves the other two closed");
  ok(JSON.stringify(times(opened, "2026-10-01")) === JSON.stringify([["17:00-19:15"]]), "D4", "the Thursday makeup is one 135-minute shift (17:00–19:15)", JSON.stringify(times(opened, "2026-10-01")));
  if (opened.days[0].windows[0].shifts.length === 1) counters.singleShiftWindow++;
});

// ─── L: leftover absorb ──────────────────────────────────────────────────────

section("L: leftover under an hour", () => {
  const last = divideWindow(510, 120, null);
  ok(JSON.stringify(last.lengths) === JSON.stringify([120, 120, 120, 150]) && last.offered && last.applied === "last" && last.defaulted, "L1", "510 min, no stored choice: the 30-minute leftover goes on the LAST shift by default (120,120,120,150)", JSON.stringify(last));
  if (last.offered) counters.absorbOffered++;
  if (last.defaulted) counters.absorbDefaulted++;
  const first = divideWindow(510, 120, "first");
  ok(JSON.stringify(first.lengths) === JSON.stringify([150, 120, 120, 120]) && !first.defaulted, "L2", "stored 'first': the leftover goes on the first shift (150,120,120,120)", JSON.stringify(first));
  const split = divideWindow(510, 120, "split");
  ok(JSON.stringify(split.lengths) === JSON.stringify([128, 128, 127, 127]), "L3", "stored 'split': 30 across 4 to the minute, odd minutes to the EARLIER shifts (128,128,127,127)", JSON.stringify(split));
  const split45 = divideWindow(645, 120, "split");
  ok(JSON.stringify(split45.lengths) === JSON.stringify([129, 129, 129, 129, 129]) && split45.lengths.reduce((a, b) => a + b, 0) === 645, "L3", "645 min: 45 across 5 is exactly 9 each — total still lands on closing time", JSON.stringify(split45));
  const split50 = divideWindow(50 + 3 * 120, 120, "split");
  ok(JSON.stringify(split50.lengths) === JSON.stringify([137, 137, 136]), "L3", "50 across 3: 17,17,16 extra (137,137,136)", JSON.stringify(split50));
  const sixty = divideWindow(540, 120, "first");
  ok(JSON.stringify(sixty.lengths) === JSON.stringify([120, 120, 120, 120, 60]) && !sixty.offered && sixty.applied === null, "L4", "a leftover of EXACTLY 60 is not under an hour — the 60-minute shift stands even with a stored choice", JSON.stringify(sixty));
  if (!sixty.offered && sixty.leftoverMin === 60) counters.exactly60Stands++;
  const fiftyNine = divideWindow(539, 120, null);
  ok(fiftyNine.offered && JSON.stringify(fiftyNine.lengths) === JSON.stringify([120, 120, 120, 179]), "L4", "a leftover of 59 is offered and absorbed (last → 179)", JSON.stringify(fiftyNine));
  // Two shifts, leftover 30: 'last' and 'first' both land on a shift, 'split' halves it.
  const two = divideWindow(150, 120, "split");
  ok(JSON.stringify(two.lengths) === JSON.stringify([150]), "L5a", "150 min at 2h: the 30 has only ONE shift to go to under split (150)", JSON.stringify(two));

  // Keyed by date + window start. A Saturday whose window starts 09:30 with a
  // stored 'first' for that key; the same key on another date is untouched.
  const games = [game("2026-09-19", "10:00", 120), game("2026-09-19", "13:00", 105), game("2026-09-19", "15:30", 120), game("2026-09-26", "10:00", 120), game("2026-09-26", "13:00", 105), game("2026-09-26", "15:30", 120)];
  const stored: StoredAbsorbChoice[] = [{ date: "2026-09-19", windowStart: "09:30", choice: "first" }];
  const r = deriveShifts(games, RULE, stored);
  // Window 09:30–18:00 = 510 → leftover 30 → offered.
  ok(JSON.stringify(times(r, "2026-09-19")) === JSON.stringify([["09:30-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00"]]), "L6", "the stored 'first' applies to 09-19 (first shift 150)", JSON.stringify(times(r, "2026-09-19")));
  ok(JSON.stringify(times(r, "2026-09-26")) === JSON.stringify([["09:30-11:30", "11:30-13:30", "13:30-15:30", "15:30-18:00"]]), "L6", "09-26 has no stored choice and takes the default (last shift 150)", JSON.stringify(times(r, "2026-09-26")));
  ok(r.staleChoices.length === 0, "L7", "a choice whose window still exists and is still short is not stale");
  const w19 = r.days[0].windows[0];
  ok(w19.absorbOffered && w19.absorbApplied === "first" && !w19.absorbDefaulted && w19.windowStart === "09:30", "L6", "the window reports offered/applied/not-defaulted and its start key");
  // The first game moves to 09:00: the window now starts 08:30, the stored key no longer matches → stale, default applies.
  const moved = [game("2026-09-19", "09:00", 120), game("2026-09-19", "13:00", 105), game("2026-09-19", "15:30", 120)];
  const r2 = deriveShifts(moved, RULE, stored);
  ok(r2.staleChoices.length === 1 && r2.staleChoices[0].windowStart === "09:30", "L7", "a stored choice whose window start moved is reported stale", JSON.stringify(r2.staleChoices));
  counters.staleChoices += r2.staleChoices.length;
  // 09:00–11:00 then a 2h break: two windows (08:30–11:30 = 180 → 120+60 stands; 12:30–18:00 = 330 → 120,120,90 stands). Neither is offered.
  ok(JSON.stringify(times(r2, "2026-09-19")) === JSON.stringify([["08:30-10:30", "10:30-11:30"], ["12:30-14:30", "14:30-16:30", "16:30-18:00"]]), "L7", "the moved day derives without the stale choice (two windows, nothing offered)", JSON.stringify(times(r2, "2026-09-19")));
  // Same date, window now starts 08:30 and IS short (510 min): the 09:30 choice is stale and the DEFAULT (last) applies, not 'first'.
  const moved2 = [game("2026-09-19", "09:00", 120), game("2026-09-19", "11:00", 105, { venue_id: "memorial" }), game("2026-09-19", "12:30", 120), game("2026-09-19", "14:00", 120, { venue_id: "rca" }), game("2026-09-19", "15:30", 60)];
  const r2b = deriveShifts(moved2, RULE, stored);
  ok(r2b.staleChoices.length === 1 && r2b.days[0].windows[0].absorbOffered && r2b.days[0].windows[0].absorbDefaulted, "L7", "a short window on the same date at a different start does NOT inherit the 09:30 choice — stale, defaulted", JSON.stringify({ stale: r2b.staleChoices, w: r2b.days[0].windows[0].windowStart }));
  ok(JSON.stringify(times(r2b, "2026-09-19")) === JSON.stringify([["08:30-10:30", "10:30-12:30", "12:30-14:30", "14:30-17:00"]]), "L7", "…and the default 'last' is what lands (last shift 150), not 'first'", JSON.stringify(times(r2b, "2026-09-19")));
  // Same window start, but the leftover is no longer short: the choice is stale too.
  const longer = [game("2026-09-19", "10:00", 120), game("2026-09-19", "13:00", 105), game("2026-09-19", "15:30", 180)];
  const r3 = deriveShifts(longer, RULE, stored);
  ok(r3.staleChoices.length === 1 && !r3.days[0].windows[0].absorbOffered, "L8", "a stored choice for a window that no longer has a short leftover is stale (09:30–19:00 = 570)", JSON.stringify({ stale: r3.staleChoices, offered: r3.days[0].windows[0].absorbOffered }));
});

// ─── A: assignment never overlaps a game ─────────────────────────────────────

// Fixture games for the assignment index: wall-clock date + start, a duration,
// home/away ids, a venue (default: a shack venue), a status and a kind.
type AG = { home: string | null; away?: string | null; date: string; start: string; dur: number; venue?: string | null; status?: string; kind?: "game" | "playoff" };
function ag(list: AG[]): AssignmentGame[] {
  return list.map((g) => ({
    home_team_id: g.home,
    away_team_id: g.away ?? null,
    venue_id: g.venue === undefined ? "andrews" : g.venue,
    date: g.date,
    start: g.start,
    status: g.status ?? "scheduled",
    durationMin: g.dur,
    kind: g.kind ?? "game",
  }));
}
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// THE HARNESS'S OWN CHECK — written against the fixture games, not the
// library's index, so a library that mis-indexes still fails here. A pick is
// bad if the team has any non-cancelled game that day whose [start − before,
// end + after) intersects the shift.
// The buffer is a LITERAL here on purpose: importing the library's constant
// would make this check move with a buffer mutant and agree with it.
function simSideOverlaps(games: AssignmentGame[], teamId: string, slot: ShiftSlot, before = 30, after = 0): boolean {
  const s = mins(slot.start), e = mins(slot.end);
  return games.some((g) =>
    g.status !== "cancelled" && g.date === slot.date && (g.home_team_id === teamId || g.away_team_id === teamId)
    && mins(g.start) - before < e && mins(g.start) + g.durationMin + after > s);
}
function checkEveryPick(tag: string, label: string, games: AssignmentGame[], out: AssignedSlot[]) {
  const bad = out.filter((a) => a.assignedTeamId && simSideOverlaps(games, a.assignedTeamId, a));
  ok(bad.length === 0, tag, label, bad.map((a) => `${a.date} ${a.start}-${a.end} → ${a.assignedTeamId}`).join(", "));
}

section("A: assignment is checked against game intervals, not dates", () => {
  const T = [{ id: "alpha", name: "Alpha" }, { id: "bravo", name: "Bravo" }, { id: "charlie", name: "Charlie" }, { id: "delta", name: "Delta" }];
  const SLOT: ShiftSlot = { date: "2026-10-17", start: "09:30", end: "11:30" };

  // A1 — plain overlap: Alpha (alphabetical first, fewest shifts, at the park)
  // plays 10:00–11:45 at a shack venue, as the HOME team with an external
  // opponent — home only, so the away-side mutant is not visible until A3.
  // The old picker chose Alpha; it must not.
  const g1 = ag([{ home: "alpha", away: null, date: "2026-10-17", start: "10:00", dur: 105 }]);
  const a1 = assignNewShifts([SLOT], T, [], "prefer_game_days", assignmentIndexFromGames(g1, HOME));
  checkEveryPick("A1", "a team playing during the shift is never assigned it (Alpha plays 10:00–11:45 inside 09:30–11:30)", g1, a1);
  ok(a1[0].assignedTeamId === "bravo", "A1", "the pick is the first eligible team (Bravo), not the first team", a1[0].assignedTeamId ?? "null");

  // A2 — the BUFFER alone: Alpha's game starts 11:45, fifteen minutes after the
  // shift ends. Without the 30-minute buffer Alpha is free and would be picked
  // (at the park, alphabetical first). With it, Alpha is blocked.
  const g2 = ag([{ home: "alpha", away: "delta", date: "2026-10-17", start: "11:45", dur: 75 }]);
  const a2 = assignNewShifts([SLOT], T, [], "prefer_game_days", assignmentIndexFromGames(g2, HOME));
  ok(a2[0].assignedTeamId !== "alpha" && a2[0].assignedTeamId !== "delta", "A2", "a game starting 15 minutes after the shift ends still blocks (30-minute buffer before the start)", a2[0].assignedTeamId ?? "null");
  ok(!simSideOverlaps(g2, "alpha", SLOT, 0, 0) && simSideOverlaps(g2, "alpha", SLOT), "A2", "(control) Alpha is excluded ONLY by the buffer — with no buffer the game clears the shift");
  counters.blockedOnlyByBuffer += 2;
  // …and the buffer is BEFORE the start only: a game ending exactly at the
  // shift's start does not block.
  const g2b = ag([{ home: "alpha", date: "2026-10-17", start: "08:30", dur: 60 }]);
  const a2b = assignNewShifts([SLOT], T, [], "prefer_game_days", assignmentIndexFromGames(g2b, HOME));
  ok(a2b[0].assignedTeamId === "alpha", "A2", "a game ending exactly when the shift starts does not block (no buffer after the end) — Alpha, at the park, is picked");

  // A3 — AWAY games count. Charlie is the AWAY team of a 10:00–11:00 game at a
  // shack venue (blocked); Bravo and Delta are blocked too; Alpha plays at
  // 13:00 elsewhere, so Alpha is eligible but not "free" that day. If away
  // games were ignored, Charlie would look free and be preferred over Alpha.
  const g3 = ag([{ home: "alpha", date: "2026-10-17", start: "13:00", dur: 60, venue: "perry" }, { home: "bravo", date: "2026-10-17", start: "09:00", dur: 60, venue: "perry" }, { home: "delta", away: "charlie", date: "2026-10-17", start: "10:00", dur: 60 }]);
  const a3 = assignNewShifts([SLOT], T, [], "prefer_off_days", assignmentIndexFromGames(g3, HOME));
  checkEveryPick("A3", "a team playing AWAY during the shift is never assigned it", g3, a3);
  ok(a3[0].assignedTeamId === "alpha", "A3", "Alpha (13:00 game, clear of the shift) is the only eligible team and is picked; Charlie, away during the shift, is not", a3[0].assignedTeamId ?? "null");
  counters.blockedByAway += 1;
  // Same shape at another park: an away game elsewhere blocks just the same.
  const g3b = ag([{ home: "delta", away: "charlie", date: "2026-10-17", start: "10:00", dur: 60, venue: "perry" }]);
  const a3b = assignNewShifts([SLOT], T, [], "prefer_off_days", assignmentIndexFromGames(g3b, HOME));
  ok(a3b[0].assignedTeamId === "alpha", "A3", "Alpha (no game) is picked; Charlie, away at another park during the shift, is not", a3b[0].assignedTeamId ?? "null");
  counters.blockedByAway += 1;

  // A4 — PLAYOFF games count. Alpha's only game that day is a playoff game
  // 10:00–11:00 at a shack venue; off-days mode would pick Alpha if playoffs
  // were ignored.
  const g4 = ag([{ home: "alpha", away: "bravo", date: "2026-10-17", start: "10:00", dur: 60, kind: "playoff" }]);
  const a4 = assignNewShifts([SLOT], T, [], "prefer_off_days", assignmentIndexFromGames(g4, HOME));
  checkEveryPick("A4", "a team playing a PLAYOFF game during the shift is never assigned it", g4, a4);
  ok(a4[0].assignedTeamId === "charlie", "A4", "Charlie (no game) is picked over Alpha/Bravo (playoff game)", a4[0].assignedTeamId ?? "null");
  counters.blockedByPlayoff += 2;
  // The playoff row adapter: a row with no date is not on the calendar.
  const prow = assignmentGamesFromPlayoffRows([
    { home_team_id: "alpha", away_team_id: "bravo", venue_id: "andrews", scheduled_date: "2026-10-17", start_time: "10:00:00", status: "scheduled", durationMin: 60 },
    { home_team_id: "charlie", away_team_id: null, venue_id: null, scheduled_date: null, start_time: null, status: "scheduled", durationMin: 60 },
  ]);
  ok(prow.length === 1 && prow[0].kind === "playoff" && prow[0].start === "10:00" && prow[0].date === "2026-10-17", "A4", "the playoff adapter keeps dated rows (HH:MM:SS → HH:MM) and drops undated ones");
  const grow = assignmentGamesFromRows([{ home_team_id: "alpha", away_team_id: null, venue_id: null, scheduled_at: "2026-10-17T19:45:00+00:00", status: "scheduled", durationMin: 60 }]);
  ok(grow[0].date === "2026-10-17" && grow[0].start === "19:45" && grow[0].kind === "game", "A4", "the games adapter reads date and time by substring of the wall-clock");

  // A5 — the hard rule runs BEFORE equity. Alpha holds nothing; Bravo already
  // holds one shift. Alpha plays during the shift. Equity-first would narrow
  // to Alpha and then find nobody; the rule-first order gives it to Bravo.
  const g5 = ag([{ home: "alpha", date: "2026-10-17", start: "10:00", dur: 60 }]);
  const a5 = assignNewShifts([SLOT], [T[0], T[1]], [{ assigned_team_id: "bravo" }], "prefer_off_days", assignmentIndexFromGames(g5, HOME));
  ok(a5[0].assignedTeamId === "bravo" && a5[0].flag === null, "A5", "an eligible team with one more shift beats a blocked team with fewer — Bravo gets it (not unfilled, not Alpha)", `${a5[0].assignedTeamId} ${a5[0].flag}`);

  // A6 — nobody free: unassigned and flagged, never a playing team.
  const g6 = ag([{ home: "alpha", away: "bravo", date: "2026-10-17", start: "10:00", dur: 60 }, { home: "charlie", away: "delta", date: "2026-10-17", start: "10:30", dur: 60, venue: "perry" }]);
  const a6 = assignNewShifts([SLOT], T, [], "prefer_game_days", assignmentIndexFromGames(g6, HOME));
  ok(a6[0].assignedTeamId === null && a6[0].flag === "unfilled", "A6", "every team plays during the shift → unassigned + 'unfilled', not a playing team", `${a6[0].assignedTeamId} ${a6[0].flag}`);
  checkEveryPick("A6", "(and no pick overlaps)", g6, a6);
  counters.unfilledShifts += 1;
  ok(assignmentFlagLine("unfilled", "prefer_game_days") === "No team is free — every team plays during this shift (within 30 minutes of a game).", "A6", "the unfilled sentence, verbatim");

  // A7 — game days prefer a team AT THE PARK, home OR away, whose game clears
  // the shift; tier 1 wins over a zero-count off-day team.
  const g7 = ag([{ home: "delta", away: "charlie", date: "2026-10-17", start: "12:30", dur: 60 }]);
  const a7 = assignNewShifts([SLOT], T, [], "prefer_game_days", assignmentIndexFromGames(g7, HOME));
  ok(a7[0].assignedTeamId === "charlie" && a7[0].flag === null, "A7", "game days: Charlie, the AWAY team of a 12:30 game at the park, is preferred over Alpha/Bravo (no game)", `${a7[0].assignedTeamId}`);
  // A team at ANOTHER park that day is not tier 1.
  const g7b = ag([{ home: "alpha", away: "bravo", date: "2026-10-17", start: "12:30", dur: 60, venue: "perry" }]);
  const a7b = assignNewShifts([SLOT], T, [], "prefer_game_days", assignmentIndexFromGames(g7b, HOME));
  ok(a7b[0].assignedTeamId === "charlie" && a7b[0].flag === "preference_not_met", "A7", "game days with nobody at the park: an off-day team (Charlie) and the fallback is flagged", `${a7b[0].assignedTeamId} ${a7b[0].flag}`);
  counters.gameDayFallbacks += 1;
  // Tier 3: everyone plays that day, only one clears the shift, elsewhere.
  const g7c = ag([{ home: "alpha", away: "bravo", date: "2026-10-17", start: "10:00", dur: 60 }, { home: "charlie", away: "delta", date: "2026-10-17", start: "13:00", dur: 60, venue: "perry" }]);
  const a7c = assignNewShifts([SLOT], T, [], "prefer_game_days", assignmentIndexFromGames(g7c, HOME));
  ok(a7c[0].assignedTeamId === "charlie" && a7c[0].flag === "preference_not_met", "A7", "game days, tier 3: everyone plays that day, Charlie/Delta clear the shift (elsewhere) → Charlie, flagged", `${a7c[0].assignedTeamId} ${a7c[0].flag}`);
  counters.gameDayFallbacks += 1;
  ok(assignmentFlagLine("preference_not_met", "prefer_game_days") === "Not at the park that day — every team playing here is busy during this shift.", "A7", "the game-day fallback sentence, verbatim");

  // A8 — off days: evenness first; a busy pick is flagged. Two slots in ONE
  // call (no kept seeding, so SM18 stays P5's mutant): Alpha and Bravo play at
  // 14:00 elsewhere (clear of both shifts, with the buffer); Charlie is free.
  // Slot 1 → Charlie (the only free team). Slot 2: the fewest-shift teams are
  // Alpha and Bravo (0 each) and both play that day → Alpha, flagged; Charlie
  // (1 shift, free) is NOT promoted over them.
  const g8 = ag([{ home: "alpha", away: "bravo", date: "2026-10-17", start: "14:00", dur: 60, venue: "perry" }]);
  const a8 = assignNewShifts([SLOT, { date: "2026-10-17", start: "11:30", end: "13:30" }], [T[0], T[1], T[2]], [], "prefer_off_days", assignmentIndexFromGames(g8, HOME));
  ok(a8[0].assignedTeamId === "charlie" && a8[0].flag === null && a8[1].assignedTeamId === "alpha" && a8[1].flag === "preference_not_met", "A8", "off days: slot 1 → Charlie (free); slot 2 → Alpha, flagged — the fewest-shift teams both play that day and Charlie (1 shift, free) is not promoted", a8.map((a) => `${a.assignedTeamId} ${a.flag}`).join(" | "));
  counters.offDayBusyPicks += 1;
  ok(assignmentFlagLine("preference_not_met", "prefer_off_days") === "Plays that day — every team with the fewest shifts has a game that day.", "A8", "the off-day busy sentence, verbatim");
  // Cancelled games don't count.
  const g8b = ag([{ home: "alpha", date: "2026-10-17", start: "10:00", dur: 60, status: "cancelled" }]);
  const a8b = assignNewShifts([SLOT], T, [], "prefer_off_days", assignmentIndexFromGames(g8b, HOME));
  ok(a8b[0].assignedTeamId === "alpha" && a8b[0].flag === null, "A8", "a cancelled game neither blocks nor counts as playing — Alpha is picked, unflagged");
  // A pending proposal DOES block (the team might be busy).
  const g8c = ag([{ home: "alpha", date: "2026-10-17", start: "10:00", dur: 60, status: "pending_interleague" }]);
  ok(assignNewShifts([SLOT], T, [], "prefer_off_days", assignmentIndexFromGames(g8c, HOME))[0].assignedTeamId === "bravo", "A8", "a pending interleague proposal blocks the shift (Alpha skipped → Bravo)");

  // A9 — stored rows judged by the same rules (for the page): conflict,
  // preference, unfilled.
  const idx9 = assignmentIndexFromGames(g1, HOME);
  ok(storedAssignmentFlag(idx9, "prefer_game_days", "alpha", SLOT) === "conflict", "A9", "a stored team that plays during the shift → 'conflict'");
  ok(storedAssignmentFlag(idx9, "prefer_game_days", "charlie", SLOT) === "preference_not_met", "A9", "game days: a stored team with no game at the park → 'preference_not_met'");
  ok(storedAssignmentFlag(idx9, "prefer_off_days", "charlie", SLOT) === null, "A9", "off days: a stored team with no game → no flag");
  ok(storedAssignmentFlag(idx9, "prefer_game_days", null, SLOT) === "unfilled", "A9", "a stored derived row with no team → 'unfilled'");
  ok(storedAssignmentFlag(idx9, "prefer_game_days", "alpha", { date: "2026-10-17", start: "12:30", end: "14:30" }) === null, "A9", "game days: a stored park team whose game cleared the shift → no flag");
  ok(assignmentFlagLine("conflict", "prefer_off_days") === "This team plays during this shift (within 30 minutes of a game).", "A9", "the conflict sentence, verbatim");

  // A10 — SWEEP: 300 seeded random Saturdays, real-league shape (12 teams,
  // 4–8 games across three shack fields and one other park, a 60–180 minute
  // division, 1–4 shifts), both modes. Every pick passes the sim-side check;
  // a shift is unassigned only when the sim-side check blocks EVERY team.
  let seed = 20261006;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)];
  const TEAMS = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, name: `Team ${String.fromCharCode(65 + i)}` }));
  let sweepPicks = 0;
  for (let n = 0; n < 300; n++) {
    const date = "2026-10-17";
    const games: AssignmentGame[] = [];
    const nGames = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < nGames; i++) {
      const ids = [...TEAMS.map((t) => t.id)];
      const home = ids.splice(Math.floor(rnd() * ids.length), 1)[0];
      const away = rnd() < 0.15 ? null : ids.splice(Math.floor(rnd() * ids.length), 1)[0];
      games.push(...ag([{ home, away, date, start: `${String(8 + Math.floor(rnd() * 10)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}`, dur: pick([60, 75, 90, 105, 120, 180]), venue: pick(["andrews", "memorial", "rca", "perry"]), status: pick(["scheduled", "scheduled", "scheduled", "cancelled", "pending_interleague"]), kind: rnd() < 0.2 ? "playoff" : "game" }]));
    }
    const nShifts = 1 + Math.floor(rnd() * 4);
    const slots: ShiftSlot[] = [];
    let t0 = 8 * 60 + 30 + Math.floor(rnd() * 4) * 60;
    for (let i = 0; i < nShifts; i++) { const len = pick([90, 120, 150]); slots.push({ date, start: `${String(Math.floor(t0 / 60)).padStart(2, "0")}:${String(t0 % 60).padStart(2, "0")}`, end: `${String(Math.floor((t0 + len) / 60)).padStart(2, "0")}:${String((t0 + len) % 60).padStart(2, "0")}` }); t0 += len; }
    const kept = TEAMS.filter(() => rnd() < 0.3).map((t) => ({ assigned_team_id: t.id }));
    for (const mode of ["prefer_game_days", "prefer_off_days"] as const) {
      const out = assignNewShifts(slots, TEAMS, kept, mode, assignmentIndexFromGames(games, HOME));
      for (const a of out) {
        const blockedTeams = TEAMS.filter((t) => simSideOverlaps(games, t.id, a));
        if (blockedTeams.length > 0) counters.sweepPicksWithSomeoneBlocked++;
        if (a.assignedTeamId) {
          sweepPicks++;
          if (simSideOverlaps(games, a.assignedTeamId, a)) { ok(false, "A10", `sweep ${n}/${mode}: ${a.date} ${a.start}-${a.end} given to ${a.assignedTeamId}, who plays during it`); return; }
          if (a.flag === "unfilled" || a.flag === "conflict") { ok(false, "A10", `sweep ${n}/${mode}: an assigned shift carries '${a.flag}'`); return; }
        } else {
          counters.unfilledShifts++;
          if (blockedTeams.length !== TEAMS.length) { ok(false, "A10", `sweep ${n}/${mode}: ${a.date} ${a.start}-${a.end} left unfilled while ${TEAMS.length - blockedTeams.length} team(s) were free`); return; }
          if (a.flag !== "unfilled") { ok(false, "A10", `sweep ${n}/${mode}: an unassigned shift is not flagged 'unfilled'`); return; }
        }
      }
    }
  }
  ok(sweepPicks > 1000, "A10", `sweep: ${sweepPicks} picks over 300 random Saturdays × 2 modes, every one clear of the team's games (with the buffer); unfilled only when nobody was free`);
  ok(GAME_BUFFER_BEFORE_MIN === 30 && GAME_BUFFER_AFTER_MIN === 0, "A11", "the buffer the product ships is 30 minutes before a game and none after (the sim-side check pins the same literals)");
});

// ─── P: assignment preservation on regenerate ────────────────────────────────

section("P: regenerate keeps unchanged assignments", () => {
  const derived = [
    { date: "2026-09-19", start: "09:30", end: "11:30" },
    { date: "2026-09-19", start: "11:30", end: "13:30" },
    { date: "2026-09-19", start: "13:30", end: "16:00" }, // changed: was 13:30-15:30 + 15:30-16:00
    { date: "2026-10-03", start: "09:30", end: "11:30" }, // new day
  ];
  const stored: StoredShiftRow[] = [
    { id: "b1", date: "2026-09-19", start_time: "09:30:00", end_time: "11:30:00", assigned_team_id: "bears", is_recurring: true },
    { id: "b2", date: "2026-09-19", start_time: "11:30:00", end_time: "13:30:00", assigned_team_id: "cubs", is_recurring: true },
    { id: "b3", date: "2026-09-19", start_time: "13:30:00", end_time: "15:30:00", assigned_team_id: "expos", is_recurring: true },
    { id: "b4", date: "2026-09-19", start_time: "15:30:00", end_time: "16:00:00", assigned_team_id: null, is_recurring: true },
    { id: "b5", date: "2026-09-26", start_time: "09:30:00", end_time: "11:30:00", assigned_team_id: "giants", is_recurring: true }, // day lost its games
    { id: "m1", date: "2026-09-19", start_time: "08:00:00", end_time: "09:30:00", assigned_team_id: "cubs", is_recurring: false }, // manual
    { id: "m2", date: "2026-11-01", start_time: "08:00:00", end_time: "16:00:00", assigned_team_id: null, is_recurring: false },   // manual, no games
  ];
  const rec = reconcileWithStored(derived, stored);
  ok(rec.keep.map((r) => r.id).join(",") === "b1,b2", "P1", "rows whose date/start/end are unchanged are kept (b1, b2) — the 13:30 row whose END changed is not", rec.keep.map((r) => r.id).join(","));
  counters.keptAssignments += rec.keep.filter((r) => r.assigned_team_id).length;
  ok(rec.create.map((s) => `${s.date} ${s.start}-${s.end}`).join(",") === "2026-09-19 13:30-16:00,2026-10-03 09:30-11:30", "P2", "the changed slot and the new day are created", JSON.stringify(rec.create));
  ok(rec.remove.map((r) => r.id).sort().join(",") === "b3,b4,b5", "P3", "the superseded rows and the day that lost its games are removed", rec.remove.map((r) => r.id).join(","));
  counters.removedWithAssignment += rec.remove.filter((r) => r.assigned_team_id).length;
  ok(!rec.keep.some((r) => !r.is_recurring) && !rec.remove.some((r) => !r.is_recurring), "P4", "manual rows (is_recurring=false) are in no list — untouched");
  // The equity counter is seeded with the kept rows: bears and cubs already hold one each,
  // so the two new slots go to the other teams (alphabetical among the zero-count teams).
  const teams = [{ id: "giants", name: "Giants" }, { id: "bears", name: "Bears" }, { id: "cubs", name: "Cubs" }, { id: "expos", name: "Expos" }];
  const maps = assignmentIndexFromGames([], HOME);
  const assigned = assignNewShifts(rec.create, teams, rec.keep, "prefer_off_days", maps);
  ok(assigned.map((a) => a.assignedTeamId).join(",") === "expos,giants", "P5", "new slots go to the teams with the fewest KEPT assignments (expos, giants — not bears/cubs again)", assigned.map((a) => a.assignedTeamId).join(","));
  // Without seeding, bears would be picked first (alphabetical, all zero).
  const unseeded = assignNewShifts(rec.create, teams, [], "prefer_off_days", maps);
  ok(unseeded[0].assignedTeamId === "bears", "P5", "(control) without the kept rows the first pick would be Bears — the seed is what changes it");
  // Preference still applies on new slots — but since 2026-10-06 the hard rule
  // runs first: Giants and Expos play 10:00–12:00 INSIDE the 09:30–11:30 shift,
  // so neither may take it in either mode (the old P6 expected Giants here).
  const mapsHome = assignmentIndexFromGames(ag([{ home: "giants", away: "expos", date: "2026-10-03", start: "10:00", dur: 120 }]), HOME);
  const pref = assignNewShifts([{ date: "2026-10-03", start: "09:30", end: "11:30" }], teams, [], "prefer_game_days", mapsHome);
  ok(pref[0].assignedTeamId === "bears" && pref[0].flag === "preference_not_met", "P6", "prefer_game_days: both park teams are busy during the shift → an off-day team (Bears), flagged");
  const off = assignNewShifts([{ date: "2026-10-03", start: "09:30", end: "11:30" }], teams, [], "prefer_off_days", mapsHome);
  ok(off[0].assignedTeamId === "bears" && off[0].flag === null, "P6", "prefer_off_days skips both teams playing that day (giants, expos) → Bears, no flag");
  // A shift AFTER the game: the park teams are free of it and preferred again.
  const later = assignNewShifts([{ date: "2026-10-03", start: "12:30", end: "14:30" }], teams, [], "prefer_game_days", mapsHome);
  ok(later[0].assignedTeamId === "expos" && later[0].flag === null, "P6", "prefer_game_days on a later shift: the park teams qualify (game ended 12:00, shift 12:30) → Expos (alphabetical among the two)");
  // Duplicate stored rows for one slot: keep the first, remove the rest.
  const dup = reconcileWithStored([{ date: "2026-09-19", start: "09:30", end: "11:30" }], [
    { id: "x1", date: "2026-09-19", start_time: "09:30", end_time: "11:30", assigned_team_id: "bears", is_recurring: true },
    { id: "x2", date: "2026-09-19", start_time: "09:30:00", end_time: "11:30:00", assigned_team_id: null, is_recurring: true },
  ]);
  ok(dup.keep.length === 1 && dup.keep[0].id === "x1" && dup.remove.length === 1 && dup.remove[0].id === "x2" && dup.create.length === 0, "P7", "a duplicate stored row for one slot: keep the first, remove the extra, create nothing");
});

// ─── T: staleness ────────────────────────────────────────────────────────────

section("T: staleness diff", () => {
  const games = [game("2026-09-19", "10:00", 120), game("2026-09-19", "13:00", 105), game("2026-09-26", "10:00", 120)];
  const current = flattenShifts(deriveShifts(games, RULE, []));
  // 09-19: 09:30–15:15 = 345 → 120,120,105. 09-26: 09:30–12:30 = 180 → 120,60.
  const stored: StoredShiftRow[] = [
    { id: "1", date: "2026-09-19", start_time: "09:30:00", end_time: "11:30:00", assigned_team_id: null, is_recurring: true },
    { id: "2", date: "2026-09-19", start_time: "11:30:00", end_time: "13:30:00", assigned_team_id: null, is_recurring: true },
    { id: "3", date: "2026-09-19", start_time: "13:30:00", end_time: "15:15:00", assigned_team_id: null, is_recurring: true },
    { id: "4", date: "2026-09-26", start_time: "09:30:00", end_time: "11:30:00", assigned_team_id: null, is_recurring: true },
    { id: "5", date: "2026-09-26", start_time: "11:30:00", end_time: "12:30:00", assigned_team_id: null, is_recurring: true },
    { id: "m", date: "2026-09-26", start_time: "07:00:00", end_time: "09:30:00", assigned_team_id: null, is_recurring: false },
  ];
  ok(stalenessDiff(current, stored).differingDates.length === 0 && stalenessSummary(stalenessDiff(current, stored)) === null, "T0", "stored shifts that match the derivation are not stale; manual rows are ignored", JSON.stringify(current));
  // Same count of shifts, different times: still stale (count-only would miss it).
  const shifted: StoredShiftRow[] = stored.map((r) => (r.id === "3" ? { ...r, end_time: "15:30:00" } : r));
  ok(stalenessDiff(current, shifted).differingDates.join(",") === "2026-09-19", "T3", "the same number of shifts with one different end time is stale", JSON.stringify(stalenessDiff(current, shifted)));
  // A rainout cancels the 13:00 game on 09-19: the day's window shrinks.
  const rained = [{ ...games[0] }, { ...games[1], status: "cancelled" }, games[2]];
  const d1 = stalenessDiff(flattenShifts(deriveShifts(rained, RULE, [])), stored);
  ok(d1.differingDates.join(",") === "2026-09-19", "T1", "a rainout that shrinks one day flags exactly that date", d1.differingDates.join(","));
  ok(stalenessSummary(d1) === "The schedule changed since shifts were made — 1 day differ.", "T2", "the sentence, verbatim (singular)", stalenessSummary(d1) ?? "null");
  // 09-26 loses all its games AND 09-19 shifts move: two dates.
  const both = [game("2026-09-19", "09:00", 120), game("2026-09-19", "13:00", 105)];
  const d2 = stalenessDiff(flattenShifts(deriveShifts(both, RULE, [])), stored);
  ok(d2.differingDates.join(",") === "2026-09-19,2026-09-26", "T1", "a day that lost every game and a day whose shifts moved are both flagged", d2.differingDates.join(","));
  ok(stalenessSummary(d2) === "The schedule changed since shifts were made — 2 days differ.", "T2", "the sentence, verbatim (plural)", stalenessSummary(d2) ?? "null");
  // A new game day with no stored rows at all: flagged.
  const extra = [...games, game("2026-10-03", "10:00", 120)];
  ok(stalenessDiff(flattenShifts(deriveShifts(extra, RULE, [])), stored).differingDates.join(",") === "2026-10-03", "T1", "a new game day with no stored shifts is flagged");
});

// ─── F: the regenerate plan ──────────────────────────────────────────────────

section("F: past dates frozen, preview, upcoming staleness", () => {
  const TODAY = "2026-10-10";
  // 10-03 is PAST: the schedule now derives one 3-hour shift there, but the
  // stored rows (two shifts, Bears and Cubs) must ride through untouched.
  // 10-17 is upcoming: the first shift is unchanged, the second's END moved.
  const games = [game("2026-10-03", "10:00", 150), game("2026-10-17", "10:00", 120), game("2026-10-17", "12:00", 90)];
  // 10-03: 09:30–13:00 = 210 → 120 + 90 (two shifts, 09:30-11:30 + 11:30-13:00) — differs from stored.
  // 10-17: 09:30–14:00 = 270 → 120 + 120 + 30 → absorbed last → 09:30-11:30, 11:30-14:00.
  const derivation = deriveShifts(games, RULE, []);
  const stored: StoredShiftRow[] = [
    { id: "p1", date: "2026-10-03", start_time: "09:30:00", end_time: "11:30:00", assigned_team_id: "bears", is_recurring: true },
    { id: "p2", date: "2026-10-03", start_time: "11:30:00", end_time: "12:30:00", assigned_team_id: "cubs", is_recurring: true },
    { id: "u1", date: "2026-10-17", start_time: "09:30:00", end_time: "11:30:00", assigned_team_id: "expos", is_recurring: true },
    { id: "u2", date: "2026-10-17", start_time: "11:30:00", end_time: "13:30:00", assigned_team_id: null, is_recurring: true },
    { id: "m1", date: "2026-10-03", start_time: "08:00:00", end_time: "09:30:00", assigned_team_id: "giants", is_recurring: false },
  ];
  const teams = [{ id: "giants", name: "Giants" }, { id: "bears", name: "Bears" }, { id: "cubs", name: "Cubs" }, { id: "expos", name: "Expos" }];
  const plan = buildRegeneratePlan({ derivation, stored, teams, preference: "prefer_off_days", index: assignmentIndexFromGames([], HOME), today: TODAY });
  const past = plan.desired.filter((d) => d.date === "2026-10-03");
  ok(JSON.stringify(past) === JSON.stringify([
    { date: "2026-10-03", start: "09:30", end: "11:30", assigned_team_id: "bears" },
    { date: "2026-10-03", start: "11:30", end: "12:30", assigned_team_id: "cubs" },
  ]), "F1", "stored rows before today ride the payload EXACTLY as stored (no derived 11:30-13:00, nothing dropped, teams kept)", JSON.stringify(past));
  ok(plan.frozenPast === 2 && !plan.dayChanges.some((d) => d.date === "2026-10-03"), "F1", "frozenPast=2 and the past date appears in no change list");
  counters.frozenPastRows += plan.frozenPast;
  const up = plan.desired.filter((d) => d.date === "2026-10-17");
  ok(JSON.stringify(up.map((d) => `${d.start}-${d.end}`)) === JSON.stringify(["09:30-11:30", "11:30-14:00"]) && up[0].assigned_team_id === "expos" && up[1].assigned_team_id !== null, "F2", "upcoming: the unchanged shift keeps Expos; the changed slot is new and assigned (WHO is F4's line)", JSON.stringify(up));
  ok(plan.kept === 1 && plan.dayChanges.length === 1 && plan.dayChanges[0].date === "2026-10-17"
     && plan.dayChanges[0].changed.length === 1 && plan.dayChanges[0].added.length === 0 && plan.dayChanges[0].removed.length === 0, "F2", "the 11:30 pair (end 13:30 → 14:00) is ONE 'changed' shift, not a removal plus an addition", JSON.stringify(plan.dayChanges));
  counters.changedShifts += plan.dayChanges.reduce((n, d) => n + d.changed.length, 0);
  ok(plan.assignmentChanges.length === 1 && plan.assignmentChanges[0].kind === "changed" && plan.assignmentChanges[0].fromTeamId === null && plan.assignmentChanges[0].toTeamId !== null, "F2", "the assignment change lists unassigned → a team on the changed shift", JSON.stringify(plan.assignmentChanges));
  ok(plan.hasChanges, "F2", "the plan reports changes");
  // Staleness: 10-03 differs but is past → not reported; 10-17 differs → reported.
  const st = upcomingStaleness(derivation, stored, TODAY);
  ok(st.differingDates.join(",") === "2026-10-17", "F3", "staleness over upcoming dates only — the past 10-03 is not reported", st.differingDates.join(","));
  // Equity seeded with the frozen past rows: Bears and Cubs already hold one each, Expos is kept → Giants.
  ok(up[1].assigned_team_id === "giants" && plan.assignmentChanges[0].kind === "changed" && plan.assignmentChanges[0].toTeamId === "giants", "F4", "the new shift goes to the only team holding nothing (frozen Bears/Cubs count, kept Expos counts) — Giants, and the change line says so");
  // A removed row with a team, and a plain addition on another day.
  const games2 = [game("2026-10-17", "10:00", 120), game("2026-10-24", "10:00", 120)];
  const plan2 = buildRegeneratePlan({ derivation: deriveShifts(games2, RULE, []), stored, teams, preference: "prefer_off_days", index: assignmentIndexFromGames([], HOME), today: TODAY });
  // 10-17: 09:30–12:30 = 180 → 120 + 60 → 09:30-11:30 (kept, expos), 11:30-12:30 (changed from 11:30-13:30). 10-24: same → two added.
  const kinds = plan2.assignmentChanges.map((c) => c.kind).join(",");
  ok(kinds === "changed,added,added", "F5", "kinds: the 10-17 same-start pair is 'changed'; the new day's shifts are 'added'", kinds + " " + JSON.stringify(plan2.assignmentChanges));
  const lines = assignmentChangeLines(plan2.assignmentChanges, (id) => teams.find((t) => t.id === id)?.name ?? id ?? "?");
  ok(lines[0] === "2026-10-17 11:30: ends 13:30 → 12:30, unassigned → Giants" && lines[1].startsWith("2026-10-24 09:30–11:30: new → "), "F6", "the preview lines read as team → team / new → team", JSON.stringify(lines));
  const plan3 = buildRegeneratePlan({ derivation: deriveShifts([], RULE, []), stored, teams, preference: "prefer_off_days", index: assignmentIndexFromGames([], HOME), today: TODAY });
  ok(plan3.assignmentChanges.some((c) => c.kind === "removed" && c.fromTeamId === "expos") && plan3.desired.length === 2 && plan3.frozenPast === 2, "F6", "no upcoming games: upcoming rows are removed (Expos → removed), the past two still ride the payload", JSON.stringify(plan3.assignmentChanges));
  // 0104 — carried / lost. The stored rows gain a note and a cash person.
  const storedNC: StoredShiftRow[] = stored.map((r) =>
    r.id === "u2" ? { ...r, notes: "float in the office", cash_person_id: "cash-a" } :
    r.id === "u1" ? { ...r, cash_person_id: "cash-b" } : r);
  const planNC = buildRegeneratePlan({ derivation, stored: storedNC, teams, preference: "prefer_off_days", index: assignmentIndexFromGames([], HOME), today: TODAY });
  ok(planNC.carried.length === 1 && planNC.carried[0].start === "11:30" && planNC.carried[0].fromEnd === "13:30" && planNC.carried[0].toEnd === "14:00"
     && planNC.carried[0].notes === "float in the office" && planNC.carried[0].cashPersonId === "cash-a", "F10", "a note + cash person on the CHANGED (same-start) row is reported as carried to the new end", JSON.stringify(planNC.carried));
  ok(planNC.lost.length === 0, "F10", "nothing is lost when every removed row has a same-start replacement");
  counters.carriedItems += planNC.carried.length;
  const planNC2 = buildRegeneratePlan({ derivation: deriveShifts([], RULE, []), stored: storedNC, teams, preference: "prefer_off_days", index: assignmentIndexFromGames([], HOME), today: TODAY });
  ok(planNC2.lost.length === 2 && planNC2.lost.map((l) => `${l.start}:${l.notes ?? "-"}:${l.cashPersonId ?? "-"}`).join(",") === "09:30:-:cash-b,11:30:float in the office:cash-a" && planNC2.carried.length === 0,
     "F11", "with no upcoming games, the two removed rows' note/cash are reported as LOST (the kept-only cash row too)", JSON.stringify(planNC2.lost));
  counters.lostItems += planNC2.lost.length;
  ok(buildRegeneratePlan({ derivation, stored, teams, preference: "prefer_off_days", index: assignmentIndexFromGames([], HOME), today: TODAY }).lost.length === 0, "F11", "a removed row with neither note nor cash is not listed as lost");

  // todayInTimezone.
  const t = new Date("2026-10-10T05:30:00Z");
  ok(todayInTimezone("America/Los_Angeles", t) === "2026-10-09" && todayInTimezone("America/New_York", t) === "2026-10-10", "F7", "05:30Z on Oct 10 is still Oct 9 in Los Angeles and already Oct 10 in New York");
  let threw = false;
  try { todayInTimezone("Not/AZone", t); } catch { threw = true; }
  ok(threw, "F7", "an unknown zone throws rather than guessing");
  // Legacy notice.
  ok(legacyShiftsNotice(null, stored) === LEGACY_SHIFTS_NOTICE, "F8", "null shifts_generated_at with derived rows → the legacy notice, verbatim");
  ok(legacyShiftsNotice(null, stored.filter((r) => !r.is_recurring)) === null && legacyShiftsNotice("2026-10-05T00:00:00Z", stored) === null, "F8", "no derived rows, or a stamped season → no notice");
  ok(LEGACY_SHIFTS_NOTICE === "These shifts were set up before automatic shifts. Regenerating will rebuild upcoming shifts from the game schedule.", "F8", "the sentence is the approved one");
  const help = maxShiftHelpText(120);
  ok(help.includes("2h") && help.includes("under 60 minutes") && help.includes("59 minutes longer"), "F9", "the max-shift help text says the leftover can extend a shift up to 59 minutes", help);
});

// ─── X: wall-clock, every host zone ──────────────────────────────────────────

section("X: wall-clock only", () => {
  // The real league's latest Saturday: 09-12 last end 19:45 (Majors 17:45 + 120).
  const r = deriveShifts([
    game("2026-09-12", "10:00", 120), game("2026-09-12", "11:30", 105, { venue_id: "memorial" }), game("2026-09-12", "13:00", 120),
    game("2026-09-12", "14:45", 105, { venue_id: "rca" }), game("2026-09-12", "16:15", 120, { venue_id: "memorial" }), game("2026-09-12", "17:45", 120),
  ], RULE, []);
  const w = r.days[0].windows[0];
  ok(r.days[0].windows.length === 1 && w.startMin === 9 * 60 + 30 && w.endMin === 20 * 60 + 15, "X1", `one window 09:30–20:15 regardless of host zone (TZ=${process.env.TZ ?? "host"})`, JSON.stringify(r.days[0].windows.map((x) => [x.startMin, x.endMin])));
  ok(JSON.stringify(times(r, "2026-09-12")) === JSON.stringify([["09:30-11:30", "11:30-13:30", "13:30-15:30", "15:30-17:30", "17:30-20:15"]]), "X1", "645 min → 4×120 + 45 absorbed on the last (165)", JSON.stringify(times(r, "2026-09-12")));
  ok(r.days[0].day === "Sa", "X2", "2026-09-12 is a Saturday in every host zone");
  // A late game that would close past midnight is clamped and reported.
  const late = deriveShifts([game("2026-09-12", "22:30", 120)], RULE, []);
  ok(late.days[0].windows[0].endMin === 24 * 60 && late.clampedDates.join(",") === "2026-09-12", "X3", "a close past midnight is clamped at 24:00 and the date is reported");
  const src = readFileSync(join(ROOT, "src/lib/snack-shack/derive-shifts.ts"), "utf8");
  const dateCalls = src.match(/new Date\(([^)]*)\)/g) ?? [];
  ok(dateCalls.every((c) => c.includes('"T00:00:00"')) && !src.includes("getTime(") && !src.includes("Date.parse("), "X4", "the library never hands a stored timestamp to new Date — only date strings at local midnight", JSON.stringify(dateCalls));
  ok(src.includes("scheduled_at.substring") || src.includes("iso.substring(11, 16)"), "X4", "time of day is read by substring");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n── anti-vacuity counters");
for (const [name, n] of Object.entries(counters)) ok(n > 0, "AV", `counter ${name} fired`, `got ${n}`);
console.log("  counters:", JSON.stringify(counters));
console.log(`  GAP_SPLIT_MIN=${GAP_SPLIT_MIN} ABSORB_OFFER_UNDER_MIN=${ABSORB_OFFER_UNDER_MIN}`);
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

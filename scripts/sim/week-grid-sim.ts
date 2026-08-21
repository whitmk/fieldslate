// Harness for the "week by field" Schedule view's pure derivations
// (src/lib/schedule/week-grid.ts).
//
// WHY IT EXISTS. Everything this file checks is a silent-failure class this
// repo has already been bitten by: week definitions drifting from the shared
// one, a day bucket computed from an instant instead of the wall-clock
// substring, an exclusive range bound that drops the last day, and a duration
// fallback inventing an end time. None of it throws when wrong — it renders a
// believable grid.
//
// TIMEZONE INDEPENDENCE IS THE HEADLINE ASSERTION. Unlike the other sims, this
// one does NOT pin TZ=UTC. `npm run sim:week-grid` runs the identical assertions
// under UTC, America/Los_Angeles (negative offset, US DST) and
// Pacific/Kiritimati (+14, the largest positive offset in use). Every expected
// value is a literal, so a result that shifts with the host zone fails rather
// than quietly agreeing with itself.
//
// It drives the REAL functions — no fixtures of its own logic.

import { DAY_KEYS, dayKeyFromIsoDate } from "@/lib/venues/availability";
import {
  parseWeekParam,
  weekDates,
  shiftWeek,
  weekRange,
  weekLabel,
  fmtTimeRange,
  bucketWeekGames,
  buildWeekRows,
  cellKey,
  countAwayGamesInWeek,
  weekMatchupLabel,
  visibleBlocks,
  blockMarkers,
  rendersStartOnly,
} from "@/lib/schedule/week-grid";
import { DAY_KEYS as COLS } from "@/lib/venues/availability";
import type { ScheduleGame } from "@/components/schedule/schedule-list";

let checks = 0;
let fails = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    console.log("  FAIL:", msg);
    fails++;
  }
}

const TZ = process.env.TZ ?? "(host default)";
console.log(`\nweek-grid sim — TZ=${TZ}, offset=${new Date().getTimezoneOffset()}min`);

// ── Week param ───────────────────────────────────────────────────────────────
ok(parseWeekParam("2026-08-17") === "2026-08-17", "Monday stays Monday");
ok(parseWeekParam("2026-08-23") === "2026-08-17", "Sunday snaps back to its Monday");
ok(parseWeekParam("2026-08-19") === "2026-08-17", "mid-week snaps back to its Monday");
ok(parseWeekParam(undefined) === null, "absent param -> null (never a server-clock default)");
ok(parseWeekParam("") === null, "empty param -> null");
ok(parseWeekParam("2026-8-1") === null, "unpadded date rejected");
ok(parseWeekParam("garbage") === null, "junk rejected");

// ── Columns ──────────────────────────────────────────────────────────────────
const d = weekDates("2026-08-17");
ok(d.length === 7, "seven columns");
ok(d[0] === "2026-08-17" && d[6] === "2026-08-23", "Mon..Sun span");
d.forEach((date, i) =>
  ok(
    dayKeyFromIsoDate(date) === DAY_KEYS[i],
    `column ${i} (${date}) buckets to ${dayKeyFromIsoDate(date)}, must be ${DAY_KEYS[i]}`,
  ),
);

// ── Week arithmetic: DST + year boundaries ───────────────────────────────────
ok(shiftWeek("2026-10-26", 1) === "2026-11-02", "forward across US DST fall-back");
ok(shiftWeek("2026-03-02", 1) === "2026-03-09", "forward across US DST spring-forward");
ok(shiftWeek("2026-12-28", 1) === "2027-01-04", "forward across a year boundary");
ok(shiftWeek("2027-01-04", -1) === "2026-12-28", "back across a year boundary");
ok(weekDates("2026-11-02")[6] === "2026-11-08", "a DST week still spans exactly 7 days");
ok(weekDates("2026-03-09")[6] === "2026-03-15", "spring-forward week still spans 7 days");

// ── Query range ──────────────────────────────────────────────────────────────
// The reschedule picker's lesson: `scheduled_at` is a timestamp, so an
// inclusive `<= Sunday` compares against Sunday 00:00 and drops that whole day.
const r = weekRange("2026-08-17");
ok(r.startDate === "2026-08-17", "range starts Monday");
ok(
  r.dayAfterEnd === "2026-08-24",
  `range end is EXCLUSIVE day-after-Sunday, got ${r.dayAfterEnd}`,
);

// ── Label ────────────────────────────────────────────────────────────────────
ok(weekLabel("2026-08-17") === "Aug 17 – 23, 2026", `same-month: ${weekLabel("2026-08-17")}`);
ok(weekLabel("2026-08-31") === "Aug 31 – Sep 6, 2026", `cross-month: ${weekLabel("2026-08-31")}`);
ok(
  weekLabel("2026-12-28") === "Dec 28, 2026 – Jan 3, 2027",
  `cross-year: ${weekLabel("2026-12-28")}`,
);

// ── Time range — the reason the view exists ──────────────────────────────────
const AT9 = "2026-08-17T09:00:00+00:00";
ok(fmtTimeRange(AT9, 90) === "9:00 AM – 10:30 AM", "resolved duration renders start-end");
ok(fmtTimeRange(AT9, undefined) === "9:00 AM", "UNDEFINED duration -> START ONLY");
ok(fmtTimeRange(AT9, 0) === "9:00 AM", "zero -> start only, never '9:00 AM - 9:00 AM'");
ok(fmtTimeRange(AT9, Number.NaN) === "9:00 AM", "NaN -> start only (typeof would have passed it)");
ok(fmtTimeRange(AT9, -30) === "9:00 AM", "negative -> start only");
ok(fmtTimeRange(AT9, Infinity) === "9:00 AM", "non-finite -> start only");
ok(fmtTimeRange("2026-08-17T23:30:00+00:00", 90) === "11:30 PM – 1:00 AM", "wraps past midnight");
ok(fmtTimeRange("2026-08-17T12:00:00+00:00", 60) === "12:00 PM – 1:00 PM", "noon reads 12 PM");
ok(fmtTimeRange("2026-08-17T00:15:00+00:00", 60) === "12:15 AM – 1:15 AM", "midnight hour reads 12 AM");
// The stored offset must never be applied — that is the instant-parsing bug.
ok(
  fmtTimeRange("2026-08-17T09:00:00+00", 60) === "9:00 AM – 10:00 AM",
  "short +00 offset form reads identically",
);

// ── Bucketing ────────────────────────────────────────────────────────────────
function game(
  id: string,
  at: string,
  venueId: string | null,
  status = "scheduled",
  extra: Partial<ScheduleGame> = {},
): ScheduleGame {
  return {
    id,
    scheduled_at: at,
    status,
    league_id: "L",
    home_team_id: "H",
    away_team_id: null,
    venue_id: venueId,
    venue: venueId ? { name: "Field", location: null } : null,
    home_team: { name: "Home", division_id: "d1", division: { name: "Majors" } },
    away_team: null,
    ...extra,
  } as ScheduleGame;
}

const games: ScheduleGame[] = [
  game("b", "2026-08-22T13:00:00+00:00", "v1"),
  // The two 09:00 games are supplied in REVERSE id order on purpose. Array
  // sort is stable in V8, so input order alone would already produce "a,c" and
  // the tiebreak assertion below would pass whether or not the tiebreak exists.
  game("c", "2026-08-22T09:00:00+00:00", "v1"),
  game("a", "2026-08-22T09:00:00+00:00", "v1"),
  game("away", "2026-08-22T09:00:00+00:00", null), // interleague away
  game("nextweek", "2026-08-25T09:00:00+00:00", "v1"), // NEXT week, a Tuesday
                                                       // — no in-week game shares
                                                       // that column, so the
                                                       // exclusion assertion below
                                                       // cannot be satisfied by
                                                       // anything else.
  game("lastsun", "2026-08-23T15:30:00+00:00", "v1"), // final day, afternoon
  game("cx", "2026-08-19T18:00:00+00:00", "v2", "cancelled"),
  game("pend", "2026-08-20T18:00:00+00:00", "v2", "pending_interleague"),
];
const buckets = bucketWeekGames(games, "2026-08-17");
const sat = buckets.get(cellKey("v1", "Sa")) ?? [];
ok(sat.map((x) => x.id).join(",") === "a,c,b", `cell ordered by start then id: ${sat.map((x) => x.id).join(",")}`);
ok(
  (buckets.get(cellKey("v1", "Su")) ?? []).map((x) => x.id).join(",") === "lastsun",
  "a Sunday-afternoon game lands in the LAST column (the dropped-final-day bug)",
);
// Isolated on purpose: Tuesday holds nothing in-week, so this line fails if
// and only if the out-of-week filter is gone. Checking a column that already
// has an in-week game would make it pass vacuously.
ok(
  (buckets.get(cellKey("v1", "Tu")) ?? []).length === 0,
  `a game outside the week is excluded even when the fetch was not narrowed (Tu held ${(buckets.get(cellKey("v1", "Tu")) ?? []).map((x) => x.id).join(",")})`,
);
ok((buckets.get(cellKey("v2", "We")) ?? []).length === 1, "cancelled games ARE bucketed (rows must survive the toggle)");
ok((buckets.get(cellKey("v2", "Th")) ?? []).length === 1, "pending_interleague IS bucketed (it occupies the field)");
ok([...buckets.values()].flat().every((x) => x.id !== "away"), "null-venue away game dropped from the grid");
ok(countAwayGamesInWeek(games, "2026-08-17") === 1, "away game counted for the footnote");
ok(countAwayGamesInWeek(games, "2026-08-24") === 0, "away count is week-scoped");

// ── Rows ─────────────────────────────────────────────────────────────────────
const rows = buildWeekRows(
  [
    { venueId: "v1", name: "Andrews", locationName: "Monroe" },
    { venueId: "v9", name: "Unused", locationName: null },
    { venueId: "v0", name: "Zeta", locationName: "Ashland" },
    { venueId: "v8", name: "Alpha", locationName: null },
  ],
  [game("x", "2026-08-22T09:00:00+00:00", "v2")],
);
// Ashland/Zeta, Monroe/Andrews, then the location-less group by NAME:
// Alpha (v8), Field (v2, added by the union arm), Unused (v9).
ok(
  rows.map((x) => x.venueId).join(",") === "v0,v1,v8,v2,v9",
  `sort = location asc then name, NULLS LAST: ${rows.map((x) => `${x.locationName ?? "-"}/${x.name}`).join(" | ")}`,
);
ok(rows.some((x) => x.venueId === "v2"), "UNION ARM: a venue with games but no eligibility flag still gets a row");
ok(rows.some((x) => x.venueId === "v9"), "an eligible venue with NO games keeps its row (the capacity signal)");
ok(rows.length === 5, `no duplicate rows: ${rows.length}`);

const dupRows = buildWeekRows(
  [{ venueId: "v1", name: "Andrews", locationName: "Monroe" }],
  [game("y", "2026-08-22T09:00:00+00:00", "v1")],
);
ok(dupRows.length === 1, "a venue that is both eligible AND has games appears once");

// ── Matchup label ────────────────────────────────────────────────────────────
ok(
  weekMatchupLabel(game("m", AT9, "v1", "scheduled", { away_team: { name: "Cubs" } })) ===
    "Home vs Cubs",
  "plain matchup",
);
ok(
  weekMatchupLabel(
    game("m", AT9, "v1", "scheduled", {
      interleague_org_id: "o1",
      interleague_org: { name: "Westside" },
      external_team_name: "Wildcats",
    }),
  ) === "Home vs Wildcats",
  "interleague home with a named partner team",
);
ok(
  weekMatchupLabel(
    game("m", AT9, "v1", "pending_interleague", {
      interleague_org_id: "o1",
      interleague_org: { name: "Westside" },
    }),
  ) === "Home vs TBD — Westside",
  "pending interleague with no team yet",
);

// ── Scenario R: a full grid render pass, with ANTI-VACUITY COUNTERS ──────────
//
// The assertions above check values. These counters check that the SCENARIOS
// those values describe actually occurred: a conditional invariant whose
// condition never fires passes while checking nothing. Every counter must be
// non-zero or the run FAILS — and the honest response to a zero is to say the
// path was never exercised, not to bolt on a fixture that makes the number move.
//
// This pass walks rows x days x blocks exactly as ScheduleWeekGrid does, driving
// the same buildWeekRows / bucketWeekGames / visibleBlocks / blockMarkers /
// fmtTimeRange the component calls. There is no second copy of that logic.

const WK = "2026-08-17"; // Mon 2026-08-17 .. Sun 2026-08-23

const eligibleR = [
  { venueId: "vA", name: "Andrews", locationName: "Monroe" },
  { venueId: "vB", name: "Memorial", locationName: "Monroe" },
  { venueId: "vC", name: "Calhan", locationName: null },  // ZERO games all week
  { venueId: "vD", name: "Minors", locationName: "Westside" }, // ONLY a cancelled game
];

const IL = { interleague_org_id: "o1", interleague_org: { name: "Westside" } };

const scenarioR: ScheduleGame[] = [
  // vA Saturday: two tied starts (ordering) + one with NO resolvable duration.
  game("r1", "2026-08-22T09:00:00+00:00", "vA", "scheduled", {
    away_team: { name: "Jays" }, durationMin: 90,
  }),
  game("r2", "2026-08-22T09:00:00+00:00", "vA", "scheduled", {
    away_team: { name: "Cubs" }, durationMin: 90,
  }),
  game("r3", "2026-08-22T13:00:00+00:00", "vA", "scheduled", {
    away_team: { name: "Sox" }, // durationMin deliberately ABSENT -> start only
  }),
  // vB: an interleague HOME game and a PENDING interleague game.
  game("r4", "2026-08-19T18:00:00+00:00", "vB", "scheduled", {
    ...IL, external_team_name: "Wildcats", durationMin: 105,
  }),
  game("r5", "2026-08-20T18:00:00+00:00", "vB", "pending_interleague", {
    ...IL, durationMin: 105,
  }),
  // vD is ELIGIBLE and its only game this week is cancelled.
  game("r6", "2026-08-21T17:00:00+00:00", "vD", "cancelled", {
    away_team: { name: "Reds" }, durationMin: 90,
  }),
  // vF is NOT eligible and its only game is cancelled — it can reach the grid
  // ONLY through the union arm, and only because that arm ignores status.
  game("r7", "2026-08-21T17:00:00+00:00", "vF", "cancelled", {
    away_team: { name: "Aces" }, durationMin: 90,
  }),
  // vE is NOT eligible but has a live game — the ordinary union-arm case.
  game("r8", "2026-08-23T10:00:00+00:00", "vE", "scheduled", {
    away_team: { name: "Owls" }, durationMin: 60,
  }),
  // Interleague AWAY: venue_id null, so it can never reach a field row.
  game("r9", "2026-08-22T12:00:00+00:00", null, "scheduled", { ...IL, is_away: true }),
  // Outside the displayed week entirely.
  game("r10", "2026-08-25T09:00:00+00:00", "vA", "scheduled", { durationMin: 90 }),
];

const c = {
  rowsRendered: 0,
  emptyEligibleRows: 0,
  unionArmOnlyRows: 0,
  cellsWithMultipleBlocks: 0,
  cancelledBlocksRendered: 0,
  cancelledBlocksHidden: 0,
  rowsSurvivingOnlyCancelledToggleOff: 0,
  unionArmRowSurvivingOnlyCancelled: 0,
  pendingBlocksLabelled: 0,
  interleagueBlocksLabelled: 0,
  startOnlyBlocksRendered: 0,
  endTimeBlocksRendered: 0,
  awayGamesDropped: 0,
  outOfWeekGamesDropped: 0,
};

const rowsR = buildWeekRows(eligibleR, scenarioR);
const cellsR = bucketWeekGames(scenarioR, WK);
const eligibleIds = new Set(eligibleR.map((v) => v.venueId));
const placedIds = new Set([...cellsR.values()].flat().map((g) => g.id));

c.awayGamesDropped = scenarioR.filter(
  (g) => !g.venue_id && !placedIds.has(g.id),
).length;
c.outOfWeekGamesDropped = scenarioR.filter(
  (g) => g.venue_id && !placedIds.has(g.id),
).length;

for (const row of rowsR) {
  c.rowsRendered++;
  if (!eligibleIds.has(row.venueId)) c.unionArmOnlyRows++;

  let blocksOn = 0;
  let blocksOff = 0;
  let cancelledHere = 0;
  for (const day of COLS) {
    const cell = cellsR.get(cellKey(row.venueId, day)) ?? [];
    const on = visibleBlocks(cell, true);
    const off = visibleBlocks(cell, false);
    blocksOn += on.length;
    blocksOff += off.length;
    c.cancelledBlocksHidden += on.length - off.length;
    if (on.length > 1) c.cellsWithMultipleBlocks++;

    for (const g of on) {
      const m = blockMarkers(g);
      if (m.cancelled) { c.cancelledBlocksRendered++; cancelledHere++; }
      if (m.pending) c.pendingBlocksLabelled++;
      if (m.interleague) c.interleagueBlocksLabelled++;
      const label = fmtTimeRange(g.scheduled_at, g.durationMin);
      if (rendersStartOnly(g.durationMin)) {
        c.startOnlyBlocksRendered++;
        ok(!label.includes("–"), `start-only block ${g.id} must render no end time: "${label}"`);
      } else {
        c.endTimeBlocksRendered++;
        ok(label.includes("–"), `resolved block ${g.id} must render an end time: "${label}"`);
      }
    }
  }
  if (blocksOn === 0) {
    c.emptyEligibleRows++;
    ok(eligibleIds.has(row.venueId), `an empty row can only come from the eligible arm: ${row.venueId}`);
  }
  // THE TOGGLE HIDES BLOCKS, NEVER ROWS.
  if (cancelledHere > 0 && blocksOff === 0) {
    c.rowsSurvivingOnlyCancelledToggleOff++;
    if (!eligibleIds.has(row.venueId)) c.unionArmRowSurvivingOnlyCancelled++;
  }
}

// Exact values the counters are counting, so a counter cannot be non-zero for
// the wrong reason.
ok(rowsR.length === 6, `6 rows: 4 eligible + vE + vF, got ${rowsR.length}`);
ok(rowsR.some((r) => r.venueId === "vC"), "eligible field with zero games keeps a row");
ok(rowsR.some((r) => r.venueId === "vF"), "union arm admits a venue whose ONLY game is cancelled");
ok(
  (visibleBlocks(cellsR.get(cellKey("vD", "Fr")) ?? [], false)).length === 0 &&
    rowsR.some((r) => r.venueId === "vD"),
  "toggle OFF empties vD's cell but vD KEEPS its row",
);
ok(
  (visibleBlocks(cellsR.get(cellKey("vA", "Sa")) ?? [], true)).map((g) => g.id).join(",") === "r1,r2,r3",
  "vA Saturday ordered by start then id",
);

console.log("  counters:", JSON.stringify(c));
let zero = 0;
for (const [name, n] of Object.entries(c)) {
  checks++;
  if (n === 0) {
    console.log(`  VACUOUS: counter '${name}' is ZERO — the assertions that depend on it proved nothing this run`);
    zero++;
    fails++;
  }
}

console.log(
  fails === 0
    ? `  ALL PASS — ${checks} assertions, ${Object.keys(c).length} counters all non-zero`
    : `  ${fails} FAILED (${zero} vacuous counters) of ${checks}`,
);
process.exit(fails === 0 ? 0 : 1);

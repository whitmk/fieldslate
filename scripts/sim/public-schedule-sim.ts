// Harness for the public league schedule's TypeScript half (0105):
// src/lib/public-schedule/{classify,view,links,league-ics}.ts — the code the
// page, its print, the data route and the .ics feed all call.
//
//   npm run sim:public-schedule            (three host zones)
//   npm run sim:public-schedule:mutants    (mutation pass, real source)
//
// The DATABASE half (which rows leave the reader at all: locked divisions,
// pending interleague, notes, home-park facts) is proven by
// scripts/sim/public-schedule-sim.sql. This drives what happens to the rows
// after they arrive.
//
// RUN UNDER THREE ZONES (UTC, America/Los_Angeles, Pacific/Kiritimati): every
// expected value is a literal, so anything that leaks the host zone into a
// date or weekday fails instead of agreeing with itself.
//
// SECTIONS RUN IN THIS ORDER ON PURPOSE — a mutant must die FIRST at its own
// assertion (CLAUDE.md, "killed by the RIGHT assertion"):
//   H  Home / Away / TBD                       ← PM1
//   R  rows: pending withheld, then the rest   ← PM2
//   C  data-route caching                      ← PM3
//   P  playoff open slots                      ← PM6 (before I: the feed's
//      playoff title also names the feeder, and PM6 must die at P1 first)
//   I  the .ics feed                           ← PM4
//   F  filters and the print summary           ← PM5
//   K  card line order                         ← PM7
//   S  default season, month, labels
//   L  links and embed code
// then ANTI-VACUITY COUNTERS — a zero counter fails the run.
//
// MUTATION LOG: see the bottom of this file.

import { siteOf, gameStatusDisplay, SITE_TAG } from "@/lib/public-schedule/classify";
import {
  buildRows,
  cardLines,
  defaultSeasonId,
  filterRows,
  filterSummary,
  initialMonth,
  longDayLabel,
  monthGrid,
  openSlotLabel,
  shiftMonth,
  shortDayLabel,
} from "@/lib/public-schedule/view";
import {
  CACHE_NEVER,
  CACHE_READER_ANSWER,
  dataResponseInit,
  embedCode,
  feedRefusal,
  parseFeedToken,
  parseToken,
  publicScheduleFeedUrls,
  publicScheduleUrl,
} from "@/lib/public-schedule/links";
import { buildLeagueCalendarIcs } from "@/lib/public-schedule/league-ics";
import type { PublicGame, PublicPlayoffGame, PublicScheduleOk, PublicSeason } from "@/lib/public-schedule/types";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    fails++;
    console.log(`  FAIL: [CRASH-${name}] ${(e as Error).message}`);
  }
}

const counters = {
  homeRows: 0, awayOtherPark: 0, awayNoPark: 0, awayInterleague: 0, tbdRows: 0,
  struckRows: 0, noteRows: 0, winnerLabels: 0, tbdLabels: 0, icsEvents: 0, startOnlyRows: 0,
};

// ── Fixture ────────────────────────────────────────────────────────────────
const HOME_PARK = { name: "Andrews", location: { name: "Monroe Park" }, address: "1200 Monroe St", home_park: true };
const OTHER_PARK = { name: "Perry", location: { name: "Wright Complex" }, address: null, home_park: false };
const NO_PARK = { name: "Loose Field", location: null, address: null, home_park: false };

function game(p: Partial<PublicGame> & { id: string; scheduled_at: string }): PublicGame {
  return {
    status: "scheduled", is_away: false, interleague: false, division_id: "dMaj",
    home_team_id: "tExpos", away_team_id: "tBears", external_team_name: null, proposed_venue_name: null,
    home_team: { name: "Expos" }, away_team: { name: "Bears" }, venue: HOME_PARK, ...p,
  };
}

const GAMES: PublicGame[] = [
  game({ id: "g1", scheduled_at: "2026-10-10T09:00:00+00:00" }),
  game({ id: "g2", scheduled_at: "2026-10-10T11:00:00+00:00", venue: OTHER_PARK }),
  game({ id: "g3", scheduled_at: "2026-10-10T13:00:00+00:00", venue: NO_PARK, home_team_id: "tBears", away_team_id: "tExpos", home_team: { name: "Bears" }, away_team: { name: "Expos" } }),
  game({ id: "g4", scheduled_at: "2026-10-10T09:00:00+00:00", status: "cancelled", division_id: "dMin", home_team_id: "tCubs", away_team_id: "tTwins", home_team: { name: "Cubs" }, away_team: { name: "Twins" } }),
  game({ id: "g5", scheduled_at: "2026-10-10T15:30:00+00:00", status: "reschedule_pending" }),
  game({ id: "g6", scheduled_at: "2026-10-14T17:30:00+00:00", interleague: true, is_away: true, away_team_id: null, away_team: null, external_team_name: "Northgate Rays", proposed_venue_name: "Northgate Park Field 2", venue: null, division_id: "dMin", home_team_id: "tGiants", home_team: { name: "Giants" } }),
  game({ id: "g7", scheduled_at: "2026-10-15T17:30:00+00:00", status: "pending_interleague", interleague: true, away_team_id: null, away_team: null, external_team_name: "Pending Partner", division_id: "dMin", home_team_id: "tGiants", home_team: { name: "Giants" } }),
  game({ id: "g8", scheduled_at: "2026-10-03T09:00:00+00:00" }), // past
  game({ id: "g9", scheduled_at: "2026-10-17T09:00:00+00:00", venue: null, division_id: "dMin", home_team_id: "tCubs", away_team_id: "tTwins", home_team: { name: "Cubs" }, away_team: { name: "Twins" } }),
  game({ id: "g10", scheduled_at: "2026-10-17T11:00:00+00:00", division_id: "dRook", home_team_id: "tA", away_team_id: "tB", home_team: { name: "A" }, away_team: { name: "B" } }),
];

function po(p: Partial<PublicPlayoffGame> & { id: string; round: string; game_number: number }): PublicPlayoffGame {
  return {
    playoff_id: "pMaj", format: "single_elimination", division_id: "dMaj", scheduled_date: "2026-10-24",
    start_time: "10:00", status: "scheduled", home_team: null, away_team: null, venue: HOME_PARK, ...p,
  };
}
// An 8-team single-elimination bracket: R1 = 1..4, SF = 5..6, F = 7.
const PLAYOFFS: PublicPlayoffGame[] = [
  po({ id: "p1", round: "R1", game_number: 1, scheduled_date: null, start_time: null }),
  po({ id: "p2", round: "R1", game_number: 2, scheduled_date: null, start_time: null }),
  po({ id: "p3", round: "R1", game_number: 3, scheduled_date: null, start_time: null }),
  po({ id: "p4", round: "R1", game_number: 4, scheduled_date: null, start_time: null }),
  po({ id: "p5", round: "SF", game_number: 5, home_team: { id: "tExpos", name: "Expos" } }),
  po({ id: "p6", round: "SF", game_number: 6, start_time: "13:00" }),
  po({ id: "p7", round: "F", game_number: 7, scheduled_date: null, start_time: null }),
  // A double-elimination bracket's open slot is never guessed.
  po({ id: "d1", playoff_id: "pMin", format: "double_elimination", division_id: "dMin", round: "WB-R2", game_number: 3, scheduled_date: "2026-10-25", start_time: "09:00" }),
];

const SEASON: PublicSeason = {
  id: "sFall", name: "Fall 2026", start_date: "2026-08-31", end_date: "2026-10-31",
  divisions: [
    { id: "dMaj", name: "Majors", game_duration: 120 },
    { id: "dMin", name: "Minors", game_duration: "105" },
    { id: "dRook", name: "Rookies", game_duration: null },
  ],
  unpublished: ["T-Ball"],
  teams: [
    { id: "tExpos", name: "Expos", division_id: "dMaj" },
    { id: "tBears", name: "Bears", division_id: "dMaj" },
    { id: "tGiants", name: "Giants", division_id: "dMin" },
    { id: "tCubs", name: "Cubs", division_id: "dMin" },
    { id: "tTwins", name: "Twins", division_id: "dMin" },
  ],
  games: GAMES,
  playoff_games: PLAYOFFS,
};
const TODAY = "2026-10-08";
const DATA: PublicScheduleOk = { status: "ok", org: { name: "Riverside LL", timezone: "America/Los_Angeles" }, today: TODAY, seasons: [SEASON] };

const rows = buildRows(SEASON);
const byKey = new Map(rows.map((r) => [r.key, r]));

// ── H ──────────────────────────────────────────────────────────────────────
section("H", () => {
  ok(siteOf(HOME_PARK, false) === "home", "[H1] a field in a home park is Home");
  ok(siteOf(OTHER_PARK, false) === "away", "[H2] a field in another league's park is Away");
  ok(siteOf(NO_PARK, false) === "away", "[H2b] a field in no park is Away");
  ok(siteOf(null, true) === "away", "[H3] an interleague game at the partner's field is Away");
  ok(siteOf(null, false) === "tbd", "[H4] no field and no partner field is TBD, never Away");
  ok(SITE_TAG.home === "Home" && SITE_TAG.away === "Away", "[H5] every site has its text tag");
  ok(byKey.get("g-g1")?.site === "home" && byKey.get("g-g2")?.site === "away" && byKey.get("g-g3")?.site === "away"
    && byKey.get("g-g6")?.site === "away" && byKey.get("g-g9")?.site === "tbd", "[H6] rows carry the right site");
});

// ── R ──────────────────────────────────────────────────────────────────────
section("R", () => {
  ok(!byKey.has("g-g7"), "[R-pending] a pending interleague game is not a row (second lock behind the reader)");
  ok(rows.length === 9 + 3, "[R1] 9 regular games + 3 dated playoff games (undated playoff games are not rows)", String(rows.length));
  const sorted = rows.every((r, i) => i === 0 || rows[i - 1].date + rows[i - 1].time <= r.date + r.time);
  ok(sorted, "[R2] rows are in date, then time order");
  const g4 = byKey.get("g-g4")!;
  ok(g4.struck && g4.statusLabel === "Rained out" && !g4.statusIsNote, "[R3] a cancelled game is struck and labelled Rained out");
  const g5 = byKey.get("g-g5")!;
  ok(!g5.struck && g5.statusLabel === "Time may change" && g5.statusIsNote && g5.site === "home", "[R4] reschedule_pending: shown, 'Time may change', still Home");
  const g6 = byKey.get("g-g6")!;
  ok(g6.matchup === "Giants at Northgate Rays" && g6.fieldLabel === "Northgate Park Field 2" && g6.interleague && g6.address === null,
    "[R5] interleague away: 'ours at partner', the partner's field, no address", JSON.stringify(g6));
  ok(byKey.get("g-g1")!.matchup === "Expos vs Bears" && byKey.get("g-g1")!.fieldLabel === "Monroe Park — Andrews"
    && byKey.get("g-g1")!.address === "1200 Monroe St", "[R6] regular game: host vs visitor, qualified field, address");
  ok(byKey.get("g-g1")!.endTime === "11:00" && byKey.get("g-g4")!.endTime === "10:45", "[R7] end = start + the division's duration (numeric or string)");
  ok(byKey.get("g-g10")!.endTime === null, "[R8] an unusable duration gives a start-only row, never a guess");
  ok(byKey.get("g-g9")!.fieldLabel === "Field to be announced", "[R9] no field reads 'Field to be announced'");
  ok(gameStatusDisplay("postponed").struck && gameStatusDisplay("completed").label === null, "[R10] postponed struck; completed shows as a normal game");
  for (const r of rows) {
    if (r.site === "home" && !r.struck) counters.homeRows++;
    if (r.struck) counters.struckRows++;
    if (r.statusIsNote) counters.noteRows++;
    if (r.site === "tbd") counters.tbdRows++;
    if (r.endTime === null) counters.startOnlyRows++;
  }
  if (byKey.get("g-g2")?.site === "away") counters.awayOtherPark++;
  if (byKey.get("g-g3")?.site === "away") counters.awayNoPark++;
  if (byKey.get("g-g6")?.site === "away") counters.awayInterleague++;
});

// ── C ──────────────────────────────────────────────────────────────────────
section("C", () => {
  const err = dataResponseInit("error");
  ok(err.status === 503 && err.headers["Cache-Control"] === CACHE_NEVER && !/s-maxage/.test(err.headers["Cache-Control"]),
    "[C1] a failed read is 503 + no-store, never edge-cached", JSON.stringify(err));
  const ans = dataResponseInit("answer");
  ok(ans.status === 200 && ans.headers["Cache-Control"] === CACHE_READER_ANSWER && /s-maxage=60/.test(ans.headers["Cache-Control"])
    && /max-age=0/.test(ans.headers["Cache-Control"]), "[C2] a reader answer is edge-cached 60s, never in the browser");
  ok(err.headers["X-Robots-Tag"] === "noindex, nofollow" && ans.headers["X-Robots-Tag"] === "noindex, nofollow", "[C3] never indexed");
  ok(feedRefusal("error").status === 503 && feedRefusal("error").retryAfterSeconds === 300
    && feedRefusal("nothing_published").status === 503 && feedRefusal("off").status === 410 && feedRefusal("plan").status === 410
    && feedRefusal("unknown").status === 404, "[C4] the feed's answers: temporary → 503 + Retry-After; off/plan → 410");
});

// ── P ──────────────────────────────────────────────────────────────────────
section("P", () => {
  const sf5 = PLAYOFFS.find((p) => p.id === "p5")!;
  const sf6 = PLAYOFFS.find((p) => p.id === "p6")!;
  const fin = PLAYOFFS.find((p) => p.id === "p7")!;
  const maj = PLAYOFFS.filter((p) => p.playoff_id === "pMaj");
  ok(openSlotLabel(sf5, "away", maj) === "Winner of Game 2", "[P1] SF game 5's away slot is the winner of R1 game 2", openSlotLabel(sf5, "away", maj));
  ok(openSlotLabel(sf6, "home", maj) === "Winner of Game 3" && openSlotLabel(sf6, "away", maj) === "Winner of Game 4", "[P2] SF game 6 ← games 3 and 4");
  ok(openSlotLabel(fin, "home", maj) === "Winner of Game 5" && openSlotLabel(fin, "away", maj) === "Winner of Game 6", "[P3] the final ← games 5 and 6");
  ok(openSlotLabel(PLAYOFFS[0], "home", maj) === "TBD", "[P4] a first-round slot has no feeder: TBD");
  const d1 = PLAYOFFS.find((p) => p.id === "d1")!;
  ok(openSlotLabel(d1, "home", PLAYOFFS.filter((p) => p.playoff_id === "pMin")) === "TBD", "[P5] double elimination is never guessed: TBD");
  const withBye = maj.filter((p) => p.game_number !== 2);
  ok(openSlotLabel(sf5, "away", withBye) === "TBD", "[P6] a feeder that does not exist (a bye) is TBD");
  ok(byKey.get("p-p5")!.playoffLabel === "Playoffs · Semifinal · Game 5" && byKey.get("p-p5")!.matchup === "Expos vs Winner of Game 2", "[P7] the playoff row's label and matchup");
  for (const r of rows) {
    if (r.matchup.includes("Winner of Game")) counters.winnerLabels++;
    if (r.matchup.includes("TBD")) counters.tbdLabels++;
  }
});

// ── I ──────────────────────────────────────────────────────────────────────
section("I", () => {
  const built = buildLeagueCalendarIcs(DATA, "2026-10-08T17:00:00.000Z");
  ok(built.ok, "[I0] the feed builds");
  if (!built.ok) return;
  const ics = built.ics.replace(/\r\n /g, "");
  ok(ics.includes("SUMMARY:Northgate Rays vs Giants"), "[I1] titles are host-first: an away interleague game names the partner first");
  ok(ics.includes("SUMMARY:Expos vs Bears"), "[I1b] a regular game: host vs visitor");
  ok(ics.includes("SUMMARY:CANCELLED: Cubs vs Twins") && ics.includes("STATUS:CANCELLED"), "[I2] a rained-out game stays, marked CANCELLED");
  ok(ics.includes("DESCRIPTION:Home · Majors · Fall 2026") && ics.includes("DESCRIPTION:Away · Minors · Fall 2026"), "[I3] Home/Away spelled out (calendars ignore colors)");
  ok(ics.includes("DTSTART;TZID=America/Los_Angeles:20261010T090000") && ics.includes("DTEND;TZID=America/Los_Angeles:20261010T110000"), "[I4] wall-clock times, labelled with the org's zone");
  ok(!ics.includes("Pending Partner"), "[I5] a pending interleague game is not in the feed");
  ok(ics.includes("UID:playoff-p5@thefieldslate.com") && ics.includes("SUMMARY:Expos vs Winner of Game 2"), "[I6] dated playoff games are events with their own UID");
  ok(!/notes|score|contact/i.test(ics), "[I7] nothing private in the feed");
  ok(built.eventCount === 12, "[I8] one event per page row", String(built.eventCount));
  counters.icsEvents = built.eventCount;
  const empty = buildLeagueCalendarIcs({ ...DATA, seasons: [] }, "2026-10-08T17:00:00.000Z");
  ok(empty.ok && empty.eventCount === 0, "[I9] no seasons → zero events (the route answers 503, not an empty calendar)");
  const badTz = buildLeagueCalendarIcs({ ...DATA, org: { name: "x", timezone: "Mars/Base" } }, "2026-10-08T17:00:00.000Z");
  ok(!badTz.ok, "[I10] an unsupported timezone fails loud");
});

// ── F ──────────────────────────────────────────────────────────────────────
section("F", () => {
  ok(filterSummary(null, null) === "All divisions", "[F1] no filter → 'All divisions'");
  ok(filterSummary("Majors", null) === "Majors only", "[F2] a division filter → 'Majors only'");
  ok(filterSummary(null, "Expos") === "Expos only" && filterSummary("Majors", "Expos") === "Majors · Expos only", "[F3] team and both");
  const maj = filterRows(rows, { divisionId: "dMaj", teamId: null, range: "all", today: TODAY });
  ok(maj.length > 0 && maj.every((r) => r.divisionId === "dMaj"), "[F4] a division filter keeps only that division");
  const giants = filterRows(rows, { divisionId: null, teamId: "tGiants", range: "all", today: TODAY });
  ok(giants.length === 1 && giants[0].key === "g-g6", "[F5] a team filter keeps that team's games", giants.map((r) => r.key).join(","));
  const upcoming = filterRows(rows, { divisionId: null, teamId: null, range: "upcoming", today: TODAY });
  ok(!upcoming.some((r) => r.key === "g-g8") && upcoming.length === rows.length - 1, "[F6] Upcoming drops games before the org's today");
});

// ── K ──────────────────────────────────────────────────────────────────────
section("K", () => {
  const g1 = cardLines(byKey.get("g-g1")!);
  ok(JSON.stringify(g1) === JSON.stringify(["Monroe Park — Andrews", "1200 Monroe St", "Majors · until 11:00 AM"]), "[K1] card lines: field, address, 'division · until time'", JSON.stringify(g1));
  const g2 = cardLines(byKey.get("g-g2")!);
  ok(JSON.stringify(g2) === JSON.stringify(["Wright Complex — Perry", "Majors · until 1:00 PM"]), "[K2] no address → field, then division line", JSON.stringify(g2));
  const g10 = cardLines(byKey.get("g-g10")!);
  ok(JSON.stringify(g10) === JSON.stringify(["Monroe Park — Andrews", "1200 Monroe St", "Rookies"]), "[K3] no end time → just the division", JSON.stringify(g10));
});

// ── S ──────────────────────────────────────────────────────────────────────
section("S", () => {
  const s = (id: string, start: string | null, end: string | null): PublicSeason => ({ ...SEASON, id, start_date: start, end_date: end });
  ok(defaultSeasonId([s("old", "2026-03-01", "2026-06-01"), s("now", "2026-08-31", "2026-10-31")], TODAY) === "now", "[S1] the season containing today wins");
  ok(defaultSeasonId([s("old", "2026-03-01", "2026-10-03"), s("next", "2027-03-01", "2027-06-01")], TODAY) === "next", "[S2] else the next to start");
  ok(defaultSeasonId([s("a", "2026-03-01", "2026-09-01"), s("b", "2026-05-01", "2026-10-03")], TODAY) === "b", "[S3] else the latest to end");
  ok(defaultSeasonId([], TODAY) === null, "[S4] no seasons → null");
  ok(longDayLabel("2026-10-10") === "Saturday, October 10" && shortDayLabel("2026-10-14") === "Wed, Oct 14", "[S5] day labels from the text, any host zone");
  ok(initialMonth(rows, TODAY) === "2026-10" && initialMonth(rows, "2026-12-01") === "2026-10", "[S6] the month view opens on today's month, else the last with games");
  const grid = monthGrid("2026-10");
  ok(grid.length % 7 === 0 && grid.indexOf("2026-10-01") === 3 && grid.includes("2026-10-31"), "[S7] October 2026 starts on a Thursday (Monday-first grid)");
  ok(shiftMonth("2026-12", 1) === "2027-01" && shiftMonth("2026-01", -1) === "2025-12", "[S8] month stepping crosses years");
});

// ── L ──────────────────────────────────────────────────────────────────────
section("L", () => {
  const t = "a".repeat(64);
  ok(publicScheduleUrl(t) === `https://www.thefieldslate.com/s/${t}`, "[L1] the page URL is on www");
  const f = publicScheduleFeedUrls(t);
  ok(f.https.endsWith(`/s/${t}.ics`) && f.webcal === `webcal://www.thefieldslate.com/s/${t}.ics`, "[L2] the feed URLs");
  const code = embedCode(t, 'Riverside "LL"');
  ok(code.includes(`src="https://www.thefieldslate.com/s/${t}?embed=1"`) && code.includes('height="700"') && code.includes('style="border:0"')
    && code.includes('title="Riverside &quot;LL&quot; games"'), "[L3] the embed code: embed=1, fixed 700px, quoted title", code);
  ok(parseToken(t) === t && parseToken("x") === null && parseFeedToken(`${t}.ics`) === t && parseFeedToken(t) === null, "[L4] token parsing");
});

// ── Anti-vacuity ───────────────────────────────────────────────────────────
for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));

console.log(`\npublic-schedule sim (TZ=${process.env.TZ ?? "host"}): ${checks - fails}/${checks} passed`);
console.log(`counters: ${JSON.stringify(counters)}`);
process.exit(fails ? 1 : 0);

// ── MUTATION LOG ───────────────────────────────────────────────────────────
// 2026-10-08, first pass: PM1–PM5 and PM7 killed at their own assertion; PM6
// (wrong feeder) died FIRST at [I6] — the feed section ran before the playoff
// section and its playoff title names the feeder too. Not a kill by the house
// rule. Section P moved ahead of I; second pass below.
// Second pass (same day): all 7 killed at their own assertion — PM1 [H2],
// PM2 [R-pending], PM3 [C1], PM4 [I1], PM5 [F2], PM6 [P1], PM7 [K1]; source
// restored, sim green after. Baseline 73/73 under UTC, Los Angeles, Kiritimati.
// Harness faults on the very first run (fixed, recorded): [R1]/[I8] counted 2
// dated playoff rows when the fixture has 3 (the double-elimination game is
// dated), and [I6] expected "Winner of Game 4" where the fixture's semifinal
// is fed by game 2.

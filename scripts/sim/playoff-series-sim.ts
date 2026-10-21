// Harness for playoff SERIES (best of 3, 5 or 7), step 1 of the build: the
// pure rules (series-lengths.ts, series-names.ts, series.ts), the planner
// (bracket-plan.ts) and the labels (bracket-labels.ts). Drives the REAL code;
// every expected value is a literal written by hand from the approved mockup
// (docs/mockups/playoff-series.html, 2026-10-20). Ends with seeded full
// playthroughs of series brackets through the TypeScript advancement twin.
//
//   npm run sim:playoff-series            (three host zones)
//   npm run sim:playoff-series:mutants    (mutation pass, real source)
//
// Section order is load-bearing (each mutant must die FIRST at its own tag):
//   S0 nothing changes without series → S1 layout and home → S2 scheduling →
//   S3 names and labels → S4 series state and tags → S5 results in order →
//   S6 the Save line → S7 the Clear lines → S8 advancement writes → S9 setup
//   text → S10 confirms → S11 screens (step 3: the card's actions and lines,
//   the payload, the database's refusal replies, the clear confirm) → S12
//   outside the app (step 4; incl. IX: the IFNEEDED-TABLE parsed out of
//   scripts/sim/playoff-series-sim.sql and run through seriesGameTag — the
//   SQL proof runs the SAME rows through playoff_if_needed) → PT
//   playthroughs → counters.
import {
  buildSingleElimination,
  makeSlotPicker,
  planBracket,
  type BracketIds,
  type GameInsert,
  type PlanInput,
} from "../../src/lib/playoffs/bracket-plan";
import { emptySlotLabel, gameLabel, gameNumbering } from "../../src/lib/playoffs/bracket-labels";
import { isFinalRound, roundTitle, seriesName } from "../../src/lib/playoffs/series-names";
import {
  hasSeries,
  parseSeriesByRound,
  seriesHomeAway,
  winsNeeded,
  type SeriesByRound,
} from "../../src/lib/playoffs/series-lengths";
import {
  NOT_NEEDED,
  bestOfLine,
  gameHasResult,
  homeTeamKnown,
  roundLengthHelp,
  seriesAdvanceWrites,
  seriesChampionLine,
  seriesChange,
  seriesClearLines,
  seriesClearRefusal,
  seriesClearWrites,
  seriesDeleteLine,
  seriesEnterLine,
  seriesEnterRefusal,
  seriesFormatProblem,
  seriesGameTag,
  seriesGamesOf,
  seriesGamesReviewLine,
  seriesHeadline,
  seriesReviewRows,
  seriesSetupNote,
  seriesState,
  undatedSeriesGamesLine,
  wizardRounds,
  type SeriesGame,
  type SeriesSlotWrite,
} from "../../src/lib/playoffs/series";
import { planStage2, seedConfirm, stage1Status, type Stage2Game } from "../../src/lib/playoffs/two-stage";
import {
  bracketGamesLabel,
  nextSeriesBlockedMessage,
  oneRowPerSeries,
  seriesByRoundPayload,
  seriesCardActions,
  seriesGameActions,
  seriesHomeNote,
  seriesResultText,
} from "../../src/lib/playoffs/series";
import {
  blockedMessage,
  clearConfirm,
  clearPreviewOutcome,
  playoffRoundTitle,
  type ClearPreview,
  type ResultNumbering,
} from "../../src/lib/playoffs/playoff-result";
import type { SeededTeam } from "../../src/components/playoffs/playoff-wizard-types";
import { readFileSync } from "node:fs";
import { bracketRoundName, buildRows } from "../../src/lib/public-schedule/view";
import { buildLeagueCalendarIcs, playoffEventTitle } from "../../src/lib/public-schedule/league-ics";
import type { PublicPlayoffGame, PublicScheduleOk, PublicSeason } from "../../src/lib/public-schedule/types";
import { buildPlayoffCsv, exportableGames, exportGameName, type ExportGame } from "../../src/lib/playoffs/playoff-export";
import {
  buildBracketPrintHtml,
  GROUP_MARGIN,
  PRINT_GROUP,
  PRINT_SERIES_TREE,
  SCREEN_GROUP,
  SCREEN_TREE,
  groupCardTexts,
  groupHeight,
  groupedTreeLayout,
  printGroupHeight,
  type PrintGame,
  type TreeDims,
} from "../../src/lib/playoffs/bracket-print";
import { deleteConfirm, type BracketCounts } from "../../src/lib/playoffs/bracket-delete";
import {
  assignmentGamesFromPlayoffRows,
  assignmentIndexFromGames,
  teamGamesOn,
} from "../../src/lib/snack-shack/derive-shifts";
import { daylightFlag } from "../../src/lib/daylight/flags";
import { cityById } from "../../src/lib/sun/us-cities";
import { outboundMatchup, roundsFromTeamsLine, seriesPrintLine, seriesRoundHeader } from "../../src/lib/playoffs/series";
import { doubleElim, roundRobin, seriesMockup, seriesSixteen, singleElim } from "./bracket-print-fixtures";
import { DEFAULT_PLAYOFF_DATA, type PlayoffWizardData } from "../../src/components/playoffs/playoff-wizard-types";
import { reconcileSeeding } from "../../src/lib/playoffs/seeding";

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
function eq(actual: unknown, expected: unknown, tag: string, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, tag, label, `got ${a}, want ${e}`);
}
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try {
    fn();
  } catch (e) {
    failures.push(`[CRASH-${name}] ${(e as Error).message}`);
    console.error(`  CRASH: ${name} — ${(e as Error).stack}`);
  }
}

const counters = {
  playthroughs: 0,
  seriesDecidedEarly: 0,
  seriesWentFull: 0,
  homeSwapsAfterUpset: 0,
  byeIntoSeries: 0,
  bothKnownAtGeneration: 0,
  clearRoundTrips: 0,
  orderRefusals: 0,
  publicNotNeededDropped: 0,
  ifNeededTableRows: 0,
  publicPlaceholderMatchups: 0,
  csvIfNeededFromResults: 0,
  /** FN: a 2-team bracket's only round named "Final" on a surface. */
  twoTeamFinals: 0,
  /** FN2: team counts 2–16 whose wizard rows equal the generated rounds. */
  teamCountsListed: 0,
  /** FN13: the real 3-team best-of-3 Final played to a champion. */
  threeTeamFinalsPlayed: 0,
  /** WZ: the Add-bracket flow reached Dates with every seeded team counted. */
  wizardFlowCounted: 0,
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const IDS: BracketIds = { playoffId: "p1", leagueId: "l1", divisionId: "d1" };
const NAMES = ["Expos", "Bears", "Lions", "Mets", "Pirates", "Royals", "Cubs", "Twins"];
const teams = (n: number): SeededTeam[] =>
  Array.from({ length: n }, (_, i) => ({ team_id: `t${i + 1}`, team_name: NAMES[i] ?? `Team ${i + 1}` }));
const teamName = (id: string) => NAMES[Number(id.slice(1)) - 1] ?? id;
const seedOfPlain = (id: string) => (/^t\d+$/.test(id) ? Number(id.slice(1)) : null);
const noSlots = () => makeSlotPicker([], { durationMin: 90, bufferMin: 15 });
const SETTINGS = { durationMin: 120, bufferMin: 15, durationDefaulted: false, bufferDefaulted: false };

/** The mockup's Majors: 6 teams, Sat/Sun, Andrews + Perry, 120-minute games. */
function mockupInput(series: SeriesByRound | undefined, endDate = "2026-12-06"): PlanInput {
  return {
    format: "single_elimination",
    seeds: teams(6),
    ids: IDS,
    grid: {
      startDate: "2026-11-14",
      endDate,
      playingDays: ["Sa", "Su"],
      dayWindows: { Sa: { start: "09:00", end: "17:00" }, Su: { start: "09:00", end: "17:00" } },
      venues: [
        { id: "andrews", name: "Andrews", availability: null },
        { id: "perry", name: "Perry", availability: null },
      ],
      durationMin: 120,
      bufferMin: 15,
    },
    settings: SETTINGS,
    divisionName: "Majors",
    ...(series ? { seriesByRound: series } : {}),
  };
}
const MOCKUP_SERIES: SeriesByRound = { SF: 3, F: 3 };

function withIds(gs: GameInsert[]): SeriesGame[] {
  return gs.map((g) => ({
    ...g,
    id: `${g.round}-${g.game_number}-${g.series_game ?? 1}`,
    winner_id: null,
    home_score: null,
    away_score: null,
  }));
}
const short = (g: GameInsert) =>
  `${g.round}:${g.game_number}.${g.series_game ?? 1} ${g.home_team_id ?? "-"}/${g.away_team_id ?? "-"}`;

/** Set a result (and the winner) on one row, by id, in place. */
function result(rows: SeriesGame[], id: string, home: number, away: number) {
  const g = rows.find((r) => r.id === id)!;
  g.home_score = home;
  g.away_score = away;
  g.status = "completed";
  g.winner_id = home > away ? g.home_team_id : g.away_team_id;
}
function applyWrites(rows: SeriesGame[], writes: SeriesSlotWrite[]) {
  for (const w of writes) {
    const g = rows.find((r) => r.id === w.gameId)!;
    g.home_team_id = w.home_team_id;
    g.away_team_id = w.away_team_id;
  }
}

/** The mockup's bracket state: Round 1 played (Mets 6–3, Royals 4–2),
 *  Semifinal 1 Expos lead 1–0, Semifinal 2 Bears won 2–0 (Game 3 not
 *  needed), Bears in the Final. */
function mockupState(): SeriesGame[] {
  // Team slots are set BY HAND, not through the advancement writes, so S4–S7
  // can't fail because of an advancement fault — S8 is where that is caught.
  const rows = withIds(planBracket({ ...mockupInput(MOCKUP_SERIES), gamesPerTeamPerDay: 1 }).games);
  const slots: Record<string, [string | null, string | null]> = {
    "SF-5-1": ["t1", "t4"], "SF-5-2": ["t4", "t1"], "SF-5-3": ["t1", "t4"], // Expos (1) v Mets (4)
    "SF-6-1": ["t2", "t6"], "SF-6-2": ["t6", "t2"], "SF-6-3": ["t2", "t6"], // Bears (2) v Royals (6)
    "F-7-1": [null, "t2"], "F-7-2": [null, "t2"], "F-7-3": [null, "t2"], // Bears wait in the Final
  };
  for (const [id, [h, a]] of Object.entries(slots)) {
    const g = rows.find((r) => r.id === id)!;
    g.home_team_id = h;
    g.away_team_id = a;
  }
  result(rows, "R1-2-1", 6, 3); // Mets (4) beat Pirates (5)
  result(rows, "R1-4-1", 2, 4); // Royals (6) beat Lions (3)
  result(rows, "SF-5-1", 5, 2); // Expos 5–2 (Expos home)
  result(rows, "SF-6-1", 4, 1); // Bears 4–1 (Bears home)
  result(rows, "SF-6-2", 2, 3); // Royals home, Bears 3–2
  rows.find((r) => r.id === "SF-6-3")!.status = NOT_NEEDED;
  return rows;
}

// ─── S0: a bracket with no series is planned exactly as before ────────────────

section("S0 nothing changes without series", () => {
  const plain = planBracket(mockupInput(undefined));
  const empty = planBracket({ ...mockupInput(undefined), seriesByRound: {} });
  const ones = planBracket({ ...mockupInput(undefined), seriesByRound: { R1: 1, SF: 1, F: 1 } });
  eq(empty, plain, "S0", "an empty series map plans byte-identically to none");
  eq(ones, plain, "S0", "every round at 1 game plans byte-identically to none");
  eq(plain.skippedForDayLimit, 0, "S0", "a bracket of single games has no per-day limit, as before");
  eq(
    plain.games.map((g) => `${g.round}:${g.game_number} ${g.scheduled_date} ${g.start_time} ${g.venue_id}`),
    [
      "R1:2 2026-11-14 09:00 andrews",
      "R1:4 2026-11-14 09:00 perry",
      "SF:5 2026-11-14 11:15 andrews",
      "SF:6 2026-11-14 11:15 perry",
      "F:7 2026-11-14 13:30 andrews",
    ],
    "S0",
    "6 teams of single games: the same five games at the same times as before",
  );
  ok(plain.games.every((g) => g.series_game === undefined), "S0", "no single game carries series_game");
  eq(hasSeries({}), false, "S0", "hasSeries({}) is false");
  eq(parseSeriesByRound({ SF: 3, F: 2, R1: "5", QF: 1, X: 7 }), { SF: 3, X: 7 }, "S0", "only 3/5/7 entries are kept");
});

// ─── S1: layout and home ──────────────────────────────────────────────────────

section("S1 layout and home", () => {
  const six = buildSingleElimination(teams(6), IDS, noSlots(), MOCKUP_SERIES);
  eq(
    six.map(short),
    [
      "R1:2.1 t4/t5",
      "R1:4.1 t3/t6",
      "SF:5.1 t1/-",
      "SF:5.2 t1/-",
      "SF:5.3 t1/-",
      "SF:6.1 t2/-",
      "SF:6.2 t2/-",
      "SF:6.3 t2/-",
      "F:7.1 -/-",
      "F:7.2 -/-",
      "F:7.3 -/-",
    ],
    "S1",
    "6 teams, SF and F best of 3: 11 rows; a bye seed sits in its bracket slot in every game (no home decided)",
  );
  ok(six.filter((g) => g.round === "R1").every((g) => g.series_game === undefined), "S1", "Round 1 single games carry no series_game");

  const eight = buildSingleElimination(teams(8), IDS, noSlots(), { R1: 3 });
  eq(
    eight.filter((g) => g.round === "R1" && g.game_number === 1).map(short),
    ["R1:1.1 t1/t8", "R1:1.2 t8/t1", "R1:1.3 t1/t8"],
    "S1",
    "8 teams, Round 1 best of 3: seed 1 home in games 1 and 3, seed 8 home in game 2",
  );
  eq(
    eight.filter((g) => g.round === "R1" && g.game_number === 2).map(short),
    ["R1:2.1 t4/t5", "R1:2.2 t5/t4", "R1:2.3 t4/t5"],
    "S1",
    "4 v 5: seed 4 home in games 1 and 3",
  );

  const five = buildSingleElimination(teams(5), IDS, noSlots(), { SF: 3 });
  const sf2 = five.filter((g) => g.round === "SF" && g.game_number === 6);
  eq(
    sf2.map(short),
    ["SF:6.1 t2/t3", "SF:6.2 t3/t2", "SF:6.3 t2/t3"],
    "S1",
    "5 teams: two bye seeds meet in Semifinal 2 — both known at generation, so home alternates from the start",
  );
  if (sf2.length === 3) counters.bothKnownAtGeneration++;
  if (six.some((g) => g.round === "SF" && g.home_team_id === "t1")) counters.byeIntoSeries++;

  eq(seriesHomeAway(2, "t2", "t1", seedOfPlain), { home: "t2", away: "t1" }, "S1", "slot order doesn't matter: seed 1 is away in game 2");
  eq(seriesHomeAway(1, "t4", null, seedOfPlain), { home: "t4", away: null }, "S1", "one team unknown: bracket slots, nothing decided");
  eq(seriesHomeAway(3, "x", "y", () => null), { home: "x", away: "y" }, "S1", "no seeds: slot A is treated as the higher seed");
});

// ─── S2: scheduling ───────────────────────────────────────────────────────────

section("S2 scheduling", () => {
  const plan = planBracket({ ...mockupInput(MOCKUP_SERIES), gamesPerTeamPerDay: 1 });
  eq(
    plan.games.map((g) => `${g.round}:${g.game_number}.${g.series_game ?? 1} ${g.scheduled_date} ${g.start_time} ${g.venue_id}`),
    [
      "R1:2.1 2026-11-14 09:00 andrews",
      "R1:4.1 2026-11-14 09:00 perry",
      "SF:5.1 2026-11-15 09:00 andrews",
      "SF:5.2 2026-11-21 09:00 andrews",
      "SF:5.3 2026-11-22 09:00 andrews",
      "SF:6.1 2026-11-15 09:00 perry",
      "SF:6.2 2026-11-21 09:00 perry",
      "SF:6.3 2026-11-22 09:00 perry",
      "F:7.1 2026-11-28 09:00 andrews",
      "F:7.2 2026-11-29 09:00 andrews",
      "F:7.3 2026-12-05 09:00 andrews",
    ],
    "S2",
    "the mockup's dates: Round 1 Sat 11/14; Semifinals Sun 11/15, Sat 11/21, Sun 11/22; Final Sat 11/28, Sun 11/29, Sat 12/5",
  );
  eq(plan.tbdCount, 0, "S2", "everything fits");

  const two = planBracket({ ...mockupInput(MOCKUP_SERIES), gamesPerTeamPerDay: 2 });
  eq(
    two.games.filter((g) => g.round === "SF" && g.game_number === 5).map((g) => `${g.scheduled_date} ${g.start_time}`),
    ["2026-11-14 11:15", "2026-11-15 09:00", "2026-11-15 11:15"],
    "S2",
    "with 2 games a day: game 1 follows Round 1 on Saturday, games 2 and 3 share Sunday, each after the one before ends plus the buffer",
  );

  const shortPlan = planBracket({ ...mockupInput(MOCKUP_SERIES, "2026-11-29"), gamesPerTeamPerDay: 1 });
  eq(shortPlan.tbdCount, 1, "S2", "one date short: one game has no date");
  eq(
    undatedSeriesGamesLine(shortPlan.games),
    "1 game has no date, time or field yet: Final · Game 3 of 3 (if needed). It can be given one later with the calendar button on the game.",
    "S2",
    "the undated game is named",
  );

  // Generic: game k+1 of a series never starts before game k ends plus the
  // buffer, and with 1 a day no series has two games on one date.
  let pairs = 0;
  for (const n of [3, 4, 6, 8, 11, 16]) {
    for (const len of [3, 5, 7] as const) {
      const p = planBracket({
        ...mockupInput({ SF: len, F: len }, "2027-06-30"),
        seeds: teams(n).map((t, i) => ({ ...t, team_id: `t${i + 1}` })),
        gamesPerTeamPerDay: 1,
      });
      const byKey = new Map<string, GameInsert[]>();
      for (const g of p.games) {
        const key = `${g.round}:${g.game_number}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(g);
      }
      for (const gs of byKey.values()) {
        gs.sort((a, b) => (a.series_game ?? 1) - (b.series_game ?? 1));
        for (let i = 1; i < gs.length; i++) {
          const a = gs[i - 1];
          const b = gs[i];
          if (!a.scheduled_date || !b.scheduled_date) continue;
          pairs++;
          const aEnd = Number(a.start_time!.slice(0, 2)) * 60 + Number(a.start_time!.slice(3)) + 120 + 15;
          const bStart = Number(b.start_time!.slice(0, 2)) * 60 + Number(b.start_time!.slice(3));
          ok(b.scheduled_date > a.scheduled_date, "S2-gen", `${n} teams, best of ${len}: ${a.round} ${a.game_number} game ${b.series_game} is on a later date`, `${a.scheduled_date} → ${b.scheduled_date}`);
          if (b.scheduled_date === a.scheduled_date) ok(bStart >= aEnd, "S2-gen", "same day: after the earlier game ends plus the buffer");
        }
      }
    }
  }
  ok(pairs > 50, "S2-gen", `series game pairs checked (${pairs})`);
});

// ─── S3: names and labels ─────────────────────────────────────────────────────

section("S3 names and labels", () => {
  const six = withIds(buildSingleElimination(teams(6), IDS, noSlots(), MOCKUP_SERIES));
  const g = (id: string) => six.find((r) => r.id === id)!;
  eq(seriesName(g("SF-5-2"), six), "Semifinal 1", "S3", "SF position 5 is Semifinal 1");
  eq(seriesName(g("SF-6-1"), six), "Semifinal 2", "S3", "SF position 6 is Semifinal 2");
  eq(seriesName(g("F-7-3"), six), "Final", "S3", "the Final");
  eq(gameLabel(g("SF-5-2"), six), "Semifinal 1 · Game 2 of 3", "S3", "a series game's label");
  eq(gameLabel(g("R1-4-1"), six), "Game 2", "S3", "Round 1's second game is still Game 2");
  eq([2, 4].map(gameNumbering(six)), [1, 2], "S3", "Game N counts single games only: Round 1 is Games 1–2");
  eq(emptySlotLabel(g("SF-5-1"), "away", six, "single_elimination"), "Winner of Game 1", "S3", "a slot fed by a single game: Winner of Game 1");
  eq(emptySlotLabel(g("F-7-1"), "home", six, "single_elimination"), "Winner of Semifinal 1", "S3", "a slot fed by a series: Winner of Semifinal 1");
  eq(emptySlotLabel(g("F-7-2"), "away", six, "single_elimination"), "Winner of Semifinal 2", "S3", "every game of the Final reads the same");

  const sfSeries = withIds(buildSingleElimination(teams(6), IDS, noSlots(), { SF: 3 }));
  const fin = sfSeries.find((r) => r.round === "F")!;
  eq(gameLabel(fin, sfSeries), "Game 3", "S3", "a single-game Final after series Semifinals is Game 3 — no jumps");

  const sixteen = withIds(buildSingleElimination(teams(16).map((t, i) => ({ ...t, team_id: `t${i + 1}` })), IDS, noSlots(), { R1: 3, R2: 3 }));
  const r2 = [...new Set(sixteen.filter((r) => r.round === "R2").map((r) => r.game_number))];
  eq(r2.map((n) => seriesName({ round: "R2", game_number: n }, sixteen)), ["Quarterfinal 1", "Quarterfinal 2", "Quarterfinal 3", "Quarterfinal 4"], "S3", "16 teams: Round 2 is Quarterfinals 1–4");
  eq(seriesName({ round: "R1", game_number: 3 }, sixteen), "Round 1 · Series 3", "S3", "before the quarterfinals: Round 1 · Series 3");
  const eight = withIds(buildSingleElimination(teams(8), IDS, noSlots(), { R1: 3 }));
  eq(seriesName({ round: "R1", game_number: 1 }, eight), "Round 1 · Series 1", "S3", "Round 1 is always Round 1, as the app calls it today");
});

// ─── S4: series state and tags ────────────────────────────────────────────────

section("S4 series state and tags", () => {
  const rows = mockupState();
  const series = (id: string) => seriesGamesOf(rows.find((r) => r.id === id)!, rows);
  eq(seriesHeadline(series("SF-5-1"), teamName), { text: "Expos lead 1–0", tone: "amber" }, "S4", "Semifinal 1: Expos lead 1–0");
  eq(seriesHeadline(series("SF-6-1"), teamName), { text: "Bears win 2–0", tone: "green" }, "S4", "Semifinal 2: Bears win 2–0");
  eq(seriesHeadline(series("F-7-1"), teamName), { text: "Not started", tone: "gray" }, "S4", "Final: Not started");
  eq(seriesState(series("SF-6-1")).winnerId, "t2", "S4", "Bears win Semifinal 2");
  eq(seriesState(series("SF-5-1")).next?.id, "SF-5-2", "S4", "Semifinal 1's next game is Game 2");
  eq(winsNeeded(3), 2, "S4", "best of 3: first to 2");
  eq(winsNeeded(7), 4, "S4", "best of 7: first to 4");

  const tags = (id: string) => series(id).map((g) => seriesGameTag(g, series(id)));
  eq(tags("SF-5-1"), ["result", "next", "if_needed"], "S4", "Semifinal 1: result, Next, If needed");
  eq(tags("SF-6-1"), ["result", "result", "not_needed"], "S4", "Semifinal 2: result, result, Not needed");
  eq(tags("F-7-1"), ["upcoming", "upcoming", "if_needed"], "S4", "Final, one team unknown: no Next yet; Game 3 if needed");

  // Best of 5 at 1–1: game 3 is next, game 4 will be played whatever happens, game 5 is if needed.
  // (A 2-team bracket's only round is labelled R1, as the app has always done.)
  const bo5 = withIds(buildSingleElimination(teams(2), IDS, noSlots(), { R1: 5 }));
  result(bo5, "R1-1-1", 5, 1);
  result(bo5, "R1-1-2", 5, 1);
  eq(bo5.map((g) => seriesGameTag(g, bo5)), ["result", "result", "next", "upcoming", "if_needed"], "S4", "best of 5 at 1–1: Game 4 is certain, Game 5 if needed");
  eq(seriesHeadline(bo5, teamName).text, "Tied 1–1", "S4", "a tie reads Tied 1–1");
  eq(bestOfLine(5), "Best of 5 — first to 3 wins", "S4", "the modal's series box");

  const fin = withIds(buildSingleElimination(teams(2), IDS, noSlots(), { R1: 3 }));
  result(fin, "R1-1-1", 3, 1);
  result(fin, "R1-1-2", 3, 1); // Bears are home in game 2
  result(fin, "R1-1-3", 4, 2);
  eq(seriesChampionLine(fin, teamName), "Expos win the Final 2–1", "S4", "the champion banner");
  eq(seriesChampionLine(bo5, teamName), null, "S4", "no banner before the Final is decided");
});

// ─── S5: results in order ─────────────────────────────────────────────────────

section("S5 results in order", () => {
  const rows = mockupState();
  const g = (id: string) => rows.find((r) => r.id === id)!;
  eq(
    seriesEnterRefusal(g("SF-5-3"), rows, teamName),
    "Game 2 of this series needs a result first — results go in order. If Game 2 was rained out, move it with Move.",
    "S5",
    "Game 3 before Game 2 is refused",
  );
  counters.orderRefusals++;
  eq(seriesEnterRefusal(g("SF-5-2"), rows, teamName), null, "S5", "the next game takes a result");
  eq(seriesEnterRefusal(g("SF-6-3"), rows, teamName), "This game isn't needed — Bears won Semifinal 2, 2–0.", "S5", "a not-needed game is refused");
  eq(
    seriesEnterRefusal(g("SF-6-1"), rows, teamName),
    "Game 2 of this series has a result too. Clear it first, then edit this one — results are changed from the latest game back.",
    "S5",
    "an earlier result can't be edited while a later one stands",
  );
  eq(seriesEnterRefusal(g("SF-6-2"), rows, teamName), null, "S5", "the latest result can be edited");
  eq(seriesEnterRefusal(g("R1-2-1"), rows, teamName), null, "S5", "a single game has no series rule");
  eq(
    seriesClearRefusal(g("SF-6-1"), rows),
    "Game 2 of this series has a result too. Clear it first — results are cleared from the latest game back.",
    "S5",
    "clearing goes from the latest game back",
  );
  eq(seriesClearRefusal(g("SF-6-2"), rows), null, "S5", "the latest result can be cleared");
});

// ─── S6: the line under the scores ────────────────────────────────────────────

section("S6 the Save line", () => {
  const rows = mockupState();
  const g = (id: string) => rows.find((r) => r.id === id)!;
  eq(
    seriesEnterLine(g("SF-5-2"), rows, 3, 6, teamName),
    "Saving this decides the series: Expos win 2–0. Game 3 (Sun 11/22) won't be played, and Expos move into the Final.",
    "S6",
    "the mockup's line, word for word",
  );
  eq(seriesEnterLine(g("SF-5-2"), rows, 4, 3, teamName), "After this, the series is tied 1–1.", "S6", "a Mets win ties it");
  eq(seriesEnterLine(g("SF-5-2"), rows, 3, 3, teamName), null, "S6", "a tied score says nothing (it can't be saved)");
  eq(
    seriesEnterLine(g("SF-6-2"), rows, 4, 3, teamName),
    "After this, the series is tied 1–1. Game 3 (Sun 11/22) is back on. Bears will be removed from the Final until the series is decided again.",
    "S6",
    "an edit that flips the deciding game",
  );
  eq(seriesEnterLine(g("SF-6-2"), rows, 2, 5, teamName), "The series result doesn't change: Bears win 2–0.", "S6", "an edit with the same winner");

  const fin = withIds(buildSingleElimination(teams(2), IDS, noSlots(), { R1: 3 }));
  fin.forEach((r, i) => (r.scheduled_date = ["2026-11-28", "2026-11-29", "2026-12-05"][i]));
  result(fin, "R1-1-1", 3, 1);
  eq(
    seriesEnterLine(fin[1], fin, 2, 4, teamName),
    "Saving this decides the Final: Expos win 2–0. Game 3 (Sat 12/5) won't be played.",
    "S6",
    "deciding the Final",
  );
  const single = withIds(buildSingleElimination(teams(4), IDS, noSlots(), { R1: 3 }));
  result(single, "R1-1-1", 5, 0);
  eq(
    seriesEnterLine(single.find((r) => r.id === "R1-1-2")!, single, 0, 5, teamName),
    "Saving this decides the series: Expos win 2–0. Game 3 won't be played, and Expos move into Game 1.",
    "S6",
    "a series feeding a single-game Final names it by its number",
  );
});

// ─── S7: the Clear lines ──────────────────────────────────────────────────────

section("S7 the Clear lines", () => {
  const rows = mockupState();
  const field = (id: string | null) => (id === "perry" ? "Perry" : id === "andrews" ? "Andrews" : null);
  eq(
    seriesClearLines(rows.find((r) => r.id === "SF-6-2")!, rows, teamName, field),
    [
      "The series goes back to Bears lead 1–0, so Game 3 (Sun 11/22, Perry) is scheduled again.",
      "Bears will be removed from the Final until the series is decided again.",
    ],
    "S7",
    "the mockup's clear preview, word for word",
  );
  eq(seriesClearLines(rows.find((r) => r.id === "SF-5-1")!, rows, teamName, field), ["The series goes back to 0–0."], "S7", "clearing Semifinal 1's only result");
  const c = seriesChange(rows.find((r) => r.id === "SF-6-2")!, rows, null, null);
  eq(c.restores.map((r) => r.id), ["SF-6-3"], "S7", "the not-needed game comes back");
  eq(c.movesOut, "t2", "S7", "Bears move back out");
});

// ─── S8: advancement writes ───────────────────────────────────────────────────

section("S8 advancement writes", () => {
  const rows = mockupState();
  const fin = () => rows.filter((r) => r.round === "F").map((r) => `${r.home_team_id ?? "-"}/${r.away_team_id ?? "-"}`);
  eq(fin(), ["-/t2", "-/t2", "-/t2"], "S8", "Bears wait in the Final's second slot, no home decided");

  // The writes reproduce the hand-set fixture: Mets into Semifinal 1, Royals
  // into Semifinal 2, Bears into the Final.
  const fresh = withIds(planBracket({ ...mockupInput(MOCKUP_SERIES), gamesPerTeamPerDay: 1 }).games);
  const via = (id: string, home: number, away: number) => {
    result(fresh, id, home, away);
    const g = fresh.find((r) => r.id === id)!;
    const w = seriesAdvanceWrites(g, g.winner_id!, null, fresh, seedOfPlain);
    if ("writes" in w) applyWrites(fresh, w.writes);
  };
  via("R1-2-1", 6, 3);
  via("R1-4-1", 2, 4);
  eq(
    fresh.filter((r) => r.round === "SF").map((r) => `${r.home_team_id}/${r.away_team_id}`),
    ["t1/t4", "t4/t1", "t1/t4", "t2/t6", "t6/t2", "t2/t6"],
    "S8",
    "Round 1 winners join the Semifinals: home alternates by true seed",
  );
  result(fresh, "SF-6-1", 4, 1);
  result(fresh, "SF-6-2", 2, 3);
  const sf2w = seriesAdvanceWrites(fresh.find((r) => r.id === "SF-6-2")!, "t2", null, fresh, seedOfPlain);
  eq("writes" in sf2w ? sf2w.writes.map((w) => `${w.home_team_id ?? "-"}/${w.away_team_id ?? "-"}`) : sf2w, ["-/t2", "-/t2", "-/t2"], "S8", "Bears into the Final's second slot, every game");

  const expos = seriesAdvanceWrites(rows.find((r) => r.id === "SF-5-2")!, "t1", null, rows, seedOfPlain);
  eq(
    "writes" in expos ? expos.writes.map((w) => `${w.home_team_id}/${w.away_team_id}`) : expos,
    ["t1/t2", "t2/t1", "t1/t2"],
    "S8",
    "Expos (1) join: home alternates, Expos home in games 1 and 3",
  );
  const mets = seriesAdvanceWrites(rows.find((r) => r.id === "SF-5-2")!, "t4", null, rows, seedOfPlain);
  eq(
    "writes" in mets ? mets.writes.map((w) => `${w.home_team_id}/${w.away_team_id}`) : mets,
    ["t2/t4", "t4/t2", "t2/t4"],
    "S8",
    "Mets (4) join instead: Bears (2) are the higher seed, home in games 1 and 3",
  );
  counters.homeSwapsAfterUpset++;

  if ("writes" in expos) applyWrites(rows, expos.writes);
  const flip = seriesAdvanceWrites(rows.find((r) => r.id === "SF-5-2")!, "t4", "t1", rows, seedOfPlain);
  eq(
    "writes" in flip ? flip.writes.map((w) => `${w.home_team_id}/${w.away_team_id}`) : flip,
    ["t2/t4", "t4/t2", "t2/t4"],
    "S8",
    "an edit that flips Semifinal 1 replaces Expos with Mets",
  );
  const back = seriesClearWrites(rows.find((r) => r.id === "SF-5-2")!, "t1", rows, seedOfPlain);
  eq(
    "writes" in back ? back.writes.map((w) => `${w.home_team_id ?? "-"}/${w.away_team_id ?? "-"}`) : back,
    ["-/t2", "-/t2", "-/t2"],
    "S8",
    "clearing takes Expos out; Bears go back to their bracket slot",
  );
  const played = rows.map((r) => ({ ...r }));
  result(played, "F-7-1", 3, 2);
  eq(seriesAdvanceWrites(played.find((r) => r.id === "SF-5-2")!, "t1", null, played, seedOfPlain), { blocked: "next_game_has_result" }, "S8", "a Final with a result can't be written into");
  const odd = rows.map((r) => (r.round === "F" ? { ...r, home_team_id: "t5", away_team_id: "t6" } : r));
  eq(seriesAdvanceWrites(odd.find((r) => r.id === "SF-5-2")!, "t1", null, odd, seedOfPlain), { blocked: "advancement_mismatch" }, "S8", "two strangers in the Final: refused, never guessed");

  const plainSingle = withIds(buildSingleElimination(teams(4), IDS, noSlots()));
  result(plainSingle, "R1-1-1", 5, 2);
  const one = seriesAdvanceWrites(plainSingle.find((r) => r.id === "R1-1-1")!, "t1", null, plainSingle, seedOfPlain);
  eq("writes" in one ? one.writes : one, [{ gameId: "F-3-1", home_team_id: "t1", away_team_id: null }], "S8", "single games: the winner takes its bracket slot, as today");
  eq(homeTeamKnown({ home_team_id: null, away_team_id: "t2" }), false, "S8", "one team unknown: no home team to show");
});

// ─── S9: setup text ───────────────────────────────────────────────────────────

section("S9 setup text", () => {
  eq(wizardRounds(6), [
    { label: "R1", title: "Round 1", matchups: 2 },
    { label: "SF", title: "Semifinals", matchups: 2 },
    { label: "F", title: "Final", matchups: 1 },
  ], "S9", "6 teams: Round 1, Semifinals, Final");
  eq(wizardRounds(16).map((r) => r.title), ["Round 1", "Quarterfinals", "Semifinals", "Final"], "S9", "16 teams: Quarterfinals");
  eq(roundLengthHelp(1, 2), "1 game · 2 matchups", "S9", "1 game");
  eq(roundLengthHelp(3, 2), "Best of 3 — first to 2 wins. Game 3 is played only if needed. · 2 series", "S9", "best of 3, 2 series");
  eq(roundLengthHelp(3, 1), "Best of 3 — first to 2 wins. Game 3 is played only if needed.", "S9", "best of 3 Final");
  eq(roundLengthHelp(5, 1), "Best of 5 — first to 3 wins. Games 4 and 5 are played only if needed.", "S9", "best of 5");
  eq(roundLengthHelp(7, 1), "Best of 7 — first to 4 wins. Games 5, 6 and 7 are played only if needed.", "S9", "best of 7");
  eq(
    seriesSetupNote(wizardRounds(6), MOCKUP_SERIES),
    "Up to 11 games: 2 in Round 1, up to 6 in the Semifinals, up to 3 in the Final — 3 of them only if needed. The higher seed is home in games 1 and 3. If-needed games get a date and a field now and are cancelled automatically when a series is decided.",
    "S9",
    "the setup note",
  );
  eq(seriesSetupNote(wizardRounds(6), {}), null, "S9", "no note with every round at 1 game");
  eq(seriesFormatProblem("double_elimination", { F: 3 }), "Series are for single elimination only — double elimination and round robin play 1 game per round.", "S9", "no series in double elimination");
  eq(seriesFormatProblem("single_elimination", { F: 3 }), null, "S9", "single elimination takes series");

  const plan = planBracket({ ...mockupInput(MOCKUP_SERIES), gamesPerTeamPerDay: 1 });
  eq(seriesReviewRows(plan.games), [
    { title: "Round 1", text: "2 games · Sat 11/14" },
    { title: "Semifinals", text: "Best of 3 · Sun 11/15, Sat 11/21, Sun 11/22 (if needed)" },
    { title: "Final", text: "Best of 3 · Sat 11/28, Sun 11/29, Sat 12/5 (if needed)" },
  ], "S9", "the Review rows");
  eq(seriesGamesReviewLine(plan.games), "Up to 11 — all 11 have a date and a field", "S9", "the Review games line");
});

// ─── S10: confirms ────────────────────────────────────────────────────────────

section("S10 confirms", () => {
  eq(seriesDeleteLine(mockupState()), "11 games — 2 single games and 3 best-of-3 series. 5 have results; 1 is not needed.", "S10", "the delete confirm's first line");

  const s2 = planStage2({
    advance: 6,
    ids: IDS,
    grid: mockupInput(MOCKUP_SERIES).grid,
    settings: SETTINGS,
    divisionName: "Majors",
    gamesPerTeamPerDay: 1,
    seriesByRound: MOCKUP_SERIES,
  });
  const confirm = seedConfirm({
    divisionName: "Majors",
    stage2Games: s2.games as Stage2Game[],
    order: teams(6),
    advance: 6,
    status: stage1Status([], "2026-11-01"),
    teamName: (id) => (id ? teamName(id) : "TBD"),
  });
  eq(confirm.lines, [
    "Expos (1) — bye to Semifinal 1",
    "Bears (2) — bye to Semifinal 2",
    "Game 1: Mets (4) vs Pirates (5) · Sat 11/14, 9:00 AM",
    "Game 2: Lions (3) vs Royals (6) · Sat 11/14, 9:00 AM",
  ], "S10", "seed confirm: byes go to Semifinals 1 and 2, named once each");
  eq(confirm.seriesLine, "Semifinals and Final are best of 3; the higher seed is home in games 1 and 3.", "S10", "seed confirm: the series line");
  eq(confirm.notAdvancing, null, "S10", "all 6 advance");
  const s2Games = s2.games.filter((g) => g.round === "SF" && g.game_number === 5);
  eq(s2Games.map((g) => `${g.seed_home}/${g.seed_away}`), ["1/null", "1/null", "1/null"], "S10", "Stage 2: the bye seed sits in every game of its series");
  const r1 = planStage2({ advance: 8, ids: IDS, grid: mockupInput({ R1: 3 }).grid, settings: SETTINGS, divisionName: "Majors", seriesByRound: { R1: 3 } });
  eq(r1.games.filter((g) => g.round === "R1" && g.game_number === 1).map((g) => `${g.seed_home}/${g.seed_away}`), ["1/8", "8/1", "1/8"], "S10", "Stage 2 Round 1 series: seeds alternate home");
});

// ─── S11: the screens (step 3) ────────────────────────────────────────────────

section("S11 screens", () => {
  const rows = mockupState();
  const g = (id: string) => rows.find((r) => r.id === id)!;
  const series = (id: string) => seriesGamesOf(g(id), rows);
  const acts = (id: string) => seriesGameActions(g(id), series(id));

  // What each game offers (mockup screens 3 and 5).
  eq(acts("SF-5-1"), { result: false, edit: true, move: false }, "S11", "Semifinal 1 Game 1: its result is the latest, so Edit");
  eq(acts("SF-5-2"), { result: true, edit: false, move: true }, "S11", "Semifinal 1 Game 2 (Next): Result and Move");
  eq(acts("SF-5-3"), { result: false, edit: false, move: true }, "S11", "Semifinal 1 Game 3 (if needed): Move only");
  eq(acts("SF-6-1"), { result: false, edit: false, move: false }, "S11", "Semifinal 2 Game 1: a later result stands, nothing");
  eq(acts("SF-6-2"), { result: false, edit: true, move: false }, "S11", "Semifinal 2 Game 2: the deciding result, Edit");
  eq(acts("SF-6-3"), { result: false, edit: false, move: false }, "S11", "Semifinal 2 Game 3 (not needed): nothing");
  eq(acts("F-7-1"), { result: false, edit: false, move: true }, "S11", "Final Game 1, one team unknown: Move only");

  const card = (id: string) => {
    const a = seriesCardActions(series(id));
    return { result: a.result?.id ?? null, edit: a.edit?.id ?? null, move: a.move?.id ?? null };
  };
  eq(card("SF-5-1"), { result: "SF-5-2", edit: "SF-5-1", move: "SF-5-2" }, "S11", "Semifinal 1's footer: Result and Move on Game 2, Edit on Game 1");
  eq(card("SF-6-1"), { result: null, edit: "SF-6-2", move: null }, "S11", "Semifinal 2's footer: Edit on Game 2 only");
  eq(card("F-7-1"), { result: null, edit: null, move: "F-7-1" }, "S11", "the Final's footer: Move on Game 1");

  // The card never offers what the modal would refuse.
  for (const r of rows) {
    const s = seriesGamesOf(r, rows);
    if (s.length < 2) continue;
    const a = seriesGameActions(r, s);
    const refusal = seriesEnterRefusal(r, rows, teamName);
    if ((a.result || a.edit) && refusal !== null) ok(false, "S11", `${r.id} is offered but the modal refuses it`, refusal);
    if (gameHasResult(r) && !a.edit && refusal === null) ok(false, "S11", `${r.id}'s result can be edited but the card hides Edit`);
  }
  ok(true, "S11", "every series game: the card and the modal agree");

  eq(seriesResultText(g("SF-5-1"), teamName), "Expos 5–2", "S11", "a home win reads winner first");
  eq(seriesResultText(g("SF-6-2"), teamName), "Bears 3–2", "S11", "an away win reads winner first");
  eq(seriesResultText(g("SF-5-2"), teamName), null, "S11", "no score, no result text");
  eq(seriesHomeNote(g("SF-5-2"), teamName), "Mets home", "S11", "Game 2: Mets home (games alternate)");
  eq(seriesHomeNote(g("F-7-1"), teamName), null, "S11", "no home team named while a team is unknown");
  // The case that needs the both-known rule: a home slot filled, the away
  // slot still waiting (a winner moved in before its opponent is known).
  eq(seriesHomeNote({ ...g("F-7-1"), home_team_id: "t2", away_team_id: null }, teamName), null, "S11", "no home team named while the away team is unknown");

  eq(oneRowPerSeries(rows).map((r) => r.id), ["R1-2-1", "R1-4-1", "SF-5-1", "SF-6-1", "F-7-1"], "S11", "the tree lays out one row per series");

  eq(seriesByRoundPayload("single_elimination", { SF: 3, F: 3, R2: 5 }, rows), { SF: 3, F: 3 }, "S11", "series_by_round keeps only the games' rounds");
  eq(seriesByRoundPayload("round_robin", { SF: 3 }, rows), {}, "S11", "no series for a round robin");
  eq(bracketGamesLabel(wizardRounds(6), MOCKUP_SERIES), "Up to 11 games", "S11", "Stage 2 panel: Up to 11 games");
  eq(bracketGamesLabel(wizardRounds(6), {}), "5 games", "S11", "Stage 2 panel without series: 5 games");

  // The database's refusal replies (0114), in the same words as the modal's.
  const numbering: ResultNumbering = {
    own: gameNumbering(rows),
    nextStage: null,
    seriesOf: (round, n) => {
      const row = rows.find((r) => r.round === round && r.game_number === n);
      return row && seriesGamesOf(row, rows).length > 1 ? { inSentence: row.round === "F" ? "the Final" : seriesName(row, rows) } : null;
    },
  };
  eq(
    blockedMessage({ blocked: true, reason: "series_order", previous_series_game: 2 }, "edit", numbering),
    "Game 2 of this series needs a result first — results go in order. If Game 2 was rained out, move it with Move.",
    "S11", "reply series_order",
  );
  eq(
    blockedMessage({ blocked: true, reason: "series_later_result", later_series_game: 3 }, "clear", numbering),
    "Game 3 of this series has a result too. Clear it first — results are cleared from the latest game back.",
    "S11", "reply series_later_result (clear)",
  );
  eq(
    blockedMessage({ blocked: true, reason: "game_not_needed" }, "edit", numbering),
    "This game isn't needed — its series is already decided. Refresh the page to see the latest.",
    "S11", "reply game_not_needed",
  );
  eq(
    blockedMessage({ blocked: true, reason: "next_game_has_result", next_game: { game_number: 7, round: "F", series_game: 1, home_name: "Expos", away_name: "Bears", home_score: 3, away_score: 2 } }, "clear", numbering),
    "The Final already has a result (Game 1: Expos 3, Bears 2). Clear the Final's results first, then clear this one.",
    "S11", "reply next_game_has_result for a series: the mockup's words",
  );
  eq(
    nextSeriesBlockedMessage("Semifinal 1", { seriesGame: 2, homeName: "Mets", homeScore: 1, awayName: "Expos", awayScore: 4 }, "edit"),
    "Semifinal 1 already has a result (Game 2: Mets 1, Expos 4). Clear Semifinal 1's results first, then change this one.",
    "S11", "a series that is not the Final",
  );

  // The clear confirm (mockup screen 6, left), with the series lines.
  const preview: ClearPreview = {
    gameId: "SF-6-2", gameNumber: 6, round: "SF", roundName: "Semifinals", homeName: "Royals", awayName: "Bears", homeScore: 2, awayScore: 3,
    winnerName: "Bears", onPublicSchedule: true,
    removed: { gameNumber: 7, round: "F", roundName: "Final", teamName: "Bears", seriesInSentence: "the Final" },
  };
  const field = (id: string | null) => (id === "perry" ? "Perry" : id === "andrews" ? "Andrews" : null);
  eq(
    clearConfirm(preview, { gameTitle: gameLabel(g("SF-6-2"), rows), lines: seriesClearLines(g("SF-6-2"), rows, teamName, field) }).lines,
    [
      "Semifinal 2 · Game 2 of 3 — Royals 2, Bears 3 (Bears won).",
      "The score and winner will be removed and the game goes back to scheduled.",
      "The series goes back to Bears lead 1–0, so Game 3 (Sun 11/22, Perry) is scheduled again.",
      "Bears will be removed from the Final until the series is decided again.",
      "This is on your public schedule — the change shows there within a minute.",
    ],
    "S11", "the clear confirm, word for word (the database's removed line is not repeated)",
  );
  eq(
    clearConfirm({ ...preview, gameId: "R1-4-1", gameNumber: 4, round: "R1", roundName: "Round 1", removed: { gameNumber: 6, round: "SF", roundName: "Semifinals", teamName: "Royals", seriesInSentence: "Semifinal 2" } }).lines[2],
    "Royals will be removed from Semifinal 2 until this game has a result again.",
    "S11", "a single game feeding a series names the series",
  );
});

// ─── S12: outside the app (step 4) ────────────────────────────────────────────
// The public page and its feed, the CSV and schedule print, the printed
// bracket, the delete confirm, and what a not-needed game frees. Every
// expected value is written out from the approved mockup (7–10).

/** A planned row with its id and result fields (mockupState's rows). */
type Planned = SeriesGame & Omit<GameInsert, "status">;

const VENUE_NAME: Record<string, string> = { andrews: "Andrews", perry: "Perry" };

/** What get_league_schedule_by_token (0114) returns for the mockup state:
 *  not-needed games left out, series_game and series_length emitted. */
function publicGames(rows: SeriesGame[], keepNotNeeded = false): PublicPlayoffGame[] {
  const all = rows as Planned[];
  return all
    .filter((g) => keepNotNeeded || g.status !== NOT_NEEDED)
    .map((g) => ({
      id: g.id,
      playoff_id: "p1",
      format: "single_elimination",
      division_id: "d1",
      round: g.round,
      game_number: g.game_number,
      scheduled_date: g.scheduled_date ?? null,
      start_time: g.start_time ? g.start_time.substring(0, 5) : null,
      status: g.status ?? "scheduled",
      home_team: g.home_team_id ? { id: g.home_team_id, name: teamName(g.home_team_id) } : null,
      away_team: g.away_team_id ? { id: g.away_team_id, name: teamName(g.away_team_id) } : null,
      venue: g.venue_id
        ? { name: VENUE_NAME[g.venue_id] ?? g.venue_id, location: { name: "Monroe Complex" }, address: null, home_park: true }
        : null,
      series_game: g.series_game ?? 1,
      series_length: Math.max(
        ...all.filter((x) => x.round === g.round && x.game_number === g.game_number).map((x) => x.series_game ?? 1),
      ),
      // The reader's flag, computed here by the TypeScript rule — IX below pins
      // that rule to the SQL helper the reader calls, row for row.
      if_needed: seriesGameTag(g, seriesGamesOf(g, rows)) === "if_needed",
    }));
}
function publicSeason(playoff: PublicPlayoffGame[]): PublicSeason {
  return {
    id: "l1", name: "Fall 2026", start_date: "2026-08-01", end_date: "2026-12-06",
    divisions: [{ id: "d1", name: "Majors", game_duration: 120 }],
    teams: [], games: [], playoff_games: playoff,
  } as unknown as PublicSeason;
}
function exportGames(rows: SeriesGame[]): ExportGame[] {
  return (rows as Planned[]).map((g) => ({
    id: g.id,
    playoff_id: "p1",
    round: g.round,
    game_number: g.game_number,
    series_game: g.series_game ?? 1,
    scheduled_date: g.scheduled_date ?? null,
    start_time: g.start_time ?? null,
    status: g.status ?? "scheduled",
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    home_team_name: g.home_team_id ? teamName(g.home_team_id) : null,
    away_team_name: g.away_team_id ? teamName(g.away_team_id) : null,
    winner_id: g.winner_id,
    venue_name: g.venue_id ? `Monroe Complex — ${VENUE_NAME[g.venue_id]}` : null,
  }));
}

section("S12 outside the app", () => {
  const rows = mockupState();
  ok(rows.every((g) => !!g.scheduled_date), "S12", "fixture: every game of the mockup bracket is dated");

  // ── Public page ──
  const pub = buildRows(publicSeason(publicGames(rows)));
  const byKey = new Map(pub.map((r) => [r.key, r]));
  const row = (id: string) => byKey.get(`p-${id}`);
  const label = (id: string) => row(id)?.playoffLabel ?? "(missing)";
  eq(label("R1-2-1"), "Playoffs · Round 1 · Game 1", "S12", "public: a single game in a series bracket keeps Game N (singles only)");
  eq(label("R1-4-1"), "Playoffs · Round 1 · Game 2", "S12", "public: Round 1's second game is Game 2");
  eq(label("SF-5-2"), "Playoffs · Semifinal 1 · Game 2 of 3", "S12", "public: a series game names its series");
  eq(label("SF-6-1"), "Playoffs · Semifinal 2 · Game 1 of 3", "S12", "public: a decided series still reads of 3 (length from the reader, not the rows)");
  eq(row("SF-6-3"), undefined, "S12", "public: a not-needed game is not on the page");
  eq(row("SF-5-2")?.matchup, "Mets vs Expos", "S12", "public: both teams known → home team first");
  eq([row("SF-5-1")?.ifNeeded, row("SF-5-2")?.ifNeeded, row("SF-5-3")?.ifNeeded], [false, false, true], "S12", "public: only Game 3 of a best of 3 is If needed");
  eq(row("F-7-1")?.matchup, "Bears and Winner of Semifinal 1", "S12", "public: a series game with a team unknown names no home team");
  eq([row("F-7-1")?.ifNeeded, row("F-7-3")?.ifNeeded], [false, true], "S12", "public: the Final's Game 3 is If needed");
  eq(row("R1-2-1")?.ifNeeded, false, "S12", "public: a single game is never If needed");
  if (row("F-7-1")?.matchup.includes(" and ")) counters.publicPlaceholderMatchups++;

  // No scores on the public page (mockup decision): no standing, no winner.
  const pubText = JSON.stringify(pub);
  ok(!/ lead |\bwin\b|Tied|\d–\d/.test(pubText), "S12", "public: no series score or standing leaves the page", pubText.match(/ lead |\bwin\b|Tied|\d–\d/)?.[0] ?? "");
  const pubType = readFileSync("src/lib/public-schedule/types.ts", "utf8");
  const ppg = pubType.slice(pubType.indexOf("export type PublicPlayoffGame"), pubType.indexOf("export type PublicDivision"));
  ok(ppg.length > 0 && !/score|winner/.test(ppg.replace(/\/\*[\s\S]*?\*\//g, "")), "S12", "public: the playoff game type carries no score or winner key");

  // Second lock: a not-needed row that reaches buildRows is dropped there too.
  const leaked = buildRows(publicSeason(publicGames(rows, true)));
  ok(!leaked.some((r) => r.key === "p-SF-6-3"), "S12", "public: buildRows drops a not-needed game even if the reader sent it");
  if (!leaked.some((r) => r.key === "p-SF-6-3")) counters.publicNotNeededDropped++;

  // The home team known, the other not (one slot filled): still no "vs".
  // (Expos, Semifinal 1's leader, in the home slot Semifinal 1 feeds.)
  const half = rows.map((g) => (g.id === "F-7-1" ? { ...g, home_team_id: "t1", away_team_id: null } : g));
  eq(buildRows(publicSeason(publicGames(half))).find((r) => r.key === "p-F-7-1")?.matchup,
    "Expos and Winner of Semifinal 2", "S12", "public: home slot known, away not → still no home team named");
  eq(outboundMatchup("Expos", "Mets", { seriesGame: false, homeIsTeam: true, awayIsTeam: false }), "Expos vs Mets", "S12", "a single game always reads vs");
  // The page shows the reader's flag and nothing else: a row whose flag is
  // false reads no tag even when its position is past the minimum.
  const flagOff = publicGames(rows).map((g) => (g.id === "SF-5-3" ? { ...g, if_needed: false } : g));
  eq(buildRows(publicSeason(flagOff)).find((r) => r.key === "p-SF-5-3")?.ifNeeded, false, "S12", "public: the tag is the reader's flag, never worked out on the page");

  // ── Feed ──
  eq(playoffEventTitle(row("SF-5-3")!), "Majors Playoffs — Semifinal 1, Game 3 of 3 (if needed): Expos vs Mets", "S12", "feed: an if-needed game's title");
  eq(playoffEventTitle(row("F-7-1")!), "Majors Playoffs — Final, Game 1 of 3: Bears and Winner of Semifinal 1", "S12", "feed: before both teams are known");
  eq(playoffEventTitle(row("R1-2-1")!), "Mets vs Pirates", "S12", "feed: a single playoff game keeps its matchup title");
  const data = { status: "ok", org: { name: "SRALL", timezone: "America/Los_Angeles" }, today: "2026-11-01", seasons: [publicSeason(publicGames(rows))] } as PublicScheduleOk;
  const ics = buildLeagueCalendarIcs(data, "2026-11-01T12:00:00Z");
  ok(ics.ok && !ics.ics.includes("playoff-SF-6-3@") && ics.ics.includes("playoff-SF-5-3@"), "S12", "feed: the not-needed game has no event; the if-needed one does");
  ok(ics.ok && ics.eventCount === 10, "S12", "feed: 10 events (11 games, 1 not needed)", ics.ok ? String(ics.eventCount) : ics.error);

  // ── CSV and schedule print ──
  const ex = exportGames(rows);
  const titles = buildPlayoffCsv(ex, { divisionName: "Majors", durationMin: 120, pair: null, format: "single_elimination" })
    .split("\r\n").slice(1).map((l) => l.split('","')[4]);
  for (const t of [
    "Majors Playoffs - Round 1 · Game 1: Mets vs Pirates",
    "Majors Playoffs - Semifinal 1 · Game 2 of 3: Mets vs Expos",
    "Majors Playoffs - Semifinal 1 · Game 3 of 3 (if needed): Expos vs Mets",
    "Majors Playoffs - Final · Game 1 of 3: Bears and Winner of Semifinal 1",
  ]) ok(titles.includes(t), "S12", `CSV: "${t}"`, titles.join(" | "));
  eq(titles.length, 10, "S12", "CSV: 10 rows — the not-needed game is not exported");
  ok(!titles.some((t) => t.startsWith("Majors Playoffs - Semifinal 2 · Game 3")), "S12", "CSV: Semifinal 2's Game 3 is left out");
  eq(exportableGames(ex).length, 10, "S12", "schedule print: lists the same 10 games");
  // At 1–1 the CSV knows Game 3 will be played; the public page (no results) still says If needed.
  const tied = mockupState();
  result(tied, "SF-5-2", 5, 3); // Mets (home) win → 1–1
  eq(exportGameName(exportGames(tied).find((g) => g.id === "SF-5-3")!, exportGames(tied), null), "Semifinal 1 · Game 3 of 3", "S12", "CSV: at 1–1 Game 3 is not marked if needed (results known)");
  eq(buildRows(publicSeason(publicGames(tied))).find((r) => r.key === "p-SF-5-3")?.ifNeeded, false, "S12", "public: at 1–1 Game 3 will be played — no If needed (the reader's flag)");
  if (!exportGameName(exportGames(tied).find((g) => g.id === "SF-5-3")!, exportGames(tied), null).includes("if needed")) counters.csvIfNeededFromResults++;
  // A bracket with no series exports exactly as before.
  const plain = exportGames(withIds(planBracket({ ...mockupInput(undefined), gamesPerTeamPerDay: 1 }).games));
  eq(exportGameName(plain.find((g) => g.round === "SF")!, plain, null), "Semifinals", "S12", "CSV: no series → round name only, as before");

  // ── Printed bracket (revised 2026-10-20: a group of stacked game cards) ──
  const html = buildBracketPrintHtml(seriesMockup(), "single_elimination", "L", "Majors", "Nov 21, 2026");
  ok(html.includes(">Single elimination · Semifinals and Final best of 3</div>"), "S12", "print: the series line under the title");
  for (const h of ["Round 1", "Semifinals · best of 3", "Final · best of 3"]) ok(html.includes(`>${h}</div>`), "S12", `print: round header "${h}"`);
  eq((html.match(/data-series="/g) ?? []).length, 3, "S12", "print: one group per series (3)");
  eq((html.match(/data-series-game="/g) ?? []).length, 9, "S12", "print: one full card per game (9)");
  eq((html.match(/transform:translateY\(-50%\)"><div data-series=/g) ?? []).length, 3, "S12", "print: each group is placed by its middle (top at the slot's centre, moved up half its height)");
  ok(html.includes(">Semifinal 1 · best of 3</span>") && html.includes("<span data-series-state>Expos lead 1–0</span>")
     && html.includes("<span data-series-state>Bears win 2–0</span>"), "S12", "print: each group's header line — name · best of 3, and where it stands");
  ok(html.includes(">Game 1 of 3 · Sun 11/15 · 9:00 AM</div>") && html.includes(">Monroe Complex — Andrews</div>"),
    "S12", "print: a game card's header — Game k of 3 · date · time — over the field");
  ok(/data-series-game="3" data-tag="not_needed"[^>]*opacity:0\.5;[^>]*>[\s\S]*?text-decoration:line-through/.test(html), "S12", "print: the not-needed game is greyed and struck through");
  eq((html.match(/data-tag="if_needed"/g) ?? []).length, 2, "S12", "print: two if-needed games (Semifinal 1 and Final Game 3)");
  eq((html.match(/<span data-if-needed[^>]*>If needed<\/span>/g) ?? []).length, 2, "S12", "print: If needed is said in the card's header");
  ok(!/>Next</.test(html), "S12", "print: no Next tag");
  const groupsHtml = html.split("data-series=\"").slice(1).map((x) => x.slice(0, x.indexOf("data-series=") > 0 ? x.indexOf("data-series=") : x.length));
  ok(groupsHtml.every((g) => !g.slice(0, g.indexOf("data-row=")).includes("text-overflow:ellipsis")), "S12", "print: a group's headers never truncate (they wrap)");
  ok(html.includes("Winner of Semifinal 1"), "S12", "print: the Final's empty slot names the series that feeds it");
  // Home order follows the alternation: Semifinal 1 is Expos–Mets, Mets–Expos, Expos–Mets.
  const rowsOf = (k: number) => {
    const seg = html.slice(html.indexOf('data-series="Semifinal 1"'));
    const card = seg.split('data-series-game="')[k];
    return [...card.matchAll(/data-row="(home|away)"[^>]*>\s*<span[^>]*>([^<]*)</g)].map((m) => m[2]).join("/");
  };
  eq([1, 2, 3].map(rowsOf), ["Expos/Mets", "Mets/Expos", "Expos/Mets"], "S12", "print: each card's home row follows the alternation");
  eq(seriesPrintLine(withIds(planBracket({ ...mockupInput(undefined), gamesPerTeamPerDay: 1 }).games)), null, "S12", "print: no series → no series line");
  eq(seriesRoundHeader("SF", seriesMockup()), "Semifinals · best of 3", "S12", "print: header helper");

  // Geometry (print and screen): no two items in a column overlap, every item
  // is on the canvas, a group's lines leave and enter at its middle, a single
  // card's leave at the divider and enter a row's centre.
  const screenH = (series: PrintGame[], bracket: PrintGame[]) =>
    groupHeight(SCREEN_GROUP, `${series[0].round}`, "Expos lead 1–0", groupCardTexts(series), false) + 0 * bracket.length;
  for (const [name, games, minScale, D, groupH] of [
    ["print, mockup", seriesMockup(), 1, PRINT_SERIES_TREE, (f: PrintGame, s2: PrintGame[]) => printGroupHeight(f, s2, seriesMockup())],
    ["print, 16 teams to a best of 7", seriesSixteen(), 0.4, PRINT_SERIES_TREE, (f: PrintGame, s2: PrintGame[]) => printGroupHeight(f, s2, seriesSixteen())],
    ["screen, mockup", seriesMockup(), 0, SCREEN_TREE, (_f: PrintGame, s2: PrintGame[]) => screenH(s2, seriesMockup())],
  ] as [string, PrintGame[], number, TreeDims, (f: PrintGame, s: PrintGame[]) => number][]) {
    const L = groupedTreeLayout(games, D, groupH);
    let overlap = false;
    for (let k = 0; k < L.rounds.length; k++) {
      const col = L.items.filter((c) => c.round === k).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) if (col[i].y < col[i - 1].y + col[i - 1].h + GROUP_MARGIN - 1e-6) overlap = true;
    }
    ok(!overlap, "S12", `geometry (${name}): no items overlap in a column`);
    ok(L.items.every((c) => c.y >= D.roundHdr - 1e-6 && c.y + c.h <= L.height + 1e-6), "S12", `geometry (${name}): every item is on the canvas`);
    ok(L.items.filter((c) => c.group).every((c) => Math.abs(c.y + c.h / 2 - c.centre) < 1e-6), "S12", `geometry (${name}): a group is centred on its slot`);
    ok(L.connectors.length > 0 && L.connectors.every((cn) => {
      const from = L.items.find((c) => c.game.game_number === cn.from)!;
      const to = L.items.find((c) => c.game.game_number === cn.to)!;
      const fromY = from.group ? from.centre : from.y + D.sourceY;
      const toY = to.group ? to.centre : to.y + D.rowTop + (cn.side === "home_team_id" ? D.rowH / 2 : D.rowH + D.divider + D.rowH / 2);
      return Math.abs(cn.points[0][1] - fromY) < 1e-6 && Math.abs(cn.points[3][1] - toY) < 1e-6;
    }), "S12", `geometry (${name}): a group's lines leave and enter at its middle; a card's leave at the divider, enter a row`);
    if (minScale > 0) ok(L.scale >= minScale, "S12", `geometry (${name}): scale ≥ ${minScale}`, L.scale.toFixed(3));
  }
  // The estimate grows with a header that wraps: a long field name adds a line.
  const longField = groupCardTexts([{ ...seriesMockup()[2], venue_name: "Polley Field @ Ives Park (Sebastopol Little League)" }]);
  ok(groupHeight(PRINT_GROUP, "x", "y", longField) > groupHeight(PRINT_GROUP, "x", "y", groupCardTexts([seriesMockup()[2]])),
    "S12", "geometry: a field name that wraps makes the estimated group taller");

  // ── Delete confirm ──
  const C: BracketCounts = { games: 11, datedGames: 11, gamesWithResults: 5, publicGames: 10, notNeededGames: 1 };
  const d = deleteConfirm("Majors", C, false, rows);
  eq(d.lines, ["11 games — 2 single games and 3 best-of-3 series. 5 have results; 1 is not needed.", "This can't be undone."], "S12", "delete: the series line replaces the games and results lines");
  ok(!!d.publicWarning?.startsWith("10 of these games are on your public schedule right now (not-needed games never are)."), "S12", "delete: the public line says not-needed games never are", d.publicWarning ?? "");
  const off = deleteConfirm("Majors", { ...C, gamesWithResults: 4 }, false, rows);
  eq(off.lines[0], "This deletes the bracket and all 11 of its games (all have dates).", "S12", "delete: games that disagree with the preview → the preview's own lines");
  ok(!deleteConfirm("Majors", { ...C, notNeededGames: 0 }, false, null).publicWarning?.includes("not-needed"), "S12", "delete: no not-needed games → no parenthetical");

  // ── What a not-needed game frees ──
  const snackRows = (rows as Planned[]).map((g) => ({
    home_team_id: g.home_team_id, away_team_id: g.away_team_id, venue_id: g.venue_id ?? null,
    scheduled_date: g.scheduled_date ?? null, start_time: g.start_time ?? null, status: g.status ?? "scheduled", durationMin: 120,
  }));
  const index = assignmentIndexFromGames(assignmentGamesFromPlayoffRows(snackRows), ["andrews", "perry"]);
  const nn = rows.find((g) => g.id === "SF-6-3")! as Planned;
  const ifn = rows.find((g) => g.id === "SF-5-3")! as Planned;
  eq(teamGamesOn(index, "t6", nn.scheduled_date!).length, 0, "S12", "snack shack: a not-needed game leaves its teams free");
  eq(teamGamesOn(index, "t4", ifn.scheduled_date!).length, 1, "S12", "snack shack: an if-needed game holds its teams");
  const dl = { date: "2026-11-22", startTime: "16:30", rawDuration: 120, venue: { has_lights: false }, isAway: false };
  const sr = { kind: "on" as const, city: cityById("ca-santa-rosa") };
  ok(daylightFlag({ ...dl, status: "scheduled" }, sr, "2026-11-01") !== null && daylightFlag({ ...dl, status: NOT_NEEDED }, sr, "2026-11-01") === null,
    "S12", "daylight: an if-needed game ending after sunset is flagged; a not-needed one never is");

  // Reads that must leave not-needed games out (source checks — weak by nature).
  const modal = readFileSync("src/components/playoffs/edit-playoff-game-modal.tsx", "utf8");
  eq((modal.match(/\.neq\("status", NOT_NEEDED\)/g) ?? []).length, 2, "S12", "Edit game: both playoff occupancy reads skip not-needed games");
  ok(readFileSync("src/app/(dashboard)/dashboard/leagues/[id]/page.tsx", "utf8").includes('.neq("status", "not_needed")'), "S12", "season page: the last-game read skips not-needed games");
  ok(readFileSync("src/components/public-schedule/public-schedule-client.tsx", "utf8").includes("{row.ifNeeded && !row.struck && <PlainTag tone=\"amber\">{SERIES_TAG_TEXT.if_needed}</PlainTag>}"),
    "S12", "public page: renders the If needed tag");
  ok(readFileSync("src/components/playoffs/seed-stage2-modal.tsx", "utf8").includes("{confirm.seriesLine && <p"), "S12", "seed confirm: shows the series line");
});

// ─── IX: the public "If needed" rule, one table for both languages ──────────
// The IFNEEDED-TABLE block of scripts/sim/playoff-series-sim.sql is the only
// copy. The SQL proof runs it through playoff_if_needed (IX1); here every row
// becomes a series and goes through seriesGameTag. Change either rule alone
// and its side goes red.

// ─── FN: the last round is always the Final (Whit's acceptance test) ───────
// A 2-team bracket stores its only round as "R1" and a 4-team bracket its
// first round as "R1" — names come from POSITION (series-names.ts), on every
// surface. Expected values are written out by hand.

section("FN the last round is the Final", () => {
  const titles = (n: number) => wizardRounds(n).map((r) => r.title);
  eq(titles(2), ["Final"], "FN1", "wizard, 2 teams: the only round is the Final");
  if (titles(2)[0] === "Final") counters.twoTeamFinals++;

  // Every team count 2–16 (Whit's acceptance test: 3 teams showed one row).
  // Written by hand: label, title, matchups (real games) for every round that
  // has at least one real game — a bye pair is not a game. The last is always
  // the Final; the round before it is the Semifinals only with two matchups.
  const TABLE: Record<number, [string, string, number][]> = {
    2: [["R1", "Final", 1]],
    3: [["R1", "Round 1", 1], ["F", "Final", 1]],
    4: [["R1", "Semifinals", 2], ["F", "Final", 1]],
    5: [["R1", "Round 1", 1], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    6: [["R1", "Round 1", 2], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    7: [["R1", "Round 1", 3], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    8: [["R1", "Round 1", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    9: [["R1", "Round 1", 1], ["R2", "Quarterfinals", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    10: [["R1", "Round 1", 2], ["R2", "Quarterfinals", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    11: [["R1", "Round 1", 3], ["R2", "Quarterfinals", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    12: [["R1", "Round 1", 4], ["R2", "Quarterfinals", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    13: [["R1", "Round 1", 5], ["R2", "Quarterfinals", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    14: [["R1", "Round 1", 6], ["R2", "Quarterfinals", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    15: [["R1", "Round 1", 7], ["R2", "Quarterfinals", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
    16: [["R1", "Round 1", 8], ["R2", "Quarterfinals", 4], ["SF", "Semifinals", 2], ["F", "Final", 1]],
  };
  for (let n = 2; n <= 16; n++) {
    const want = TABLE[n];
    const rows = wizardRounds(n).map((r) => [r.label, r.title, r.matchups]);
    eq(rows, want, "FN2", `wizard, ${n} teams: every round with a real game, in order`);
    // The control lists exactly the rounds the generator makes, each with as
    // many matchups as it has real games.
    const gen = buildSingleElimination(teams(n), IDS, noSlots());
    const genRounds = [...new Set([...gen].sort((a, b) => a.game_number - b.game_number).map((g) => g.round))];
    const genRows = genRounds.map((r) => [r, new Set(gen.filter((g) => g.round === r).map((g) => g.game_number)).size]);
    eq(genRows, want.map(([l, , m]) => [l, m]), "FN2", `${n} teams: the generated bracket has exactly those rounds and games`);
    ok(rows.length > 0 && rows[rows.length - 1][1] === "Final", "FN2", `${n} teams: the last row is the Final`);
    if (JSON.stringify(rows) === JSON.stringify(want) && JSON.stringify(genRows) === JSON.stringify(want.map(([l, , m]) => [l, m]))) {
      counters.teamCountsListed++;
    }
  }
  eq(titles(32), ["Round 1", "Round 2", "Quarterfinals", "Semifinals", "Final"], "FN2", "wizard, 32 teams unchanged");

  eq(roundsFromTeamsLine(2),
    "Rounds come from the number of teams (2 teams → Final). Set each round separately — e.g. single games, then a best-of-3 Final.",
    "FN3", "the line under the control, 2 teams");
  eq(roundsFromTeamsLine(8),
    "Rounds come from the number of teams (8 teams → Round 1, Semifinals, Final). Set each round separately — e.g. single games, then a best-of-3 Final.",
    "FN3", "the line under the control, 8 teams");

  // Real generated brackets: every round's name on the tree and list.
  const roundsOf = (g: ReadonlyArray<{ round: string; game_number: number }>) =>
    [...new Set([...g].sort((a, b) => a.game_number - b.game_number).map((x) => x.round))];
  const names = (n: number) => {
    const games = buildSingleElimination(teams(n), IDS, noSlots());
    return roundsOf(games).map((r) => playoffRoundTitle(r, games));
  };
  eq(names(2), ["Final"], "FN4", "tree, 2 teams");
  if (names(2)[0] === "Final") counters.twoTeamFinals++;
  eq(names(3), ["Round 1", "Final"], "FN4", "tree, 3 teams: Round 1 (2 vs 3, seed 1 on a bye), Final");
  eq(names(4), ["Semifinals", "Final"], "FN4", "tree, 4 teams");
  eq(names(6), ["Round 1", "Semifinals", "Final"], "FN4", "tree, 6 teams (byes)");
  eq(names(8), ["Round 1", "Semifinals", "Final"], "FN4", "tree, 8 teams unchanged");
  eq(names(16), ["Round 1", "Round 2", "Semifinals", "Final"], "FN4", "tree, 16 single-game teams: no Quarterfinals, as before");
  const sixteen = buildSingleElimination(teams(16), IDS, noSlots());
  eq(roundsOf(sixteen).map((r) => roundTitle(r, sixteen)), ["Round 1", "Quarterfinals", "Semifinals", "Final"], "FN4", "a series bracket's titles keep Quarterfinals");
  const twoSeries = buildSingleElimination(teams(2), IDS, noSlots(), { R1: 3 });
  eq(seriesName(twoSeries[0], twoSeries), "Final", "FN4", "a 2-team best-of-3 is the Final");

  // The Final's trophy / champion banner follows the same rule.
  const two = buildSingleElimination(teams(2), IDS, noSlots());
  const four = buildSingleElimination(teams(4), IDS, noSlots());
  const eight = buildSingleElimination(teams(8), IDS, noSlots());
  ok(isFinalRound("R1", two), "FN5", "a 2-team bracket's R1 is the Final (champion banner)");
  ok(!isFinalRound("R1", four) && isFinalRound("F", four), "FN5", "4 teams: only F is the Final");
  ok(!isFinalRound("SF", eight) && !isFinalRound("R1", eight), "FN5", "8 teams: neither R1 nor SF is the Final");

  // Print headers.
  const head = (html: string) => [...html.matchAll(/text-transform:uppercase;letter-spacing:0\.6pt;color:#[0-9a-f]+">([^<]+)</g)].map((m) => m[1]);
  eq(head(buildBracketPrintHtml(singleElim(2, 1), "single_elimination", "L", "Majors", "Nov 21, 2026")), ["Final"], "FN6", "print, 2 teams");
  if (head(buildBracketPrintHtml(singleElim(2, 1), "single_elimination", "L", "Majors", "Nov 21, 2026"))[0] === "Final") counters.twoTeamFinals++;
  eq(head(buildBracketPrintHtml(singleElim(4, 3), "single_elimination", "L", "Majors", "Nov 21, 2026")), ["Semifinals", "Final"], "FN6", "print, 4 teams");
  eq(head(buildBracketPrintHtml(singleElim(8, 7), "single_elimination", "L", "Majors", "Nov 21, 2026")), ["Round 1", "Semifinals", "Final"], "FN6", "print, 8 teams unchanged");

  // CSV / schedule print titles.
  const asExport = (g: PrintGame[]) => g.map((x) => ({ ...x, playoff_id: "p1" })) as ExportGame[];
  const csv2 = asExport(singleElim(2, 1));
  eq(exportGameName(csv2[0], csv2, null), "Final", "FN7", "CSV, 2 teams");
  if (exportGameName(csv2[0], csv2, null) === "Final") counters.twoTeamFinals++;
  const csv4 = asExport(singleElim(4, 3));
  eq(roundsOf(csv4).map((r) => exportGameName(csv4.find((x) => x.round === r)!, csv4, null)), ["Semifinals", "Final"], "FN7", "CSV, 4 teams");
  const csv8 = asExport(singleElim(8, 7));
  eq(exportGameName(csv8.find((x) => x.round === "R1")!, csv8, null), "Round 1", "FN7", "CSV, 8 teams unchanged");

  // Public page and feed (they share the row label).
  eq(bracketRoundName("R1", two), "Final", "FN8", "public, 2 teams");
  if (bracketRoundName("R1", two) === "Final") counters.twoTeamFinals++;
  eq(bracketRoundName("R1", four), "Semifinal", "FN8", "public, 4 teams: the first round is a Semifinal");
  eq(bracketRoundName("R1", eight), "Round 1", "FN8", "public, 8 teams unchanged");
  eq(bracketRoundName("SF", eight), "Semifinal", "FN8", "public, 8 teams: SF unchanged");

  // The result modal's sentences name rounds through the bracket.
  const numbering: ResultNumbering = {
    own: gameNumbering(two), nextStage: null, roundName: (r) => playoffRoundTitle(r, two),
  };
  const pv = clearPreviewOutcome({
    committed: false, blocked: false, game_id: "g1", game_number: two[0].game_number, round: "R1",
    home_name: "Expos", away_name: "Bears", home_score: 4, away_score: 2, winner_name: "Expos",
    on_public_schedule: false, removed: null,
  }, null, "g1", numbering);
  eq(pv.ok ? clearConfirm(pv.preview).lines[0] : null, "Game 1 (Final) — Expos 4, Bears 2 (Expos won).", "FN9", "the clear confirm names a 2-team Final");

  // Other formats are untouched.
  const rr = roundRobin(4);
  eq(roundsOf(rr).map((r) => playoffRoundTitle(r, rr)), roundsOf(rr).map((r) => `Round ${r.slice(2)}`), "FN10", "round robin: Round k, no Final");
  const de = doubleElim(8);
  ok(roundsOf(de).every((r) => playoffRoundTitle(r, de) !== "Final" || r === "F"), "FN10", "double elimination: no round renamed Final");
  eq(bracketRoundName(rr[0].round, rr), "Round robin", "FN10", "public round robin unchanged");

  // A best-of-3 Final makes 3 Final games, for every count 2–16 (the Final is
  // stored "R1" in a 2-team bracket); every other round is unchanged.
  for (let n = 2; n <= 16; n++) {
    const last = TABLE[n][TABLE[n].length - 1][0];
    const gen = buildSingleElimination(teams(n), IDS, noSlots(), { [last]: 3 });
    const finals = gen.filter((g) => g.round === last).map((g) => g.series_game ?? 1).sort();
    eq(finals, [1, 2, 3], "FN12", `${n} teams: a best-of-3 Final is Final games 1, 2 and 3`);
    eq(gen.filter((g) => g.round !== last).length, TABLE[n].slice(0, -1).reduce((t, [, , m]) => t + m, 0), "FN12", `${n} teams: the other rounds keep one game per matchup`);
  }

  // A real 3-team bracket with a best-of-3 Final: planned onto the calendar,
  // then played through the advancement twin (series.ts), with an upset.
  const three = withIds(planBracket({ ...mockupInput({ F: 3 }), seeds: teams(3), gamesPerTeamPerDay: 1 }).games);
  eq(three.map((g) => `${g.round}:${g.game_number}.${g.series_game ?? 1} ${g.home_team_id ?? "-"}/${g.away_team_id ?? "-"}`),
    ["R1:2.1 t2/t3", "F:3.1 t1/-", "F:3.2 t1/-", "F:3.3 t1/-"],
    "FN13", "3 teams, best-of-3 Final: 2 vs 3 in Round 1, seed 1 waits in every Final game");
  const when = (id: string) => { const g = three.find((r) => r.id === id)!; return `${g.scheduled_date} ${g.start_time}`; };
  ok(three.every((g) => g.scheduled_date && g.start_time && g.venue_id), "FN13", "every game has a date, a time and a field", JSON.stringify(three.map((g) => when(g.id))));
  ok(when("R1-2-1") < when("F-3-1") && when("F-3-1") < when("F-3-2") && when("F-3-2") < when("F-3-3"), "FN13", "Round 1 first, then Final games 1, 2, 3 in order",
    JSON.stringify(three.map((g) => when(g.id))));
  ok(new Set(three.map((g) => g.scheduled_date)).size === 4, "FN13", "one game per team per day: four different dates", JSON.stringify(three.map((g) => g.scheduled_date)));
  // Round 1: Pirates (3) upset Bears (2).
  result(three, "R1-2-1", 2, 5);
  const adv = seriesAdvanceWrites(three.find((r) => r.id === "R1-2-1")!, "t3", null, three, seedOfPlain);
  ok("writes" in adv, "FN13", "the Round 1 winner moves into the Final", JSON.stringify(adv));
  if ("writes" in adv) applyWrites(three, adv.writes);
  eq(three.filter((g) => g.round === "F").map((g) => `${g.home_team_id}/${g.away_team_id}`), ["t1/t3", "t1/t3", "t1/t3"].map((x, i) => (i === 1 ? "t3/t1" : x)),
    "FN13", "the Final: seed 1 home in games 1 and 3, seed 3 home in game 2");
  // The Final: seed 1 wins game 1, seed 3 game 2, seed 1 game 3.
  for (const [id, home, away] of [["F-3-1", 4, 1], ["F-3-2", 6, 2], ["F-3-3", 3, 2]] as const) {
    const before = JSON.parse(JSON.stringify(three)) as SeriesGame[];
    result(three, id, home, away);
    const change = seriesChange(three.find((r) => r.id === id)!, before, home, away);
    for (const c of change.cancels) three.find((r) => r.id === c.id)!.status = NOT_NEEDED;
  }
  const fin = seriesState(three.filter((g) => g.round === "F"));
  eq([fin.winnerId, fin.wins.get("t1"), fin.wins.get("t3")], ["t1", 2, 1], "FN13", "seed 1 wins the Final 2–1");
  eq(seriesChampionLine(three.filter((g) => g.round === "F"), teamName), "Expos win the Final 2–1", "FN13", "the champion banner");
  if (fin.winnerId === "t1") counters.threeTeamFinalsPlayed++;
  // And decided in two: game 3 is not needed.
  const three2 = withIds(planBracket({ ...mockupInput({ F: 3 }), seeds: teams(3), gamesPerTeamPerDay: 1 }).games);
  result(three2, "R1-2-1", 5, 2);
  const adv2 = seriesAdvanceWrites(three2.find((r) => r.id === "R1-2-1")!, "t2", null, three2, seedOfPlain);
  if ("writes" in adv2) applyWrites(three2, adv2.writes);
  const cancels: string[] = [];
  for (const [id, home, away] of [["F-3-1", 4, 1], ["F-3-2", 1, 3]] as const) {
    const before = JSON.parse(JSON.stringify(three2)) as SeriesGame[];
    result(three2, id, home, away);
    for (const c of seriesChange(three2.find((r) => r.id === id)!, before, home, away).cancels) {
      three2.find((r) => r.id === c.id)!.status = NOT_NEEDED;
      cancels.push(c.id);
    }
  }
  eq(cancels, ["F-3-3"], "FN13", "seed 1 wins games 1 and 2: Final game 3 is not needed");

  // Wiring (source greps — weak by nature).
  const control = readFileSync("src/components/playoffs/steps/series-lengths-control.tsx", "utf8");
  ok(control.includes("{roundsFromTeamsLine(teamCount)}"), "FN11", "the control renders the line");
  ok(control.includes("const rounds = wizardRounds(teamCount);") && control.includes("{rounds.map((r) => {"),
    "FN11", "the control renders one row for EVERY round wizardRounds lists");
  const view = readFileSync("src/components/playoffs/bracket-view.tsx", "utf8");
  const pieces = readFileSync("src/components/playoffs/bracket-pieces.tsx", "utf8");
  ok(pieces.includes("if (!withSeries) return playoffRoundTitle(round, games);")
     && view.includes("roundName={playoffRoundTitle(g.round, games)}")
     && view.includes("isFinalRound(lastRound, games)")
     && view.includes(": playoffRoundTitle(editingGame.round, games)}"), "FN11", "the tree, list, banner and edit modal name rounds by the bracket");
  const modal = readFileSync("src/components/playoffs/enter-result-modal.tsx", "utf8");
  ok(modal.includes("roundName: (round) => playoffRoundTitle(round, allGames)") && modal.includes("isFinalRound(game.round, allGames)"), "FN11", "the result modal names rounds by the bracket");
  const pub = readFileSync("src/lib/public-schedule/view.ts", "utf8");
  ok(pub.includes("${bracketRoundName(p.round, seriesRows("), "FN11", "the public row label uses bracketRoundName");
});

// ─── WZ: Whit's exact flow — Add bracket, 3 teams, Seeding untouched ────────
// Reported 2026-10-20: the Seeding step listed Braves, Mariners, Mets ("1 bye
// in round 1 (seed 1)") and the Dates step's "Games in each round" showed one
// row. Clicked through the REAL wizard on a scratch route (REST faked) on the
// deployed commit and this branch: the control received 3 every time (also
// with Continue before the teams loaded, Back/Next and a format switch), so no
// cause was found in code. This pins the flow: the wizard's data at each step,
// through the real reconcile and round rules, and the wiring each step uses.

section("WZ the Add-bracket flow counts every seeded team", () => {
  const teams3 = [
    { team_id: "tb", team_name: "Braves" },
    { team_id: "tm", team_name: "Mariners" },
    { team_id: "tz", team_name: "Mets" },
  ];
  let data: PlayoffWizardData = { ...DEFAULT_PLAYOFF_DATA };
  const update = (patch: Partial<PlayoffWizardData>) => { data = { ...data, ...patch }; };
  // Division: a new pick resets the seeding (step-division.tsx).
  update({ division_id: "d3", division_name: "Majors", seeding: [], excluded: [] });
  // Format: Single elimination is the default.
  eq(data.format, "single_elimination", "WZ1", "Add bracket starts on single elimination");
  // Dates BEFORE the teams load (Continue clicked during the spinner): no rows,
  // never a misleading single row.
  eq(wizardRounds(data.seeding.length).length, 0, "WZ1", "no teams loaded yet → the control shows no rows");
  // Seeding untouched: the load reconciles the division's teams into the seeding.
  const next = reconcileSeeding(teams3, data.seeding);
  update({ seeding: next.included, excluded: next.excluded });
  eq(data.seeding.map((t) => t.team_name), ["Braves", "Mariners", "Mets"], "WZ1", "Seeding untouched: all three teams are in");
  // Dates: the control is handed data.seeding.length.
  const rows = wizardRounds(data.seeding.length).map((r) => `${r.title}:${r.matchups}`);
  eq(rows, ["Round 1:1", "Final:1"], "WZ1", "Dates: Round 1 (2 vs 3) and Final");
  // Back to Seeding and on again (the step remounts and reconciles again).
  const again = reconcileSeeding(teams3, data.seeding);
  update({ seeding: again.included, excluded: again.excluded });
  eq(wizardRounds(data.seeding.length).length, 2, "WZ1", "Back/Next: still two rows");
  if (rows.length === 2) counters.wizardFlowCounted++;

  // The wiring each step uses (source greps — weak by nature).
  const dates = readFileSync("src/components/playoffs/steps/step-dates.tsx", "utf8");
  ok(dates.includes("<SeriesLengthsControl\n          teamCount={data.seeding.length}"), "WZ2", "Dates hands the control the seeded teams");
  const seedStep = readFileSync("src/components/playoffs/steps/step-seeding.tsx", "utf8");
  ok(seedStep.includes("apply(reconcileSeeding(divisionTeams, data.seeding));")
     && seedStep.includes("update({ seeding: next.included, excluded: next.excluded });"),
    "WZ2", "Seeding writes every loaded team into the wizard's seeding");
  const divStep = readFileSync("src/components/playoffs/steps/step-division.tsx", "utf8");
  ok(divStep.includes("if (div.id === data.division_id) return;") && divStep.includes("seeding: [],"),
    "WZ2", "Division resets the seeding only for a different division");
});

section("IX if-needed table", () => {
  const sql = readFileSync("scripts/sim/playoff-series-sim.sql", "utf8").split("\n");
  const begin = sql.filter((l) => l.trim() === "-- IFNEEDED-TABLE-BEGIN").length;
  const end = sql.filter((l) => l.trim() === "-- IFNEEDED-TABLE-END").length;
  ok(begin === 1 && end === 1, "IX", `the table's markers appear once each (BEGIN ×${begin}, END ×${end})`);
  const from = sql.findIndex((l) => l.trim() === "-- IFNEEDED-TABLE-BEGIN");
  const to = sql.findIndex((l) => l.trim() === "-- IFNEEDED-TABLE-END");
  const ROW = /^\s*\('([A-Z0-9]+)', (\d), (\d), '([ABRx-]+)', (true|false)\),?\s*$/;
  let rowsRun = 0;
  for (const line of from >= 0 && to > from ? sql.slice(from + 1, to) : []) {
    if (!line.trim()) continue;
    const m = ROW.exec(line);
    ok(!!m, "IX", `a table row parses: ${line.trim()}`);
    if (!m) continue;
    const [, id, lenRaw, kRaw, outcomes, expectRaw] = m;
    const length = Number(lenRaw);
    const k = Number(kRaw);
    ok(outcomes.length === length, "IX", `${id}: one outcome per game`);
    // Slot A is game 1's home team; teams alternate home as the planner does.
    const games: SeriesGame[] = [...outcomes].map((c, i) => {
      const gameNo = i + 1;
      const home = gameNo % 2 === 1 ? "ta" : "tb";
      const away = home === "ta" ? "tb" : "ta";
      const winner = c === "A" ? "ta" : c === "B" ? "tb" : null;
      const result = c === "A" || c === "B" || c === "R";
      return {
        id: `${id}-${gameNo}`,
        round: "SF",
        game_number: 5,
        series_game: gameNo,
        home_team_id: home,
        away_team_id: away,
        winner_id: winner,
        status: c === "x" ? NOT_NEEDED : result ? "completed" : "scheduled",
        home_score: result ? (winner === home ? 5 : winner === away ? 2 : 3) : null,
        away_score: result ? (winner === away ? 5 : winner === home ? 2 : 3) : null,
      };
    });
    const got = seriesGameTag(games[k - 1], games) === "if_needed";
    eq(got, expectRaw === "true", "IX", `${id}: best of ${length}, game ${k}, outcomes ${outcomes}`);
    rowsRun++;
  }
  ok(rowsRun >= 20, "IX", `20+ rows run (${rowsRun})`);
  counters.ifNeededTableRows += rowsRun;
});

// ─── PT: playthroughs (the TypeScript twin, end to end) ───────────────────────

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

section("PT playthroughs", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rand = rng(seed);
    const n = 2 + Math.floor(rand() * 15);
    const roundLabels = wizardRounds(n).map((r) => r.label);
    const series: SeriesByRound = {};
    for (const l of roundLabels) {
      const pick = [1, 1, 3, 5, 7][Math.floor(rand() * 5)] as 1 | 3 | 5 | 7;
      if (pick > 1) series[l] = pick;
    }
    const rows = withIds(buildSingleElimination(teams(n).map((t, i) => ({ ...t, team_id: `t${i + 1}` })), IDS, noSlots(), series));
    const tag = `seed ${seed} (${n} teams, ${JSON.stringify(series)})`;
    let guard = 0;
    for (;;) {
      if (++guard > 500) {
        ok(false, "PT", `${tag}: playthrough terminates`);
        break;
      }
      // Every series with both teams and a next game.
      const keys = [...new Set(rows.map((r) => `${r.round}:${r.game_number}`))];
      const ready = keys
        .map((k) => rows.filter((r) => `${r.round}:${r.game_number}` === k))
        .map((gs) => seriesState(gs))
        .filter((s) => s.next && s.next.home_team_id && s.next.away_team_id);
      if (!ready.length) break;
      const s = ready[Math.floor(rand() * ready.length)];
      const game = s.next!;
      const games = seriesGamesOf(game, rows);
      // Order: any later game without a result is refused.
      const later = games.find((g) => (g.series_game ?? 1) > (game.series_game ?? 1) && g.status !== NOT_NEEDED);
      if (later) {
        ok(seriesEnterRefusal(later, rows, teamName) !== null, "PT", `${tag}: a later game is refused before the next one`);
        counters.orderRefusals++;
      }
      ok(seriesEnterRefusal(game, rows, teamName) === null, "PT", `${tag}: the next game takes a result`);
      const homeWins = rand() < 0.5;
      const snapshot = JSON.stringify(rows);
      const before = seriesState(games);
      result(rows, game.id, homeWins ? 5 : 2, homeWins ? 2 : 5);
      const change = seriesChange(game, JSON.parse(snapshot) as SeriesGame[], homeWins ? 5 : 2, homeWins ? 2 : 5);
      if (change.after.winnerId) {
        for (const c of change.cancels) rows.find((r) => r.id === c.id)!.status = NOT_NEEDED;
        const adv = seriesAdvanceWrites(game, change.after.winnerId, before.winnerId, rows, seedOfPlain);
        ok("writes" in adv, "PT", `${tag}: the winner moves on`, JSON.stringify(adv));
        if ("writes" in adv) applyWrites(rows, adv.writes);
        // Now and then: clear the deciding result and put it back.
        if (rand() < 0.3) {
          const undo = seriesClearWrites(game, change.after.winnerId, rows, seedOfPlain);
          if ("writes" in undo && "writes" in adv) {
            applyWrites(rows, undo.writes);
            for (const c of change.cancels) rows.find((r) => r.id === c.id)!.status = "scheduled";
            const g = rows.find((r) => r.id === game.id)!;
            Object.assign(g, { home_score: null, away_score: null, winner_id: null, status: "scheduled" });
            ok(JSON.stringify(rows) === snapshot, "PT", `${tag}: clear puts every row back exactly`);
            counters.clearRoundTrips++;
            // and play it again
            result(rows, game.id, homeWins ? 5 : 2, homeWins ? 2 : 5);
            for (const c of change.cancels) rows.find((r) => r.id === c.id)!.status = NOT_NEEDED;
            applyWrites(rows, adv.writes);
          }
        }
      }
    }
    // Every series decided by exactly winsNeeded wins, the rest not needed.
    const keys = [...new Set(rows.map((r) => `${r.round}:${r.game_number}`))];
    for (const k of keys) {
      const gs = rows.filter((r) => `${r.round}:${r.game_number}` === k);
      const st = seriesState(gs);
      ok(st.winnerId !== null, "PT", `${tag}: ${k} is decided`);
      ok(st.wins.get(st.winnerId ?? "") === winsNeeded(st.length), "PT", `${tag}: ${k} winner has exactly winsNeeded`);
      const resultsN = gs.filter(gameHasResult).length;
      ok(resultsN + gs.filter((g) => g.status === NOT_NEEDED).length === gs.length, "PT", `${tag}: ${k} every game is played or not needed`);
      if (st.length > 1) {
        if (resultsN < st.length) counters.seriesDecidedEarly++;
        else counters.seriesWentFull++;
        // Home: once both teams are known, the higher seed is home in odd games.
        const [a, b] = [gs[0].home_team_id!, gs[0].away_team_id!];
        const top = seedOfPlain(a)! < seedOfPlain(b)! ? a : b;
        ok(gs.every((g) => (((g.series_game ?? 1) % 2 === 1) === (g.home_team_id === top))), "PT", `${tag}: ${k} home alternates by true seed`);
      }
    }
    counters.playthroughs++;
  }
});

// ─── Counters ─────────────────────────────────────────────────────────────────

console.log("");
for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `counter ${k} > 0`, String(v));

console.log(`\n${checks - failures.length}/${checks} checks passed  ${JSON.stringify(counters)}`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

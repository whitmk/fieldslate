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
//   text → S10 confirms → PT playthroughs → counters.
import {
  buildSingleElimination,
  makeSlotPicker,
  planBracket,
  type BracketIds,
  type GameInsert,
  type PlanInput,
} from "../../src/lib/playoffs/bracket-plan";
import { emptySlotLabel, gameLabel, gameNumbering } from "../../src/lib/playoffs/bracket-labels";
import { seriesName } from "../../src/lib/playoffs/series-names";
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
import type { SeededTeam } from "../../src/components/playoffs/playoff-wizard-types";

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

// Harness for two-stage playoffs' shared rules (src/lib/playoffs/two-stage.ts
// + the seed placeholder in bracket-labels.ts) — step 2 of the build,
// 2026-10-19. Pure: drives the real functions and the real planner.
// Run: npm run sim:two-stage   Mutants: npm run sim:two-stage:mutants
//
// Every expected value is a literal written by hand from the approved mockup
// (docs/mockups/two-stage-playoffs.html) or worked out on paper — never
// recomputed with the code under test.
//
// Section order is load-bearing (each mutant must die FIRST at its own tag):
// S setup → P Stage 2 layout → Q Stage 2 daily limit → T both stages → R
// records → U Stage 1 status → Z seeding → C confirm → W wording.
import {
  advanceProblem,
  defaultAdvanceCount,
  initialSeedOrder,
  moveSeed,
  planStage2,
  planTwoStage,
  recordText,
  roundRobinRecords,
  rrGameLabel,
  SEED_SCREEN_LINE,
  seedButtonEnabled,
  seedButtonLabel,
  seedConfirm,
  seedOrderProblem,
  seedWrites,
  stage1ChangedNote,
  stage1Pill,
  stage1Status,
  stage2Byes,
  stage2Line,
  stage2StartedRefusal,
  stageDateProblem,
  twoStageSummaryLine,
  STAGE1_EDIT_AFTER_SEEDING,
  type Stage1Game,
  type Stage2Game,
  type TeamRecord,
} from "../../src/lib/playoffs/two-stage";
import {
  buildSingleElimination,
  makeSlotPicker,
  type BracketIds,
  type PlanSettings,
  type PlanVenue,
  type SlotGridInput,
} from "../../src/lib/playoffs/bracket-plan";
import { emptySlotLabel, slotName } from "../../src/lib/playoffs/bracket-labels";
import type { GameRow } from "../../src/lib/playoffs/advancement";
import { parseAvailability } from "../../src/lib/venues/availability";
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
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try { fn(); } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    failures.push(`[CRASH-${name}] ${msg}`);
    console.error(`  FAIL: [CRASH-${name}] ${msg}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const counters = {
  advanceCountsPlanned: 0,
  byeSeedsSeen: 0,
  dayLimitSkips: 0,
  stage2TbdSeen: 0,
  seedAnywayStatuses: 0,
  undatedNeverPlayed: 0,
  seedWritesChecked: 0,
  recordsChangedNamed: 0,
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SETTINGS: PlanSettings = { durationMin: 120, bufferMin: 30, durationDefaulted: false, bufferDefaulted: false };
const IDS1: BracketIds = { playoffId: "p1", leagueId: "l1", divisionId: "d1" };
const IDS2: BracketIds = { playoffId: "p2", leagueId: "l1", divisionId: "d1" };
function field(id: string): PlanVenue {
  const av: Record<string, { start: string; end: string }> = {};
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) av[d] = { start: "08:00", end: "22:00" };
  return { id, name: id, availability: parseAvailability(av) };
}
function grid(start: string, end: string, fields = 2): SlotGridInput {
  return {
    startDate: start, endDate: end, playingDays: ["Sa", "Su"],
    dayWindows: { Sa: { start: "09:00", end: "17:00" }, Su: { start: "09:00", end: "17:00" } },
    venues: Array.from({ length: fields }, (_, i) => field(`v${i + 1}`)),
    durationMin: SETTINGS.durationMin, bufferMin: SETTINGS.bufferMin,
  };
}
// The mockup's Majors: 7 teams in, top 6 advance.
const T = (id: string, name: string): SeededTeam => ({ team_id: id, team_name: name });
const MAJORS = [T("royals", "Royals"), T("expos", "Expos"), T("giants", "Giants"), T("bears", "Bears"),
  T("pirates", "Pirates"), T("lions", "Lions"), T("mets", "Mets")];
const SEEDED = ["expos", "bears", "lions", "mets", "pirates", "royals", "giants"]
  .map((id) => MAJORS.find((t) => t.team_id === id)!);
const nameOf = (id: string | null) => MAJORS.find((t) => t.team_id === id)?.team_name ?? "?";
const stage2 = (advance: number, g = grid("2026-11-14", "2026-12-13"), perDay?: 1 | 2) =>
  planStage2({ advance, ids: IDS2, grid: g, settings: SETTINGS, divisionName: "Majors", gamesPerTeamPerDay: perDay });
const withIds = (games: Stage2Game[]) => games.map((g) => ({ ...g, id: `s2g${g.game_number}` }));
const dates = (games: { scheduled_date: string | null }[]) => new Set(games.filter((g) => g.scheduled_date).map((g) => g.scheduled_date)).size;

// ─── S: setup ────────────────────────────────────────────────────────────────

section("S1 default advancing", () => {
  ok(defaultAdvanceCount(7) === 4 && defaultAdvanceCount(12) === 4, "S1", "default is 4");
  ok(defaultAdvanceCount(3) === 3 && defaultAdvanceCount(2) === 2, "S1", "fewer than 4 teams → every team");
});

section("S2 advancing range", () => {
  ok(advanceProblem(7, 8) === "Only 7 teams are in, so at most 7 can advance.", "S2", "more than the teams in is refused", String(advanceProblem(7, 8)));
  ok(advanceProblem(7, 1) === "At least 2 teams have to advance to the bracket.", "S2", "fewer than 2 is refused");
  ok(advanceProblem(7, 2.5) !== null, "S2", "a fraction is refused");
  ok(advanceProblem(7, 7) === null && advanceProblem(7, 2) === null, "S2", "2 to 7 of 7 are allowed");
});

section("S3 byes", () => {
  ok(stage2Byes(6) === 2 && stage2Byes(5) === 3 && stage2Byes(3) === 1, "S3", "6 → 2 byes, 5 → 3, 3 → 1");
  ok(stage2Byes(8) === 0 && stage2Byes(2) === 0 && stage2Byes(4) === 0, "S3", "powers of two → no byes");
});

section("S4 summary line", () => {
  const a = twoStageSummaryLine(7, 6);
  ok(a === "7 teams · 21 round-robin games · top 6 advance → 5 bracket games, byes for seeds 1–2", "S4", "the mockup's line, word for word", a);
  ok(twoStageSummaryLine(8, 8) === "8 teams · 28 round-robin games · top 8 advance → 7 bracket games", "S4", "no byes → no bye clause");
  ok(twoStageSummaryLine(4, 3) === "4 teams · 6 round-robin games · top 3 advance → 2 bracket games, a bye for seed 1", "S4", "one bye reads 'a bye for seed 1'");
});

section("S5 stage order", () => {
  const s = stageDateProblem("2026-11-08", "2026-11-07");
  ok(s === "Stage 2 starts Sat, Nov 7, but Stage 1 runs until Sun, Nov 8. The bracket can't start until the round robin is over.", "S5", "the mockup's sentence", String(s));
  ok(stageDateProblem("2026-11-08", "2026-11-08") !== null, "S5", "Stage 2 can't start on Stage 1's last day");
  ok(stageDateProblem("2026-11-08", "2026-11-09") === null, "S5", "the day after is fine");
});

// ─── P: Stage 2 layout ───────────────────────────────────────────────────────

section("P1 no teams", () => {
  for (let a = 2; a <= 16; a++) {
    const games = stage2(a).games;
    counters.advanceCountsPlanned++;
    ok(games.every((g) => g.home_team_id === null && g.away_team_id === null), "P1",
      `top ${a}: Stage 2 rows carry no team`);
    ok(games.length === a - 1, "P1", `top ${a}: ${a - 1} bracket games`, `got ${games.length}`);
  }
});

section("P2 every seed once", () => {
  for (let a = 2; a <= 16; a++) {
    const seeds = stage2(a).games.flatMap((g) => [g.seed_home, g.seed_away]).filter((s): s is number => s !== null).sort((x, y) => x - y);
    ok(eq(seeds, Array.from({ length: a }, (_, i) => i + 1)), "P2", `top ${a}: seeds 1…${a}, each once`, seeds.join(","));
  }
});

section("P3 byes in round 2", () => {
  for (let a = 3; a <= 16; a++) {
    const games = stage2(a).games;
    const byes = stage2Byes(a);
    const later = games.filter((g) => g.round !== "R1").flatMap((g) => [g.seed_home, g.seed_away]).filter((s) => s !== null);
    counters.byeSeedsSeen += later.length;
    ok(eq([...later].sort((x, y) => x! - y!), Array.from({ length: byes }, (_, i) => i + 1)), "P3",
      `top ${a}: seeds 1–${byes} wait in round 2`, later.join(","));
  }
});

section("P5 same layout as a native bracket", () => {
  for (let a = 2; a <= 16; a++) {
    const real = Array.from({ length: a }, (_, i) => T(`t${i + 1}`, `Team ${i + 1}`));
    const native = buildSingleElimination(real, IDS2, makeSlotPicker([], SETTINGS));
    const ours = stage2(a).games;
    const asTeam = (s: number | null) => (s === null ? null : `t${s}`);
    const same = native.length === ours.length && native.every((n, i) =>
      n.round === ours[i].round && n.game_number === ours[i].game_number &&
      n.home_team_id === asTeam(ours[i].seed_home) && n.away_team_id === asTeam(ours[i].seed_away));
    ok(same, "P5", `top ${a}: seed k sits exactly where a native bracket puts seed k`);
  }
});

section("P4 placeholder labels", () => {
  const games = stage2(6).games;
  const rows = games.map((g) => ({ ...g, id: `g${g.game_number}`, winner_id: null })) as (GameRow & Stage2Game)[];
  const byNum = (n: number) => rows.find((r) => r.game_number === n)!;
  ok(emptySlotLabel(byNum(2), "home", rows, "single_elimination") === "Seed 4" && emptySlotLabel(byNum(2), "away", rows, "single_elimination") === "Seed 5",
    "P4", "Game 2 reads Seed 4 vs Seed 5");
  ok(emptySlotLabel(byNum(5), "home", rows, "single_elimination") === "Seed 1" && emptySlotLabel(byNum(5), "away", rows, "single_elimination") === "Winner of Game 2",
    "P4", "Game 5 reads Seed 1 vs Winner of Game 2");
  ok(emptySlotLabel(byNum(7), "home", rows, "single_elimination") === "Winner of Game 5", "P4", "the final reads Winner of Game 5");
  ok(slotName("Mets", byNum(2), "home", rows, "single_elimination") === "Mets", "P4", "a team's name wins over its seed");
  const plain: GameRow = { id: "x", round: "R1", game_number: 1, home_team_id: null, away_team_id: null, winner_id: null };
  ok(emptySlotLabel(plain, "home", [plain], "single_elimination") === "TBD", "P4", "an ordinary bracket's round-1 slot still reads TBD");
});

// ─── Q: Stage 2 daily limit ──────────────────────────────────────────────────
// Top 6 on 2 fields, Sat+Sun 9–5, 120 + 30: one Saturday has 9:00, 11:30 and
// 2:00 — room for every round at once, which the limit must stop.

section("Q1 limit 1", () => {
  const p = stage2(6, undefined, 1);
  counters.dayLimitSkips += p.skippedForDayLimit;
  ok(dates(p.games) === 3 && p.tbdCount === 0, "Q1", "limit 1: round 1, semifinals and final on three different days", `${dates(p.games)} dates`);
  ok(eq(p.games.map((g) => g.scheduled_date), ["2026-11-14", "2026-11-14", "2026-11-15", "2026-11-15", "2026-11-21"]), "Q1",
    "Sat 11/14, Sun 11/15, Sat 11/21", p.games.map((g) => g.scheduled_date).join(","));
});

section("Q2 limit 2", () => {
  const p = stage2(6, undefined, 2);
  ok(eq(p.games.map((g) => g.scheduled_date), ["2026-11-14", "2026-11-14", "2026-11-14", "2026-11-14", "2026-11-15"]), "Q2",
    "limit 2: round 1 and semifinals Saturday, final Sunday", p.games.map((g) => g.scheduled_date).join(","));
});

section("Q0 default", () => {
  const p = stage2(6);
  ok(dates(p.games) === 3, "Q0", "no limit given: 1 a day (decided 2026-10-19)", `${dates(p.games)} dates`);
});

section("Q3 rounds that don't fit", () => {
  const p = stage2(6, grid("2026-11-14", "2026-11-15"), 1);
  counters.stage2TbdSeen += p.tbdCount;
  const final = p.games.find((g) => g.round === "F")!;
  ok(p.tbdCount === 1 && final.scheduled_date === null && final.start_time === null && final.venue_id === null, "Q3",
    "only one weekend, limit 1: the final stays undated (never a second game that day)");
  const w = p.warnings.find((x) => x.includes("could not be placed")) ?? "";
  ok(w.includes("1 of 5 games could not be placed") && w.includes("left unused so that no team plays more than one game in a day"), "Q3",
    "Review's warning names the daily limit", w);
});

// ─── T: both stages ──────────────────────────────────────────────────────────

const twoStage = (over: Partial<Parameters<typeof planTwoStage>[0]> = {}) => planTwoStage({
  teams: MAJORS, advance: 6, ids: { stage1: IDS1, stage2: IDS2 },
  stage1: { grid: grid("2026-10-24", "2026-11-08") },
  stage2: { grid: grid("2026-11-14", "2026-11-15") },
  settings: SETTINGS, divisionName: "Majors", ...over,
});

section("T1 problems", () => {
  const bad = twoStage({ stage2: { grid: grid("2026-11-07", "2026-11-15") } });
  ok(bad.problems.some((p) => p.startsWith("Stage 2 starts Sat, Nov 7")), "T1", "Stage 2 starting before Stage 1 ends is refused", bad.problems.join(" | "));
  const many = twoStage({ advance: 8 });
  ok(many.problems.includes("Only 7 teams are in, so at most 7 can advance."), "T1", "advancing more than the teams in is refused");
  ok(many.stage2.games.length === 6, "T1", "a refused count still plans (clamped to 7) so Review can show it", `got ${many.stage2.games.length}`);
  ok(twoStage().problems.length === 0, "T1", "the mockup's setup has no problems");
});

section("T2 stage 1 uses the round robin's rules", () => {
  const p = twoStage();
  const games = p.stage1.games;
  ok(games.length === 21 && games.every((g) => g.round.startsWith("RR")), "T2", "21 round-robin games");
  const perDay = new Map<string, number>();
  for (const g of games) for (const t of [g.home_team_id, g.away_team_id]) {
    if (!g.scheduled_date) continue;
    perDay.set(`${t}|${g.scheduled_date}`, (perDay.get(`${t}|${g.scheduled_date}`) ?? 0) + 1);
  }
  ok(Math.max(...perDay.values()) === 1, "T2", "default 1 game per team per day");
  const home = MAJORS.map((t) => games.filter((g) => g.home_team_id === t.team_id).length);
  ok(home.every((h) => h === 3), "T2", "7 teams: every team home 3 of 6", home.join(","));
  ok(p.stage2.games.length === 5 && p.stage2.games.every((g) => g.home_team_id === null), "T2", "Stage 2: 5 games, no teams");
});

// ─── R: records ──────────────────────────────────────────────────────────────

const G = (n: number, home: string, away: string, hs: number | null, as: number | null, extra: Partial<Stage1Game> = {}): Stage1Game => ({
  id: `rr${n}`, game_number: n, home_team_id: home, away_team_id: away, home_score: hs, away_score: as,
  winner_id: hs === null || as === null ? null : hs > as ? home : as > hs ? away : null,
  status: hs === null ? "scheduled" : "completed", scheduled_date: "2026-10-24", ...extra,
});
const THREE = [T("t3", "Giants"), T("t1", "Bears"), T("t2", "Expos")];
const THREE_GAMES = [G(1, "t1", "t2", 5, 3), G(2, "t2", "t3", 7, 1), G(3, "t3", "t1", 4, 2)];
const brief = (r: TeamRecord) => `${r.teamName} ${recordText(r)} ${r.runsFor}/${r.runsAgainst} p${r.played}`;

section("R1 records", () => {
  const r = roundRobinRecords(THREE, THREE_GAMES).map(brief);
  ok(eq(r, ["Bears 1-1 7/7 p2", "Expos 1-1 10/6 p2", "Giants 1-1 5/9 p2"]), "R1", "W-L and runs, worked by hand", r.join(" · "));
});

section("R2 A–Z, never by record", () => {
  const r = roundRobinRecords([T("z", "Zebras"), T("b", "Bears")], [G(1, "z", "b", 3, 1)]).map((x) => x.teamName);
  ok(eq(r, ["Bears", "Zebras"]), "R2", "the 0-1 team listed first because B comes before Z", r.join(","));
});

section("R3 unplayed games left out", () => {
  const r = roundRobinRecords(THREE, [...THREE_GAMES, G(4, "t1", "t2", null, null), G(5, "t2", "t3", null, null, { status: "cancelled" })]).map(brief);
  ok(eq(r, ["Bears 1-1 7/7 p2", "Expos 1-1 10/6 p2", "Giants 1-1 5/9 p2"]), "R3", "games with no result change nothing", r.join(" · "));
});

section("R4 a tie is counted, never dropped", () => {
  const r = roundRobinRecords([T("a", "Angels"), T("b", "Bears")], [G(1, "a", "b", 2, 2)]);
  ok(eq(r.map(recordText), ["0-0-1", "0-0-1"]) && r.every((x) => x.played === 1), "R4", "2–2 reads 0-0-1 for both");
});

// ─── U: Stage 1 status → the Seed button ─────────────────────────────────────

const TODAY = "2026-11-10";

section("U1 done", () => {
  const s = stage1Status(THREE_GAMES, TODAY);
  ok(s.kind === "done" && stage1Pill(s) === "Done · 3 of 3" && seedButtonLabel(s) === "Seed Stage 2" && seedButtonEnabled(s), "U1",
    "every result in → Seed Stage 2", stage1Pill(s));
});

section("U2 a game today or later blocks", () => {
  const today = stage1Status([...THREE_GAMES, G(4, "t1", "t2", null, null, { scheduled_date: TODAY })], TODAY);
  ok(today.kind === "in_progress" && !seedButtonEnabled(today), "U2", "a game dated today without a result keeps Stage 1 in progress");
  const later = stage1Status([...THREE_GAMES, G(4, "t1", "t2", null, null, { scheduled_date: "2026-11-14" })], TODAY);
  ok(later.kind === "in_progress" && stage2Line(later).endsWith("1 of 4 still need one."), "U2", "a future game → the reason line counts what's left", stage2Line(later));
});

section("U3 seed anyway: rained out, undated or past", () => {
  const s = stage1Status([...THREE_GAMES,
    G(4, "t1", "t2", null, null, { status: "cancelled", scheduled_date: "2026-11-14" }),
    G(5, "t2", "t3", null, null, { scheduled_date: null }),
    G(6, "t3", "t1", null, null, { scheduled_date: "2026-11-09" })], TODAY);
  if (s.kind === "seed_anyway") {
    counters.seedAnywayStatuses++;
    counters.undatedNeverPlayed += s.neverPlayed.filter((n) => n.reason === "no_date").length;
  }
  ok(s.kind === "seed_anyway" && eq(s.neverPlayed.map((n) => n.reason), ["rained_out", "no_date", "past"]), "U3",
    "a rained-out game (even dated ahead), an undated game and a past game all allow Seed anyway",
    s.kind === "seed_anyway" ? s.neverPlayed.map((n) => n.reason).join(",") : s.kind);
  ok(seedButtonLabel(s) === "Seed anyway" && seedButtonEnabled(s) && stage1Pill(s) === "3 of 6 played · 3 never played", "U3", "the button and pill say so", stage1Pill(s));
  const only = stage1Status([...THREE_GAMES, G(4, "t1", "t2", null, null, { scheduled_date: null })], TODAY);
  ok(only.kind === "seed_anyway", "U3", "an undated game alone allows Seed anyway (approved 2026-10-19)");
});

// ─── Z: seeding ──────────────────────────────────────────────────────────────

section("Z1 starts A–Z", () => {
  ok(eq(initialSeedOrder(MAJORS).map((t) => t.team_name), ["Bears", "Expos", "Giants", "Lions", "Mets", "Pirates", "Royals"]), "Z1", "the Seed screen opens A–Z");
  ok(SEED_SCREEN_LINE(6) === "Teams start in A–Z order. FieldSlate doesn't rank teams — order them by your league's rules. The top 6 go into the bracket.", "Z1", "and says so");
});

section("Z2 up and down", () => {
  const o = initialSeedOrder(MAJORS);
  ok(eq(moveSeed(o, 1, -1).slice(0, 2).map((t) => t.team_name), ["Expos", "Bears"]), "Z2", "▲ moves a team up one");
  ok(eq(moveSeed(o, 0, 1).slice(0, 2).map((t) => t.team_name), ["Expos", "Bears"]), "Z2", "▼ moves a team down one");
  ok(moveSeed(o, 0, -1) === o && moveSeed(o, 6, 1) === o, "Z2", "past either end: unchanged");
});

section("Z3 the order must be the round-robin teams", () => {
  const ids = MAJORS.map((t) => t.team_id);
  ok(seedOrderProblem([...ids].reverse(), ids) === null, "Z3", "any order of exactly those teams is fine");
  // Every team AND a duplicate: the size check alone would let this through.
  ok(seedOrderProblem([...ids, ids[0]], ids) !== null, "Z3", "a duplicate is refused");
  ok(seedOrderProblem(ids.slice(0, 6), ids) !== null, "Z3", "a missing team is refused");
  ok(seedOrderProblem([...ids, "cubs"], ids) !== null, "Z3", "an extra team is refused");
});

section("Z4 writes fill slots in place", () => {
  const games = withIds(stage2(6).games);
  const w = seedWrites(games, SEEDED.map((t) => t.team_id));
  counters.seedWritesChecked += w.length;
  const got = w.map((x) => `G${x.gameId.slice(3)} ${x.field === "home_team_id" ? "home" : "away"} ${nameOf(x.teamId)}`).sort();
  ok(eq(got, ["G2 away Pirates", "G2 home Mets", "G4 away Royals", "G4 home Lions", "G5 home Expos", "G6 home Bears"]), "Z4",
    "Expos and Bears to their bye slots, Mets v Pirates and Lions v Royals in round 1", got.join(" · "));
  ok(!w.some((x) => x.teamId === "giants"), "Z4", "the 7th team is written nowhere");
});

// ─── C: confirm ──────────────────────────────────────────────────────────────

section("C1 confirm", () => {
  const status = stage1Status(THREE_GAMES, TODAY);
  const c = seedConfirm({ divisionName: "Majors", stage2Games: stage2(6).games, order: SEEDED, advance: 6, status, teamName: nameOf });
  ok(c.title === "Seed the Majors bracket?", "C1", "title");
  ok(eq(c.lines, [
    "Expos (1) — bye to Game 5",
    "Bears (2) — bye to Game 6",
    "Game 2: Mets (4) vs Pirates (5) · Sat 11/14, 9:00 AM",
    "Game 4: Lions (3) vs Royals (6) · Sat 11/14, 9:00 AM",
  ]), "C1", "the mockup's lines, word for word", c.lines.join(" | "));
  ok(c.notAdvancing === "Not advancing: Giants." && c.unplayed === null && c.button === "Seed Stage 2", "C1", "who doesn't advance; no unplayed block");
});

section("C2 confirm, seeded anyway", () => {
  const games = [...THREE_GAMES.map((g) => ({ ...g })),
    { ...G(8, "mets", "giants", null, null), status: "cancelled" },
    { ...G(17, "lions", "royals", null, null), scheduled_date: null }];
  const status = stage1Status(games, TODAY);
  const c = seedConfirm({ divisionName: "Majors", stage2Games: stage2(6).games, order: SEEDED, advance: 6, status, teamName: nameOf });
  ok(c.unplayed === "2 round-robin games were never played and have no result: RR Game 8 (Mets vs Giants, rained out) and RR Game 17 (Lions vs Royals, no date). Records leave them out.",
    "C2", "the rained-out AND the undated game are both named", String(c.unplayed));
  ok(c.button === "Seed anyway", "C2", "the button reads Seed anyway");
});

// ─── W: wording ──────────────────────────────────────────────────────────────

section("W1 labels and refusals", () => {
  ok(rrGameLabel(13) === "RR Game 13", "W1", "RR Game 13");
  ok(stage2StartedRefusal(2) === "The bracket has started (Game 2 has a result), so round-robin results can't be changed. Clear the bracket's results first, then change this one.", "W1", "the started refusal");
  ok(STAGE1_EDIT_AFTER_SEEDING === "Stage 2 is already seeded. Changing this result won't change the seeds — you'll be asked to re-check them.", "W1", "the edit notice");
});

section("W2 stage 1 changed", () => {
  const rec = (id: string, name: string, w: number, l: number): TeamRecord =>
    ({ teamId: id, teamName: name, wins: w, losses: l, ties: 0, runsFor: 0, runsAgainst: 0, played: w + l });
  const before = [rec("mets", "Mets", 3, 3), rec("royals", "Royals", 2, 4), rec("expos", "Expos", 5, 1)];
  const after = [rec("mets", "Mets", 2, 4), rec("royals", "Royals", 3, 3), rec("expos", "Expos", 5, 1)];
  const n = stage1ChangedNote({ gameNumber: 19, now: "Royals 6, Mets 4", was: "Mets 5, Royals 3", before, after });
  counters.recordsChangedNamed += (n.match(/ are now /g) ?? []).length;
  ok(n === "A round-robin result changed after you seeded the bracket. RR Game 19 is now Royals 6, Mets 4 (was Mets 5, Royals 3). Mets are now 2-4 (were 3-3); Royals are now 3-3 (were 2-4). Check the seeds still match your league's rules.",
    "W2", "the mockup's note — only teams whose record moved are named", n);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n── anti-vacuity counters");
for (const [name, n] of Object.entries(counters)) ok(n > 0, "AV", `counter ${name} fired`, `got ${n}`);

console.log(`\n${checks} checks, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

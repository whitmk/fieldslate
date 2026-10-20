// Harness for removing a team from a playoff bracket before it is built
// (src/lib/playoffs/seeding.ts, the Seeding step, generate-bracket.ts).
// Pure: drives the real seeding rules, the real settings payload and the real
// planner for every format. Run: npm run sim:playoff-exclude
// Mutants: npm run sim:playoff-exclude:mutants (each killed first at its own tag).
//
// Section order is load-bearing: X1–X8 test one rule each and run BEFORE the
// end-to-end section F, which uses several of those rules at once — so a
// mutant to one rule dies at its own X line, not at F.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addTeamBack,
  bracketSummaryLine,
  canExclude,
  excludeTeam,
  MIN_TEAMS_LINE,
  planSeeds,
  reconcileSeeding,
  singleElimByes,
  teamCountProblem,
  type SeedingState,
} from "../../src/lib/playoffs/seeding";
import {
  planBracket,
  type BracketIds,
  type GameInsert,
  type PlanSettings,
  type PlanVenue,
  type SlotGridInput,
  type PlayoffFormatKey,
} from "../../src/lib/playoffs/bracket-plan";
import { settingsPayload } from "../../src/lib/playoffs/bracket-delete";
import { emptySlotLabel } from "../../src/lib/playoffs/bracket-labels";
import type { GameRow } from "../../src/lib/playoffs/advancement";
import { parseAvailability } from "../../src/lib/venues/availability";
import { DEFAULT_PLAYOFF_DATA, type SeededTeam } from "../../src/components/playoffs/playoff-wizard-types";

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
  formatsWithExclusion: 0,
  gamesScannedForExcluded: 0,
  byeTeamsPrePlaced: 0,
  labelsCompared: 0,
  editModeExcludedDerived: 0,
  addedBackSeeded: 0,
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const IDS: BracketIds = { playoffId: "p1", leagueId: "l1", divisionId: "d1" };
const SETTINGS: PlanSettings = { durationMin: 90, bufferMin: 30, durationDefaulted: false, bufferDefaulted: false };
const NAMES = ["Angels", "Bears", "Cubs", "Dodgers", "Expos", "Giants", "Mets", "Padres", "Reds", "Twins"];
function division(n: number): SeededTeam[] {
  return NAMES.slice(0, n).map((name, i) => ({ team_id: `t${i + 1}`, team_name: name }));
}
const ids = (ts: SeededTeam[]) => ts.map((t) => t.team_id);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function openVenue(id: string): PlanVenue {
  const av: Record<string, { start: string; end: string }> = {};
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) av[d] = { start: "08:00", end: "22:00" };
  return { id, name: id, availability: parseAvailability(av) };
}
const GRID: SlotGridInput = {
  startDate: "2026-11-07", endDate: "2027-01-09",
  playingDays: ["Sa"], dayWindows: { Sa: { start: "09:00", end: "21:00" } },
  venues: [openVenue("v1"), openVenue("v2")],
  durationMin: 90, bufferMin: 30,
};
function plan(format: PlayoffFormatKey, seeds: SeededTeam[]): GameInsert[] {
  return planBracket({ format, seeds, ids: IDS, grid: GRID, settings: SETTINGS, divisionName: "Majors" }).games;
}
const asRow = (g: GameInsert): GameRow => ({
  id: `g${g.game_number}`, round: g.round, game_number: g.game_number,
  home_team_id: g.home_team_id, away_team_id: g.away_team_id, winner_id: null,
});
function teamsIn(games: GameInsert[]): Set<string> {
  const s = new Set<string>();
  for (const g of games) {
    if (g.home_team_id) s.add(g.home_team_id);
    if (g.away_team_id) s.add(g.away_team_id);
  }
  return s;
}

// ─── X1: Remove ──────────────────────────────────────────────────────────────

section("X1 remove", () => {
  const start = reconcileSeeding(division(6), []);
  const s = excludeTeam(start, "t3");
  ok(!ids(s.included).includes("t3"), "X1", "a removed team leaves the seed list");
  ok(same(ids(s.excluded), ["t3"]), "X1", "a removed team is listed as not in this bracket");
  ok(same(ids(s.included), ["t1", "t2", "t4", "t5", "t6"]), "X1", "everyone else keeps their order (each team below moves up a seed)");
  ok(excludeTeam(s, "t3") === s, "X1", "removing a team that is already out changes nothing");
  const two = excludeTeam(s, "t6");
  ok(same(ids(two.excluded), ["t3", "t6"]), "X1", "the removed list is by name");
});

// ─── X2: at least two teams ──────────────────────────────────────────────────

section("X2 minimum", () => {
  let s: SeedingState = reconcileSeeding(division(4), []);
  ok(canExclude(s), "X2", "with 4 teams in, Remove is allowed");
  s = excludeTeam(s, "t1");
  s = excludeTeam(s, "t2");
  ok(s.included.length === 2 && !canExclude(s), "X2", "with 2 teams in, Remove is refused");
  const after = excludeTeam(s, "t3");
  ok(after === s && after.included.length === 2, "X2", "a refused Remove changes nothing", `got ${after.included.length}`);
  ok(MIN_TEAMS_LINE === "A bracket needs at least 2 teams.", "X2", "the refusal sentence");
  ok(!canExclude(reconcileSeeding(division(2), [])), "X2", "a 2-team division can't remove anyone");
});

// ─── X3: Add back ────────────────────────────────────────────────────────────

section("X3 add back", () => {
  let s = reconcileSeeding(division(6), []);
  s = excludeTeam(s, "t2");
  s = excludeTeam(s, "t5");
  s = addTeamBack(s, "t2");
  ok(same(ids(s.included), ["t1", "t3", "t4", "t6", "t2"]), "X3", "a team added back is the lowest seed", ids(s.included).join(","));
  ok(same(ids(s.excluded), ["t5"]), "X3", "it leaves the removed list");
  ok(addTeamBack(s, "t2") === s, "X3", "adding back a team already in changes nothing");
});

// ─── X4: Edit setup re-derives who was removed ───────────────────────────────

section("X4 reconcile", () => {
  const div = division(8);
  const fresh = reconcileSeeding(div, []);
  ok(same(ids(fresh.included), ids(div)) && fresh.excluded.length === 0, "X4", "a new bracket starts with every team in");
  const saved: SeededTeam[] = [div[4], div[0], div[7], div[1], div[5], div[2]]; // custom order, t4 and t7 left out
  const s = reconcileSeeding(div, saved);
  ok(same(ids(s.included), ids(saved)), "X4", "Edit setup keeps the saved seed order");
  ok(same(ids(s.excluded), ["t4", "t7"]), "X4", "Edit setup shows the division's other teams as not in this bracket", ids(s.excluded).join(","));
  if (s.excluded.length === 2) counters.editModeExcludedDerived++;
  const later = [...div, { team_id: "t9", team_name: "Reds" }];
  const s2 = reconcileSeeding(later, saved);
  ok(ids(s2.excluded).includes("t9") && !ids(s2.included).includes("t9"), "X4", "a team added to the division later starts out of the bracket");
});

// ─── X5: what is saved ───────────────────────────────────────────────────────

section("X5 payload", () => {
  let s = reconcileSeeding(division(6), []);
  s = excludeTeam(s, "t4");
  const data = { ...DEFAULT_PLAYOFF_DATA, division_id: "d1", seeding: s.included, excluded: s.excluded };
  const p = settingsPayload(data) as Record<string, unknown>;
  ok(same(ids(p.seeding as SeededTeam[]), ["t1", "t2", "t3", "t5", "t6"]), "X5", "the saved seeding holds the included teams only");
  ok(!("excluded" in p), "X5", "the removed list is never saved");
});

// ─── X6: the planner gets the included teams only ────────────────────────────

section("X6 plan seeds", () => {
  const div = division(6);
  // A stale seeding list that still holds a removed team.
  const seeds = planSeeds(div, [div[2]]);
  ok(!ids(seeds).includes("t3") && seeds.length === 5, "X6", "a team marked removed never reaches the planner, even from a stale seed list");
  ok(same(ids(planSeeds(div, [])), ids(div)), "X6", "nothing removed → the seed list as is");
});

// ─── X7: byes and the summary line ───────────────────────────────────────────

section("X7 byes", () => {
  ok(singleElimByes(8) === 0 && singleElimByes(6) === 2 && singleElimByes(5) === 3 && singleElimByes(2) === 0, "X7", "byes = next power of two minus the teams in");
  ok(bracketSummaryLine("single_elimination", 6) === "6 teams in this bracket · 2 byes in round 1 (seeds 1–2)", "X7", "single elimination summary names the byes",
    bracketSummaryLine("single_elimination", 6));
  ok(bracketSummaryLine("single_elimination", 8) === "8 teams in this bracket", "X7", "no byes → no bye line");
  ok(bracketSummaryLine("single_elimination", 7) === "7 teams in this bracket · 1 bye in round 1 (seed 1)", "X7", "one bye");
  ok(bracketSummaryLine("round_robin", 5) === "5 teams in this bracket · 10 games", "X7", "round robin summary counts games");
  ok(bracketSummaryLine("double_elimination", 4) === "4 teams in this bracket", "X7", "double elimination summary");
});

// ─── X8: the format must fit the teams that are in ───────────────────────────

section("X8 team count", () => {
  ok(teamCountProblem("double_elimination", 4) === null && teamCountProblem("double_elimination", 8) === null, "X8", "double elimination with 4 or 8 in is fine");
  const six = teamCountProblem("double_elimination", 6);
  ok(six !== null && six.includes("this bracket has 6"), "X8", "double elimination with 6 in is refused, counting the teams IN the bracket", String(six));
  ok(teamCountProblem("single_elimination", 6) === null && teamCountProblem("round_robin", 3) === null, "X8", "single elimination and round robin take any count from 2");
  ok(teamCountProblem("single_elimination", 1) === "Need at least 2 teams to generate a bracket.", "X8", "fewer than 2 is refused");
});

// ─── F: end to end, every format ─────────────────────────────────────────────

function excludedNeverPlays(games: GameInsert[], out: string[], tag: string, label: string) {
  counters.gamesScannedForExcluded += games.length;
  const present = teamsIn(games);
  ok(out.every((id) => !present.has(id)), tag, label, out.filter((id) => present.has(id)).join(","));
}

section("F single elimination", () => {
  // Eight teams; Cubs (t3) and Mets (t7) opt out. Six are seeded 1–6.
  let s = reconcileSeeding(division(8), []);
  s = excludeTeam(s, "t3");
  s = excludeTeam(s, "t7");
  const data = { ...DEFAULT_PLAYOFF_DATA, division_id: "d1", seeding: s.included, excluded: s.excluded };
  const seeds = planSeeds((settingsPayload(data) as { seeding: SeededTeam[] }).seeding, data.excluded);
  const games = plan("single_elimination", seeds);
  counters.formatsWithExclusion++;
  excludedNeverPlays(games, ["t3", "t7"], "F1", "single elimination: a removed team is in no game");
  ok(games.length === 5, "F1", "6 teams → 5 games", `got ${games.length}`);
  const r1 = games.filter((g) => g.round === games[0].round);
  ok(r1.length === 2, "F1", "round 1 has 2 games (2 byes)", `got ${r1.length}`);
  const r2 = games.filter((g) => g.round !== games[0].round && (g.home_team_id || g.away_team_id));
  const byeTeams = r2.flatMap((g) => [g.home_team_id, g.away_team_id]).filter(Boolean) as string[];
  counters.byeTeamsPrePlaced += byeTeams.length;
  ok(same([...byeTeams].sort(), [seeds[0].team_id, seeds[1].team_id].sort()), "F1", "the byes go to the top two INCLUDED seeds", byeTeams.join(","));

  // Same shape and the same "Winner of Game N" labels as a division that only
  // ever had six teams.
  const native = plan("single_elimination", division(6));
  const seedOf = (list: SeededTeam[], id: string | null) => (id ? list.findIndex((t) => t.team_id === id) + 1 : 0);
  const shape = (gs: GameInsert[], list: SeededTeam[]) =>
    gs.map((g) => [g.round, g.game_number, seedOf(list, g.home_team_id), seedOf(list, g.away_team_id)]);
  ok(same(shape(games, seeds), shape(native, division(6))), "F1", "the bracket is laid out exactly like a native 6-team bracket");
  const labels = (gs: GameInsert[]) => {
    const rows = gs.map(asRow);
    return rows.flatMap((r) => (["home", "away"] as const).map((side) => emptySlotLabel(r, side, rows, "single_elimination")));
  };
  const a = labels(games);
  const b = labels(native);
  counters.labelsCompared += a.filter((l) => l.startsWith("Winner of Game")).length;
  ok(same(a, b), "F1", "\"Winner of Game N\" labels match the native 6-team bracket");

  // Add Mets back: they come in as seed 7 and play.
  const back = addTeamBack(s, "t7");
  const games7 = plan("single_elimination", planSeeds(back.included, back.excluded));
  ok(teamsIn(games7).has("t7") && !teamsIn(games7).has("t3"), "F1", "a team added back plays; the one still out doesn't");
  const t7Game = games7.find((g) => g.home_team_id === "t7" || g.away_team_id === "t7");
  if (t7Game) counters.addedBackSeeded++;
  ok(!!t7Game && (t7Game.home_team_id === seeds[1].team_id || t7Game.away_team_id === seeds[1].team_id), "F1", "as seed 7 it meets seed 2 in round 1");
});

section("F round robin", () => {
  let s = reconcileSeeding(division(7), []);
  s = excludeTeam(s, "t1");
  const seeds = planSeeds(s.included, s.excluded);
  const games = plan("round_robin", seeds);
  counters.formatsWithExclusion++;
  excludedNeverPlays(games, ["t1"], "F2", "round robin: a removed team is in no game");
  ok(games.length === 15, "F2", "6 teams → 15 games", `got ${games.length}`);
  const pairs = new Set(games.map((g) => [g.home_team_id, g.away_team_id].sort().join("|")));
  ok(pairs.size === 15, "F2", "every pair of included teams meets once");
});

section("F double elimination", () => {
  let s = reconcileSeeding(division(6), []);
  s = excludeTeam(s, "t2");
  s = excludeTeam(s, "t6");
  const seeds = planSeeds(s.included, s.excluded);
  ok(teamCountProblem("double_elimination", seeds.length) === null, "F3", "6 teams minus 2 → 4, which double elimination supports");
  const games = plan("double_elimination", seeds);
  counters.formatsWithExclusion++;
  excludedNeverPlays(games, ["t2", "t6"], "F3", "double elimination: a removed team is in no game");
  const present = teamsIn(games);
  ok(ids(seeds).every((id) => present.has(id)), "F3", "every included team plays");
});

// ─── S: wiring (source greps — weak by nature) ───────────────────────────────

section("S wiring", () => {
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
  const gen = read("src/lib/playoffs/generate-bracket.ts");
  ok(gen.includes("planSeeds(data.seeding, data.excluded)") && gen.includes("teamCountProblem(data.format, seeds.length)"), "S1",
    "generate plans from the included teams and refuses with the shared sentence");
  const div = read("src/components/playoffs/steps/step-division.tsx");
  ok(div.includes("if (div.id === data.division_id) return;"), "S2", "re-picking the chosen division doesn't wipe the seeding");
  const step = read("src/components/playoffs/steps/step-seeding.tsx");
  ok(step.includes("apply(excludeTeam(state, team.team_id))") && step.includes("disabled={!removable}") && step.includes("apply(addTeamBack(state, team.team_id))")
    && step.includes("reconcileSeeding(divisionTeams, data.seeding)"), "S3", "the Seeding step uses the shared rules for Remove, Add back and Edit setup");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n── anti-vacuity counters");
for (const [name, n] of Object.entries(counters)) ok(n > 0, "AV", `counter ${name} fired`, `got ${n}`);
ok(counters.formatsWithExclusion === 3, "AV", "all three formats ran with a team removed");

console.log(`\n${checks} checks, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

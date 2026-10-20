// Mutation pass for round-robin-sim.ts. Each mutant is applied to the REAL
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const PLAN = "src/lib/playoffs/bracket-plan.ts";
const PUSH = `      games.push(gameFromSlot(ids, label, gameNumber++, homeId, awayId, picker.pick(label)));`;

const MUTANTS: Mutant[] = [
  {
    id: "RM1", what: "odd team counts get no bye", file: PLAN,
    find: `  const arr = ids.length % 2 === 0 ? [...ids] : [...ids, "__bye__"];`,
    replace: `  const arr = [...ids];`,
    expect: "R0",
  },
  {
    id: "RM2", what: "every round labelled RR1", file: PLAN,
    find: "    const label = `RR${rIdx + 1}`;",
    replace: `    const label = "RR1";`,
    expect: "N2",
  },
  {
    id: "RM3", what: "a team is put against itself", file: PLAN,
    find: `      if (a !== "__bye__" && b !== "__bye__") round.push([a, b]);`,
    replace: `      if (a !== "__bye__" && b !== "__bye__") round.push([a, a]);`,
    expect: "R2",
  },
  {
    id: "RM4", what: "the second game of a round reuses the first game's home team", file: PLAN,
    find: PUSH,
    replace: `      games.push(gameFromSlot(ids, label, gameNumber++, round.length > 1 && a === round[1][0] ? round[0][0] : homeId, awayId, picker.pick(label)));`,
    expect: "R3",
  },
  {
    id: "RM5", what: "the circle never rotates", file: PLAN,
    find: `    arr.splice(1, 0, arr.pop()!);\n`,
    replace: ``,
    expect: "R1",
  },
  {
    id: "RM6", what: "game numbers don't advance", file: PLAN,
    find: PUSH,
    replace: `      games.push(gameFromSlot(ids, label, gameNumber, homeId, awayId, picker.pick(label)));`,
    expect: "N1",
  },
  {
    id: "RM7", what: "the picker sees one round, so rounds don't wait for each other", file: PLAN,
    find: PUSH,
    replace: `      games.push(gameFromSlot(ids, label, gameNumber++, homeId, awayId, picker.pick("RR")));`,
    expect: "T1",
  },
  {
    id: "RM8", what: "the picker hands out the same slot twice", file: PLAN,
    find: `    cursor++;\n    const endsAt`,
    replace: `    const endsAt`,
    expect: "T2",
  },
  {
    id: "RM9", what: "round-robin slots ask for a feeder game", file: "src/lib/playoffs/bracket-labels.ts",
    find: `  if (format !== "single_elimination") return "TBD";`,
    replace: `  if (format === "double_elimination") return "TBD";`,
    expect: "L1",
  },
  {
    id: "RM10", what: "round-robin results take the browser path", file: "src/lib/playoffs/playoff-result.ts",
    find: `  return format === "double_elimination" ? "browser" : "database";`,
    replace: `  return format === "single_elimination" ? "database" : "browser";`,
    expect: "L3",
  },
  {
    id: "RM11", what: "the tied-score refusal loses its sentence", file: "src/lib/playoffs/playoff-result.ts",
    find: "  tied_score: `${NOTHING} Scores can't be tied — one team must win.`,\n",
    replace: ``,
    expect: "L4",
  },
  {
    id: "RM12", what: "removed teams reach the planner", file: "src/lib/playoffs/seeding.ts",
    find: `  return seeding.filter((t) => !out.has(t.team_id));`,
    replace: `  return out.size >= 0 ? [...seeding, ...excluded] : [];`,
    expect: "X1",
  },
  {
    id: "RM13", what: "home is always the first team of the pair (the old behaviour)", file: PLAN,
    find: `  return d >= 1 && d <= (n - 1) / 2;`,
    replace: `  return d >= 0;`,
    expect: "H1",
  },
  {
    id: "RM14", what: "even counts: the last team is home in every game", file: PLAN,
    find: `    if (ia === last) return ib % 2 === 0;\n    if (ib === last) return ia % 2 === 1;`,
    replace: `    if (ia === last) return true;\n    if (ib === last) return false;`,
    expect: "H2",
  },
  {
    id: "RM15", what: "the daily limit is never applied", file: PLAN,
    find: `        (roundsOnDate.get(slots[cursor].date) ?? 0) >= maxRoundsPerDate`,
    replace: `        (roundsOnDate.get(slots[cursor].date) ?? 0) >= maxRoundsPerDate + 99`,
    expect: "D1",
  },
  {
    id: "RM16", what: "no limit given means 2 a day", file: PLAN,
    find: `export const DEFAULT_GAMES_PER_TEAM_PER_DAY = 1;`,
    replace: `export const DEFAULT_GAMES_PER_TEAM_PER_DAY = 2;`,
    expect: "D0",
  },
  {
    id: "RM17", what: "the warning doesn't say the daily limit left slots unused", file: PLAN,
    find: "${why}${dayWhy} ${",
    replace: "${why} ${",
    expect: "D3",
  },
  {
    id: "RM18", what: "the daily limit is applied to elimination brackets too", file: PLAN,
    find: `    input.format === "round_robin" ||\n    (input.format === "single_elimination" && hasSeries(input.seriesByRound))\n      ? `,
    replace: `    input.format !== "double_elimination"\n      ? `,
    expect: "D4",
  },
];

runMutants({
  sim: "scripts/sim/round-robin-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-19 — run 1 (before the fixes): baseline green (233 checks × 3
// zones), 12/12 KILLED at their own assertion. K1/K2 then pinned the first team
// home in every game and no per-team daily limit.
// 2026-10-19 — run 2 (home/away balance + daily limit approved and built; K1/K2
// replaced by H1/H2 and D0–D4; RM4 re-keyed to the pair's first team because
// homeId is now decided by roundRobinHomeFirst): see below.
//   Run 2a: 17/18 at their own tag; RM18 SURVIVED. Harness fault: D4 compared
//   a plan without the option with a plan with it — under the mutant both got
//   the limit and still agreed — and its fallback "a team plays twice a day"
//   counted EMPTY bracket slots (null) as a team. Fixed: mostGamesInADay skips
//   empty slots, and D4 checks fixed date counts (single elimination 1
//   Saturday, double elimination 2, measured without a limit).
//   Run 2b: baseline green (259 checks × 3 zones), 18/18 KILLED at their own
//   assertion: RM1–RM12 as run 1, RM13 → [H1] RM14 → [H2] RM15 → [D1]
//   RM16 → [D0] RM17 → [D3] RM18 → [D4]. Source restored, green after.
// 2026-10-20 (feat/playoff-series): RM18's find string re-pointed — the per-day
// condition now also covers single elimination with a series round. Same
// mutant (limit applied to elimination brackets); 18/18 killed at their own tag.

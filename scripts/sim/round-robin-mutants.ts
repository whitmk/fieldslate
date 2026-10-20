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
    replace: `      games.push(gameFromSlot(ids, label, gameNumber++, round.length > 1 && homeId === round[1][0] ? round[0][0] : homeId, awayId, picker.pick(label)));`,
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
];

runMutants({
  sim: "scripts/sim/round-robin-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-19 — first run: baseline green (233 checks × 3 zones), 12/12 KILLED
// at their own assertion:
//   RM1 → [R0]  RM2 → [N2]  RM3 → [R2]  RM4 → [R3]  RM5 → [R1]  RM6 → [N1]
//   RM7 → [T1]  RM8 → [T2]  RM9 → [L1]  RM10 → [L3]  RM11 → [L4]  RM12 → [X1]
// Source restored and re-verified green after the pass. K1/K2 pin KNOWN
// behaviour (first team always home; no per-team daily limit) and have no
// mutant on purpose — fixing either is a decided change that flips them.

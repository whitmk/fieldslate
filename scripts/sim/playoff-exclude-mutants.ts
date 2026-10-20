// Mutation pass for playoff-exclude-sim.ts. Each mutant is applied to the REAL
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/playoffs/seeding.ts";

const MUTANTS: Mutant[] = [
  {
    id: "EX1", what: "Remove leaves the team in the seed list", file: LIB,
    find: `    included: state.included.filter((t) => t.team_id !== teamId),\n    excluded: [...state.excluded, team].sort(byName),`,
    replace: `    included: state.included,\n    excluded: [...state.excluded, team].sort(byName),`,
    expect: "X1",
  },
  {
    id: "EX2", what: "Remove allowed down to one team", file: LIB,
    find: `  return state.included.length > MIN_BRACKET_TEAMS;`,
    replace: `  return state.included.length >= MIN_BRACKET_TEAMS;`,
    expect: "X2",
  },
  {
    id: "EX3", what: "Add back makes the team seed 1", file: LIB,
    find: `    included: [...state.included, team],`,
    replace: `    included: [team, ...state.included],`,
    expect: "X3",
  },
  {
    id: "EX4", what: "Edit setup forgets who was removed", file: LIB,
    find: `    excluded: divisionTeams.filter((t) => !seeded.has(t.team_id)).sort(byName),`,
    replace: `    excluded: [],`,
    expect: "X4",
  },
  {
    id: "EX5", what: "the saved seeding carries the removed teams", file: "src/lib/playoffs/bracket-delete.ts",
    find: `    seeding: data.seeding,`,
    replace: `    seeding: [...data.seeding, ...data.excluded],`,
    expect: "X5",
  },
  {
    id: "EX6", what: "the planner gets the seed list unfiltered", file: LIB,
    find: `  return seeding.filter((t) => !out.has(t.team_id));`,
    replace: `  return out.size >= 0 ? [...seeding] : [];`,
    expect: "X6",
  },
  {
    id: "EX7", what: "byes counted from one team too many", file: LIB,
    find: `  return count < MIN_BRACKET_TEAMS ? 0 : bracketSizeFor(count) - count;`,
    replace: `  return count < MIN_BRACKET_TEAMS ? 0 : bracketSizeFor(count + 1) - count;`,
    expect: "X7",
  },
  {
    id: "EX8", what: "double elimination's team count not checked", file: LIB,
    find: `  if (format === "double_elimination" && !DOUBLE_ELIM_SUPPORTED_COUNTS.includes(count)) {`,
    replace: `  if (format === "double_elimination" && !DOUBLE_ELIM_SUPPORTED_COUNTS.includes(count) && false) {`,
    expect: "X8",
  },
  {
    id: "EX9", what: "generate plans from the raw seed list", file: "src/lib/playoffs/generate-bracket.ts",
    find: `  let seeds: SeededTeam[] = planSeeds(data.seeding, data.excluded);`,
    replace: `  let seeds: SeededTeam[] = data.seeding;`,
    expect: "S1",
  },
  {
    id: "EX10", what: "re-picking the division wipes the seeding again", file: "src/components/playoffs/steps/step-division.tsx",
    find: `                  if (div.id === data.division_id) return;\n`,
    replace: ``,
    expect: "S2",
  },
  {
    id: "EX11", what: "Remove is never disabled at the minimum", file: "src/components/playoffs/steps/step-seeding.tsx",
    find: `                  disabled={!removable}`,
    replace: `                  disabled={false}`,
    expect: "S3",
  },
];

runMutants({
  sim: "scripts/sim/playoff-exclude-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-19 — first run: baseline green (55 checks × 3 zones), 11/11 KILLED
// at their own assertion:
//   EX1 → [X1]  EX2 → [X2]  EX3 → [X3]  EX4 → [X4]  EX5 → [X5]  EX6 → [X6]
//   EX7 → [X7]  EX8 → [X8]  EX9 → [S1]  EX10 → [S2]  EX11 → [S3]
// Source restored and re-verified green after the pass.

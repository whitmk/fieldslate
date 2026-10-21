// Mutation pass for practice-plan-rules-sim.ts. Each mutant is applied to the
// REAL source, the sim runs under three zones, the source is restored and
// verified byte-for-byte, and the mutant counts as killed only if the FIRST
// failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const LOAD = "src/lib/practice-plans/load.ts";
const PREFILL = "src/lib/practice-plans/prefill.ts";
const REQUEST = "src/lib/practice-plans/request.ts";
const WORDS = "src/lib/practice-plans/words.ts";

const MUTANTS: Mutant[] = [
  {
    id: "RU1", what: "a version one past the current opens", file: LOAD,
    find: "version > PLAN_INPUT_VERSION) return null;",
    replace: "version > PLAN_INPUT_VERSION + 1) return null;",
    expect: "L2",
  },
  {
    id: "RU2", what: "the input check skipped when opening", file: LOAD,
    find: "  const problem = practicePlanInputProblem(input);",
    replace: "  const problem = null as PlanInputProblem | null;",
    expect: "L3",
  },
  {
    id: "RU3", what: "a season with no teams can be picked", file: PREFILL,
    find: "  const candidates = rows.filter((r) => withTeams.has(r.seasonId)).sort(seasonOrder);",
    replace: "  const candidates = rows.filter(() => true).sort(seasonOrder);",
    expect: "P1",
  },
  {
    id: "RU4", what: "undated seasons first", file: PREFILL,
    find: "    if (a.seasonStart === null) return 1;\n    if (b.seasonStart === null) return -1;",
    replace: "    if (a.seasonStart === null) return -1;\n    if (b.seasonStart === null) return 1;",
    expect: "P2",
  },
  {
    id: "RU5", what: "archived seasons skipped", file: PREFILL,
    find: "  const withTeams = new Set(rows.filter((r) => r.teamCount > 0).map((r) => r.seasonId));",
    replace: "  const withTeams = new Set(rows.filter((r) => r.teamCount > 0 && r.seasonArchivedAt === null).map((r) => r.seasonId));",
    expect: "P3",
  },
  {
    id: "RU6", what: "a start-date tie goes to the OLDEST created", file: PREFILL,
    find: "  const c = time(b.seasonCreatedAt) - time(a.seasonCreatedAt);",
    replace: "  const c = time(a.seasonCreatedAt) - time(b.seasonCreatedAt);",
    expect: "P4",
  },
  {
    id: "RU7", what: "a duplicated name hints the first match", file: PREFILL,
    find: "  if (matches.length !== 1) return null;",
    replace: "  if (matches.length === 0) return null;",
    expect: "H2",
  },
  {
    id: "RU8", what: "a new plan's team count not capped", file: PREFILL,
    find: "    teams: Math.min(Math.max(0, Math.trunc(d.teams)), INPUT_LIMITS.teams.max),",
    replace: "    teams: d.teams,",
    expect: "N2",
  },
  {
    id: "RU9", what: "a lit division with no teams is named", file: REQUEST,
    find: "d.lit === true && divisionIsActive(d)",
    replace: "d.lit === true",
    expect: "T3",
  },
  {
    id: "RU10", what: "the lit line appears with nothing lit", file: WORDS,
    find: '  return names.length ? `On lit fields: ${names.join(", ")}.` : null;',
    replace: '  return `On lit fields: ${names.join(", ")}.`;',
    expect: "T2",
  },
  {
    id: "RU11", what: "the city request drops the lit line", file: REQUEST,
    find: "  return lit ? `${text}\\n\\n${lit}` : text;",
    replace: "  return text;",
    expect: "T4",
  },
];

runMutants({
  sim: "scripts/sim/practice-plan-rules-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

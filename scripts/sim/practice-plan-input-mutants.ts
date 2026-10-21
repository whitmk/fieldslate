// Mutation pass for practice-plan-input-sim.ts. Each mutant is applied to the
// REAL source, the sim runs under three zones, the source is restored and
// verified byte-for-byte, and the mutant counts as killed only if the FIRST
// failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const INPUT = "src/lib/practice-plans/plan-input.ts";
const TABLE = "scripts/sim/practice-plans-sim.sql";
const ROW = "src/components/marketing/practice-calculator/division-row.tsx";

const MUTANTS: Mutant[] = [
  {
    id: "PI1", what: "the TypeScript teams limit moved to 61 (disagrees with 0117)", file: INPUT,
    find: "  teams: { min: 0, max: 60 },",
    replace: "  teams: { min: 0, max: 61 },",
    expect: "XT1",
  },
  {
    id: "PI2", what: "a cityId key no longer refused by name", file: INPUT,
    find: '  if ("cityId" in input) return "city_not_allowed";\n',
    replace: "",
    expect: "XT1",
  },
  {
    id: "PI3", what: "duplicate days allowed", file: INPUT,
    find: "      if (!intIn(x, 0, 6) || seen.has(x)) return \"days\";",
    replace: "      if (!intIn(x, 0, 6)) return \"days\";",
    expect: "XT1",
  },
  {
    id: "PI4", what: "the table loses a limit's just-outside row", file: TABLE,
    find: "  ('teams 61 (outside)', 'div',",
    replace: "  -- ('teams 61 (outside)', 'div',",
    expect: "E-teams-max-out",
  },
  {
    id: "PI5", what: "the calculator's form allows more practices a week than a plan may hold", file: ROW,
    find: 'label="Per week" value={d.perWeek} min={0} max={7}',
    replace: 'label="Per week" value={d.perWeek} min={0} max={8}',
    expect: "L1",
  },
];

runMutants({
  sim: "scripts/sim/practice-plan-input-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// Mutation pass for practice-planner-sim.ts. Each mutant is applied to the
// REAL module source, the sim runs under three zones, the source is restored
// and verified byte-for-byte, and the mutant counts as killed only if the
// FIRST failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const PLAN = "src/lib/practice-planner/plan.ts";
const CONSTANTS = "src/lib/practice-planner/constants.ts";
const SUNSET = "src/lib/practice-planner/sunset.ts";

const MUTANTS: Mutant[] = [
  {
    id: "PP1", what: "same-nights order is calendar order, not Tue/Thu first", file: CONSTANTS,
    find: "export const SAME_NIGHTS_PREFERENCE: DayIndex[] = [1, 3, 0, 2, 4, 5, 6];",
    replace: "export const SAME_NIGHTS_PREFERENCE: DayIndex[] = [0, 1, 2, 3, 4, 5, 6];",
    expect: "F5",
  },
  {
    id: "PP2", what: "teams per field ignored when packing", file: PLAN,
    find: "    const groups = Math.ceil(it.practices / d.teamsPerField);",
    replace: "    const groups = it.practices;",
    expect: "F2",
  },
  {
    id: "PP3", what: "minutes between practices ignored", file: PLAN,
    find: "  const between = Number(input.minutesBetween) || 0;",
    replace: "  const between = 0;",
    expect: "F3",
  },
  {
    id: "PP4", what: "once-a-day-per-team cap removed", file: PLAN,
    find: "          if (per[k] >= d.teams) continue;",
    replace: "          if (per[k] >= Infinity) continue;",
    expect: "F4",
  },
  {
    id: "PP5", what: "DST ignored in sunset", file: SUNSET,
    find: "  let local = UT + city.utcOffset + (city.dst && isUsDst(t) ? 1 : 0);",
    replace: "  let local = UT + city.utcOffset + 0;",
    expect: "S2",
  },
  {
    id: "PP6", what: "fields to request = sum over nights, not the busiest night", file: PLAN,
    find: "  return { fields, peakDay };",
    replace: "  return { fields: nights.reduce((a, r) => a + r.count, 0), peakDay };",
    expect: "F6",
  },
  {
    id: "PP7", what: "divisions not processed fewest-allowed-days first", file: PLAN,
    find: "    .sort((a, b) => normalizeDays(divs[a].days).length - normalizeDays(divs[b].days).length);",
    replace: "    .sort(() => 0);",
    expect: "F7",
  },
  {
    id: "PP8", what: "a practice longer than its window is counted", file: PLAN,
    find: "    if (b.lengthMin > b.end - b.start) {",
    replace: "    if (b.lengthMin > Infinity) {",
    expect: "F8",
  },
  {
    id: "PP9", what: "load tie no longer goes to the day with fewer of this division", file: PLAN,
    find: "            (Math.abs(fieldLoad[k] - fieldLoad[best]) < EPS && per[k] < per[best])",
    replace: "            (Math.abs(fieldLoad[k] - fieldLoad[best]) < EPS && per[k] < -1)",
    expect: "F9",
  },
  {
    id: "PP10", what: "a fall season that loses daylight is reported as fine", file: SUNSET,
    find: "  if (okAtStart) return { kind: \"until\", until: first.until };",
    replace: "  if (okAtStart) return { kind: \"ok\" };",
    expect: "D2",
  },
  {
    id: "PP11", what: "never-in-season is reported as fine", file: SUNSET,
    find: "  if (!runs.length) return { kind: \"never\" };",
    replace: "  if (!runs.length) return { kind: \"ok\" };",
    expect: "D3",
  },
  {
    id: "PP12", what: "packing sort removed (input order)", file: PLAN,
    find: "  blocks.sort((a, b) => a.end - a.start - (b.end - b.start) || a.start - b.start || b.lengthMin - a.lengthMin);",
    replace: "",
    expect: "F10",
  },
];

runMutants({
  sim: "scripts/sim/practice-planner-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// Mutation pass for official-claim-rules-sim.ts (2026-11-09). Each mutant is
// applied to the REAL source (or the shared case table), the sim runs under
// UTC, Los Angeles and Kiritimati, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
//
// CR5 skews the shared table from the TypeScript side: one row's expected
// reason changed in official-signup-sim.sql. The SQL proof's OB1 would fail
// on the same edit — one table, two languages.
import { runMutants, type Mutant } from "./mutant-runner";

const RULES = "src/lib/umpires/claim-rules.ts";
const ENGINE = "src/lib/umpires/auto-assign.ts";
const TABLE = "scripts/sim/official-signup-sim.sql";

const MUTANTS: Mutant[] = [
  {
    id: "CR1", what: "the division rule dropped", file: RULES,
    find: '  if (!i.divisionAllowed) return "division_not_allowed";\n',
    replace: "",
    expect: "T1",
  },
  {
    id: "CR2", what: "a window may end a minute late", file: RULES,
    find: "        startOfDay + i.minutes <= hhmm(w.end_time),",
    replace: "        startOfDay + i.minutes <= hhmm(w.end_time) + 1,",
    expect: "T1",
  },
  {
    id: "CR3", what: "the weekly cap counts every week", file: RULES,
    find: "    if (i.bookings.filter((b) => gameWeekKey(b.start) === week).length >= i.cap) return \"over_weekly_limit\";",
    replace: "    void week;\n    if (i.bookings.length >= i.cap) return \"over_weekly_limit\";",
    expect: "T1",
  },
  {
    id: "CR4", what: "back-to-back games read as overlapping", file: RULES,
    find: "  if (i.bookings.some((b) => wallMinutes(b.start) < end && start < wallMinutes(b.start) + b.minutes)) {",
    replace: "  if (i.bookings.some((b) => wallMinutes(b.start) <= end && start <= wallMinutes(b.start) + b.minutes)) {",
    expect: "T1",
  },
  {
    id: "CR5", what: "the shared table skewed (B16 expects no refusal)", file: TABLE,
    find: "  ('B16', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-05T18:00/90',       '',                              1,    'over_weekly_limit'),",
    replace: "  ('B16', false, true,  '',           false, false, '2026-10-10T09:00', 90, '2026-10-05T18:00/90',       '',                              1,    null),",
    expect: "T1",
  },
  {
    id: "CR6", what: "auto-assign ignores an official's division list", file: ENGINE,
    find: "            divisionAllowed: !allowed || allowed.has(divisionId),",
    replace: "            divisionAllowed: allowed === allowed,",
    expect: "E1",
  },
  {
    id: "CR7", what: "an unreadable division list reads as \"every division\"", file: ENGINE,
    find: "  if (officialDivisionsErr) return unreadable(\"the officials' divisions\");",
    replace: "",
    expect: "E2",
  },
  {
    id: "CR8", what: "rows the database skipped are counted as filled", file: ENGINE,
    find: "    filled = reply.inserted;",
    replace: "    filled = reply.inserted + reply.skipped.length;",
    expect: "W2",
  },
  {
    id: "CR9", what: "a failed write reported as a success", file: ENGINE,
    find: "    if (writeErr || typeof reply?.inserted !== \"number\" || !Array.isArray(reply?.skipped)) {\n      return {\n        success: false,",
    replace: "    if (writeErr || typeof reply?.inserted !== \"number\" || !Array.isArray(reply?.skipped)) {\n      return {\n        success: true,",
    expect: "W3",
  },
];

runMutants({
  sim: "scripts/sim/official-claim-rules-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

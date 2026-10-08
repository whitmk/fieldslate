// Mutation pass for auto-assign-past-sim.ts. Each mutant is applied to the
// REAL engine source, the sim runs (TZ=UTC), the source is restored and
// verified byte-for-byte, and the mutant counts as killed only if the FIRST
// failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const ENGINE = "src/lib/umpires/auto-assign.ts";

const MUTANTS: Mutant[] = [
  {
    id: "AP1", what: "the past-game filter removed", file: ENGINE,
    find: "      if (isBeforeToday(g.scheduled_at, today)) {",
    replace: "      if (false && isBeforeToday(g.scheduled_at, today)) {",
    expect: "P1",
  },
  {
    id: "AP2", what: "today computed in UTC, not the league's timezone", file: ENGINE,
    find: "    today = todayInTimezone(timezone, now);",
    replace: "    today = todayInTimezone(\"UTC\", now);",
    expect: "P2",
  },
  {
    id: "AP3", what: "past games dropped from bookings / weekly load too", file: ENGINE,
    find: "    (r) => r.game && r.game.status !== \"cancelled\",",
    replace: "    (r) => r.game && r.game.status !== \"cancelled\" && !isBeforeToday(r.game.scheduled_at, today),",
    expect: "P3",
  },
  {
    id: "AP4", what: "an unreadable timezone falls back to the UTC date", file: ENGINE,
    find: "    return none(\"Couldn't read your league's timezone, so no officials were assigned.\");",
    replace: "    today = now.toISOString().slice(0, 10);",
    expect: "P5",
  },
];

runMutants({
  sim: "scripts/sim/auto-assign-past-sim.ts",
  timezones: ["UTC"],
  mutants: MUTANTS,
});

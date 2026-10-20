// Mutation pass for feed-cutoff-sim.ts — each mutant must fail FIRST at its own
// assertion (see mutant-runner.ts). TM5/TM6 skew the SHARED table from the
// TypeScript side: the same rows feed the SQL proof, so a skewed row is a
// disagreement between the two languages, caught here.
import { runMutants, type Mutant } from "./mutant-runner";

const DEC = "src/lib/seasons/archive-decision.ts";
const TABLE = "scripts/sim/feed-cutoff-sim.sql";
const MIG = "supabase/migrations/0112_feed_cutoff_last_day.sql";

const MUTANTS: Mutant[] = [
  {
    id: "TM1", what: "the last day ignores regular-season games", file: DEC,
    find: "    if (d > last) last = d;\n  }",
    replace: "    void d;\n  }",
    expect: "LD-C",
  },
  {
    id: "TM2", what: "the last day ignores playoff games", file: DEC,
    find: "  for (const d of playoffDates) if (d !== null && d > last) last = d;",
    replace: "  void playoffDates;",
    expect: "LD-D",
  },
  {
    id: "TM3", what: "no end date no longer means never cut off", file: DEC,
    find: "  if (endDate === null) return null;\n  let last = endDate;",
    replace: "  let last = endDate ?? \"\";",
    expect: "LD-G",
  },
  {
    id: "TM4", what: "the grace is 6 days", file: DEC,
    find: "today <= addDays(lastDay, FEED_GRACE_DAYS)",
    replace: "today <= addDays(lastDay, FEED_GRACE_DAYS - 1)",
    expect: "G1",
  },
  {
    id: "TM5", what: "the shared table says a later game doesn't count (TS and SQL disagree)", file: TABLE,
    find: "  ('C', '2026-10-25', '{2026-10-17,2026-11-01}', '{}', '{}', '2026-11-01'),",
    replace: "  ('C', '2026-10-25', '{2026-10-17,2026-11-01}', '{}', '{}', '2026-10-25'),",
    expect: "LD-C",
  },
  {
    id: "TM6", what: "a second copy of the table's begin marker", file: TABLE,
    find: "-- LASTDAY-TABLE-END\n",
    replace: "-- LASTDAY-TABLE-END\n-- LASTDAY-TABLE-BEGIN\n",
    expect: "XC1",
  },
  {
    id: "TM7", what: "one function left at end_date + 7 in 0112", file: MIG,
    find: "     or (v_end_date is not null and v_today > public.season_last_day(v_league_id) + 7)",
    replace: "     or (v_end_date is not null and v_today > v_end_date + 7)",
    expect: "M1",
  },
  {
    id: "TM8", what: "not-needed playoff dates (0114) count toward the last day", file: DEC,
    find: "  return games.filter((g) => g.status !== NOT_NEEDED).map((g) => g.date);",
    replace: "  return games.map((g) => g.date);",
    expect: "LD-K",
  },
];

runMutants({ sim: "scripts/sim/feed-cutoff-sim.ts", mutants: MUTANTS });

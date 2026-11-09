// Mutation pass for sql-latest-sim.ts — one mutant per rule, each must fail
// FIRST at its own assertion (mutant-runner.ts restores every file).
import { runMutants, type Mutant } from "./mutant-runner";

const R = "scripts/sim/sql-latest.ts";
const MUTANTS: Mutant[] = [
  { id: "SQ1", what: "the FIRST definition wins", file: R, expect: "L1",
    find: "  for (const d of all) latest.set(d.name, d); // later files (and later in a file) win",
    replace: "  for (const d of all) if (!latest.has(d.name)) latest.set(d.name, d);" },
  { id: "SQ2", what: "an old copy is never shadowed", file: R, expect: "L2",
    find: "  if (live.file === file && live.bodyStart === here.bodyStart) return null;",
    replace: "  if (live.name === here.name) return null;" },
  { id: "SQ3", what: "the live copy itself reads as shadowed", file: R, expect: "L3",
    find: "  if (live.file === file && live.bodyStart === here.bodyStart) return null;",
    replace: "" },
  { id: "SQ4", what: "the targets check stops looking for shadowing", file: "scripts/sim/mutant-runner.ts", expect: "L4",
    find: "      const sh = shadowedAt(m.file, src, src.indexOf(m.find));",
    replace: "      const sh = null as { name: string; liveFile: string } | null; void shadowedAt;" },
  { id: "SQ5", what: "the leak fence parses migrations on its own again", file: "scripts/sim/volunteer-leaks-sim.ts", expect: "L5",
    find: "const latest = latestSqlBodies(); // fn → latest body, comments stripped",
    replace: "const latest = new Map<string, string>(latestSqlBodies()); // fn → latest body, comments stripped" },
];

runMutants({ sim: "scripts/sim/sql-latest-sim.ts", mutants: MUTANTS });

// Mutation pass for interleague-resolve-picker-sim.ts — see mutant-runner.ts.
// The "request" purpose's makeup rule (2026-11-02). M1–M9 and RU1–RU6 in the
// sim's MUTATION LOG were applied by hand and stay in the log.
import { runMutants, type Mutant } from "./mutant-runner";

const PICKER = "src/lib/schedule/interleague-resolve-picker.ts";

const MUTANTS: Mutant[] = [
  {
    id: "RQ1", what: "assembly ignores keepMakeup (always strips)", file: PICKER,
    find: "      [venue.id]: ctx.keepMakeup\n",
    replace: "      [venue.id]: false\n",
    expect: "RQ1",
  },
  {
    id: "RQ2", what: "keepsMakeupFlags ignores the status", file: PICKER,
    find: 'return purpose === "request" && status === "cancelled";',
    replace: 'return purpose === "request";',
    expect: "RQ2",
  },
  {
    id: "RQ3", what: "keepsMakeupFlags ignores the purpose", file: PICKER,
    find: 'return purpose === "request" && status === "cancelled";',
    replace: 'return status === "cancelled";',
    expect: "RQ3",
  },
];

runMutants({ sim: "scripts/sim/interleague-resolve-picker-sim.ts", timezones: ["UTC"], mutants: MUTANTS });

/**
 * Records the placement golden for placement-diagnostics-sim.ts's invariance
 * assertion. Prints JSON to stdout.
 *
 * HOW THE GOLDEN WAS PRODUCED (and the only sanctioned way to re-produce it):
 *
 *   git worktree add /tmp/fs-main main
 *   cp scripts/sim/fixtures/placement-fixtures.ts /tmp/fs-main/scripts/sim/fixtures/
 *   cp scripts/sim/placement-golden-record.ts     /tmp/fs-main/scripts/sim/
 *   (cd /tmp/fs-main && TZ=UTC npx tsx scripts/sim/placement-golden-record.ts) \
 *     > scripts/sim/fixtures/placement-golden.json
 *   git worktree remove /tmp/fs-main
 *
 * The point is that the golden comes from the PRE-CHANGE tree. Re-recording it
 * from the current tree would make the invariance assertion tautological — it
 * would prove only that the code agrees with itself. If the invariance
 * assertion goes red, that is a real finding: the diagnostic pass has leaked
 * into placement. Fix the leak; do not re-record.
 *
 * Re-recording is legitimate in exactly one case: a future change deliberately
 * alters placement (a scheduling change, not a reporting one). Then re-record
 * from the tree immediately BEFORE that change, and say so in the commit.
 */

import { planSchedule } from "@/lib/schedule/generate-schedule";
import { goldenFixtures } from "./fixtures/placement-fixtures";

if (process.env.TZ !== "UTC") {
  console.error("Recorder requires TZ=UTC (matches the harness).");
  process.exit(1);
}

const out: Record<string, unknown> = {};
for (const [name, input] of goldenFixtures()) {
  out[name] = planSchedule(input).games;
}
console.log(JSON.stringify(out, null, 2));

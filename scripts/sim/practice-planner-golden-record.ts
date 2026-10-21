// Records the public calculator's golden (see practice-planner-golden.ts).
//
//   RECORD_GOLDEN=1 TZ=UTC npx tsx scripts/sim/practice-planner-golden-record.ts
//
// Recorded 2026-10-21 from the tree BEFORE the in-app planner's module change
// (step 1 of the practice planner build). Re-record ONLY on Whit's decision:
// a red practice-planner-sim section G means the calculator's output changed,
// and the fix is the change, not the golden. Refuses without RECORD_GOLDEN=1.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureGolden } from "./practice-planner-golden";

if (process.env.RECORD_GOLDEN !== "1") {
  console.error("Refusing to record: set RECORD_GOLDEN=1. Re-record only on Whit's decision.");
  process.exit(1);
}
const out = join(process.cwd(), "scripts/sim/fixtures/practice-planner-golden.json");
const golden = captureGolden();
writeFileSync(out, JSON.stringify(golden, null, 1) + "\n");
console.log(`wrote ${out}: ${Object.keys(golden.cases).length} cases, first render ${golden.calculatorFirstRender.length} chars`);

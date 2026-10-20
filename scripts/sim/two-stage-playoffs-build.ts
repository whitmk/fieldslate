// Assembles the 0113 proof: substitutes the LITERAL text of the migration for
// the placeholder in two-stage-playoffs-sim.sql and prints the batch. What
// gets proven is the file that will be applied, never a copy.
//
//   npx tsx scripts/sim/two-stage-playoffs-build.ts > proof.sql
//
// The 0107 and 0108 proofs re-run against 0113: their harness, with 0113 in
// place of their own migration. Production already holds 0107 (as re-created
// by 0112) and 0108, and 0113 re-creates every function those proofs test, so
// the functions they exercise are exactly 0113's.
//
//   npx tsx scripts/sim/two-stage-playoffs-build.ts 0107 > proof-0107.sql
//   npx tsx scripts/sim/two-stage-playoffs-build.ts 0108 > proof-0108.sql
//
// It only reads files and writes to stdout. It never connects to anything.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const m0113 = read("supabase/migrations/0113_two_stage_playoffs.sql");

const TARGETS: Record<string, { harness: string; placeholder: string; migration: string }> = {
  "0113": { harness: "scripts/sim/two-stage-playoffs-sim.sql", placeholder: "-- @@MIGRATION_0113@@", migration: m0113 },
  "0107": {
    harness: "scripts/sim/playoff-bracket-delete-sim.sql",
    placeholder: "-- @@MIGRATION_0107@@",
    migration: m0113,
  },
  "0108": {
    harness: "scripts/sim/playoff-result-sim.sql",
    placeholder: "-- @@MIGRATION_0108@@",
    migration: m0113,
  },
};

const t = TARGETS[process.argv[2] ?? "0113"];
if (!t) {
  console.error("Usage: two-stage-playoffs-build.ts [0113|0107|0108]");
  process.exit(1);
}
const harness = read(t.harness);
const found = harness.split(t.placeholder).length - 1;
if (found !== 1) {
  console.error(`Expected the placeholder exactly once in ${t.harness}, found ${found}.`);
  process.exit(1);
}
process.stdout.write(harness.replace(t.placeholder, () => t.migration));

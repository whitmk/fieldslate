// Assembles the 0114 proof: substitutes the LITERAL text of the migration for
// the placeholder in playoff-series-sim.sql and prints the batch. What gets
// proven is the file that will be applied, never a copy.
//
//   npx tsx scripts/sim/playoff-series-build.ts > proof.sql
//
// The 0105 (public schedule), 0107, 0108, 0112 and 0113 proofs re-run
// against 0114: their harness,
// with 0114 in place of their own migration. Production already holds 0107,
// 0108, 0112 and 0113, and 0114 re-creates every function those proofs test
// except the ones it leaves alone (they keep their live 0113 / 0112 bodies),
// so the functions they exercise are exactly what production will run.
//
//   npx tsx scripts/sim/playoff-series-build.ts 0107 > proof-0107.sql
//   (also 0105, 0108, 0112, 0113)
//
// It only reads files and writes to stdout. It never connects to anything.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const m0114 = read("supabase/migrations/0114_playoff_series.sql");

const TARGETS: Record<string, { harness: string; placeholder: string; quote?: string }> = {
  "0114": { harness: "scripts/sim/playoff-series-sim.sql", placeholder: "-- @@MIGRATION_0114@@" },
  "0105": { harness: "scripts/sim/public-schedule-sim.sql", placeholder: "-- @@MIGRATION_0105@@", quote: "$mig105$" },
  "0107": { harness: "scripts/sim/playoff-bracket-delete-sim.sql", placeholder: "-- @@MIGRATION_0107@@", quote: "$mig107$" },
  "0108": { harness: "scripts/sim/playoff-result-sim.sql", placeholder: "-- @@MIGRATION_0108@@" },
  "0112": { harness: "scripts/sim/feed-cutoff-sim.sql", placeholder: "-- @@MIGRATION_0112@@", quote: "$mig112$" },
  "0113": { harness: "scripts/sim/two-stage-playoffs-sim.sql", placeholder: "-- @@MIGRATION_0113@@" },
};

const t = TARGETS[process.argv[2] ?? "0114"];
if (!t) {
  console.error("Usage: playoff-series-build.ts [0114|0105|0107|0108|0112|0113]");
  process.exit(1);
}
const harness = read(t.harness);
const found = harness.split(t.placeholder).length - 1;
if (found !== 1) {
  console.error(`Expected the placeholder exactly once in ${t.harness}, found ${found}.`);
  process.exit(1);
}
// A harness that runs the migration through `execute $tag$ … $tag$` must not
// meet that tag inside the migration.
if (t.quote && m0114.includes(t.quote)) {
  console.error(`The migration contains ${t.quote}, which would end the harness's quoting early.`);
  process.exit(1);
}
process.stdout.write(harness.replace(t.placeholder, () => m0114));

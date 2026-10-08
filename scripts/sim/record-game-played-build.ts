// Assembles the 0106 proof: substitutes the LITERAL text of the migration for
// the placeholder in record-game-played-sim.sql and prints the batch.
// What gets proven is the file that will be applied, never a copy.
//
//   npx tsx scripts/sim/record-game-played-build.ts > proof.sql
//
// It only reads two files and writes to stdout. It never connects to anything.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const PLACEHOLDER = "-- @@MIGRATION_0106@@";
const QUOTE = "$mig106$";

const harness = readFileSync(join(ROOT, "scripts/sim/record-game-played-sim.sql"), "utf8");
const migration = readFileSync(
  join(ROOT, "supabase/migrations/0106_record_game_played.sql"),
  "utf8",
);

const found = harness.split(PLACEHOLDER).length - 1;
if (found !== 1) {
  console.error(`Expected the placeholder exactly once in the harness, found ${found}.`);
  process.exit(1);
}
if (migration.includes(QUOTE)) {
  console.error(`The migration contains ${QUOTE}, which would end the harness's quoting early.`);
  process.exit(1);
}
if (harness.split(QUOTE).length - 1 !== 2) {
  console.error(`Expected ${QUOTE} exactly twice in the harness.`);
  process.exit(1);
}

process.stdout.write(harness.replace(PLACEHOLDER, () => migration));

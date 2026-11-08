// Assembles the 0119 proof: substitutes the LITERAL text of the migration for
// the placeholder in snack-shack-headcount-sim.sql and prints the batch.
// What gets proven is the file that will be applied, never a copy.
//
//   npx tsx scripts/sim/snack-shack-headcount-build.ts > proof.sql
//   npx tsx scripts/sim/snack-shack-headcount-build.ts --md5
//       prints the md5(prosrc) the run (and the live function after apply)
//       must show, computed from the repo file. Self-checked against 0104's
//       recorded md5 so the method itself is proven.
//
// It only reads files and writes to stdout. It never connects to anything.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const PLACEHOLDER = "-- @@MIGRATION_0119@@";
const QUOTE = "$mig119$";
const MIG = "supabase/migrations/0119_snack_shack_headcount.sql";

/** The body Postgres stores as prosrc: the text between the function's `$$`s. */
function regenerateProsrc(sql: string): string {
  const at = sql.indexOf("create or replace function public.regenerate_snack_shack_shifts(");
  if (at < 0) throw new Error("regenerate_snack_shack_shifts not found");
  const open = sql.indexOf("$$", at);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(open + 2, close);
}
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

const migration = readFileSync(join(ROOT, MIG), "utf8");

if (process.argv.includes("--md5")) {
  const known0104 = "7881278e78eb8a513d0ae678f378f6a2"; // CLAUDE.md, verified live 2026-10-06
  const got0104 = md5(regenerateProsrc(readFileSync(join(ROOT, "supabase/migrations/0104_snack_shack_notes_cash.sql"), "utf8")));
  if (got0104 !== known0104) {
    console.error(`md5 method check FAILED: 0104 computes ${got0104}, recorded ${known0104}.`);
    process.exit(1);
  }
  console.log(`method check: 0104 body → ${got0104} (matches the live record)`);
  console.log(`0119 regenerate_snack_shack_shifts md5(prosrc) = ${md5(regenerateProsrc(migration))}`);
  process.exit(0);
}

const harness = readFileSync(join(ROOT, "scripts/sim/snack-shack-headcount-sim.sql"), "utf8");
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

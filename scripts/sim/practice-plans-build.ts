// Assembles the 0117 proof: substitutes the LITERAL text of the migration for
// the placeholder in practice-plans-sim.sql and prints the batch.
// What gets proven is the file that will be applied, never a copy.
//
//   npx tsx scripts/sim/practice-plans-build.ts > proof.sql
//   npx tsx scripts/sim/practice-plans-build.ts --md5   (what the run must print)
//
// It only reads two files and writes to stdout. It never connects to anything.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const PLACEHOLDER = "-- @@MIGRATION_0117@@";
const QUOTE = "$mig117$";

const harness = readFileSync(join(ROOT, "scripts/sim/practice-plans-sim.sql"), "utf8");
const migration = readFileSync(
  join(ROOT, "supabase/migrations/0117_practice_plans.sql"),
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

const md5 = (t: string) => createHash("md5").update(t, "utf8").digest("hex");

if (process.argv.includes("--md5")) {
  // Each function's stored body (prosrc) is the text between its $$ quotes.
  for (const m of migration.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\nas \$\$([\s\S]*?)\$\$;/g)) {
    console.log(`md5 ${m[1]} ${md5(m[2])}`);
  }
  // The case table as the proof hashes it: label|kind|patch|want, by label in byte order.
  const lines = harness.split("\n");
  const begin = lines.findIndex((l) => l.trim() === "-- PLANINPUT-TABLE-BEGIN");
  const end = lines.findIndex((l) => l.trim() === "-- PLANINPUT-TABLE-END");
  const ROW = /^\s*\('((?:[^']|'')*)', '([a-z]+)', '((?:[^']|'')*)', (null|'([a-z_]+)')\),?\s*$/;
  const rows = lines.slice(begin + 1, end).filter((l) => !l.trim().startsWith("--")).map((l) => {
    const r = ROW.exec(l);
    if (!r) throw new Error(`table line doesn't parse: ${l.slice(0, 80)}`);
    return `${r[1].replace(/''/g, "'")}|${r[2]}|${r[3].replace(/''/g, "'")}|${r[5] ?? ""}`;
  });
  const sorted = rows.slice().sort((a, b) => Buffer.compare(Buffer.from(a.split("|")[0]), Buffer.from(b.split("|")[0])));
  console.log(`table ${rows.length} rows, md5 ${md5(sorted.join("\n"))}`);
  process.exit(0);
}

process.stdout.write(harness.replace(PLACEHOLDER, () => migration));

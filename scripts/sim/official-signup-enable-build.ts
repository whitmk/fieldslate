// Assembles the 0125 proof: puts the LITERAL text of the migration where the
// placeholder is in official-signup-enable-sim.sql and prints the batch. What gets
// proven is the file that will be applied, never a copy.
//
//   npx tsx scripts/sim/official-signup-enable-build.ts > proof.sql
//   npx tsx scripts/sim/official-signup-enable-build.ts --md5
//       every 0125 function's md5(prosrc), computed from the repo file — the
//       values the live catalog must show after the apply.
//
// It only reads two files and writes to stdout. It never connects to anything.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const PLACEHOLDER = "-- @@MIGRATION_0125@@";
const QUOTE = "$mig125$";
const VERIFY = "-- 3. Verify";

const harness = readFileSync(join(ROOT, "scripts/sim/official-signup-enable-sim.sql"), "utf8");
const MIG = readFileSync(join(ROOT, "supabase/migrations/0125_official_signup_enable_fix.sql"), "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (harness.split(PLACEHOLDER).length - 1 !== 1) die("Expected the placeholder exactly once in the harness.");
if (MIG.includes(QUOTE)) die(`The migration contains ${QUOTE}, which would end the harness's quoting early.`);
if (harness.split(QUOTE).length - 1 !== 2) die(`Expected ${QUOTE} exactly twice in the harness.`);
if (MIG.split(VERIFY).length - 1 !== 1) die("0125 must contain the verify marker exactly once.");

if (process.argv[2] === "--md5") {
  const re = /^create or replace function public\.([a-z0-9_]+)\(/gm;
  const seen = new Set<string>();
  const rows: string[] = [];
  for (let m = re.exec(MIG); m; m = re.exec(MIG)) {
    const open = MIG.indexOf("$$", m.index);
    const close = MIG.indexOf("$$", open + 2);
    if (open < 0 || close < 0) die(`no $$ body for ${m[1]}`);
    if (seen.has(m[1])) die(`${m[1]} is defined twice in 0125`);
    seen.add(m[1]);
    rows.push(`${m[1]}=${md5(MIG.slice(open + 2, close))}`);
  }
  console.log(rows.sort().join("\n"));
  process.exit(0);
}

process.stdout.write(harness.replace(PLACEHOLDER, () => MIG));

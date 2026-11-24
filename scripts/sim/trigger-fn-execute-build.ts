// Assembles one case of the 0132 proof: puts the LITERAL text of the migration
// (or, for the mutants e1/e2, a mutated copy) where the placeholder is in that
// case's section of trigger-fn-execute-sim.sql, and prints the batch.
//
//   npx tsx scripts/sim/trigger-fn-execute-build.ts --case a     (a|b|c|d|e1|e2)
//   npx tsx scripts/sim/trigger-fn-execute-build.ts --md5        migration file md5
//
// It only reads two files and writes to stdout. It never connects to anything.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const PLACEHOLDER = "-- @@MIGRATION_0132@@";
const ASSERT_MARK = "-- Assertion:";
const E2_FIND = "fns text[] := array['handle_new_user()','clear_division_posted()'";
const E2_REPLACE = "fns text[] := array['clear_division_posted()'";

const harness = readFileSync(join(ROOT, "scripts/sim/trigger-fn-execute-sim.sql"), "utf8");
const MIG = readFileSync(
  join(ROOT, "supabase/migrations/0132_revoke_public_execute_trigger_functions.sql"),
  "utf8",
);
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
function once(hay: string, needle: string, what: string) {
  if (hay.split(needle).length - 1 !== 1) die(`Expected ${what} exactly once.`);
}

if (process.argv[2] === "--md5") {
  console.log(md5(MIG));
  process.exit(0);
}
if (process.argv[2] !== "--case") die("Usage: --case <a|b|c|d|e1|e2> | --md5");
const name = process.argv[3];
const CASES = ["a", "b", "c", "d", "e1", "e2"];
if (!CASES.includes(name)) die(`Unknown case ${name}.`);

const header = `-- ==== CASE ${name} ====`;
once(harness, header, header);
const start = harness.indexOf(header);
const next = harness.indexOf("-- ==== CASE ", start + header.length);
const section = harness.slice(start, next === -1 ? undefined : next);
once(section, PLACEHOLDER, "the placeholder in this case");

let body = MIG;
once(MIG, ASSERT_MARK, "the assertion marker in 0132");
if (name === "e1") {
  body = MIG.replace(ASSERT_MARK, () => `grant execute on function public.set_updated_at() to anon;\n\n${ASSERT_MARK}`);
}
if (name === "e2") {
  // The array literal appears twice (revoke loop, assertion); mutate the FIRST only.
  if (MIG.split(E2_FIND).length - 1 !== 2) die("Expected the six-function array twice in 0132.");
  body = MIG.replace(E2_FIND, () => E2_REPLACE);
}

console.log(`-- 0132 file md5 ${md5(MIG)}${body === MIG ? "" : `; MUTATED body md5 ${md5(body)}`}`);
// A function replacer: a STRING replacement would turn every "$$" into "$".
const out = section.replace(PLACEHOLDER, () => body);
if (!out.includes(body)) die("The assembled batch does not contain the body verbatim.");
console.log(out);

// Assembles the 0111 proof: substitutes the LITERAL text of migration 0111 for
// one placeholder in season-purchase-sim.sql, and the LITERAL 0071 body of
// process_checkout_event for another (the twin the legacy branch is compared
// against). What gets proven is the file that will be applied, never a copy.
//
//   npx tsx scripts/sim/season-purchase-build.ts > proof.sql
//
// It only reads three files and writes to stdout. It never connects to anything.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const MIG_PLACEHOLDER = "-- @@MIGRATION_0111@@";
const OLD_PLACEHOLDER = "-- @@OLD_PCE_BODY_0071@@";
const MIG_QUOTE = "$mig111$";
const OLD_QUOTE = "$oldpce$";

const harness = readFileSync(join(ROOT, "scripts/sim/season-purchase-sim.sql"), "utf8");
const migration = readFileSync(join(ROOT, "supabase/migrations/0111_season_purchases.sql"), "utf8");
const m0071 = readFileSync(join(ROOT, "supabase/migrations/0071_profiles_pending_promo.sql"), "utf8");

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// The 0071 body: the text between the $$ markers of process_checkout_event.
const fnAt = m0071.indexOf("function public.process_checkout_event");
if (fnAt < 0) fail("process_checkout_event not found in 0071.");
const open = m0071.indexOf("$$", fnAt);
const close = m0071.indexOf("$$", open + 2);
if (open < 0 || close < 0) fail("Could not find the $$ body of process_checkout_event in 0071.");
const oldBody = m0071.slice(open + 2, close);

for (const [ph, label] of [[MIG_PLACEHOLDER, "migration"], [OLD_PLACEHOLDER, "0071 body"]] as const) {
  const n = harness.split(ph).length - 1;
  if (n !== 1) fail(`Expected the ${label} placeholder exactly once in the harness, found ${n}.`);
}
if (migration.includes(MIG_QUOTE)) fail(`The migration contains ${MIG_QUOTE}.`);
if (oldBody.includes(OLD_QUOTE)) fail(`The 0071 body contains ${OLD_QUOTE}.`);
if (harness.split(MIG_QUOTE).length - 1 !== 2) fail(`Expected ${MIG_QUOTE} exactly twice in the harness.`);
if (harness.split(OLD_QUOTE).length - 1 !== 2) fail(`Expected ${OLD_QUOTE} exactly twice in the harness.`);

// The old body goes in with no added whitespace on either side: its md5 is
// pinned against the live pre-0111 function (fb3b7eb4…).
const out = harness
  .replace(`${OLD_QUOTE}\n${OLD_PLACEHOLDER}\n${OLD_QUOTE}`, () => `${OLD_QUOTE}${oldBody}${OLD_QUOTE}`)
  .replace(MIG_PLACEHOLDER, () => migration);
if (out.includes(OLD_PLACEHOLDER) || out.includes(MIG_PLACEHOLDER)) {
  fail("A placeholder survived substitution (the old-body one must sit alone between its two quotes).");
}
process.stdout.write(out);

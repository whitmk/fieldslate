// Assembles the 0122 proofs. What gets proven is the file that will be
// applied, never a copy.
//
//   npx tsx scripts/sim/volunteer-snack-build.ts > proof.sql
//       the 0122 proof (volunteer-snack-sim.sql) with the LITERAL migration
//   npx tsx scripts/sim/volunteer-snack-build.ts regress0119 > proof.sql
//       the 0119 proof (snack-shack-headcount-sim.sql: the 0103 R-series,
//       0104's N-series, 0119's H-series and its 8 mutants) re-run against
//       0122 — 0122 is applied where 0119 was (0119 is live), H1 (0119's
//       apply-time defaults on live rows) is left out, and the expected md5
//       becomes 0122's regenerate body
//   npx tsx scripts/sim/volunteer-snack-build.ts --md5
//       every 0122 function's md5(prosrc), computed from the repo file — the
//       run and the live functions after apply must show the same
//
// It only reads files and writes to stdout. It never connects to anything.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const MIG = readFileSync(join(ROOT, "supabase/migrations/0122_volunteer_snack_shack.sql"), "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** name → prosrc (the text between the function's `$$`s). */
function bodies(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^create or replace function public\.([a-z0-9_]+)\(/gm;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const open = sql.indexOf("$$", m.index);
    const close = sql.indexOf("$$", open + 2);
    if (open < 0 || close < 0) die(`no $$ body for ${m[1]}`);
    if (out.has(m[1])) die(`${m[1]} is defined twice in 0122`);
    out.set(m[1], sql.slice(open + 2, close));
  }
  return out;
}

function substitute(harness: string, placeholder: string, quote: string): string {
  if (harness.split(placeholder).length - 1 !== 1) die(`Expected ${placeholder} exactly once in the harness.`);
  if (MIG.includes(quote)) die(`The migration contains ${quote}, which would end the harness's quoting early.`);
  if (harness.split(quote).length - 1 !== 2) die(`Expected ${quote} exactly twice in the harness.`);
  return harness.replace(placeholder, () => MIG);
}

const mode = process.argv[2] ?? "";
const fns = bodies(MIG);

if (mode === "--md5") {
  // Method check: 0119's regenerate body must reproduce its recorded md5.
  const known0119 = "fd94fb29d2dd64ef659ac52fae736ae8";
  const got0119 = md5(bodies(readFileSync(join(ROOT, "supabase/migrations/0119_snack_shack_headcount.sql"), "utf8"))
    .get("regenerate_snack_shack_shifts") ?? "");
  if (got0119 !== known0119) die(`md5 method check FAILED: 0119 computes ${got0119}, recorded ${known0119}.`);
  console.log(`method check: 0119 regenerate → ${got0119} (matches the live record)`);
  for (const [name, body] of [...fns].sort(([a], [b]) => a.localeCompare(b))) console.log(`${name}=${md5(body)}`);
  process.exit(0);
}

if (mode === "regress0119") {
  let h = readFileSync(join(ROOT, "scripts/sim/snack-shack-headcount-sim.sql"), "utf8");
  const H1 = `  if exists (select 1 from public.snack_shack_settings s where s.id <> fx.snack and s.people_per_shift <> 1)
     or exists (select 1 from public.snack_shack_blocks b where b.snack_shack_id <> fx.snack and b.people_needed is not null) then
    v_fails := array_append(v_fails, 'H1: a pre-existing row is not at the default (settings 1, shifts null)');
  end if;
`;
  if (h.split(H1).length - 1 !== 1) die("regress0119: the H1 block was not found exactly once");
  h = h.replace(H1, "  -- (0122 regression: H1 left out — it checked 0119's apply-time defaults on live rows.)\n");
  const OLD_MD5 = "fd94fb29d2dd64ef659ac52fae736ae8 — build --md5";
  if (h.split(OLD_MD5).length - 1 !== 1) die("regress0119: the expected-md5 line was not found exactly once");
  h = h.replace(OLD_MD5, `${md5(fns.get("regenerate_snack_shack_shifts") ?? "")} — 0122, volunteer-snack-build --md5`);
  h = h.replace(/-- @@MIGRATION_0119@@/, "-- @@MIGRATION_0122@@");
  process.stdout.write(substitute(h, "-- @@MIGRATION_0122@@", "$mig119$"));
  process.exit(0);
}

if (mode !== "") die(`unknown mode ${mode}`);
const harness = readFileSync(join(ROOT, "scripts/sim/volunteer-snack-sim.sql"), "utf8");
process.stdout.write(substitute(harness, "-- @@MIGRATION_0122@@", "$mig122$"));

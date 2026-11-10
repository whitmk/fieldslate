// Assembles the 0129 proof: puts the LITERAL text of the migration where the
// placeholder is in official-busy-sim.sql and prints the batch. What gets
// proven is the file that will be applied, never a copy.
//
//   npx tsx scripts/sim/official-busy-build.ts > proof.sql
//   npx tsx scripts/sim/official-busy-build.ts --md5
//       every 0129 function's md5(prosrc), computed from the repo file — the
//       values the run and the live catalog after apply must show. Also a
//       method check: 0124's official_slot_problem body reproduces the live
//       0124 record (the run prints it before the apply).
//   npx tsx scripts/sim/official-busy-build.ts regress0124 > proof.sql
//       the 0124 proof's assertions (its fixtures and case function,
//       unchanged) run against 0129 — 0124 is live, so 0129 is applied where
//       0124 was. 0129 re-creates official_slot_problem, so the one 0124
//       mutant inside it (MO5, a claim on a started game → OC1) is re-aimed at
//       0129's copy; every other 0124 mutant targets a function 0129 doesn't
//       touch and is not re-run.
//
// It only reads files and writes to stdout. It never connects to anything.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const PLACEHOLDER = "-- @@MIGRATION_0129@@";
const QUOTE = "$mig129$";
const VERIFY = "-- 5. Verify";

const harness = readFileSync(join(ROOT, "scripts/sim/official-busy-sim.sql"), "utf8");
const MIG = readFileSync(join(ROOT, "supabase/migrations/0129_official_busy_rule.sql"), "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** name → prosrc (the text between the function's `$$`s). */
function bodies(sql: string, label: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^create or replace function public\.([a-z0-9_]+)\(/gm;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const open = sql.indexOf("$$", m.index);
    const close = sql.indexOf("$$", open + 2);
    if (open < 0 || close < 0) die(`no $$ body for ${m[1]}`);
    if (out.has(m[1])) die(`${m[1]} is defined twice in ${label}`);
    out.set(m[1], sql.slice(open + 2, close));
  }
  return out;
}

if (harness.split(PLACEHOLDER).length - 1 !== 1) die("Expected the placeholder exactly once in the harness.");
if (MIG.includes(QUOTE)) die(`The migration contains ${QUOTE}, which would end the harness's quoting early.`);
if (harness.split(QUOTE).length - 1 !== 2) die(`Expected ${QUOTE} exactly twice in the harness.`);
if (MIG.split(VERIFY).length - 1 !== 1) die("0129 must contain the verify marker exactly once.");

const mode = process.argv[2] ?? "";

if (mode === "--md5") {
  const old = bodies(readFileSync(join(ROOT, "supabase/migrations/0124_officials_signup.sql"), "utf8"), "0124").get("official_slot_problem");
  if (!old) die("method check: 0124 has no official_slot_problem body");
  console.log(`method check: 0124 official_slot_problem → ${md5(old)}`);
  for (const [name, body] of [...bodies(MIG, "0129")].sort(([a], [b]) => a.localeCompare(b))) console.log(`${name}=${md5(body)}`);
  process.exit(0);
}

if (mode === "regress0124") {
  let h = readFileSync(join(ROOT, "scripts/sim/official-signup-sim.sql"), "utf8");
  const cut = h.indexOf("\ndo $h$");
  if (cut < 0 || h.indexOf("\ndo $h$", cut + 1) >= 0) die("official-signup-sim.sql: expected exactly one \"do $h$\" driver block");
  h = h.slice(0, cut);
  const MO5 = { id: "MO5", expect: "OC1", find: "    if v_start <= public.official_org_now(v_owner) then return 'started'; end if;", repl: "" };
  const n = MIG.split(VERIFY)[0].split(MO5.find).length - 1;
  if (n !== 1) die(`regress0124 MO5: find text matches 0129 ${n} times (want 1)`);
  const lit = (s: string) => `$r$${s}$r$`;
  process.stdout.write(`${h}

-- ── the 0124 proof against 0129 (official-busy-build.ts regress0124) ──
do $h$
declare
  v_body  text := ${QUOTE}
${MIG}
${QUOTE};
  v_nover text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\\n';
  m       record;
begin
  v_nover := split_part(v_body, '${VERIFY}', 1);
  begin
    execute v_body;
    v_res := pg_temp.h124_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\\n';
    raise exception 'HREGROLLBACK';
  exception when others then
    if sqlerrm <> 'HREGROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\\n';
    end if;
  end;
  for m in
    select * from (values
    ('${MO5.id}', '${MO5.expect}', ${lit(MO5.find)}, ${lit(MO5.repl)})
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h124_case();
      raise exception 'HREGCASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'HREGCASE:%' then replace(sqlerrm, 'HREGCASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — the 0124 proof against 0129\\n%', v_out;
end $h$;
`);
  process.exit(0);
}

if (mode !== "") die(`unknown mode ${mode}`);
process.stdout.write(harness.replace(PLACEHOLDER, () => MIG));

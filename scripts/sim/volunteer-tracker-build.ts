// Assembles the 0123 proofs. What gets proven is the file that will be
// applied, never a copy.
//
//   npx tsx scripts/sim/volunteer-tracker-build.ts > proof.sql
//       the 0123 proof (volunteer-tracker-sim.sql) with the LITERAL migration
//   npx tsx scripts/sim/volunteer-tracker-build.ts regress0121 > proof.sql
//   npx tsx scripts/sim/volunteer-tracker-build.ts regress0122 > proof.sql
//       the 0121 / 0122 proof's assertions (its fixtures and case functions,
//       unchanged) run against 0123 — 0121 and 0122 are live, so 0123 is
//       applied where the old migration was. 0123 re-creates the archive wipe,
//       so the old proof's wipe mutant is re-targeted at 0123's wipe (0121
//       MU15 → W1; 0122 gets one for its SW1); every other old mutant
//       targets a function 0123 doesn't touch and is not re-run.
//   npx tsx scripts/sim/volunteer-tracker-build.ts --md5
//       every 0123 function's md5(prosrc), computed from the repo file — the
//       run and the live functions after apply must show the same
//
// It only reads files and writes to stdout. It never connects to anything.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const MIG = readFileSync(join(ROOT, "supabase/migrations/0123_volunteer_tracker.sql"), "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const QUOTE = "$mig123$";

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
    if (out.has(m[1])) die(`${m[1]} is defined twice in 0123`);
    out.set(m[1], sql.slice(open + 2, close));
  }
  return out;
}

if (MIG.includes(QUOTE)) die(`The migration contains ${QUOTE}, which would end the harness's quoting early.`);
if (MIG.split("-- 5. Verify").length - 1 !== 1) die("0123 must contain the verify marker exactly once.");

const mode = process.argv[2] ?? "";
const fns = bodies(MIG);

if (mode === "--md5") {
  // Method check: 0121's wipe body must reproduce the live 0121 record.
  const known0121 = bodies(readFileSync(join(ROOT, "supabase/migrations/0121_volunteer_game_roles.sql"), "utf8"))
    .get("wipe_volunteer_data_on_archive");
  if (!known0121) die("method check: 0121 has no wipe body");
  console.log(`method check: 0121 wipe → ${md5(known0121)}`);
  for (const [name, body] of [...fns].sort(([a], [b]) => a.localeCompare(b))) console.log(`${name}=${md5(body)}`);
  process.exit(0);
}

type Retarget = { id: string; expect: string; find: string; repl: string };
type Patch = { find: string; repl: string; count: number };

function regress(harnessFile: string, caseFn: string, label: string, mutants: Retarget[], prep = "", patches: Patch[] = []): string {
  let h = readFileSync(join(ROOT, harnessFile), "utf8");
  for (const p of patches) {
    const n = h.split(p.find).length - 1;
    if (n !== p.count) die(`${label}: patch text found ${n} times (want ${p.count}): ${p.find}`);
    h = h.split(p.find).join(p.repl);
  }
  const cut = h.indexOf("\ndo $h$");
  if (cut < 0 || h.indexOf("\ndo $h$", cut + 1) >= 0) die(`${harnessFile}: expected exactly one "do $h$" driver block`);
  for (const m of mutants) {
    const n = MIG.split("-- 5. Verify")[0].split(m.find).length - 1;
    if (n !== 1) die(`${label} ${m.id}: find text matches 0123 ${n} times (want 1)`);
  }
  const lit = (s: string) => `$r$${s}$r$`;
  const values = mutants.map((m) => `    ('${m.id}', '${m.expect}', ${lit(m.find)}, ${lit(m.repl)})`).join(",\n");
  return `${h.slice(0, cut)}

-- ── ${label}: this proof's assertions against 0123 (volunteer-tracker-build.ts) ──
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
  v_nover := split_part(v_body, '-- 5. Verify', 1);
  begin
    ${prep}execute v_body;
    v_res := pg_temp.${caseFn}();
    v_out := v_out || 'BASELINE ' || v_res || E'\\n';
    raise exception 'HREGROLLBACK';
  exception when others then
    if sqlerrm <> 'HREGROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\\n';
    end if;
  end;
  for m in
    select * from (values
${values}
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\\n', m.id);
      continue;
    end if;
    begin
      ${prep}execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.${caseFn}();
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
  raise exception E'ROLLED BACK — ${label}\\n%', v_out;
end $h$;
`;
}

if (mode === "regress0121") {
  process.stdout.write(
    regress("scripts/sim/volunteer-claims-sim.sql", "h121_case", "the 0121 proof against 0123", [
      { id: "MU15", expect: "W1", find: "  delete from public.volunteer_claims where season_id = new.id;\n", repl: "" },
    ],
    // The 0121 proof was written before any org had the volunteer switch: its
    // F1 expects the "test" org's switch OFF and its fixture inserts the row.
    // The switch is on there now (2026-11-09), so the row is removed inside
    // the rolled-back run first.
    "delete from public.org_features where owner_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6' and feature = 'volunteers';\n    ",
    // 0122 gave volunteer_claim and volunteer_admin_assign a last
    // `p_block_id uuid DEFAULT NULL` and dropped the old signatures: the
    // proof's privilege checks name them by signature (positional calls
    // still work through the default).
    [
      { find: "public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean)",
        repl: "public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean, uuid)", count: 3 },
      { find: "public.volunteer_admin_assign(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, boolean)",
        repl: "public.volunteer_admin_assign(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, boolean, uuid)", count: 2 },
    ]),
  );
  process.exit(0);
}
if (mode === "regress0122") {
  process.stdout.write(
    regress("scripts/sim/volunteer-snack-sim.sql", "h122_case", "the 0122 proof against 0123", [
      { id: "MSW", expect: "SW1", find: "  delete from public.volunteer_roles where season_id = new.id;\n", repl: "" },
    ]),
  );
  process.exit(0);
}

if (mode !== "") die(`unknown mode ${mode}`);
const harness = readFileSync(join(ROOT, "scripts/sim/volunteer-tracker-sim.sql"), "utf8");
const PLACEHOLDER = "-- @@MIGRATION_0123@@";
if (harness.split(PLACEHOLDER).length - 1 !== 1) die(`Expected ${PLACEHOLDER} exactly once in the harness.`);
if (harness.split(QUOTE).length - 1 !== 2) die(`Expected ${QUOTE} exactly twice in the harness.`);
process.stdout.write(harness.replace(PLACEHOLDER, () => MIG));

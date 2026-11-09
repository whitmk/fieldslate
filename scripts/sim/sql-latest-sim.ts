// sql-latest.ts — the ONE "which migration holds the live function" resolver
// that the leak fence and the mutant-target check use (2026-11-09).
//
//   npm run sim:sql-latest
//   npm run sim:sql-latest:mutants
//
// ASSERTIONS (a mutant must die FIRST at its own tag):
//   L1  the resolver's live file for EVERY function equals the sim's own
//       naive scan (the highest-numbered migration naming it); spot checks:
//       save_volunteer_role → 0122, wipe_volunteer_data_on_archive → 0123
//   L2  a find text inside a re-created function's OLD body is shadowed —
//       the real case: sim:volunteer-leaks VL4 as it stood before
//       2026-11-09, aimed at 0121's save_volunteer_role (0122 re-creates it)
//   L3  the same find text in the LIVE body (0122) is not shadowed; nor is
//       text outside any function body (a grant line)
//   L4  THE PROOF, end to end: a mutants list holding that old VL4, run
//       through mutant-runner in MUTANT_TARGETS_ONLY mode (exactly what
//       `npm run sim:mutant-targets` does) fails with SHADOWED; the re-targeted
//       VL4 (0122) passes
//   L5  wiring (source greps — weak by nature): the leak fence takes its
//       latest bodies from latestSqlBodies() and has no parser of its own;
//       the runner checks shadowing in both modes
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { migrationFiles, shadowedAt, sqlFunctions } from "./sql-latest";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
let checks = 0;
const failures: string[] = [];
function ok(cond: boolean, tag: string, what: string, detail = "") {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${what}${detail ? ` — ${detail}` : ""}`);
}

const M121 = "supabase/migrations/0121_volunteer_game_roles.sql";
const M122 = "supabase/migrations/0122_volunteer_snack_shack.sql";
// The old VL4's find text (sim:volunteer-leaks, before 2026-11-09).
const OLD_VL4 = "    raise exception 'name_taken' using errcode = 'P0001';";

// L1 — against an independent naive scan.
{
  const live = sqlFunctions().latest;
  const naive = new Map<string, string>();
  for (const f of migrationFiles()) {
    for (const m of read(f).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) naive.set(m[1].toLowerCase(), f);
  }
  const wrong = [...naive].filter(([name, f]) => live.get(name)?.file !== f).map(([n]) => n);
  ok(naive.size > 100 && wrong.length === 0, "L1", "the live file of every function is the last migration defining it", wrong.slice(0, 5).join(", "));
  ok(live.get("save_volunteer_role")?.file === M122, "L1", "save_volunteer_role lives in 0122", live.get("save_volunteer_role")?.file ?? "none");
  ok(live.get("wipe_volunteer_data_on_archive")?.file.includes("0123_") === true, "L1", "the archive wipe lives in 0123");
}

// L2 — the old copy is shadowed.
{
  const src = read(M121);
  ok(src.split(OLD_VL4).length - 1 === 1, "L2", "the old VL4 text is still in 0121 exactly once (so the plain check passed it)");
  const sh = shadowedAt(M121, src, src.indexOf(OLD_VL4));
  ok(sh?.name === "save_volunteer_role" && sh.liveFile === M122, "L2", "0121's copy of save_volunteer_role is shadowed by 0122", JSON.stringify(sh));
}

// L3 — the live copy and non-function text are not.
{
  const src = read(M122);
  ok(shadowedAt(M122, src, src.indexOf(OLD_VL4)) === null, "L3", "0122's live body is not shadowed");
  const m123 = migrationFiles().find((f) => f.includes("0123_"))!;
  const s3 = read(m123);
  ok(shadowedAt(m123, s3, s3.indexOf("grant execute on function public.volunteer_tracker(uuid) to authenticated;")) === null, "L3",
    "a grant line outside any function body is not shadowed");
}

// L4 — the end-to-end proof through the real runner.
function targetsOnly(file: string): { status: number; out: string } {
  const code = `
    import { runMutants } from ${JSON.stringify(join(ROOT, "scripts/sim/mutant-runner.ts"))};
    runMutants({ sim: "unused", mutants: [{ id: "VL4", what: "saving a role logs", file: ${JSON.stringify(file)},
      find: ${JSON.stringify(OLD_VL4)}, replace: "", expect: "A1" }] });`;
  const r = spawnSync("npx", ["tsx", "-e", code], { cwd: ROOT, encoding: "utf8", env: { ...process.env, MUTANT_TARGETS_ONLY: "1" } });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
{
  const old = targetsOnly(M121);
  ok(old.status === 1 && /SHADOWED VL4: .*0121.*save_volunteer_role.*0122/.test(old.out) && old.out.includes("1 stale"), "L4",
    "the old VL4 (0121) fails the targets check as SHADOWED", old.out.trim().slice(0, 300));
  const now = targetsOnly(M122);
  ok(now.status === 0 && now.out.includes("0 stale"), "L4", "the re-targeted VL4 (0122) passes", now.out.trim().slice(0, 300));
}

// L5 — wiring.
{
  const fence = read("scripts/sim/volunteer-leaks-sim.ts");
  ok(fence.includes("const latest = latestSqlBodies();") && !/create\\s\+or\\s\+replace\\s\+function/.test(fence), "L5",
    "the leak fence uses the shared resolver and has no parser of its own");
  const runner = read("scripts/sim/mutant-runner.ts");
  ok((runner.match(/shadowedAt\(m\.file, /g) ?? []).length === 2, "L5", "the runner checks shadowing in targets-only AND full runs");
}

if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${failures.length} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`sim:sql-latest — ${checks} checks pass`);

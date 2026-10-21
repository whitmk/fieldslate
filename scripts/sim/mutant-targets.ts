// `npm run sim:mutant-targets` — fails when ANY mutant in ANY
// scripts/sim/*-mutants.ts file has find text that doesn't match its file
// exactly once. Such a mutant is stale: the pass would refuse it (or, worse,
// a later edit could make it mutate the wrong line). Runs before every merge
// to main, alongside tsc and eslint (CLAUDE.md). Fast: no sim is run and no
// source is written — each mutants file is loaded with MUTANT_TARGETS_ONLY=1,
// which makes runMutants (mutant-runner.ts) check its targets and exit.
//
// Why it exists: seven mutants went stale with the playoff-series step 3/4
// commits and reached main unnoticed (found 2026-10-20) — their passes had
// not been re-run, and nothing else looks at a mutant until its pass runs.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const files = readdirSync(join(ROOT, "scripts/sim"))
  .filter((f) => f.endsWith("-mutants.ts"))
  .sort();

let failed = 0;
let mutants = 0;
for (const f of files) {
  const r = spawnSync("npx", ["tsx", `scripts/sim/${f}`], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, MUTANT_TARGETS_ONLY: "1" },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const summary = out.match(/MUTANT-TARGETS (\d+) checked, (\d+) stale/);
  // A file that never reaches runMutants (crashed, or a runner of its own)
  // checked nothing — that is a failure, never a pass.
  if (!summary) {
    console.error(`FAIL ${f}: did not report its targets\n${out.trim().slice(0, 600)}`);
    failed++;
    continue;
  }
  const n = Number(summary[1]);
  mutants += n;
  if (r.status !== 0 || Number(summary[2]) > 0 || n === 0) {
    console.error(`FAIL ${f}: ${summary[0]}`);
    for (const l of out.split("\n").filter((x) => x.includes("STALE"))) console.error(l);
    failed++;
  } else {
    console.log(`ok   ${f}: ${n} mutants`);
  }
}

console.log(`\n${files.length} mutants files, ${mutants} mutants — ${failed ? `${failed} FAILED` : "every target matches exactly once"}`);
process.exit(failed ? 1 : 0);

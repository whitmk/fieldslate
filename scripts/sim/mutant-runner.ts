// Shared mutation runner for the TypeScript sims. Applies each mutant to the
// REAL source, runs the sim, RESTORES the source (always — try/finally, then
// verified byte-for-byte), and requires the FIRST failing assertion to be the
// one the mutant was written for. A red run is not the answer; the right red
// line is.
//
// Prints every failure the sim collected for each mutant, including when the
// mutant makes the code throw — sims record a thrown section as [CRASH-…] and
// carry on, so there is always something to print.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");

export type Mutant = {
  id: string;
  what: string;
  file: string;
  find: string;
  replace: string;
  /** Tag of the assertion that must fail FIRST. */
  expect: string;
};

export function runMutants(opts: {
  sim: string;
  /** TZ values to run the sim under, in order. Default: the host's. */
  timezones?: (string | undefined)[];
  mutants: Mutant[];
}): never {
  const zones = opts.timezones ?? [undefined];

  function runSim(): { code: number; fails: string[] } {
    let code = 0;
    const fails: string[] = [];
    for (const tz of zones) {
      const r = spawnSync("npx", ["tsx", opts.sim], {
        cwd: ROOT,
        encoding: "utf8",
        env: tz ? { ...process.env, TZ: tz } : process.env,
      });
      if ((r.status ?? -1) !== 0) code = r.status ?? -1;
      const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
      for (const l of out.split("\n")) {
        if (l.trimStart().startsWith("FAIL:")) fails.push(`${tz ? `(${tz}) ` : ""}${l.trim()}`);
      }
    }
    return { code, fails };
  }

  let bad = 0;
  const base = runSim();
  if (base.code !== 0) {
    console.error("Baseline is not green — fix that before running mutants.");
    for (const f of base.fails) console.error("  " + f);
    process.exit(1);
  }
  console.log("baseline: green\n");

  for (const m of opts.mutants) {
    const path = join(ROOT, m.file);
    const original = readFileSync(path, "utf8");
    if (original.split(m.find).length !== 2) {
      console.error(`${m.id}: target text not found exactly once in ${m.file} — mutant is stale\n`);
      bad++;
      continue;
    }
    let res: { code: number; fails: string[] };
    try {
      writeFileSync(path, original.replace(m.find, m.replace));
      res = runSim();
    } finally {
      writeFileSync(path, original);
    }
    if (readFileSync(path, "utf8") !== original) {
      console.error(`${m.id}: SOURCE NOT RESTORED — ${m.file}`);
      process.exit(2);
    }
    const first = res.fails[0]?.match(/FAIL: \[([^\]]+)\]/)?.[1] ?? "(none)";
    const killed = res.code !== 0 && first === m.expect;
    if (!killed) bad++;
    console.log(
      `${m.id} ${m.what}\n   ${killed ? "KILLED" : res.code === 0 ? "SURVIVED" : "KILLED AT THE WRONG ASSERTION"}` +
        ` — first failure [${first}], expected [${m.expect}], ${res.fails.length} failure(s) collected:`,
    );
    for (const f of res.fails.slice(0, 12)) console.log(`     ${f.slice(0, 160)}`);
    if (res.fails.length > 12) console.log(`     … and ${res.fails.length - 12} more`);
    console.log("");
  }

  const after = runSim();
  console.log(`after restore: ${after.code === 0 ? "green" : "RED"}`);
  if (after.code !== 0) bad++;
  console.log(bad ? `\n${bad} PROBLEM(S)` : `\nAll ${opts.mutants.length} mutants killed at their own assertion.`);
  process.exit(bad ? 1 : 0);
}

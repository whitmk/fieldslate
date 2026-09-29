// Mutation pass for games-export-sim.ts. Applies each mutant to the REAL
// source, runs the sim, RESTORES the source (always — try/finally, then
// verified byte-for-byte), and requires the FIRST failing assertion to be the
// one the mutant was written for. A red run is not the answer; the right red
// line is.
//
// Prints every failure the sim collected for each mutant, including when the
// mutant makes the code throw.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const NORMALIZE = "src/lib/schedule/export-games.ts";
const GENERIC = "src/lib/schedule/generic-games-export.ts";
const FETCH = "src/lib/schedule/sports-connect-export.ts";

type Mutant = { id: string; what: string; file: string; find: string; replace: string; expect: string };

const MUTANTS: Mutant[] = [
  {
    id: "GE1", what: "pending filter removed (only cancelled excluded)", file: NORMALIZE,
    find: "games.filter((g) => countsAsScheduledGame(g.status))",
    replace: 'games.filter((g) => g.status !== "cancelled")',
    expect: "P1",
  },
  {
    id: "GE2", what: "partner name blanked (away_team only, the old code)", file: NORMALIZE,
    find: 'g.external_team_name?.trim() || (g.away_team?.name ?? "TBD")',
    replace: 'g.away_team?.name ?? ""',
    expect: "I1",
  },
  {
    id: "GE3", what: "is_away swap removed", file: NORMALIZE,
    find: "g.is_away ? [partner, ourTeam] : [ourTeam, partner]",
    replace: "[ourTeam, partner]",
    expect: "I2",
  },
  {
    id: "GE4", what: "partner's field not offered on away games", file: NORMALIZE,
    find: 'partnerFieldName: g.is_away ? g.proposed_venue_name?.trim() ?? "" : "",',
    replace: 'partnerFieldName: "",',
    expect: "I3",
  },
  {
    id: "GE5", what: "generic builder filters on its own (drift)", file: GENERIC,
    find: "normalizeExportGames(games).map((r) =>",
    replace: 'normalizeExportGames(games.filter((g) => g.status !== "completed")).map((r) =>',
    expect: "EQ1",
  },
  {
    id: "GE6", what: "games read error swallowed, empty list returned", file: FETCH,
    find: "    if (error) return { ok: false, error: error.message };\n    return { ok: true, games: (data ?? [])",
    replace: "    if (error) return { ok: true, games: [] };\n    return { ok: true, games: (data ?? [])",
    expect: "E2",
  },
  {
    id: "GE7", what: "generic builder throws (crash reporting)", file: GENERIC,
    find: "r.venueName || r.partnerFieldName,",
    replace: "(r as unknown as { venue: { name: string } }).venue.name,",
    expect: "CRASH-P",
  },
];

function runSim(): { code: number; fails: string[] } {
  const r = spawnSync("npx", ["tsx", "scripts/sim/games-export-sim.ts"], { cwd: ROOT, encoding: "utf8" });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const fails = out.split("\n").filter((l) => l.trimStart().startsWith("FAIL:")).map((l) => l.trim());
  return { code: r.status ?? -1, fails };
}

let bad = 0;
const base = runSim();
if (base.code !== 0) {
  console.error("Baseline is not green — fix that before running mutants.");
  for (const f of base.fails) console.error("  " + f);
  process.exit(1);
}
console.log("baseline: green\n");

for (const m of MUTANTS) {
  const path = join(ROOT, m.file);
  const original = readFileSync(path, "utf8");
  if (original.split(m.find).length !== 2) {
    console.error(`${m.id}: target text not found exactly once in ${m.file} — mutant is stale`);
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
  for (const f of res.fails) console.log(`     ${f.slice(0, 150)}`);
  console.log("");
}

const after = runSim();
console.log(`after restore: ${after.code === 0 ? "green" : "RED"}`);
if (after.code !== 0) bad++;
console.log(bad ? `\n${bad} PROBLEM(S)` : `\nAll ${MUTANTS.length} mutants killed at their own assertion.`);
process.exit(bad ? 1 : 0);

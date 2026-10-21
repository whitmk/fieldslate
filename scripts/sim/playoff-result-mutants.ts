// Mutation pass for playoff-result-sim.ts. Each mutant is applied to the REAL
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
//
// The database-side mutants (membership, plan, the helper's slot skew, double
// elimination allowed, preview commits, a lock gate, the bye team removed,
// round-trip drift, the next game's slot not cleared, status left completed,
// clearing / editing under a played next game, zero-row writes reported as
// success, log skipped, EXECUTE on PUBLIC) live in
// scripts/sim/playoff-result-sim.sql.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/playoffs/playoff-result.ts";

const MUTANTS: Mutant[] = [
  {
    id: "PR1", what: "cross-check skew: advancement.ts writes the other slot", file: "src/lib/playoffs/advancement.ts",
    find: `  return { target, field: pos % 2 === 0 ? "home_team_id" : "away_team_id" };`,
    replace: `  return { target, field: pos % 2 === 0 ? "away_team_id" : "home_team_id" };`,
    expect: "XC1",
  },
  {
    id: "PR2", what: "double elimination routed to the database", file: LIB,
    find: `  return format === "double_elimination" ? "browser" : "database";`,
    replace: `  return "database";`,
    expect: "R1",
  },
  {
    id: "PR3", what: "the result button needs both teams again", file: LIB,
    find: `  return bothTeams || isDone;`,
    replace: `  return bothTeams;`,
    expect: "R3",
  },
  {
    id: "PR4", what: "a refusal key loses its sentence", file: LIB,
    find: "  advancement_mismatch: `${NOTHING} The next game holds a team this game didn't send there, so FieldSlate won't guess which team to remove. ${START_OVER}`,\n",
    replace: "",
    expect: "E1",
  },
  {
    id: "PR5", what: "enter: a committed reply for another game counts as success", file: LIB,
    find: `  if (!r || r.committed !== true || r.game_id !== gameId) return { ok: false, message: UNCONFIRMED };`,
    replace: `  if (!r || r.committed !== true) return { ok: false, message: UNCONFIRMED };`,
    expect: "O1",
  },
  {
    id: "PR6", what: "the blocked reply stops naming the later game", file: LIB,
    find: "  return `${gameLabel(next.gameNumber, next.roundName)} already has a result${score}. Clear that game's result first, ${then}.`;",
    replace: "  return `A later game already has a result${score}. Clear that game's result first, ${then}.`;",
    expect: "O2",
  },
  {
    id: "PR7", what: "a preview that came back committed is accepted", file: LIB,
    find: `  if (!r || r.committed !== false || !preview) {`,
    replace: `  if (!r || !preview) {`,
    expect: "O3",
  },
  {
    id: "PR8", what: "the confirm drops the team being removed", file: LIB,
    find: `  if (p.removed && !series?.lines.length) {\n    const from`,
    replace: `  if (p.removed && false) {\n    const from`,
    expect: "C1",
  },
  {
    id: "PR9", what: "single elimination written from the browser again", file: "src/lib/playoffs/enter-result.ts",
    find: `  if (resultPath(format) === "database") {`,
    replace: `  if (false) {`,
    expect: "S1",
  },
];

runMutants({
  sim: "scripts/sim/playoff-result-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-13 — first run: baseline green (132 checks × 3 zones). PR9 SURVIVED:
// [S1] looked for the rpc call, not the routing condition in front of it, so
// `if (false)` (single elimination sent down the browser path) passed. [S1]
// now pins the guard line; second run 9/9 KILLED at their own assertion:
//   PR1 → [XC1]  PR2 → [R1]  PR3 → [R3]  PR4 → [E1]  PR5 → [O1]
//   PR6 → [O2]   PR7 → [O3]  PR8 → [C1]  PR9 → [S1]
// Source restored and re-verified green after the pass.
// 2026-10-13 (printable bracket) — PR1 repointed: the parity line moved into
// singleElimTarget (advancement.ts) when the target lookup was split out for
// the feeder labels and the print's connectors. Same flip, new line; re-run
// green and PR1 still killed at its own assertion.
// 2026-10-20 — found STALE (target not found exactly once) since the playoff-series
// step 3/4 commits reached main the same day; the pass had not been re-run then.
// PR6 (the round name moved into next.roundName) and PR8 (the condition is now 'p.removed && !series?.lines.length', 0114) re-anchored; PR6 → [O2], PR8 → [C1]; 9/9 KILLED at their own tag. Source restored and re-verified green.

// Mutation pass for bracket-delete-sim.ts. Each mutant is applied to the REAL
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
//
// The database-side mutants (membership, plan, result block, preview commits,
// delete leaves the bracket row, log skipped, delete without insert, EXECUTE
// on PUBLIC, the public count ignoring the lock, the lock gating either) live
// in scripts/sim/playoff-bracket-delete-sim.sql.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/playoffs/bracket-delete.ts";

const MUTANTS: Mutant[] = [
  {
    id: "BD1", what: "parse: an unreadable count read as 0", file: LIB,
    find: `  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;`,
    replace: `  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;`,
    expect: "P2",
  },
  {
    id: "BD2", what: "confirm: an unread preview rendered as zeros", file: LIB,
    find: `  if (!counts) {\n    return { title, lines: [COULDNT_COUNT, last], publicWarning: null };\n  }\n`,
    replace: `  if (!counts) counts = { games: 0, datedGames: 0, gamesWithResults: 0, publicGames: 0 };\n`,
    expect: "Z1",
  },
  {
    id: "BD3", what: "delete confirm drops the results line", file: LIB,
    find: `  if (counts.gamesWithResults > 0) {\n    lines.push(`,
    replace: `  if (counts.gamesWithResults > 0 && false) {\n    lines.push(`,
    expect: "D2",
  },
  {
    id: "BD4", what: "delete confirm drops the public-schedule warning", file: LIB,
    find: `  if (publicGames <= 0) return null;`,
    replace: `  if (publicGames <= 0 || true) return null;`,
    expect: "U1",
  },
  {
    id: "BD5", what: "rebuild review ignores the result block", file: LIB,
    find: `  if (counts.blocked || counts.gamesWithResults > 0) {`,
    replace: `  if (false) {`,
    expect: "R1",
  },
  {
    id: "BD6", what: "a refusal key loses its sentence", file: LIB,
    find: "  venue_not_in_org: `${NOTHING} A field in the bracket isn't one of your fields any more. Check the venues step and try again.`,\n",
    replace: "",
    expect: "E1",
  },
  {
    id: "BD7", what: "an uncommitted reply treated as success", file: LIB,
    find: `  if (!r || r.committed !== true || parsed === null) {`,
    replace: `  if (!r || parsed === null) {`,
    expect: "E5",
  },
  {
    id: "BD8", what: "Add bracket no longer blocked on a division with a bracket", file: LIB,
    find: `  if (!hasBracket) return null;`,
    replace: `  if (!hasBracket || true) return null;`,
    expect: "A1",
  },
  {
    id: "BD9", what: "settings payload carries the division", file: LIB,
    find: `  return {\n    format: data.format,`,
    replace: `  return {\n    division_id: data.division_id,\n    format: data.format,`,
    expect: "L1",
  },
  {
    id: "BD10", what: "rebuild warning silent when the new games leave the public schedule", file: LIB,
    find: `  if (now > 0) {\n    return`,
    replace: `  if (now > 0) {\n    return null; return`,
    expect: "U4",
  },
  {
    id: "BD11", what: "the review step upserts the bracket row again", file: "src/components/playoffs/steps/step-review.tsx",
    find: `        .from("playoffs")\n        .insert({`,
    replace: `        .from("playoffs")\n        .upsert({`,
    expect: "S2",
  },
  {
    id: "BD12", what: "Generate stays enabled on a blocked rebuild", file: "src/components/playoffs/steps/step-review.tsx",
    find: `disabled={saving || !data.division_id || !!review?.blocked}`,
    replace: `disabled={saving || !data.division_id}`,
    expect: "S3",
  },
  {
    id: "BD13", what: "the generator commits with a preview flag", file: "src/lib/playoffs/generate-bracket.ts",
    find: `    p_games: gamesPayload(plan.games),\n    p_commit: true,`,
    replace: `    p_games: gamesPayload(plan.games),\n    p_commit: false,`,
    expect: "S1",
  },
];

runMutants({
  sim: "scripts/sim/bracket-delete-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-08 — first run: baseline green (75 checks × 3 zones), 10/10 KILLED
// at their own assertion:
//   BD1 → [P2]  BD2 → [Z1]  BD3 → [D2]  BD4 → [U1]  BD5 → [R1]
//   BD6 → [E1]  BD7 → [E5]  BD8 → [A1]  BD9 → [L1]  BD10 → [U4]
// Source restored and re-verified green after the pass.
// 2026-10-08 — second run, after the UI commit added part S (84 checks × 3
// zones) and BD11–BD13: 13/13 KILLED at their own assertion —
//   BD11 → [S2]  BD12 → [S3]  BD13 → [S1]; BD1–BD10 unchanged.

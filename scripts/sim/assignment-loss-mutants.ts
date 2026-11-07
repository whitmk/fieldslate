// Mutation pass for assignment-loss-sim.ts. Each mutant is applied to the REAL
// source, the sim runs (TZ=UTC), the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const REMOVAL = "src/lib/schedule/regenerate-removal.ts";
const LOSS = "src/lib/umpires/assignment-loss.ts";

const MUTANTS: Mutant[] = [
  {
    id: "AL1", what: "protection ignored (protected games counted)", file: REMOVAL,
    find: "      protectedIds.add(g.id);",
    replace: "      void protectedIds;",
    expect: "R1",
  },
  {
    id: "AL2", what: "request rows never read", file: REMOVAL,
    find: "  if (checkIds.length > 0) {",
    replace: "  if (false && checkIds.length > 0) {",
    expect: "R1",
  },
  {
    id: "AL3", what: "a failed games read counted as zero games", file: REMOVAL,
    find: "  if (gameErr) return { failed: true };",
    replace: "  if (gameErr) return { games: [], assignments: { ok: true, count: 0 } };",
    expect: "F3",
  },
  {
    id: "AL4", what: "a failed chunk skipped instead of failing", file: LOSS,
    find: '    if (error || typeof count !== "number") return { ok: false };',
    replace: '    if (error || typeof count !== "number") continue;',
    expect: "C2",
  },
  {
    id: "AL5", what: "division count reads home games only", file: LOSS,
    find: "      .or(`home_team_id.in.(${list}),away_team_id.in.(${list})`)",
    replace: '      .in("home_team_id", [...teamIds])',
    expect: "D1",
  },
  {
    id: "AL6", what: "zero assignments worded as a line", file: LOSS,
    find: "  if (result.count === 0) return null;\n",
    replace: "",
    expect: "W3",
  },
  {
    id: "AL7", what: "couldn't-count worded as zero (no line)", file: LOSS,
    find: "  if (!result.ok) return `Couldn't count how many ${title} assignments this removes.`;",
    replace: "  if (!result.ok) return null;",
    expect: "W2",
  },
];

runMutants({
  sim: "scripts/sim/assignment-loss-sim.ts",
  timezones: ["UTC"],
  mutants: MUTANTS,
});

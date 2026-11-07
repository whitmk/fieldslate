// Mutation pass for assignment-loss-sim.ts. Each mutant is applied to the REAL
// source, the sim runs (TZ=UTC), the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const REMOVAL = "src/lib/schedule/regenerate-removal.ts";
const LOSS = "src/lib/umpires/assignment-loss.ts";
const SEASON = "src/lib/seasons/delete-counts.ts";
const MODAL = "src/components/seasons/archive-modals.tsx";

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
  {
    id: "AL8", what: "season counts ignore a read's error", file: SEASON,
    find: '  return !r.error && typeof r.count === "number";',
    replace: '  return typeof r.count === "number" || r.count === null;',
    expect: "S2",
  },
  {
    id: "AL9", what: "season counts accept a reply with no count", file: SEASON,
    find: '  return !r.error && typeof r.count === "number";',
    replace: "  return !r.error;",
    expect: "S3",
  },
  {
    id: "AL10", what: "season counts skip the interleague read", file: SEASON,
    find: "  const all = [r.divisions, r.teams, r.games, r.officials, r.interleague];",
    replace: "  const all = [r.divisions, r.teams, r.games, r.officials];",
    expect: "S4",
  },
  {
    id: "AL11", what: "the modal's couldn't-count branch removed", file: MODAL,
    find: "        ) : !counts.ok ? (",
    replace: "        ) : false ? (",
    expect: "S5",
  },
];

runMutants({
  sim: "scripts/sim/assignment-loss-sim.ts",
  timezones: ["UTC"],
  mutants: MUTANTS,
});

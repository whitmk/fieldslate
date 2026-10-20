// Mutation pass for playoff-series-sim.ts. Each mutant breaks one series rule
// in the REAL source, the sim runs under three zones, the source is restored
// and verified byte-for-byte, and the mutant counts as killed only if the
// FIRST failing assertion is its own.
import { runMutants, type Mutant } from "./mutant-runner";

const PLAN = "src/lib/playoffs/bracket-plan.ts";
const LENGTHS = "src/lib/playoffs/series-lengths.ts";
const SERIES = "src/lib/playoffs/series.ts";
const LABELS = "src/lib/playoffs/bracket-labels.ts";

const MUTANTS: Mutant[] = [
  {
    id: "SM0", what: "the per-day limit applies to every single elimination, series or not", file: PLAN,
    find: `(input.format === "single_elimination" && hasSeries(input.seriesByRound))`,
    replace: `input.format === "single_elimination"`,
    expect: "S0",
  },
  {
    id: "SM1", what: "home never alternates (the higher seed is home in every game)", file: LENGTHS,
    find: "  return k % 2 === 1 ? { home: top, away: other } : { home: other, away: top };",
    replace: "  return { home: top, away: other };",
    expect: "S1",
  },
  {
    id: "SM2", what: "the LOWER seed is treated as the higher one", file: LENGTHS,
    find: "  const bIsHigher = b !== null && (a === null || b < a);",
    replace: "  const bIsHigher = b !== null && (a === null || b > a);",
    expect: "S1",
  },
  {
    id: "SM3", what: "home is decided while a team is still unknown", file: LENGTHS,
    find: "  if (!slotA || !slotB) return { home: slotA, away: slotB };\n",
    replace: "",
    expect: "S1",
  },
  {
    id: "SM4", what: "a series round is one sub-round (games of a series packed together)", file: PLAN,
    find: "picker.pick(`${label}#${k}`)",
    replace: "picker.pick(label)",
    expect: "S2",
  },
  {
    id: "SM5", what: "Game N numbering counts series games too", file: LABELS,
    find: `  const bracket = singleGames(all.map((g) => ({ round: "", ...g })));`,
    replace: "  const bracket = all;",
    expect: "S3",
  },
  {
    id: "SM6", what: "a slot fed by a series reads Winner of Game N", file: LABELS,
    find: "  if (feeder && isSeriesGame(feeder, allGames)) return `Winner of ${seriesName(feeder, allGames)}`;\n",
    replace: "",
    expect: "S3",
  },
  {
    id: "SM7", what: "the feeder is matched by id (only game 1 of a series finds it)", file: "src/lib/playoffs/advancement.ts",
    find: "t.target.round === game.round && t.target.game_number === game.game_number",
    replace: "t.target.id === game.id",
    expect: "S3",
  },
  {
    id: "SM8", what: "a series needs every game won", file: SERIES,
    find: "  const need = winsNeeded(length);\n  const first = sorted[0];",
    replace: "  const need = length;\n  const first = sorted[0];",
    expect: "S4",
  },
  {
    id: "SM9", what: "if-needed ignores the score (only game number past winsNeeded)", file: SERIES,
    find: "    if (winsOf(s, t) + before >= s.winsNeeded) return false;",
    replace: "    if (k > s.winsNeeded) return false;",
    expect: "S4",
  },
  {
    id: "SM10", what: "results don't have to go in order", file: SERIES,
    find: "  if (prev && !gameHasResult(prev)) {",
    replace: "  if (false && prev && !gameHasResult(prev)) {",
    expect: "S5",
  },
  {
    id: "SM11", what: "deciding a series cancels nothing", file: SERIES,
    find: "    cancels = reopened.filter(",
    replace: "    cancels = [].filter(",
    expect: "S6",
  },
  {
    id: "SM12", what: "the clear preview doesn't say the not-needed game comes back", file: SERIES,
    find: "    c.restores.length\n      ? `${back}, so",
    replace: "    false\n      ? `${back}, so",
    expect: "S7",
  },
  {
    id: "SM13", what: "home doesn't alternate when a winner joins a series", file: SERIES,
    find: "      rows.length > 1 ? seriesHomeAway(r.series_game ?? 1, slotA, slotB, seedOf) : { home: slotA, away: slotB };",
    replace: "      { home: slotA, away: slotB };",
    expect: "S8",
  },
  {
    id: "SM14", what: "an edit that flips a series ignores the team it sent on before", file: SERIES,
    find: "      if (id && id !== winnerId && id !== previousWinner) others.add(id);",
    replace: "      if (id && id !== winnerId) others.add(id);",
    expect: "S8",
  },
  {
    id: "SM15", what: "clearing leaves the winner in the next round", file: SERIES,
    find: "  return { writes: slotWrites(rows, t.field, null, [...others][0] ?? null, seedOf) };",
    replace: "  return { writes: slotWrites(rows, t.field, winnerId, [...others][0] ?? null, seedOf) };",
    expect: "S8",
  },
  {
    id: "SM16", what: "the setup note counts every series game as if needed", file: SERIES,
    find: "    ifNeeded += r.matchups * (l - winsNeeded(l));",
    replace: "    ifNeeded += r.matchups * l;",
    expect: "S9",
  },
  {
    id: "SM17", what: "a bye into a series reads bye to Game N", file: "src/lib/playoffs/two-stage.ts",
    find: "        target: isSeriesGame(g, input.stage2Games) ? seriesName(g, input.stage2Games) : `Game ${shown(g.game_number)}`,",
    replace: "        target: `Game ${shown(g.game_number)}`,",
    expect: "S10",
  },
];

runMutants({
  sim: "scripts/sim/playoff-series-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-20 — run 1: baseline green (3,186 checks × 3 zones, 8 counters).
// 18/18 KILLED at their own tag, first run:
//   SM0 → [S0]  SM1–SM3 → [S1]  SM4 → [S2]  SM5–SM7 → [S3]  SM8–SM9 → [S4]
//   SM10 → [S5]  SM11 → [S6]  SM12 → [S7]  SM13–SM15 → [S8]  SM16 → [S9]
//   SM17 → [S10]
// Before the run, the shared fixture (mockupState) was changed to set its
// team slots BY HAND: built through the advancement writes, an advancement
// mutant (SM13) would have died in S4 instead of S8.
// Source restored and verified after every mutant.

// Mutation pass for bracket-print-sim.ts. Each mutant is applied to the REAL
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const LABELS = "src/lib/playoffs/bracket-labels.ts";
const PRINT = "src/lib/playoffs/bracket-print.ts";

const MUTANTS: Mutant[] = [
  {
    id: "BP1", what: "trophy: an empty slot matches an undecided game (null === null)", file: LABELS,
    find: "  return winnerId != null && teamId != null && winnerId === teamId;",
    replace: "  return winnerId === teamId;",
    expect: "T1",
  },
  {
    id: "BP2", what: "feeder ignores the side (skewed from advancement)", file: "src/lib/playoffs/advancement.ts",
    find: "    if (t && t.target.id === game.id && t.field === side) return g;",
    replace: "    if (t && t.target.id === game.id) return g;",
    expect: "F1",
  },
  {
    id: "BP3", what: "label drifts: every empty slot reads TBD", file: LABELS,
    find: "  return feeder ? `Winner of Game ${feeder.game_number}` : \"TBD\";",
    replace: "  return feeder ? \"TBD\" : \"TBD\";",
    expect: "F3",
  },
  {
    id: "BP4", what: "label ignores the format", file: LABELS,
    find: "  if (format !== \"single_elimination\") return \"TBD\";\n  const feeder",
    replace: "  const feeder",
    expect: "L2",
  },
  {
    id: "BP5", what: "print card: winner by raw compare (null === null)", file: PRINT,
    find: "    const won = slotWon(game.winner_id, teamId);",
    replace: "    const won = game.winner_id === teamId;",
    expect: "T2",
  },
  {
    id: "BP6", what: "print card drops the field", file: PRINT,
    find: "  const field = game.scheduled_date && game.venue_name ? game.venue_name : \"\";",
    replace: "  const field = \"\";",
    expect: "D2",
  },
  {
    id: "BP7", what: "layout by index in the round (the old print)", file: PRINT,
    find: "      const pos = singleElimPosition(g, k, size, inRound);",
    replace: "      const pos = inRound.indexOf(g);",
    expect: "P2",
  },
  {
    id: "BP8", what: "connectors only where round sizes double (the old print)", file: PRINT,
    find: "    const to = byId.get(t.target.id);\n    if (!to) continue;",
    replace: "    const to = byId.get(t.target.id);\n    if (!to) continue;\n    if (games.filter((x) => x.round === c.game.round).length !== 2 * games.filter((x) => x.round === t.target.round).length) continue;",
    expect: "P3",
  },
  {
    id: "BP9", what: "never scales (overflows past 16 teams)", file: PRINT,
    find: "  const scale = Math.min(1, PAGE.width / width, CANVAS_H / height);",
    replace: "  const scale = 1;",
    expect: "P4",
  },
  {
    id: "BP10", what: "prints portrait", file: PRINT,
    find: "    @page { margin: 0.35in; size: letter ${orientation}; }",
    replace: "    @page { margin: 0.35in; size: letter portrait; }",
    expect: "P5",
  },
  {
    id: "BP11", what: "round headings back to the pale grey", file: PRINT,
    find: "  heading: \"#1f2937\",",
    replace: "  heading: \"#9ca3af\",",
    expect: "C1",
  },
  {
    id: "BP12", what: "bracket view: winner by raw compare again", file: "src/components/playoffs/bracket-view.tsx",
    find: "  const homeWon = slotWon(game.winner_id, game.home_team_id);\n  const awayWon = slotWon(game.winner_id, game.away_team_id);\n  const bothTeams",
    replace: "  const homeWon = game.winner_id === game.home_team_id;\n  const awayWon = slotWon(game.winner_id, game.away_team_id);\n  const bothTeams",
    expect: "S2",
  },
  {
    id: "BP13", what: "result modal says \"Home\" again", file: "src/components/playoffs/enter-result-modal.tsx",
    find: "slotName(game.home_team_name, game, \"home\", allGames, format)",
    replace: "game.home_team_name ?? \"Home\"",
    expect: "S4",
  },
];

runMutants({
  sim: "scripts/sim/bracket-print-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-13 — first run: baseline green (535 checks × 3 zones, counters
// feederLabels 75, byeSeats 11, nullTrophyCase 1, connectors 75, scaledLayout
// 1). 13/13 KILLED at their own assertion:
//   BP1 → [T1]  BP2 → [F1]  BP3 → [F3]  BP4 → [L2]  BP5 → [T2]  BP6 → [D2]
//   BP7 → [P2]  BP8 → [P3]  BP9 → [P4]  BP10 → [P5] BP11 → [C1] BP12 → [S2]
//   BP13 → [S4]
// BP3 is expected at [F3], not [L1]: the F section cross-checks every label
// against the public page's copy before L runs, so a label drift dies there.
// Source restored and re-verified green after the pass.

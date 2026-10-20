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
    find: "    if (t && t.target.round === game.round && t.target.game_number === game.game_number && t.field === side) return g;",
    replace: "    if (t && t.target.round === game.round && t.target.game_number === game.game_number) return g;",
    expect: "F1",
  },
  {
    id: "BP3", what: "label drifts: every empty slot reads TBD", file: LABELS,
    find: "  return feeder ? `Winner of Game ${shownGameNumber(feeder, allGames)}` : \"TBD\";",
    replace: "  return feeder ? \"TBD\" : \"TBD\";",
    expect: "L1",
  },
  {
    id: "BP4", what: "label ignores the format", file: LABELS,
    find: "  if (format !== \"single_elimination\") return \"TBD\";\n  const feeder",
    replace: "  const feeder",
    expect: "L2",
  },
  {
    id: "BP5", what: "print card: winner by raw compare (null === null)", file: PRINT,
    find: "  const won = slotWon(game.winner_id, teamId);",
    replace: "  const won = game.winner_id === teamId;",
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
    find: "      const pos = singleElimPosition(g, k, size, inRound);\n      const centre = D.roundHdr + (pos + 0.5) * D.slotH",
    replace: "      const pos = inRound.indexOf(g);\n      const centre = D.roundHdr + (pos + 0.5) * D.slotH",
    expect: "P2",
  },
  {
    id: "BP8", what: "connectors only where round sizes double (the old print)", file: PRINT,
    find: "    const to = byId.get(t.target.id);\n    if (!to) continue;\n    const x1 = c.x + D.cardW;\n    const y1 = c.y + D.sourceY;",
    replace: "    const to = byId.get(t.target.id);\n    if (!to) continue;\n    if (games.filter((x) => x.round === c.game.round).length !== 2 * games.filter((x) => x.round === t.target.round).length) continue;\n    const x1 = c.x + D.cardW;\n    const y1 = c.y + D.sourceY;",
    expect: "P3",
  },
  {
    id: "BP9", what: "never scales down (overflows past 16 teams)", file: PRINT,
    find: "  const scale = height < SCALE_UP_BELOW * CANVAS_H ? Math.min(fit, MAX_SCALE) : Math.min(1, fit);",
    replace: "  const scale = height < SCALE_UP_BELOW * CANVAS_H ? Math.min(fit, MAX_SCALE) : 1;",
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
  {
    id: "BP14", what: "small brackets never scale up", file: PRINT,
    find: "? Math.min(fit, MAX_SCALE) : Math.min(1, fit);",
    replace: "? Math.min(1, fit) : Math.min(1, fit);",
    expect: "P4",
  },
  {
    id: "BP15", what: "scale-up uncapped (team names past 14pt)", file: PRINT,
    find: "? Math.min(fit, MAX_SCALE) : Math.min(1, fit);",
    replace: "? fit : Math.min(1, fit);",
    expect: "P4",
  },
  {
    id: "BP16", what: "the winner's row gets a colour again", file: PRINT,
    find: "  const bg = side === \"away\" ?",
    replace: "  const bg = won ? \"background:#ecfdf5;\" : side === \"away\" ?",
    expect: "G2",
  },
  {
    id: "BP17", what: "the away row's green is not kept in print", file: PRINT,
    find: "`background:${PRINT_COLORS.awayRowBg};${KEEP_BG}`",
    replace: "`background:${PRINT_COLORS.awayRowBg};`",
    expect: "G1",
  },
  {
    id: "BP18", what: "on-screen winner row tinted again", file: "src/components/playoffs/bracket-view.tsx",
    find: "${away ? AWAY_ROW_BG : \"bg-white\"}",
    replace: "${won ? \"bg-[#22C55E]/5\" : away ? AWAY_ROW_BG : \"bg-white\"}",
    expect: "S5",
  },
  {
    id: "BP19", what: "the public page stops using the shared rule", file: "src/lib/public-schedule/view.ts",
    find: "  return emptySlotLabel(asRow(game), side, bracket.map(asRow), game.format);",
    replace: "  return asRow(game) && \"TBD\";",
    expect: "F3",
  },
  {
    id: "BP20", what: "screen lines leave from the card's centre, not the row divider", file: PRINT,
    find: "  rowTop: 41, rowH: 32, divider: 1, sourceY: 41 + 32 + 0.5,",
    replace: "  rowTop: 41, rowH: 32, divider: 1, sourceY: 139 / 2 + 10,",
    expect: "P6",
  },
  {
    id: "BP21", what: "the on-screen tree laid out with the PRINT dimensions", file: "src/components/playoffs/bracket-view.tsx",
    find: "    : singleElimLayout(games, SCREEN_TREE);",
    replace: "    : singleElimLayout(games);",
    expect: "S7",
  },
  {
    id: "BP22", what: "a team row loses its fixed height", file: "src/components/playoffs/bracket-view.tsx",
    find: "flex h-8 flex-none items-center gap-2 px-2.5",
    replace: "flex flex-none items-center gap-2 px-2.5 py-2",
    expect: "S7",
  },
  {
    id: "BP23", what: "the screen tree places a series group by its top, not its middle",
    file: "src/components/playoffs/bracket-view.tsx",
    find: 'top: (c as PlacedItem<GameWithTeams>).centre, transform: "translateY(-50%)"',
    replace: "top: c.y",
    expect: "S7",
  },
  {
    id: "BP24", what: "the screen group truncates a card's field line",
    file: "src/components/playoffs/series-card.tsx",
    find: "<p className={`break-words text-gray-500 ${struck}`}>{field}</p>",
    replace: "<p className={`truncate text-gray-500 ${struck}`}>{field}</p>",
    expect: "S7",
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
// 2026-10-13 — second run, after the two-tone card and small-bracket scale-up:
// baseline green (569 checks × 3 zones; new counters scaledUp 3, awayWinner 1).
// BP9 re-targeted at the new scale line; BP14–BP18 added. 18/18 KILLED at
// their own assertion:
//   BP14 → [P4]  BP15 → [P4]  BP16 → [G2]  BP17 → [G1]  BP18 → [S5];
//   BP1–BP13 unchanged.
// 2026-10-13 — third run (public page delegates to the shared rule): 570
// checks × 3 zones. BP3 now expected at [L1] — F3 compares the shared rule
// with the public page's delegation, so a drift in the rule moves both sides
// and the literals catch it. BP19 added (view.ts stops delegating → [F3]).
// 19/19 KILLED at their own assertion.
// 2026-10-13 — fourth run (on-screen tree on the shared layout, P6/S7):
// 713 checks × 3 zones. BP20 SURVIVED the first pass — P6 compared each line's
// start against SCREEN_TREE.sourceY itself, so moving sourceY moved the
// expectation with it (a tautology). P6 now requires the line to leave at the
// divider between the rows (rowTop + rowH + divider/2). BP21 made realistic
// (the tree laid out with the print's dimensions). Second pass 22/22 KILLED:
//   BP20 → [P6]  BP21 → [S7]  BP22 → [S7]; BP1–BP19 unchanged.
// 2026-10-20 (feat/playoff-series): BP2's find string re-pointed — the feeder
// now matches its target by round + position (series share a position). Same
// mutant (side ignored); 22/22 killed at their own tag.
// 2026-10-20 — revised series tree (groups of stacked game cards): BP21's find
// follows the view's new line; BP23 (a group placed by its top) and BP24 (a
// group card's field truncated) added, both aimed at [S7].
// Same day: the first pass found BP5, BP7, BP8, BP9, BP14, BP15 and BP16 STALE
// (target not found exactly once — the runner refuses rather than run a
// mutant that changes nothing): the row code moved into teamRowHtml (new
// indent) and groupedTreeLayout repeated the layout and page-fit lines. The
// page fit is now ONE function (pageScale) for both layouts; BP7/BP8 finds are
// anchored to singleElimLayout's own lines.
// Second pass: baseline green (715 checks × 3 zones). 24/24 KILLED at their own
// assertion (BP23 → [S7], BP24 → [S7]; the rest as before). Source restored
// and re-verified green.

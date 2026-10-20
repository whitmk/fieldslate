// Mutation pass for playoff-numbers-sim.ts. Each mutant puts a stored
// position back where a shown number belongs (one per rule), the sim runs
// under three zones, the source is restored and verified byte-for-byte, and
// the mutant counts as killed only if the FIRST failing assertion is its own.
import { runMutants, type Mutant } from "./mutant-runner";

const LABELS = "src/lib/playoffs/bracket-labels.ts";
const TS = "src/lib/playoffs/two-stage.ts";
const RESULT = "src/lib/playoffs/playoff-result.ts";

const MUTANTS: Mutant[] = [
  {
    id: "NX1", what: "the numbering shows stored positions", file: LABELS,
    find: "  return (n) => shown.get(n) ?? 1 + stored.filter((x) => x < n).length;",
    replace: "  return (n) => n;",
    expect: "N1",
  },
  {
    id: "NX2", what: "the numbering follows arrival order, not stored order", file: LABELS,
    find: "  const stored = [...new Set(bracket.map((g) => g.game_number))].sort((a, b) => a - b);",
    replace: "  const stored = [...new Set(bracket.map((g) => g.game_number))];",
    expect: "N1",
  },
  {
    id: "NX3", what: "\"Winner of Game N\" names the stored position", file: LABELS,
    find: "return feeder ? `Winner of Game ${shownGameNumber(feeder, allGames)}` : \"TBD\";",
    replace: "return feeder ? `Winner of Game ${feeder.game_number}` : \"TBD\";",
    expect: "N2",
  },
  {
    id: "NX4", what: "the Game N line (screen helper + print) names the stored position", file: LABELS,
    find: "  const label = `Game ${shownGameNumber(game, bracket)}`;",
    replace: "  const label = `Game ${game.game_number}`;",
    expect: "N3",
  },
  {
    id: "NX5", what: "the public schedule names the stored position", file: "src/lib/public-schedule/view.ts",
    find: "  const shown = (p: PublicPlayoffGame) => shownGameNumber(p, brackets.get(p.playoff_id) ?? [p]);",
    replace: "  const shown = (p: PublicPlayoffGame) => p.game_number;",
    expect: "N4",
  },
  {
    id: "NX6", what: "the seed confirm names stored positions", file: TS,
    find: "  const shown = gameNumbering(input.stage2Games);",
    replace: "  const shown = (n: number) => n;",
    expect: "N6",
  },
  {
    id: "NX7", what: "the next-game refusal names the stored position", file: RESULT,
    find: "    gameNumber: own(n.game_number), round: n.round,",
    replace: "    gameNumber: n.game_number, round: n.round,",
    expect: "N7a",
  },
  {
    id: "NX8", what: "the clear confirm names the game's stored position", file: RESULT,
    find: "    gameId, gameNumber: own(r.game_number), round: r.round,",
    replace: "    gameId, gameNumber: r.game_number, round: r.round,",
    expect: "N7b",
  },
  {
    id: "NX9", what: "the clear confirm names the removed game's stored position", file: RESULT,
    find: "    removed = { gameNumber: own(m.game_number), round: m.round, teamName: str(m.team_name) };",
    replace: "    removed = { gameNumber: m.game_number, round: m.round, teamName: str(m.team_name) };",
    expect: "N7b",
  },
  {
    id: "NX10", what: "the next-stage refusal names Stage 2's stored position", file: RESULT,
    find: "      ? stage2StartedRefusal(numbering.nextStage(n))",
    replace: "      ? stage2StartedRefusal(n)",
    expect: "N7c",
  },
  {
    id: "NX11", what: "the two-stage rebuild refusal names the stored position", file: TS,
    find: "  if (reasons.includes(\"stage2_started\")) {\n    const stored = nonNeg(r.stage2_game_number);\n    const n = stored !== null && stage2 ? stage2(stored) : null;",
    replace: "  if (reasons.includes(\"stage2_started\")) {\n    const stored = nonNeg(r.stage2_game_number);\n    const n = stored;",
    expect: "N8",
  },
  {
    id: "NX12", what: "the seed refusal names the stored position", file: TS,
    find: "  if (r.reason === \"bracket_started\") {\n    const stored = nonNeg(r.stage2_game_number);\n    const n = stored !== null && stage2 ? stage2(stored) : null;",
    replace: "  if (r.reason === \"bracket_started\") {\n    const stored = nonNeg(r.stage2_game_number);\n    const n = stored;",
    expect: "N8",
  },
  {
    id: "NX13", what: "the screen card prints game_number", file: "src/components/playoffs/bracket-view.tsx",
    find: "Game {numberOf(game)} · {fmtDate",
    replace: "Game {game.game_number} · {fmtDate",
    expect: "L",
  },
  {
    id: "NX14", what: "the two-stage card's locked line prints Stage 2's stored position", file: "src/components/playoffs/two-stage-card.tsx",
    find: "{stage1LockedLine(gameNumbering(s2Games)(firstResult))}",
    replace: "{stage1LockedLine(firstResult)}",
    expect: "L",
  },
];

runMutants({
  sim: "scripts/sim/playoff-numbers-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-20 — run 1: baseline green (68 checks × 3 zones). 14/14 KILLED at
// their own tag, first run:
//   NX1 → [N1]  NX2 → [N1]  NX3 → [N2]  NX4 → [N3]  NX5 → [N4]  NX6 → [N6]
//   NX7 → [N7a] NX8 → [N7b] NX9 → [N7b] NX10 → [N7c] NX11 → [N8] NX12 → [N8]
//   NX13 → [L]  NX14 → [L]
// Source restored and verified after every mutant.

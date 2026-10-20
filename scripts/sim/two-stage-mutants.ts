// Mutation pass for two-stage-sim.ts. Each mutant is applied to the REAL
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/playoffs/two-stage.ts";

const MUTANTS: Mutant[] = [
  {
    id: "TS1", what: "default advancing is 3", file: LIB,
    find: `  return Math.min(4, teamCount);`,
    replace: `  return Math.min(3, teamCount);`,
    expect: "S1",
  },
  {
    id: "TS2", what: "more teams may advance than are in", file: LIB,
    find: `  if (advance > teamCount) {`,
    replace: `  if (advance > teamCount + 1) {`,
    expect: "S2",
  },
  {
    id: "TS3", what: "byes counted from the next bracket size up", file: LIB,
    find: `  return advance < MIN_ADVANCING ? 0 : bracketSizeFor(advance) - advance;`,
    replace: `  return advance < MIN_ADVANCING ? 0 : bracketSizeFor(advance + 1) - advance;`,
    expect: "S3",
  },
  {
    id: "TS4", what: "the summary line drops the byes", file: LIB,
    find: "    `top ${advance} advance → ${plural(Math.max(advance - 1, 0), \"bracket game\", \"bracket games\")}${byeText}`",
    replace: "    `top ${advance} advance → ${plural(Math.max(advance - 1, 0), \"bracket game\", \"bracket games\")}`",
    expect: "S4",
  },
  {
    id: "TS5", what: "Stage 2 may start on Stage 1's last day", file: LIB,
    find: `  if (stage2Start > stage1End) return null;`,
    replace: `  if (stage2Start >= stage1End) return null;`,
    expect: "S5",
  },
  {
    id: "TS6", what: "Stage 2 rows keep the placeholder ids as teams", file: LIB,
    find: `    ...g,\n    home_team_id: null,\n    away_team_id: null,\n`,
    replace: `    ...g,\n`,
    expect: "P1",
  },
  {
    id: "TS7", what: "seed numbers read one high", file: LIB,
    find: `  return id !== null && id.startsWith(SEED_PREFIX) ? Number(id.slice(SEED_PREFIX.length)) : null;`,
    replace: `  return id !== null && id.startsWith(SEED_PREFIX) ? Number(id.slice(SEED_PREFIX.length)) + 1 : null;`,
    expect: "P2",
  },
  {
    id: "TS8", what: "the two lowest seeds swap places in the layout", file: LIB,
    find: `    team_id: seedId(i + 1),`,
    replace: `    team_id: seedId(i + 1 === input.advance ? i : i + 2 === input.advance ? i + 2 : i + 1),`,
    expect: "P5",
  },
  {
    id: "TS9", what: "an empty slot ignores its seed", file: "src/lib/playoffs/bracket-labels.ts",
    find: `  if (seed != null) return seedLabel(seed);\n`,
    replace: ``,
    expect: "P4",
  },
  {
    id: "TS10", what: "Stage 2 is scheduled with no daily limit", file: LIB,
    find: `  const picker = makeSlotPicker(slots, input.settings, perDay);`,
    replace: `  const picker = makeSlotPicker(slots, input.settings);`,
    expect: "Q1",
  },
  {
    id: "TS11", what: "Stage 2's default limit is 2", file: LIB,
    find: `export const DEFAULT_STAGE2_GAMES_PER_TEAM_PER_DAY = 1;`,
    replace: `export const DEFAULT_STAGE2_GAMES_PER_TEAM_PER_DAY = 2;`,
    expect: "Q0",
  },
  {
    id: "TS12", what: "the stage-order problem is never raised", file: LIB,
    find: `  if (order) problems.push(order);`,
    replace: ``,
    expect: "T1",
  },
  {
    id: "TS13", what: "Stage 1 is planned without the daily limit", file: LIB,
    find: `    gamesPerTeamPerDay: input.stage1.gamesPerTeamPerDay ?? DEFAULT_GAMES_PER_TEAM_PER_DAY,`,
    replace: `    gamesPerTeamPerDay: input.stage1.gamesPerTeamPerDay ?? 2,`,
    expect: "T2",
  },
  {
    id: "TS14", what: "records count runs as both for and against", file: LIB,
    find: `    for (const [r, f, a] of [[home, hs, as], [away, as, hs]] as const) {`,
    replace: `    for (const [r, f, a] of [[home, hs, as], [away, hs, as]] as const) {`,
    expect: "R1",
  },
  {
    id: "TS15", what: "records sorted by wins", file: LIB,
    find: `  return [...recs.values()].sort((a, b) =>\n    a.teamName < b.teamName ? -1 : a.teamName > b.teamName ? 1 : a.teamId < b.teamId ? -1 : 1,\n  );\n}\n\n/** "5-1"`,
    replace: `  return [...recs.values()].sort((a, b) => b.wins - a.wins || (a.teamName < b.teamName ? -1 : 1));\n}\n\n/** "5-1"`,
    expect: "R2",
  },
  {
    id: "TS16", what: "a game with no result counts as 0–0", file: LIB,
    find: `  return g.home_score !== null && g.away_score !== null && g.home_team_id !== null && g.away_team_id !== null;`,
    replace: `  return g.home_team_id !== null && g.away_team_id !== null;`,
    expect: "R3",
  },
  {
    id: "TS17", what: "a tie is dropped from the record", file: LIB,
    find: `      r.played++;\n`,
    replace: `      if (f === a) continue;\n      r.played++;\n`,
    expect: "R4",
  },
  {
    id: "TS18", what: "a game dated today counts as past", file: LIB,
    find: `  return g.scheduled_date < today ? "past" : "upcoming";`,
    replace: `  return g.scheduled_date <= today ? "past" : "upcoming";`,
    expect: "U2",
  },
  {
    id: "TS19", what: "an undated game blocks seeding", file: LIB,
    find: `  if (!g.scheduled_date) return "no_date";`,
    replace: `  if (!g.scheduled_date) return "upcoming";`,
    expect: "U3",
  },
  {
    id: "TS20", what: "the Seed screen opens in the order given", file: LIB,
    find: `  return [...teams].sort((a, b) =>\n    a.team_name < b.team_name ? -1 : a.team_name > b.team_name ? 1 : a.team_id < b.team_id ? -1 : 1,\n  );\n}\n\nexport const SEED_SCREEN_LINE`,
    replace: `  return [...teams];\n}\n\nexport const SEED_SCREEN_LINE`,
    expect: "Z1",
  },
  {
    id: "TS21", what: "▲ moves two places", file: LIB,
    find: `  const to = from + dir;`,
    replace: `  const to = from + dir * 2;`,
    expect: "Z2",
  },
  {
    id: "TS22", what: "a duplicate in the seed order is accepted", file: LIB,
    find: `    if (!want.has(id) || seen.has(id)) {`,
    replace: `    if (!want.has(id)) {`,
    expect: "Z3",
  },
  {
    id: "TS23", what: "seed k gets the (k+1)th team", file: LIB,
    find: `      const teamId = orderIds[seed - 1];`,
    replace: `      const teamId = orderIds[seed];`,
    expect: "Z4",
  },
  {
    id: "TS24", what: "byes listed in bracket order, not seed order", file: LIB,
    find: `  byes.sort((a, b) => a.seed - b.seed);\n`,
    replace: `  byes.sort((a, b) => b.seed - a.seed);\n`,
    expect: "C1",
  },
  {
    id: "TS25", what: "the confirm leaves out undated games", file: LIB,
    find: `    const list = input.status.neverPlayed.map(({ game, reason }) =>`,
    replace: `    const list = input.status.neverPlayed.filter((x) => x.reason !== "no_date").map(({ game, reason }) =>`,
    expect: "C2",
  },
  {
    id: "TS26", what: "the changed note names teams whose record didn't move", file: LIB,
    find: `    .filter((r) => prev.has(r.teamId) && prev.get(r.teamId) !== recordText(r))`,
    replace: `    .filter((r) => prev.has(r.teamId))`,
    expect: "W2",
  },
];

runMutants({
  sim: "scripts/sim/two-stage-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-19 — run 1: baseline green (145 checks × 3 zones); 23/26 KILLED at
// their own assertion, 3 SURVIVED — all three harness or mutant faults:
//   TS8  the mutant renamed placeholders but kept their ids in order, so the
//        layout was unchanged (an equivalent mutant). Rewritten to swap the
//        two lowest seeds, which are always both in round 1.
//   TS15 operator precedence turned "sort by wins" into a different sort that
//        happened to agree with the fixture. Rewritten as a real wins-first sort.
//   TS22 the duplicate fixture also MISSED a team, so the size check refused it
//        and the duplicate check went unexercised. Re-keyed to every team plus
//        a duplicate.
// Run 2: baseline green, 26/26 KILLED at their own assertion:
//   TS1→S1 TS2→S2 TS3→S3 TS4→S4 TS5→S5 TS6→P1 TS7→P2 TS8→P5 TS9→P4
//   TS10→Q1 TS11→Q0 TS12→T1 TS13→T2 TS14→R1 TS15→R2 TS16→R3 TS17→R4
//   TS18→U2 TS19→U3 TS20→Z1 TS21→Z2 TS22→Z3 TS23→Z4 TS24→C1 TS25→C2 TS26→W2
// Source restored and re-verified green after the pass.

// Mutation pass for two-stage-screens-sim.ts. Each mutant is applied to the
// REAL source, the sim runs under three zones, the source is restored and
// verified byte-for-byte, and the mutant counts as killed only if the FIRST
// failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const EXPORT = "src/lib/playoffs/playoff-export.ts";
const TS = "src/lib/playoffs/two-stage.ts";

const MUTANTS: Mutant[] = [
  {
    id: "SX1", what: "an unset game length is guessed as 90 again", file: EXPORT,
    find: "  return s.durationDefaulted ? null : s.durationMin;",
    replace: "  return s.durationMin;",
    expect: "E1",
  },
  {
    id: "SX2", what: "End is start + a hardcoded 90 again", file: EXPORT,
    find: `      const end = g.start_time && opts.durationMin !== null ? csvTimePlus(g.start_time, opts.durationMin) : "";`,
    replace: `      const end = g.start_time ? csvTimePlus(g.start_time, 90) : "";`,
    expect: "E2",
  },
  {
    id: "SX3", what: "games without both teams are dropped from the CSV again", file: EXPORT,
    find: "    .filter((g) => g.scheduled_date)\n",
    replace: "    .filter((g) => g.scheduled_date && g.home_team_id && g.away_team_id)\n",
    expect: "E3",
  },
  {
    id: "SX4", what: "a round-robin game in a pair reads its round, not RR Game N", file: EXPORT,
    find: "  if (pair && g.playoff_id === pair.stage1Id) return `Round robin · ${rrGameLabel(g.game_number)}`;\n",
    replace: "",
    expect: "E4",
  },
  {
    id: "SX5", what: "a seeded bracket with a result still reads Seeded", file: TS,
    find: `  if (s.firstResultGame !== null) return { text: "In progress", tone: "green" };\n`,
    replace: "",
    expect: "K2",
  },
  {
    id: "SX6", what: "Change seeds stays on after the bracket starts", file: TS,
    find: `      disabledReason: s.firstResultGame !== null ? "The bracket has started, so the seeds can't be changed." : null,`,
    replace: `      disabledReason: null,`,
    expect: "K3",
  },
  {
    id: "SX7", what: "the never-played line drops the rained-out date", file: TS,
    find: "      reason === \"rained_out\" ? `rained out${date ? ` ${date}` : \"\"}`",
    replace: "      reason === \"rained_out\" ? \"rained out\"",
    expect: "K4",
  },
  {
    id: "SX8", what: "Stage 2 ignores \"Same fields as Stage 1\"", file: TS,
    find: "  return data.stage2.same_fields ? data.venue_assignments : data.stage2.venue_assignments;",
    replace: "  return data.stage2.venue_assignments;",
    expect: "Y2",
  },
  {
    id: "SX9", what: "Stage 2's games carry team ids to the function", file: TS,
    find: "    home_team_id: null,\n    away_team_id: null,\n    seed_home: g.seed_home,",
    replace: "    home_team_id: g.home_team_id,\n    away_team_id: g.away_team_id,\n    seed_home: g.seed_home,",
    expect: "Y3",
  },
  {
    id: "SX10", what: "a seed reply is accepted whatever it says about committing", file: TS,
    find: "  if (!r || r.committed !== commit || !reply) {",
    replace: "  if (!r || !reply) {",
    expect: "V4",
  },
  {
    id: "SX11", what: "a round-robin result edit after the bracket started reads as a next-game refusal", file: "src/lib/playoffs/playoff-result.ts",
    find: `  if (r.reason === "next_stage_started") {`,
    replace: `  if (r.reason === "never") {`,
    expect: "B1",
  },
  {
    id: "SX12", what: "the public page stops naming the bracket stage", file: "src/lib/public-schedule/view.ts",
    find: "    if (p.stage === 2) return `Playoffs · Bracket · ${game}`;\n",
    replace: "",
    expect: "PL1",
  },
  {
    id: "SX13", what: "deleting a pair reads like deleting one bracket", file: "src/lib/playoffs/bracket-delete.ts",
    find: "  const title = twoStage\n",
    replace: "  const title = false\n",
    expect: "D1",
  },
  {
    id: "SX14", what: "a Stage-2-only rebuild stops saying the seeds are kept", file: TS,
    find: `        (c.keepsSeeds ? " The seeds you set are kept." : ""),`,
    replace: `        "",`,
    expect: "R2",
  },
  {
    id: "SX15", what: "the re-check note's \"before\" records are today's (nothing named as moved)", file: TS,
    find: "      return c ? { ...g, home_score: c.was_home, away_score: c.was_away } : g;",
    replace: "      return g;",
    expect: "K5",
  },
  {
    id: "SX16", what: "a result that changed back is still named", file: TS,
    find: "    .filter((c) => c.was_home !== c.now_home || c.was_away !== c.now_away)",
    replace: "    .filter(() => true)",
    expect: "K5",
  },
  {
    id: "SX17", what: "the card stops reading the stored changes", file: "src/components/playoffs/two-stage-card.tsx",
    find: "stage1_changed_at, stage1_changes\")",
    replace: "stage1_changed_at\")",
    expect: "S2",
  },
];

runMutants({
  sim: "scripts/sim/two-stage-screens-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// ── RUN LOG ─────────────────────────────────────────────────────────────────
// 2026-10-20 — run 1: baseline green (93 checks × 3 zones). 12/14 KILLED at
// their own tag; SX3 and SX4 KILLED AT THE WRONG ASSERTION (E2). A harness
// ordering fault: E2 checked End on a round-robin row of a pair and on the
// final (no teams), so dropping team-less rows (SX3) or the RR label (SX4)
// broke E2 first. E2 now checks End on an ordinary game with both teams; the
// final's End moved to E3, the RR row to E4.
// Run 2: baseline green (94 checks × 3 zones). 14/14 KILLED at their own tag:
//   SX1 → [E1]  SX2 → [E2]  SX3 → [E3]  SX4 → [E4]  SX5 → [K2]  SX6 → [K3]
//   SX7 → [K4]  SX8 → [Y2]  SX9 → [Y3]  SX10 → [V4] SX11 → [B1] SX12 → [PL1]
//   SX13 → [D1] SX14 → [R2]
// Run 3 (after stageRange learned "Nov 14 – 22" and stage2Line the count):
//   baseline green, 14/14 KILLED at their own tag. Source restored, verified.
// 2026-10-20 — found STALE (target not found exactly once) since the playoff-series
// step 3/4 commits reached main the same day; the pass had not been re-run then.
// SX12 re-anchored (the stage-2 label now reads '${game}', step 4); SX12 → [PL1]; 17/17 KILLED at their own tag. Source restored and re-verified green.

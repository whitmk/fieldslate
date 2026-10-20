// Two-stage playoffs ("Round robin, then bracket") — every rule and every
// sentence, PURE: no Supabase, no React, no clock ("today" is passed in, in
// the league's timezone). Screens and the database functions render and
// enforce what is decided here; never a second copy at a call site.
// Approved mockup: docs/mockups/two-stage-playoffs.html (2026-10-19).
// Harness: npm run sim:two-stage (+ :mutants).
//
// THE MODEL
// - Stage 1 is ONE round robin of the teams in (no pools yet — see CLAUDE.md
//   "PLANNED FOLLOW-UP — pools"). It plans through the plain round robin's
//   planner, so home/away balance and the per-day limit are the same rules.
// - Stage 2 is a single-elimination bracket for the top `advanceCount`,
//   created at setup WITH dates and fields but NO teams: each round-1 slot (and
//   each bye seed's round-2 slot) carries a seed number instead. The layout is
//   the real `buildSingleElimination`, fed placeholder ids — one layout rule,
//   never a copy.
// - FieldSlate never ranks. Records are reference only; the admin orders the
//   seeds, starting from A–Z.
// - Seeding fills team slots IN PLACE by seed number; it never rebuilds games.

import {
  bracketSizeFor,
  buildSingleElimination,
  buildSlotGrid,
  fmtPlanDate,
  makeSlotPicker,
  planBracket,
  planWarnings,
  DEFAULT_GAMES_PER_TEAM_PER_DAY,
  type BracketIds,
  type BracketPlan,
  type GameInsert,
  type PlanSettings,
  type SlotGridInput,
} from "@/lib/playoffs/bracket-plan";
import { seedLabel, shortDate, shortTime } from "@/lib/playoffs/bracket-labels";
import type { SeededTeam } from "@/components/playoffs/playoff-wizard-types";

// ─── Setup ────────────────────────────────────────────────────────────────────

export const MIN_ADVANCING = 2;
/** Stage 2's per-team daily limit when none is set (decided 2026-10-19: 1). */
export const DEFAULT_STAGE2_GAMES_PER_TEAM_PER_DAY = 1;

/** The Teams step's starting value: 4, or every team when there are fewer. */
export function defaultAdvanceCount(teamCount: number): number {
  return Math.min(4, teamCount);
}

/** Why this many can't advance, or null. */
export function advanceProblem(teamCount: number, advance: number): string | null {
  if (!Number.isInteger(advance) || advance < MIN_ADVANCING) {
    return `At least ${MIN_ADVANCING} teams have to advance to the bracket.`;
  }
  if (advance > teamCount) {
    return `Only ${teamCount} teams are in, so at most ${teamCount} can advance.`;
  }
  return null;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Round-1 byes in Stage 2: the bracket size minus the teams advancing. */
export function stage2Byes(advance: number): number {
  return advance < MIN_ADVANCING ? 0 : bracketSizeFor(advance) - advance;
}

/** "7 teams · 21 round-robin games · top 6 advance → 5 bracket games, byes for seeds 1–2" */
export function twoStageSummaryLine(teamCount: number, advance: number): string {
  const rr = (teamCount * (teamCount - 1)) / 2;
  const byes = stage2Byes(advance);
  const byeText = byes === 0 ? "" : byes === 1 ? ", a bye for seed 1" : `, byes for seeds 1–${byes}`;
  return (
    `${plural(teamCount, "team", "teams")} · ${plural(rr, "round-robin game", "round-robin games")} · ` +
    `top ${advance} advance → ${plural(Math.max(advance - 1, 0), "bracket game", "bracket games")}${byeText}`
  );
}

/** Stage 2 must start AFTER Stage 1's last date. The sentence, or null. */
export function stageDateProblem(stage1End: string, stage2Start: string): string | null {
  if (!stage1End || !stage2Start) return null;
  if (stage2Start > stage1End) return null;
  return (
    `Stage 2 starts ${fmtPlanDate(stage2Start)}, but Stage 1 runs until ${fmtPlanDate(stage1End)}. ` +
    `The bracket can't start until the round robin is over.`
  );
}

// ─── Planning ─────────────────────────────────────────────────────────────────

/** A Stage 2 row: a game with seed numbers where its teams will go. */
export type Stage2Game = GameInsert & { seed_home: number | null; seed_away: number | null };

export type Stage2Plan = {
  games: Stage2Game[];
  tbdCount: number;
  skippedForOrder: number;
  skippedForDayLimit: number;
  warnings: string[];
};

const SEED_PREFIX = "seed:";
const seedId = (seed: number) => `${SEED_PREFIX}${seed}`;
function seedOf(id: string | null): number | null {
  return id !== null && id.startsWith(SEED_PREFIX) ? Number(id.slice(SEED_PREFIX.length)) : null;
}

/**
 * Stage 2's games for `advance` teams: the real single-elimination layout
 * with seed numbers in place of teams, scheduled with the per-team daily
 * limit (default 1). Rounds that don't fit stay undated, and the warning says
 * why — same rule and same sentence as the round robin.
 */
export function planStage2(input: {
  advance: number;
  ids: BracketIds;
  grid: SlotGridInput;
  settings: PlanSettings;
  divisionName: string;
  gamesPerTeamPerDay?: 1 | 2;
}): Stage2Plan {
  const perDay = input.gamesPerTeamPerDay ?? DEFAULT_STAGE2_GAMES_PER_TEAM_PER_DAY;
  const { slots, days } = buildSlotGrid(input.grid);
  const picker = makeSlotPicker(slots, input.settings, perDay);
  const placeholders: SeededTeam[] = Array.from({ length: input.advance }, (_, i) => ({
    team_id: seedId(i + 1),
    team_name: seedLabel(i + 1),
  }));
  const games: Stage2Game[] = buildSingleElimination(placeholders, input.ids, picker).map((g) => ({
    ...g,
    home_team_id: null,
    away_team_id: null,
    seed_home: seedOf(g.home_team_id),
    seed_away: seedOf(g.away_team_id),
  }));
  const tbdCount = games.filter((g) => g.scheduled_date === null).length;
  const skippedForOrder = picker.skippedForOrder();
  const skippedForDayLimit = picker.skippedForDayLimit();
  const warnings = planWarnings({
    days, slotCount: slots.length, gameCount: games.length, tbdCount, skippedForOrder,
    skippedForDayLimit, gamesPerTeamPerDay: perDay,
    settings: input.settings, divisionName: input.divisionName,
  });
  return { games, tbdCount, skippedForOrder, skippedForDayLimit, warnings };
}

export type TwoStageInput = {
  teams: SeededTeam[];
  advance: number;
  ids: { stage1: BracketIds; stage2: BracketIds };
  stage1: { grid: SlotGridInput; gamesPerTeamPerDay?: 1 | 2 };
  stage2: { grid: SlotGridInput; gamesPerTeamPerDay?: 1 | 2 };
  settings: PlanSettings;
  divisionName: string;
};

export type TwoStagePlan = {
  stage1: BracketPlan;
  stage2: Stage2Plan;
  /** Reasons Generate is refused (Review shows them; nothing is written). */
  problems: string[];
};

/** Both stages, planned together, with the refusals Review shows. */
export function planTwoStage(input: TwoStageInput): TwoStagePlan {
  const problems: string[] = [];
  const adv = advanceProblem(input.teams.length, input.advance);
  if (adv) problems.push(adv);
  const order = stageDateProblem(input.stage1.grid.endDate, input.stage2.grid.startDate);
  if (order) problems.push(order);
  const stage1 = planBracket({
    format: "round_robin",
    seeds: input.teams,
    ids: input.ids.stage1,
    grid: input.stage1.grid,
    settings: input.settings,
    divisionName: input.divisionName,
    gamesPerTeamPerDay: input.stage1.gamesPerTeamPerDay ?? DEFAULT_GAMES_PER_TEAM_PER_DAY,
  });
  // A refused count still gets a plan (Review shows its warnings beside the
  // refusal), clamped into range; nothing is generated while `problems` exist.
  const planAdvance = Math.min(Math.max(input.advance, MIN_ADVANCING), Math.max(input.teams.length, MIN_ADVANCING));
  const stage2 = planStage2({
    advance: planAdvance,
    ids: input.ids.stage2,
    grid: input.stage2.grid,
    settings: input.settings,
    divisionName: input.divisionName,
    gamesPerTeamPerDay: input.stage2.gamesPerTeamPerDay,
  });
  return { stage1, stage2, problems };
}

// ─── Game labels ──────────────────────────────────────────────────────────────

/** Round-robin games read "RR Game 13" so "Game N" and "Winner of Game N"
 *  always mean the bracket (decided 2026-10-19, D1). */
export function rrGameLabel(gameNumber: number): string {
  return `RR Game ${gameNumber}`;
}

// ─── Stage 1 results ──────────────────────────────────────────────────────────

/** The fields of a Stage 1 game these rules read. `scheduled_date` is the
 *  stored date (wall clock). */
export type Stage1Game = {
  id: string;
  game_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_id: string | null;
  status: string;
  scheduled_date: string | null;
};

/** 0107's test for "has a result": completed, a score, or a winner. */
export function hasResult(g: Pick<Stage1Game, "status" | "home_score" | "away_score" | "winner_id">): boolean {
  return g.status === "completed" || g.home_score !== null || g.away_score !== null || g.winner_id !== null;
}

/** A score both sides can be counted from: both scores present. */
function countable(g: Stage1Game): boolean {
  return g.home_score !== null && g.away_score !== null && g.home_team_id !== null && g.away_team_id !== null;
}

export type TeamRecord = {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  /** 0108 refuses ties; a tied row from anywhere else is counted, never dropped. */
  ties: number;
  runsFor: number;
  runsAgainst: number;
  played: number;
};

/** Every team's round-robin record, A–Z by name — NEVER sorted by record. */
export function roundRobinRecords(teams: SeededTeam[], games: Stage1Game[]): TeamRecord[] {
  const recs = new Map<string, TeamRecord>(
    teams.map((t) => [t.team_id, {
      teamId: t.team_id, teamName: t.team_name, wins: 0, losses: 0, ties: 0, runsFor: 0, runsAgainst: 0, played: 0,
    }]),
  );
  for (const g of games) {
    if (!countable(g)) continue;
    const home = recs.get(g.home_team_id!);
    const away = recs.get(g.away_team_id!);
    const hs = g.home_score!, as = g.away_score!;
    for (const [r, f, a] of [[home, hs, as], [away, as, hs]] as const) {
      if (!r) continue;
      r.played++;
      r.runsFor += f;
      r.runsAgainst += a;
      if (f > a) r.wins++;
      else if (f < a) r.losses++;
      else r.ties++;
    }
  }
  return [...recs.values()].sort((a, b) =>
    a.teamName < b.teamName ? -1 : a.teamName > b.teamName ? 1 : a.teamId < b.teamId ? -1 : 1,
  );
}

/** "5-1", or "4-1-1" when a tie exists. */
export function recordText(r: TeamRecord): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

// ─── Stage 1 status → the Seed button ─────────────────────────────────────────

export type UnplayedReason = "rained_out" | "no_date" | "past" | "upcoming";
export type UnplayedGame = { game: Stage1Game; reason: UnplayedReason };

export type Stage1Status =
  | { kind: "done"; played: number; total: number }
  | { kind: "seed_anyway"; played: number; total: number; neverPlayed: UnplayedGame[] }
  | { kind: "in_progress"; played: number; total: number; remaining: number };

/** Why a game has no result. A rained-out game wins over its date. */
export function unplayedReason(g: Stage1Game, today: string): UnplayedReason {
  if (g.status === "cancelled") return "rained_out";
  if (!g.scheduled_date) return "no_date";
  return g.scheduled_date < today ? "past" : "upcoming";
}

/**
 * Where Stage 1 stands, with `today` in the LEAGUE's timezone:
 * - done: every game has a result → "Seed Stage 2";
 * - seed_anyway: some games have none, but every one of them is rained out,
 *   undated or dated before today → "Seed anyway" (approved 2026-10-19);
 * - in_progress: a game without a result is dated today or later.
 */
export function stage1Status(games: Stage1Game[], today: string): Stage1Status {
  const total = games.length;
  const without = games.filter((g) => !hasResult(g));
  const played = total - without.length;
  if (without.length === 0) return { kind: "done", played, total };
  const notes = without.map((g) => ({ game: g, reason: unplayedReason(g, today) }));
  if (notes.some((n) => n.reason === "upcoming")) {
    return { kind: "in_progress", played, total, remaining: without.length };
  }
  return { kind: "seed_anyway", played, total, neverPlayed: notes };
}

export function seedButtonLabel(s: Stage1Status): string {
  return s.kind === "seed_anyway" ? "Seed anyway" : "Seed Stage 2";
}

export function seedButtonEnabled(s: Stage1Status): boolean {
  return s.kind !== "in_progress";
}

/** The Stage 1 header's pill. */
export function stage1Pill(s: Stage1Status): string {
  if (s.kind === "done") return `Done · ${s.played} of ${s.total}`;
  if (s.kind === "seed_anyway") return `${s.played} of ${s.total} played · ${s.neverPlayed.length} never played`;
  return `${s.played} of ${s.total} played`;
}

/** The line under the Stage 2 header. */
export function stage2Line(s: Stage1Status): string {
  if (s.kind === "done") {
    return "The round robin is finished. Put the teams in seed order; the top teams go into the bracket.";
  }
  if (s.kind === "seed_anyway") {
    return `The round robin is over with ${plural(s.neverPlayed.length, "game", "games")} never played. ` +
      `You can seed now; the confirm will say so and it goes in the activity log.`;
  }
  return `You can seed Stage 2 once every round-robin game has a result, or once the only games left without one are rained out, have no date, or are already past. ` +
    `${s.remaining} of ${s.total} still need one.`;
}

const REASON_TEXT: Record<Exclude<UnplayedReason, "upcoming">, string> = {
  rained_out: "rained out",
  no_date: "no date",
  past: "no result",
};

// ─── Seeding ──────────────────────────────────────────────────────────────────

/** The Seed screen's starting order: A–Z by name. Never by record. */
export function initialSeedOrder(teams: SeededTeam[]): SeededTeam[] {
  return [...teams].sort((a, b) =>
    a.team_name < b.team_name ? -1 : a.team_name > b.team_name ? 1 : a.team_id < b.team_id ? -1 : 1,
  );
}

export const SEED_SCREEN_LINE = (advance: number) =>
  `Teams start in A–Z order. FieldSlate doesn't rank teams — order them by your league's rules. The top ${advance} go into the bracket.`;

/** Moves the team at `from` up or down one place. Out of range → unchanged. */
export function moveSeed(order: SeededTeam[], from: number, dir: -1 | 1): SeededTeam[] {
  const to = from + dir;
  if (from < 0 || from >= order.length || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** The order must be exactly the Stage 1 teams, once each. */
export function seedOrderProblem(orderIds: string[], stage1TeamIds: string[]): string | null {
  const want = new Set(stage1TeamIds);
  const seen = new Set<string>();
  for (const id of orderIds) {
    if (!want.has(id) || seen.has(id)) {
      return "The seed list doesn't match the round-robin teams. Refresh the page and try again.";
    }
    seen.add(id);
  }
  if (seen.size !== want.size) {
    return "The seed list doesn't match the round-robin teams. Refresh the page and try again.";
  }
  return null;
}

export type SeedWrite = { gameId: string; field: "home_team_id" | "away_team_id"; teamId: string; seed: number };

/** The team-slot writes seeding makes: each slot with seed k gets the k-th
 *  team. Games are matched by id; dates, times, fields and numbers untouched. */
export function seedWrites(
  stage2Games: (Stage2Game & { id: string })[],
  orderIds: string[],
): SeedWrite[] {
  const out: SeedWrite[] = [];
  for (const g of stage2Games) {
    for (const [field, seed] of [["home_team_id", g.seed_home], ["away_team_id", g.seed_away]] as const) {
      if (seed === null) continue;
      const teamId = orderIds[seed - 1];
      if (teamId !== undefined) out.push({ gameId: g.id, field, teamId, seed });
    }
  }
  return out;
}

export type SeedConfirm = { title: string; unplayed: string | null; lines: string[]; notAdvancing: string | null; button: string };

/**
 * What the confirm says before anything is saved: the bye seeds and where
 * they go, every round-1 matchup with its date and time, who doesn't advance,
 * and — for Seed anyway — every game with no result (rained out, no date, or
 * past), whose records leave it out.
 */
export function seedConfirm(input: {
  divisionName: string;
  stage2Games: Stage2Game[];
  order: SeededTeam[];
  advance: number;
  status: Stage1Status;
  teamName: (id: string | null) => string;
}): SeedConfirm {
  const name = (seed: number) => input.order[seed - 1]?.team_name ?? seedLabel(seed);
  const firstRound = input.stage2Games.filter((g) => g.round === "R1");
  const byes: { seed: number; gameNumber: number }[] = [];
  for (const g of input.stage2Games.filter((x) => x.round !== "R1")) {
    for (const seed of [g.seed_home, g.seed_away]) {
      if (seed !== null) byes.push({ seed, gameNumber: g.game_number });
    }
  }
  byes.sort((a, b) => a.seed - b.seed);
  const lines = byes.map((b) => `${name(b.seed)} (${b.seed}) — bye to Game ${b.gameNumber}`);
  for (const g of firstRound) {
    const when = g.scheduled_date
      ? ` · ${shortDate(g.scheduled_date)}${g.start_time ? `, ${shortTime(g.start_time)}` : ""}`
      : " · Date TBD";
    lines.push(`Game ${g.game_number}: ${name(g.seed_home!)} (${g.seed_home}) vs ${name(g.seed_away!)} (${g.seed_away})${when}`);
  }
  const out = input.order.slice(input.advance).map((t) => t.team_name);
  let unplayed: string | null = null;
  if (input.status.kind === "seed_anyway") {
    const list = input.status.neverPlayed.map(({ game, reason }) =>
      `${rrGameLabel(game.game_number)} (${input.teamName(game.home_team_id)} vs ${input.teamName(game.away_team_id)}, ${REASON_TEXT[reason as Exclude<UnplayedReason, "upcoming">]})`,
    );
    const n = input.status.neverPlayed.length;
    unplayed =
      `${plural(n, "round-robin game was", "round-robin games were")} never played and ${n === 1 ? "has" : "have"} no result: ` +
      `${joinList(list)}. Records leave ${n === 1 ? "it" : "them"} out.`;
  }
  return {
    title: `Seed the ${input.divisionName} bracket?`,
    unplayed,
    lines,
    notAdvancing: out.length ? `Not advancing: ${joinList(out)}.` : null,
    button: seedButtonLabel(input.status),
  };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ─── After seeding ────────────────────────────────────────────────────────────

/** Shown in the Edit-result modal of a Stage 1 game once Stage 2 is seeded. */
export const STAGE1_EDIT_AFTER_SEEDING =
  "Stage 2 is already seeded. Changing this result won't change the seeds — you'll be asked to re-check them.";

/**
 * The amber note on Stage 2 after a round-robin result changed post-seeding.
 * `before`/`after` are the records around the change; only teams whose record
 * text moved are named.
 */
export function stage1ChangedNote(input: {
  gameNumber: number;
  now: string;
  was: string | null;
  before: TeamRecord[];
  after: TeamRecord[];
}): string {
  const head = `A round-robin result changed after you seeded the bracket. ${rrGameLabel(input.gameNumber)} is now ${input.now}${input.was ? ` (was ${input.was})` : ""}.`;
  const prev = new Map(input.before.map((r) => [r.teamId, recordText(r)]));
  const moved = input.after
    .filter((r) => prev.has(r.teamId) && prev.get(r.teamId) !== recordText(r))
    .map((r) => `${r.teamName} are now ${recordText(r)} (were ${prev.get(r.teamId)})`);
  const mid = moved.length ? ` ${moved.join("; ")}.` : "";
  return `${head}${mid} Check the seeds still match your league's rules.`;
}

/** A round-robin result can't change, and seeds can't change, once the
 *  bracket has a result (decided 2026-10-19). */
export function stage2StartedRefusal(firstResultGameNumber: number): string {
  return `The bracket has started (Game ${firstResultGameNumber} has a result), so round-robin results can't be changed. Clear the bracket's results first, then change this one.`;
}

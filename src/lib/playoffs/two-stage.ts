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
import { gameNumbering, seedLabel, shortDate, shortTime, type GameNumbering } from "@/lib/playoffs/bracket-labels";
import type {
  DayWindowMap,
  PlayingDay,
  PlayoffWizardData,
  SeededTeam,
  VenueAssignment,
} from "@/components/playoffs/playoff-wizard-types";

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
export function stage2Line(s: Stage1Status, advance?: number): string {
  if (s.kind === "done") {
    const top = advance === undefined ? "the top teams go" : `the top ${advance} go`;
    return `The round robin is finished. Put the teams in seed order; ${top} into the bracket.`;
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
  const shown = gameNumbering(input.stage2Games);
  const firstRound = input.stage2Games.filter((g) => g.round === "R1");
  const byes: { seed: number; gameNumber: number }[] = [];
  for (const g of input.stage2Games.filter((x) => x.round !== "R1")) {
    for (const seed of [g.seed_home, g.seed_away]) {
      if (seed !== null) byes.push({ seed, gameNumber: shown(g.game_number) });
    }
  }
  byes.sort((a, b) => a.seed - b.seed);
  const lines = byes.map((b) => `${name(b.seed)} (${b.seed}) — bye to Game ${b.gameNumber}`);
  for (const g of firstRound) {
    const when = g.scheduled_date
      ? ` · ${shortDate(g.scheduled_date)}${g.start_time ? `, ${shortTime(g.start_time)}` : ""}`
      : " · Date TBD";
    lines.push(`Game ${shown(g.game_number)}: ${name(g.seed_home!)} (${g.seed_home}) vs ${name(g.seed_away!)} (${g.seed_away})${when}`);
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
  return changedNote(
    [`${rrGameLabel(input.gameNumber)} is now ${input.now}${input.was ? ` (was ${input.was})` : ""}`],
    input.before,
    input.after,
  );
}

function changedNote(clauses: string[], before: TeamRecord[], after: TeamRecord[]): string {
  const head =
    clauses.length === 1
      ? "A round-robin result changed after you seeded the bracket."
      : "Round-robin results changed after you seeded the bracket.";
  const prev = new Map(before.map((r) => [r.teamId, recordText(r)]));
  const moved = after
    .filter((r) => prev.has(r.teamId) && prev.get(r.teamId) !== recordText(r))
    .map((r) => `${r.teamName} are now ${recordText(r)} (were ${prev.get(r.teamId)})`);
  const mid = moved.length ? ` ${moved.join("; ")}.` : "";
  return `${head} ${clauses.join("; ")}.${mid} Check the seeds still match your league's rules.`;
}

/** One entry of `playoffs.stage1_changes` (0113): a round-robin game whose
 *  result changed after seeding. `was_*` is its result when the bracket was
 *  seeded (null = none), `now_*` its result now (null = cleared). A game
 *  changed twice keeps one entry: its first "was", its latest "now". */
export type Stage1Change = {
  game_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  was_home: number | null;
  was_away: number | null;
  now_home: number | null;
  now_away: number | null;
};

/** Reads `stage1_changes`; anything that isn't a list of well-formed entries
 *  is null (the card then shows the note without the scores). */
export function parseStage1Changes(raw: unknown): Stage1Change[] | null {
  if (!Array.isArray(raw)) return null;
  const score = (v: unknown) => (v === null || v === undefined ? null : typeof v === "number" && Number.isInteger(v) ? v : NaN);
  const id = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : undefined);
  const out: Stage1Change[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") return null;
    const o = e as Record<string, unknown>;
    const c = {
      game_number: o.game_number as number,
      home_team_id: id(o.home_team_id),
      away_team_id: id(o.away_team_id),
      was_home: score(o.was_home),
      was_away: score(o.was_away),
      now_home: score(o.now_home),
      now_away: score(o.now_away),
    };
    if (!Number.isInteger(c.game_number) || c.home_team_id === undefined || c.away_team_id === undefined) return null;
    if ([c.was_home, c.was_away, c.now_home, c.now_away].some((s) => Number.isNaN(s))) return null;
    out.push(c as Stage1Change);
  }
  return out;
}

/** "Royals 6, Mets 4" — the winner first; a tie reads home first. */
export function scoreLine(homeName: string, awayName: string, home: number, away: number): string {
  return away > home ? `${awayName} ${away}, ${homeName} ${home}` : `${homeName} ${home}, ${awayName} ${away}`;
}

/**
 * The amber re-check note, built from what changed (`stage1_changes`) and the
 * games as they are now. Each changed game is named with its score before and
 * after; the records before are the records now with each changed game put
 * back to its "was" result. A game whose result ended where it started is not
 * named. With nothing to name (or the changes unreadable), the note falls
 * back to `stage1RecheckNote`.
 */
export function stage1ChangesNote(input: {
  changes: Stage1Change[] | null;
  games: Stage1Game[];
  teams: SeededTeam[];
  teamName: (id: string | null) => string;
  changedOn: string | null;
}): string {
  const net = (input.changes ?? [])
    .filter((c) => c.was_home !== c.now_home || c.was_away !== c.now_away)
    .sort((a, b) => a.game_number - b.game_number);
  if (net.length === 0) return stage1RecheckNote(input.changedOn);
  const byNumber = new Map(net.map((c) => [c.game_number, c]));
  const before = roundRobinRecords(
    input.teams,
    input.games.map((g) => {
      const c = byNumber.get(g.game_number);
      return c ? { ...g, home_score: c.was_home, away_score: c.was_away } : g;
    }),
  );
  const after = roundRobinRecords(input.teams, input.games);
  const clauses = net.map((c) => {
    const home = input.teamName(c.home_team_id);
    const away = input.teamName(c.away_team_id);
    const rr = rrGameLabel(c.game_number);
    const was = c.was_home !== null && c.was_away !== null ? scoreLine(home, away, c.was_home, c.was_away) : null;
    const now = c.now_home !== null && c.now_away !== null ? scoreLine(home, away, c.now_home, c.now_away) : null;
    if (now === null) return `${rr}'s result was cleared${was ? ` (was ${was})` : ""}`;
    return `${rr} is now ${now}${was ? ` (was ${was})` : " (it had no result)"}`;
  });
  return changedNote(clauses, before, after);
}

/** A round-robin result can't change, and seeds can't change, once the
 *  bracket has a result (decided 2026-10-19). */
/** `firstResultGameNumber` is the SHOWN number (bracket-labels `gameNumbering`). */
export function stage2StartedRefusal(firstResultGameNumber: number): string {
  return `The bracket has started (Game ${firstResultGameNumber} has a result), so round-robin results can't be changed. Clear the bracket's results first, then change this one.`;
}

// ─── The playoffs page: card, pills and lines ─────────────────────────────────

/** The card's subtitle: "Round robin, then bracket · 7 teams · top 6 advance". */
export function twoStageCardLine(teamCount: number, advance: number): string {
  return `Round robin, then bracket · ${plural(teamCount, "team", "teams")} · top ${advance} advance`;
}

export type PillTone = "gray" | "green" | "amber";
export type Pill = { text: string; tone: PillTone };

/** The Stage 1 header's pill, with its tone. Locked once the bracket has a
 *  result (decided 2026-10-19). */
export function stage1HeaderPill(s: Stage1Status, bracketStarted: boolean): Pill {
  if (bracketStarted) return { text: "Locked", tone: "gray" };
  if (s.kind === "done") return { text: stage1Pill(s), tone: "green" };
  if (s.kind === "seed_anyway") return { text: stage1Pill(s), tone: "amber" };
  return { text: stage1Pill(s), tone: "gray" };
}

export type Stage2State = {
  seeded: boolean;
  /** A round-robin result changed after seeding and nobody has re-checked. */
  recheck: boolean;
  /** The lowest-numbered bracket game with a result, or null. */
  firstResultGame: number | null;
  status: Stage1Status;
};

/** The Stage 2 header's pill. */
export function stage2HeaderPill(s: Stage2State): Pill {
  if (s.firstResultGame !== null) return { text: "In progress", tone: "green" };
  if (s.seeded && s.recheck) return { text: "Re-check seeds", tone: "amber" };
  if (s.seeded) return { text: "Seeded", tone: "green" };
  if (s.status.kind !== "in_progress") return { text: "Ready to seed", tone: "amber" };
  return { text: "Not seeded", tone: "gray" };
}

/** The Stage 2 header's button: its label, and why it is off (null = on). */
export function stage2Button(s: Stage2State): { label: string; disabledReason: string | null } {
  if (s.seeded) {
    return {
      label: "Change seeds",
      disabledReason: s.firstResultGame !== null ? "The bracket has started, so the seeds can't be changed." : null,
    };
  }
  return {
    label: seedButtonLabel(s.status),
    disabledReason: seedButtonEnabled(s.status) ? null : stage2Line(s.status),
  };
}

/** The line under Stage 1's header once the bracket has a result. */
/** `firstResultGame` is the SHOWN number (bracket-labels `gameNumbering`). */
export function stage1LockedLine(firstResultGame: number): string {
  return `The bracket has started (Game ${firstResultGame} has a result), so round-robin results can't be changed. To change one, clear the bracket's results first.`;
}

/** "Never played: RR Game 8 (Mets vs Giants, rained out Oct 25) and RR Game 17
 *  (Lions vs Royals, Nov 7, no result). Enter a result if they were played;
 *  otherwise records leave them out." */
export function neverPlayedLine(neverPlayed: UnplayedGame[], teamName: (id: string | null) => string): string {
  const items = neverPlayed.map(({ game, reason }) => {
    const teams = `${teamName(game.home_team_id)} vs ${teamName(game.away_team_id)}`;
    const date = game.scheduled_date ? monthDay(game.scheduled_date) : null;
    const why =
      reason === "rained_out" ? `rained out${date ? ` ${date}` : ""}`
        : reason === "no_date" ? "no date"
          : `${date ? `${date}, ` : ""}no result`;
    return `${rrGameLabel(game.game_number)} (${teams}, ${why})`;
  });
  const them = neverPlayed.length === 1 ? "it" : "them";
  return `Never played: ${joinList(items)}. Enter a result if ${neverPlayed.length === 1 ? "it was" : "they were"} played; otherwise records leave ${them} out.`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 25" from "2026-10-25". String arithmetic only — no zone can shift it. */
export function monthDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Seeded Nov 9 by Jenn M. · Not advancing: Giants" — `seededOn` is the
 *  date in the league's timezone; a name that couldn't be read is left out. */
export function seededLine(seededOn: string, byName: string | null, notAdvancing: string[]): string {
  const who = byName ? ` by ${byName}` : "";
  const out = notAdvancing.length ? ` · Not advancing: ${joinList(notAdvancing)}` : "";
  return `Seeded ${monthDay(seededOn)}${who}${out}`;
}

/**
 * The re-check note when there is no changed game to name: the changes are
 * unreadable, or every changed result ended where it started. Points at the
 * records, which are always current. `stage1ChangesNote` is the usual note.
 */
export function stage1RecheckNote(changedOn: string | null): string {
  return (
    `A round-robin result changed after you seeded the bracket${changedOn ? ` (${monthDay(changedOn)})` : ""}. ` +
    `The seeds didn't move. Check the records above and make sure the seeds still match your league's rules.`
  );
}

export const RECHECK_KEPT = "Seeds are still right";

/** Records' footnote on the Seed screen. */
export function recordsFootnote(total: number, neverPlayed: number): string {
  if (neverPlayed > 0) {
    return `Records leave out ${plural(neverPlayed, "game that was", "games that were")} never played. Regular-season games aren't included.`;
  }
  return `Records count the ${plural(total, "round-robin game", "round-robin games")} only. Regular-season games aren't included.`;
}

/** The dashed line in the Seed list. */
export function cutLine(advance: number): string {
  return `↑ Top ${advance} advance · not advancing ↓`;
}

/** A stage's date range: "Oct 24 – Nov 8", or "Nov 14 – 22" within a month. */
export function stageRange(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  if (start === end) return monthDay(start);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${monthDay(start)} – ${Number(end.slice(8, 10))}`;
  return `${monthDay(start)} – ${monthDay(end)}`;
}

// ─── The wizard's payloads ────────────────────────────────────────────────────

export type StageSettings = {
  format: "round_robin" | "single_elimination";
  seeding: SeededTeam[];
  start_date: string | null;
  end_date: string | null;
  playing_days: PlayingDay[];
  day_windows: DayWindowMap;
  venue_assignments: VenueAssignment[];
  games_per_team_per_day: 1 | 2;
  advance_count?: number;
};

/** Stage 2's fields: Stage 1's when "Same fields as Stage 1" is on. */
export function stage2Venues(data: PlayoffWizardData): VenueAssignment[] {
  return data.stage2.same_fields ? data.venue_assignments : data.stage2.venue_assignments;
}

/** What replace_two_stage_games writes for Stage 1 — the round robin of the
 *  teams IN (the excluded ones are never sent). */
export function stage1SettingsPayload(data: PlayoffWizardData, teamsIn: SeededTeam[]): StageSettings {
  return {
    format: "round_robin",
    seeding: teamsIn,
    start_date: data.start_date || null,
    end_date: data.end_date || null,
    playing_days: data.playing_days,
    day_windows: data.day_windows,
    venue_assignments: data.venue_assignments,
    games_per_team_per_day: data.games_per_team_per_day,
  };
}

/** What replace_two_stage_games writes for Stage 2: no teams, the advancing
 *  count, its own dates and limit. */
export function stage2SettingsPayload(data: PlayoffWizardData): StageSettings {
  return {
    format: "single_elimination",
    seeding: [],
    start_date: data.stage2.start_date || null,
    end_date: data.stage2.end_date || null,
    playing_days: data.stage2.playing_days,
    day_windows: data.stage2.day_windows,
    venue_assignments: stage2Venues(data),
    games_per_team_per_day: data.stage2.games_per_team_per_day,
    advance_count: data.advance_count,
  };
}

/** Stage 2's planned games for the function: seeds, never teams. */
export function stage2GamesPayload(games: Stage2Game[]) {
  return games.map((g) => ({
    round: g.round,
    game_number: g.game_number,
    home_team_id: null,
    away_team_id: null,
    seed_home: g.seed_home,
    seed_away: g.seed_away,
    venue_id: g.venue_id,
    scheduled_date: g.scheduled_date,
    start_time: g.start_time,
  }));
}

/** Review's one-line summary per stage: "21 games · Oct 24 – Nov 8 · Sat, Sun". */
export function stageReviewLine(games: number, start: string, end: string, days: string[]): string {
  const range = stageRange(start || null, end || null) ?? "No dates";
  const dayText = days.length ? days.map((d) => DAY_SHORT[d] ?? d).join(", ") : "No days";
  return `${plural(games, "game", "games")} · ${range} · ${dayText}`;
}

const DAY_SHORT: Record<string, string> = {
  Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun",
};

/** "Top 6 · byes for seeds 1–2" */
export function advancingReviewLine(advance: number): string {
  const byes = stage2Byes(advance);
  return `Top ${advance}${byes === 0 ? "" : byes === 1 ? " · a bye for seed 1" : ` · byes for seeds 1–${byes}`}`;
}

/** "1 game per team per day" */
export function perDayLine(n: 1 | 2): string {
  return `${n} game${n === 1 ? "" : "s"} per team per day`;
}

/** Review's note about Stage 2's placeholders. */
export const STAGE2_PLACEHOLDER_NOTE =
  "Stage 2 is set up with dates and fields now. Its teams read \"Seed 1\", \"Seed 4\"… until you seed it after the round robin.";

// ─── replace_two_stage_games: the reply and its refusals ──────────────────────

export type TwoStageCounts = {
  rebuildStage1: boolean;
  keepsSeeds: boolean;
  stage1Games: number;
  stage2Games: number;
  newStage1Games: number;
  newStage2Games: number;
  publicGames: number;
  publicGamesAfter: number;
};

function nonNeg(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** The reply's counts, or null if any is unreadable (never zeros). */
export function parseTwoStageCounts(raw: unknown): TwoStageCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.stage1_games, r.stage2_games, r.new_stage1_games, r.new_stage2_games, r.public_games, r.public_games_after].map(nonNeg);
  if (nums.some((n) => n === null) || typeof r.rebuild_stage1 !== "boolean" || typeof r.keeps_seeds !== "boolean") {
    return null;
  }
  const [stage1Games, stage2Games, newStage1Games, newStage2Games, publicGames, publicGamesAfter] = nums as number[];
  return {
    rebuildStage1: r.rebuild_stage1, keepsSeeds: r.keeps_seeds,
    stage1Games, stage2Games, newStage1Games, newStage2Games, publicGames, publicGamesAfter,
  };
}

const NOTHING_SAVED = "Nothing was saved.";

/** A blocked two-stage reply → its sentence. `stage2` maps the reply's stored
 *  Stage 2 position to the shown number; null (unknown) names no game. */
export function twoStageBlockedMessage(raw: unknown, stage2: GameNumbering | null): string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const reasons = Array.isArray(r.reasons) ? r.reasons : [];
  if (reasons.includes("stage2_started")) {
    const stored = nonNeg(r.stage2_game_number);
    const n = stored !== null && stage2 ? stage2(stored) : null;
    return `${NOTHING_SAVED} The bracket has started${n !== null ? ` (Game ${n} has a result)` : ""}, so neither stage can be rebuilt. Clear the bracket's results first.`;
  }
  if (reasons.includes("results_entered")) {
    const n = nonNeg(r.games_with_results);
    return `${NOTHING_SAVED} The round robin has ${n !== null ? plural(n, "result", "results") : "results"} entered, so only Stage 2's dates, days and fields can change now.`;
  }
  return `${NOTHING_SAVED} This setup can't be rebuilt right now. Refresh the page and try again.`;
}

const TWO_STAGE_REFUSALS: Record<string, string> = {
  stage_order: `${NOTHING_SAVED} Stage 2 has to start after Stage 1's last date.`,
  not_a_pair: `${NOTHING_SAVED} These two stages don't belong together any more. Refresh the page.`,
  two_stage_pair: `${NOTHING_SAVED} This bracket is part of a "round robin, then bracket" setup. Edit it from its card.`,
  not_stage2: `${NOTHING_SAVED} This isn't a Stage 2 bracket. Refresh the page.`,
  invalid_order: `${NOTHING_SAVED} The seed list doesn't match the round-robin teams. Refresh the page and try again.`,
};

/** Every refusal key 0113 adds — with the shared ones (bracketErrorMessage),
 *  the sim pins this list against the migration file. */
export const TWO_STAGE_REFUSAL_KEYS = Object.keys(TWO_STAGE_REFUSALS);

/** A two-stage function error → its sentence; anything else falls through
 *  to `fallback` (the shared bracket refusals). */
export function twoStageErrorMessage(raw: string, fallback: (raw: string) => string): string {
  for (const key of TWO_STAGE_REFUSAL_KEYS) {
    if (raw.includes(key)) return TWO_STAGE_REFUSALS[key];
  }
  return fallback(raw);
}

/** What Review says about an EXISTING two-stage setup before Generate. */
export function twoStageReviewLines(c: TwoStageCounts): string[] {
  const lines: string[] = [];
  if (!c.rebuildStage1) {
    lines.push(
      `The round robin has results, so only Stage 2 is rebuilt: its ${plural(c.stage2Games, "game", "games")} ` +
        `${c.stage2Games === 1 ? "is" : "are"} replaced with ${plural(c.newStage2Games, "new game", "new games")}.` +
        (c.keepsSeeds ? " The seeds you set are kept." : ""),
    );
  } else if (c.stage1Games + c.stage2Games > 0) {
    lines.push(
      `Generating replaces both stages' ${plural(c.stage1Games + c.stage2Games, "game", "games")} with ` +
        `${plural(c.newStage1Games + c.newStage2Games, "new game", "new games")}.`,
    );
  }
  return lines;
}

// ─── seed_playoff_stage: the reply and its refusals ───────────────────────────

export type SeedReply = {
  reseed: boolean;
  advanceCount: number;
  neverPlayed: { gameNumber: number; homeName: string | null; awayName: string | null; reason: "rained_out" | "no_date" | "past" }[];
};

/** A readable seed reply for THIS Stage 2, or null. */
export function parseSeedReply(raw: unknown, stage2Id: string): SeedReply | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r || r.stage2_id !== stage2Id || typeof r.reseed !== "boolean") return null;
  const adv = nonNeg(r.advance_count);
  if (adv === null || !Array.isArray(r.never_played)) return null;
  const never: SeedReply["neverPlayed"] = [];
  for (const n of r.never_played as Record<string, unknown>[]) {
    const gn = nonNeg(n?.game_number);
    const reason = n?.reason;
    if (gn === null || (reason !== "rained_out" && reason !== "no_date" && reason !== "past")) return null;
    never.push({
      gameNumber: gn,
      homeName: typeof n.home_name === "string" ? n.home_name : null,
      awayName: typeof n.away_name === "string" ? n.away_name : null,
      reason,
    });
  }
  return { reseed: r.reseed, advanceCount: adv, neverPlayed: never };
}

/** A blocked seed reply → its sentence (`stage2` as twoStageBlockedMessage). */
export function seedBlockedMessage(raw: unknown, stage2: GameNumbering | null): string {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.reason === "bracket_started") {
    const stored = nonNeg(r.stage2_game_number);
    const n = stored !== null && stage2 ? stage2(stored) : null;
    return `${NOTHING_SAVED} The bracket has started${n !== null ? ` (Game ${n} has a result)` : ""}, so the seeds can't be changed. Clear the bracket's results first.`;
  }
  if (r.reason === "stage1_in_progress") {
    const n = nonNeg(r.upcoming);
    return `${NOTHING_SAVED} The round robin isn't over yet${n !== null && n > 0 ? `: ${plural(n, "game is", "games are")} still to come` : ""}. Seed Stage 2 once every game has a result, or once the only ones left are rained out, undated or past.`;
  }
  return `${NOTHING_SAVED} Stage 2 can't be seeded right now. Refresh the page and try again.`;
}

export type SeedOutcome = { ok: true; reply: SeedReply } | { ok: false; message: string };

/** A seed preview (`commit` false) or commit (`commit` true) → success only
 *  when the reply is readable, for this Stage 2, and committed as asked. */
export function seedOutcome(
  data: unknown,
  error: { message: string } | null,
  stage2Id: string,
  commit: boolean,
  errorMessage: (raw: string) => string,
  stage2: GameNumbering | null,
): SeedOutcome {
  if (error) return { ok: false, message: errorMessage(error.message) };
  const r = (data ?? null) as Record<string, unknown> | null;
  if (r && r.blocked === true) return { ok: false, message: seedBlockedMessage(r, stage2) };
  const reply = parseSeedReply(data, stage2Id);
  if (!r || r.committed !== commit || !reply) {
    return {
      ok: false,
      message: commit
        ? `${NOTHING_SAVED} The save didn't confirm. Refresh the page to see what's there.`
        : "Couldn't check the seeds before saving. Nothing was changed. Try again.",
    };
  }
  return { ok: true, reply };
}

/** The public schedule line on the seed confirm. */
export function seedPublicLine(publicStage2Games: number): string | null {
  if (publicStage2Games <= 0) return null;
  return `${plural(publicStage2Games, "bracket game is", "bracket games are")} on the public schedule. Families will see team names instead of seeds within a minute.`;
}

// ─── Review: when everything fits ─────────────────────────────────────────────

/** "all 21 games fit (28 slots)." — only when nothing is TBD. */
export function stage1FitLine(gameCount: number, slotCount: number): string {
  return `all ${plural(gameCount, "game", "games")} ${gameCount === 1 ? "fits" : "fit"} (${plural(slotCount, "slot", "slots")}).`;
}

const STAGE2_ROUND_WORDS: Record<string, string> = { F: "final", SF: "semifinals" };

/** "all 5 games fit — round 1 Sat 11/14, semifinals Sun 11/15, final Sat 11/21."
 *  Each round named once, at its first dated game. */
export function stage2FitLine(games: Stage2Game[]): string {
  const firstByRound = new Map<string, string>();
  for (const g of [...games].sort((a, b) => a.game_number - b.game_number)) {
    if (!g.scheduled_date) continue;
    const cur = firstByRound.get(g.round);
    if (!cur || g.scheduled_date < cur) firstByRound.set(g.round, g.scheduled_date);
  }
  const order = (r: string) => (r === "F" ? 1000 : r === "SF" ? 999 : Number(r.replace(/\D/g, "")) || 0);
  const parts = [...firstByRound.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([round, date]) => `${STAGE2_ROUND_WORDS[round] ?? `round ${round.replace(/\D/g, "")}`} ${shortDate(date)}`);
  const head = `all ${plural(games.length, "game", "games")} ${games.length === 1 ? "fits" : "fit"}`;
  return parts.length ? `${head} — ${parts.join(", ")}.` : `${head}.`;
}

/** Review's refusal in a Stage-2-only rebuild when the team list or the
 *  advancing count was changed (decided 2026-10-19, D5/D6). */
export const STAGE1_LOCKED_SETUP =
  "The round robin has results, so the team list and the number advancing can't change. Put them back as they were, or clear the round robin's results first.";

/** The success screen's public line, from the commit's counts. */
export function twoStagePublicLine(publicGamesAfter: number): string | null {
  if (publicGamesAfter <= 0) return null;
  return `${plural(publicGamesAfter, "of these games is", "of these games are")} now on your public schedule.`;
}

/** "7 (Cubs left out)" */
export function teamsReviewLine(teamCount: number, leftOut: string[]): string {
  return leftOut.length ? `${teamCount} (${joinList(leftOut)} left out)` : String(teamCount);
}

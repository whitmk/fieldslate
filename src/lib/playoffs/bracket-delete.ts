// Delete a playoff bracket; rebuild one — every decision and every sentence
// the surfaces show. Pure: no I/O, no clock. The database side is 0107
// (delete_playoff_bracket, replace_playoff_games), proven by
// scripts/sim/playoff-bracket-delete-sim.sql; this file is proven by
// `npm run sim:bracket-delete`.
//
// RULES (decided 2026-10-08):
// - Deleting a whole bracket is allowed even with results; the confirm states
//   the games, the dated games, the games with results and the games on the
//   public schedule.
// - Rebuilding is refused while any game has a result.
// - The division lock gates neither. When the bracket's games are on the
//   public schedule, the confirm / review SAYS SO instead.
// - A count we could not read is "couldn't count", NEVER 0. A 0 on a
//   destructive confirm is the worst possible failure mode (CLAUDE.md,
//   Division deletion).
// - Every surface renders these sentences VERBATIM; never hand-write one.

import type { GameInsert } from "@/lib/playoffs/bracket-plan";
import type { PlayoffWizardData } from "@/components/playoffs/playoff-wizard-types";

// ─── The RPC replies ──────────────────────────────────────────────────────────

/** The counts both functions return, parsed. Null when the reply could not be
 *  read — never a default of zeros. */
export type BracketCounts = {
  games: number;
  datedGames: number;
  gamesWithResults: number;
  publicGames: number;
};

export type RebuildCounts = BracketCounts & {
  newGames: number;
  newDatedGames: number;
  publicGamesAfter: number;
  blocked: boolean;
};

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** delete_playoff_bracket's reply → counts, or null if ANY count is missing or
 *  not a non-negative integer. */
export function parseDeleteCounts(raw: unknown): BracketCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const games = count(r.games);
  const datedGames = count(r.dated_games);
  const gamesWithResults = count(r.games_with_results);
  const publicGames = count(r.public_games);
  if (games === null || datedGames === null || gamesWithResults === null || publicGames === null) return null;
  return { games, datedGames, gamesWithResults, publicGames };
}

/** replace_playoff_games's reply → counts, or null if anything is unreadable. */
export function parseRebuildCounts(raw: unknown): RebuildCounts | null {
  const base = parseDeleteCounts(raw);
  if (!base) return null;
  const r = raw as Record<string, unknown>;
  const newGames = count(r.new_games);
  const newDatedGames = count(r.new_dated_games);
  const publicGamesAfter = count(r.public_games_after);
  if (newGames === null || newDatedGames === null || publicGamesAfter === null) return null;
  if (typeof r.blocked !== "boolean") return null;
  return { ...base, newGames, newDatedGames, publicGamesAfter, blocked: r.blocked };
}

// ─── Wording helpers ──────────────────────────────────────────────────────────

function n(k: number, one: string, many: string): string {
  return `${k} ${k === 1 ? one : many}`;
}

const NOTHING = "Nothing was saved.";

// ─── Delete confirm ───────────────────────────────────────────────────────────

export type DeleteConfirm = {
  title: string;
  /** Plain lines, in order. */
  lines: string[];
  /** The public-schedule line, shown as a warning. Null when none of the
   *  games are on it. */
  publicWarning: string | null;
};

export const COULDNT_COUNT =
  "We couldn't count this bracket's games, so we can't tell you how many will be deleted, whether any have results, or whether any are on your public schedule.";

/**
 * The confirm dialog for deleting a whole bracket. `counts` is the PREVIEW
 * call's reply, or null when it failed — which renders "couldn't count",
 * never zero.
 */
export function deleteConfirm(divisionName: string, counts: BracketCounts | null): DeleteConfirm {
  const title = `Delete the ${divisionName} playoff bracket?`;
  const last = "This can't be undone.";
  if (!counts) {
    return { title, lines: [COULDNT_COUNT, last], publicWarning: null };
  }
  const lines: string[] = [];
  if (counts.games === 0) {
    lines.push("This deletes the bracket's setup. It has no games yet.");
  } else {
    const dated =
      counts.datedGames === counts.games
        ? counts.games === 1 ? "it has a date" : "all have dates"
        : counts.datedGames === 0
          ? "none have dates yet"
          : `${counts.datedGames} with a date`;
    lines.push(`This deletes the bracket and ${counts.games === 1 ? "its 1 game" : `all ${counts.games} of its games`} (${dated}).`);
  }
  if (counts.gamesWithResults > 0) {
    lines.push(
      `${n(counts.gamesWithResults, "game has", "games have")} a result entered. ${counts.gamesWithResults === 1 ? "That result is" : "Those results are"} deleted too.`,
    );
  }
  lines.push(last);
  return { title, lines, publicWarning: publicDeleteWarning(counts.publicGames) };
}

export function publicDeleteWarning(publicGames: number): string | null {
  if (publicGames <= 0) return null;
  return `${n(publicGames, "of these games is", "of these games are")} on your public schedule right now. Families will stop seeing ${publicGames === 1 ? "it" : "them"} there within a minute. ${publicGames === 1 ? "It drops" : "They drop"} off subscribed calendars when those calendars next refresh, which can take several hours.`;
}

/** What the page says after a confirmed delete — from the COMMIT's own reply,
 *  which was counted inside the delete's transaction. */
export function deletedLine(divisionName: string, committed: BracketCounts | null): string {
  if (!committed) return `The ${divisionName} playoff bracket was deleted.`;
  if (committed.games === 0) return `The ${divisionName} playoff bracket was deleted.`;
  return `The ${divisionName} playoff bracket and its ${n(committed.games, "game", "games")} were deleted.`;
}

// ─── Rebuild (wizard Review) ──────────────────────────────────────────────────

export function resultsBlockSentence(gamesWithResults: number): string {
  return `This bracket can't be rebuilt: ${n(gamesWithResults, "game has", "games have")} a result entered. Results must be cleared before a bracket is rebuilt.`;
}

export type RebuildReview = {
  /** Generate is refused — show `refusal` and disable Generate. */
  blocked: boolean;
  refusal: string | null;
  lines: string[];
  publicWarning: string | null;
};

export const REBUILD_COULDNT_COUNT =
  "We couldn't check this bracket's current games, so we can't tell you what generating will replace or whether any are on your public schedule.";

/**
 * What the wizard's Review step says before Generate on an EXISTING bracket.
 * `counts` is replace_playoff_games's preview, or null when it failed.
 * A failed preview does NOT block: the commit runs every check again and
 * refuses with its own reason, so the worst case is a stated refusal.
 */
export function rebuildReview(counts: RebuildCounts | null): RebuildReview {
  if (!counts) return { blocked: false, refusal: null, lines: [REBUILD_COULDNT_COUNT], publicWarning: null };
  if (counts.blocked || counts.gamesWithResults > 0) {
    return { blocked: true, refusal: resultsBlockSentence(Math.max(1, counts.gamesWithResults)), lines: [], publicWarning: null };
  }
  const lines: string[] = [];
  if (counts.games > 0) {
    lines.push(`Generating replaces this bracket's ${n(counts.games, "game", "games")} with ${n(counts.newGames, "new game", "new games")}.`);
  }
  return { blocked: false, refusal: null, lines, publicWarning: publicRebuildWarning(counts.publicGames, counts.publicGamesAfter) };
}

export function publicRebuildWarning(now: number, after: number): string | null {
  if (now <= 0 && after <= 0) return null;
  if (now > 0 && after > 0) {
    return `${n(now, "of this bracket's games is", "of this bracket's games are")} on your public schedule now. Families will see the new dates and times there within a minute.`;
  }
  if (now > 0) {
    return `${n(now, "of this bracket's games is", "of this bracket's games are")} on your public schedule now. The new games have no dates yet, so ${now === 1 ? "it" : "they"} will disappear from it within a minute.`;
  }
  return `${n(after, "of the new games", "of the new games")} will appear on your public schedule within a minute.`;
}

/** The success screen's public line, from the COMMIT's reply. */
export function generatedPublicLine(counts: RebuildCounts | null): string | null {
  if (!counts || counts.publicGamesAfter <= 0) return null;
  return `${n(counts.publicGamesAfter, "of these games is", "of these games are")} now on your public schedule.`;
}

// ─── Refusals ─────────────────────────────────────────────────────────────────

const REFUSALS: Record<string, string> = {
  playoff_not_found: `${NOTHING} This bracket no longer exists — someone may have deleted it. Refresh the page.`,
  not_authorized: `${NOTHING} You're not an admin of this league.`,
  plan_required: `${NOTHING} Playoff brackets are part of the Elite plan.`,
  results_entered: `${NOTHING} This bracket has results entered. Results must be cleared before a bracket is rebuilt.`,
  invalid_settings: `${NOTHING} The bracket's settings couldn't be read. Go back through the steps and try again.`,
  invalid_games: `${NOTHING} The planned games couldn't be read. Go back through the steps and try again.`,
  no_games: `${NOTHING} No games could be planned for this bracket.`,
  team_not_in_season: `${NOTHING} A team in the bracket isn't in this season any more. Check the seeding and try again.`,
  venue_not_in_org: `${NOTHING} A field in the bracket isn't one of your fields any more. Check the venues step and try again.`,
  nothing_saved: `${NOTHING} The new games didn't all save, so the bracket was left as it was.`,
  nothing_deleted: `${NOTHING} The bracket was already gone. Refresh the page.`,
  invalid_arguments: `${NOTHING} Something went wrong sending the request. Try again.`,
};

/** Every refusal key 0107 raises — the sim pins this list against the
 *  migration file so a new key cannot ship without a sentence. */
export const BRACKET_REFUSAL_KEYS = Object.keys(REFUSALS);

/** A function error → the sentence to show. An unknown error says nothing was
 *  saved and carries the raw text; it is never treated as success. */
export function bracketErrorMessage(raw: string): string {
  for (const key of BRACKET_REFUSAL_KEYS) {
    if (raw.includes(key)) return REFUSALS[key];
  }
  return `${NOTHING} ${raw}`.trim();
}

/** A commit's outcome. Success must come back committed with readable counts;
 *  anything else is reported as nothing saved, never as success. */
export function commitOutcome<T>(
  data: unknown,
  error: { message: string } | null,
  parse: (raw: unknown) => T | null,
): { ok: true; counts: T } | { ok: false; message: string; blockedCounts?: T } {
  if (error) return { ok: false, message: bracketErrorMessage(error.message) };
  const r = (data ?? null) as { committed?: unknown; blocked?: unknown; reasons?: unknown } | null;
  const parsed = parse(data);
  if (r && r.blocked === true) {
    return { ok: false, message: REFUSALS.results_entered, blockedCounts: parsed ?? undefined };
  }
  if (!r || r.committed !== true || parsed === null) {
    return { ok: false, message: `${NOTHING} The save didn't confirm. Refresh the page to see what's there.` };
  }
  return { ok: true, counts: parsed };
}

// ─── Add bracket ──────────────────────────────────────────────────────────────

/** Why a division can't get a new bracket, or null. Picking a division that
 *  already has one is BLOCKED — there is no overwrite. */
export function addBracketBlock(divisionName: string, hasBracket: boolean): string | null {
  if (!hasBracket) return null;
  return `${divisionName} already has a playoff bracket. To change it, use Edit setup on its card; to start over, delete it there first.`;
}

// ─── RPC payloads ─────────────────────────────────────────────────────────────

/** The settings replace_playoff_games writes. The division is NOT in it: a
 *  bracket's division never changes. */
export function settingsPayload(data: PlayoffWizardData) {
  const cross = data.cross_division_enabled && data.cross_division_opponent_id !== "";
  return {
    format: data.format,
    seeding: data.seeding,
    start_date: data.start_date || null,
    end_date: data.end_date || null,
    playing_days: data.playing_days,
    day_windows: data.day_windows,
    venue_assignments: data.venue_assignments,
    cross_division_enabled: data.cross_division_enabled,
    cross_division_opponent_id: cross ? data.cross_division_opponent_id : null,
  };
}

/** The planned games, without the ids the function takes from the bracket
 *  row (playoff, league, division) and without a status (always scheduled). */
export function gamesPayload(games: GameInsert[]) {
  return games.map((g) => ({
    round: g.round,
    game_number: g.game_number,
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    venue_id: g.venue_id,
    scheduled_date: g.scheduled_date,
    start_time: g.start_time,
  }));
}

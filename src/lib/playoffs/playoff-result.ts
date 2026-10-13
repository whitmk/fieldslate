// Entering and clearing a playoff result — every decision and every sentence.
// Pure: no Supabase, no React, no clock (`npm run sim:playoff-result`). The I/O
// lives in enter-result.ts and clear-result.ts; the database functions are
// enter_playoff_result and clear_playoff_result (0108), which share ONE
// advancement rule (playoff_single_elim_target, a port of
// computeSingleElimAdvancement — the two are pinned to one table, see 0108).
//
// Render every sentence VERBATIM. A reply counts as success only when it comes
// back committed FOR THE GAME THAT WAS ASKED ABOUT; anything else says nothing
// was saved.

export const NOTHING = "Nothing was saved.";

// ─── Which path a format takes ────────────────────────────────────────────────

/** Single elimination and round robin go through the database functions.
 *  Double elimination keeps the original browser path (untested format, not
 *  regressed — decided 2026-10-13) and has no clear. */
export function resultPath(format: string): "database" | "browser" {
  return format === "double_elimination" ? "browser" : "database";
}

/** Whether "Clear result" is offered for a format. */
export function clearOffered(format: string): boolean {
  return resultPath(format) === "database";
}

// ─── Labels ───────────────────────────────────────────────────────────────────

/** A round's name for people. The bracket view uses this one too. */
export function playoffRoundLabel(round: string): string {
  const map: Record<string, string> = {
    F: "Final", SF: "Semifinals",
    "WB-F": "Winners Final", "LB-F": "Losers Final",
    GF: "Grand Final", "GF-R": "Grand Final (Reset)",
  };
  if (round in map) return map[round];
  if (round.startsWith("RR")) return `Round ${round.slice(2)}`;
  if (round.startsWith("WB-R")) return `Winners Rd ${round.slice(4)}`;
  if (round.startsWith("LB-R")) return `Losers Rd ${round.slice(4)}`;
  if (round.startsWith("R")) return `Round ${round.slice(1)}`;
  return round;
}

export function gameLabel(gameNumber: number, round: string): string {
  return `Game ${gameNumber} (${playoffRoundLabel(round)})`;
}

// ─── Refusals ─────────────────────────────────────────────────────────────────

/** The way out of a format or bracket that can't be cleared — never a dead end. */
const START_OVER = "To start over, delete the bracket and build it again — deleting is allowed even with results.";

export const DOUBLE_ELIM_CLEAR_REFUSAL =
  `Clearing results isn't available for double-elimination brackets yet. ${START_OVER}`;

const REFUSALS: Record<string, string> = {
  invalid_arguments: `${NOTHING} Something went wrong sending the request. Try again.`,
  invalid_scores: `${NOTHING} Enter valid scores for both teams.`,
  tied_score: `${NOTHING} Scores can't be tied — one team must win.`,
  game_not_found: `${NOTHING} This game no longer exists — the bracket may have been rebuilt or deleted. Refresh the page.`,
  not_authorized: `${NOTHING} You're not an admin of this league.`,
  plan_required: `${NOTHING} Playoff brackets are part of the Elite plan.`,
  format_not_supported: DOUBLE_ELIM_CLEAR_REFUSAL,
  teams_missing: `${NOTHING} Both teams have to be set before a result can be entered.`,
  game_cancelled: `${NOTHING} This game is cancelled.`,
  slot_occupied: `${NOTHING} The next game already has a different team in the spot this game's winner moves into, so FieldSlate won't overwrite it. ${START_OVER}`,
  no_result: `${NOTHING} This game has no result to clear. Refresh the page to see the latest.`,
  advancement_mismatch: `${NOTHING} The next game holds a team this game didn't send there, so FieldSlate won't guess which team to remove. ${START_OVER}`,
  nothing_saved: `${NOTHING} The game changed while you were looking at it. Refresh the page and try again.`,
};

/** Every refusal key 0108 raises — the sim reads the keys out of the
 *  migration file, so a new key cannot ship without a sentence. */
export const RESULT_REFUSAL_KEYS = Object.keys(REFUSALS);

/** A function error → the sentence. An unknown error says nothing was saved
 *  and carries the raw text; it is never treated as success. */
export function resultErrorMessage(raw: string): string {
  for (const key of RESULT_REFUSAL_KEYS) {
    if (raw.includes(key)) return REFUSALS[key];
  }
  return `${NOTHING} ${raw}`.trim();
}

const UNCONFIRMED = `${NOTHING} The save didn't confirm. Refresh the page to see what's there.`;

// ─── The blocked reply: a later game already has a result ────────────────────

export type NextGame = {
  gameNumber: number;
  round: string;
  homeName: string | null;
  awayName: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

function parseNextGame(raw: unknown): NextGame | null {
  const n = (raw ?? null) as Record<string, unknown> | null;
  if (!n || typeof n.game_number !== "number" || typeof n.round !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    gameNumber: n.game_number, round: n.round,
    homeName: str(n.home_name), awayName: str(n.away_name),
    homeScore: num(n.home_score), awayScore: num(n.away_score),
  };
}

/** The refusal when the next game has a result: names that game and its
 *  result, and says what to do — clear it first. Latest round first follows. */
export function nextGameBlockedMessage(next: NextGame | null, action: "clear" | "edit"): string {
  const then = action === "clear" ? "then clear this one" : "then change this one";
  if (!next) return `A later game already has a result. Clear that game's result first, ${then}.`;
  const score = next.homeScore !== null && next.awayScore !== null
    ? ` (${next.homeName ?? "Home"} ${next.homeScore}, ${next.awayName ?? "Away"} ${next.awayScore})`
    : "";
  return `${gameLabel(next.gameNumber, next.round)} already has a result${score}. Clear that game's result first, ${then}.`;
}

/** The browser path's (double elimination) blocked edit: clearing isn't
 *  offered there, so the way out is deleting the bracket. */
export const DOUBLE_ELIM_EDIT_BLOCKED =
  `A later game already has a result, so this one can't be changed. ${DOUBLE_ELIM_CLEAR_REFUSAL}`;

// ─── Enter ────────────────────────────────────────────────────────────────────

export type ResultOutcome = { ok: true } | { ok: false; message: string };

/** enter_playoff_result's reply → success only when committed for THIS game. */
export function enterOutcome(
  data: unknown,
  error: { message: string } | null,
  gameId: string,
): ResultOutcome {
  if (error) return { ok: false, message: resultErrorMessage(error.message) };
  const r = (data ?? null) as Record<string, unknown> | null;
  if (r && r.blocked === true) {
    return { ok: false, message: nextGameBlockedMessage(parseNextGame(r.next_game), "edit") };
  }
  if (!r || r.committed !== true || r.game_id !== gameId) return { ok: false, message: UNCONFIRMED };
  return { ok: true };
}

// ─── Clear ────────────────────────────────────────────────────────────────────

export type ClearPreview = {
  gameId: string;
  gameNumber: number;
  round: string;
  homeName: string | null;
  awayName: string | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerName: string | null;
  onPublicSchedule: boolean;
  removed: { gameNumber: number; round: string; teamName: string | null } | null;
};

/** A clear reply (preview or commit) → its fields, or null when it can't be
 *  read. A reply that isn't for the asked-about game is unreadable. */
export function parseClearReply(raw: unknown, gameId: string): ClearPreview | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r || r.game_id !== gameId) return null;
  if (typeof r.game_number !== "number" || typeof r.round !== "string") return null;
  if (typeof r.on_public_schedule !== "boolean") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  let removed: ClearPreview["removed"] = null;
  if (r.removed !== null && r.removed !== undefined) {
    const m = r.removed as Record<string, unknown>;
    if (typeof m.game_number !== "number" || typeof m.round !== "string") return null;
    removed = { gameNumber: m.game_number, round: m.round, teamName: str(m.team_name) };
  }
  return {
    gameId, gameNumber: r.game_number, round: r.round,
    homeName: str(r.home_name), awayName: str(r.away_name),
    homeScore: num(r.home_score), awayScore: num(r.away_score),
    winnerName: str(r.winner_name),
    onPublicSchedule: r.on_public_schedule,
    removed,
  };
}

export type ClearPreviewOutcome =
  | { ok: true; preview: ClearPreview }
  | { ok: false; message: string };

/** The preview: never committed, readable, for this game. */
export function clearPreviewOutcome(
  data: unknown,
  error: { message: string } | null,
  gameId: string,
): ClearPreviewOutcome {
  if (error) return { ok: false, message: resultErrorMessage(error.message) };
  const r = (data ?? null) as Record<string, unknown> | null;
  if (r && r.blocked === true) {
    return { ok: false, message: nextGameBlockedMessage(parseNextGame(r.next_game), "clear") };
  }
  const preview = parseClearReply(data, gameId);
  if (!r || r.committed !== false || !preview) {
    return { ok: false, message: "Couldn't check what clearing this result would change. Nothing was changed. Try again." };
  }
  return { ok: true, preview };
}

/** The commit: success only when committed for THIS game. */
export function clearCommitOutcome(
  data: unknown,
  error: { message: string } | null,
  gameId: string,
): ResultOutcome {
  if (error) return { ok: false, message: resultErrorMessage(error.message) };
  const r = (data ?? null) as Record<string, unknown> | null;
  if (r && r.blocked === true) {
    return { ok: false, message: nextGameBlockedMessage(parseNextGame(r.next_game), "clear") };
  }
  if (!r || r.committed !== true || !parseClearReply(data, gameId)) return { ok: false, message: UNCONFIRMED };
  return { ok: true };
}

/** The confirm, from the preview. */
export function clearConfirm(p: ClearPreview): { title: string; lines: string[] } {
  const score = p.homeScore !== null && p.awayScore !== null
    ? `${p.homeName ?? "Home"} ${p.homeScore}, ${p.awayName ?? "Away"} ${p.awayScore}`
    : "a result with no score";
  const lines = [
    `${gameLabel(p.gameNumber, p.round)} — ${score}${p.winnerName ? ` (${p.winnerName} won)` : ""}.`,
    "The score and winner will be removed and the game goes back to scheduled.",
  ];
  if (p.removed) {
    lines.push(`${p.removed.teamName ?? "The winner"} will be removed from ${gameLabel(p.removed.gameNumber, p.removed.round)} until this game has a result again.`);
  }
  if (p.onPublicSchedule) {
    lines.push("This is on your public schedule — the change shows there within a minute.");
  }
  return { title: "Clear this result?", lines };
}

// ─── The modal ────────────────────────────────────────────────────────────────

/** Why Save is unavailable, or null. A result needs both teams; a game with a
 *  missing team (e.g. a deleted team) can still be CLEARED. */
export function saveBlockedReason(homeTeamId: string | null, awayTeamId: string | null): string | null {
  if (homeTeamId && awayTeamId) return null;
  return "Both teams have to be set before a result can be entered.";
}

/** Whether the bracket shows the result button on a game: both teams set, OR
 *  a result already recorded (so it can be cleared even if a slot is empty). */
export function resultButtonShown(bothTeams: boolean, isDone: boolean): boolean {
  return bothTeams || isDone;
}

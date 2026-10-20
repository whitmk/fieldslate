// Playoff SERIES (best of 3, 5 or 7) — every rule and every sentence, PURE:
// no Supabase, no React, no clock. Screens render these sentences VERBATIM and
// the database functions (0114) enforce the same rules; never a second copy at
// a call site. Approved mockup: docs/mockups/playoff-series.html (2026-10-20).
// Harness: npm run sim:playoff-series (+ :mutants).
//
// THE MODEL
// - A single-elimination round is 1 game or a series (series-lengths.ts). All
//   games of a series are stored rows sharing the round and `game_number` (the
//   bracket position); `series_game` is 1..length. If-needed games are created
//   and dated at generation.
// - A team wins a series at winsNeeded(length). The games after the deciding
//   one become `not_needed` (status) in the same transaction as the result;
//   clearing a result that un-decides the series brings them back.
// - Results go in order: game k takes a result only after game k−1 has one. A
//   rained-out game is moved, never skipped. Only the LAST game with a result
//   in a series can be edited or cleared.
// - The series winner moves into the next round. When that round is a series,
//   into EVERY game of it; once both of its teams are known, home alternates by
//   true seed (seriesHomeAway). Until then each team sits in its bracket slot.
// - Single-game rounds work exactly as before.

import {
  singleElimTarget,
  type GameRow,
  type SlotField,
} from "@/lib/playoffs/advancement";
import { gameNumbering, shortDate, shortTime } from "@/lib/playoffs/bracket-labels";
import {
  isSeriesGame,
  isSeriesRound,
  roundTitle,
  seriesLengthOf,
  seriesName,
  seriesNameInSentence,
  type SeriesRow,
} from "@/lib/playoffs/series-names";
import {
  isSeriesLength,
  seriesHomeAway,
  seriesLengthFor,
  winsNeeded,
  type SeedOf,
  type SeriesByRound,
  type SeriesLength,
} from "@/lib/playoffs/series-lengths";

/** The status a game gets when its series is decided before it is played. */
export const NOT_NEEDED = "not_needed";

export type SeriesGame = GameRow &
  SeriesRow & {
    status?: string | null;
    home_score?: number | null;
    away_score?: number | null;
    scheduled_date?: string | null;
    start_time?: string | null;
    venue_id?: string | null;
  };

/** A game has a result: completed, a winner, or a score (0107's test). */
export function gameHasResult(g: Pick<SeriesGame, "status" | "winner_id" | "home_score" | "away_score">): boolean {
  return g.status === "completed" || g.winner_id != null || g.home_score != null || g.away_score != null;
}

/** The games of `game`'s series, game 1 first. A single game is a series of 1. */
export function seriesGamesOf<T extends SeriesGame>(game: SeriesRow, bracket: ReadonlyArray<T>): T[] {
  return bracket
    .filter((g) => g.round === game.round && g.game_number === game.game_number)
    .sort((a, b) => (a.series_game ?? 1) - (b.series_game ?? 1));
}

// ─── Where a series stands ────────────────────────────────────────────────────

export type SeriesState = {
  length: number;
  winsNeeded: number;
  /** Team ids in card order: game 1's home, then its away (null = not known). */
  teams: [string | null, string | null];
  wins: Map<string, number>;
  played: number;
  winnerId: string | null;
  /** The game that takes the next result, or null when the series is decided
   *  (or every game has one). */
  next: SeriesGame | null;
};

export function seriesState(games: ReadonlyArray<SeriesGame>): SeriesState {
  const sorted = [...games].sort((a, b) => (a.series_game ?? 1) - (b.series_game ?? 1));
  const length = Math.max(1, ...sorted.map((g) => g.series_game ?? 1));
  const need = winsNeeded(length);
  const first = sorted[0];
  const wins = new Map<string, number>();
  let played = 0;
  let winnerId: string | null = null;
  for (const g of sorted) {
    if (!gameHasResult(g)) continue;
    played++;
    if (g.winner_id) {
      const w = (wins.get(g.winner_id) ?? 0) + 1;
      wins.set(g.winner_id, w);
      if (w >= need && winnerId === null) winnerId = g.winner_id;
    }
  }
  const next =
    winnerId !== null ? null : sorted.find((g) => !gameHasResult(g) && g.status !== NOT_NEEDED) ?? null;
  return {
    length,
    winsNeeded: need,
    teams: [first?.home_team_id ?? null, first?.away_team_id ?? null],
    wins,
    played,
    winnerId,
    next,
  };
}

function winsOf(s: SeriesState, teamId: string | null): number {
  return teamId ? s.wins.get(teamId) ?? 0 : 0;
}

/** Leader first: [leaderId, leaderWins, otherWins]; leader null on a tie. */
function standing(s: SeriesState): { leader: string | null; high: number; low: number } {
  const [a, b] = s.teams;
  const wa = winsOf(s, a);
  const wb = winsOf(s, b);
  if (wa === wb) return { leader: null, high: wa, low: wb };
  return wa > wb ? { leader: a, high: wa, low: wb } : { leader: b, high: wb, low: wa };
}

/**
 * True when game k WILL be played whatever happens before it: no team can
 * have reached winsNeeded in the games before it. With no results that is
 * k ≤ winsNeeded; otherwise it follows the score.
 */
export function gameGuaranteed(k: number, s: SeriesState, games: ReadonlyArray<SeriesGame>): boolean {
  const before = games.filter((g) => (g.series_game ?? 1) < k && !gameHasResult(g) && g.status !== NOT_NEEDED).length;
  for (const t of s.teams) {
    if (winsOf(s, t) + before >= s.winsNeeded) return false;
  }
  return true;
}

export type SeriesGameTag = "result" | "next" | "if_needed" | "not_needed" | "upcoming";

/** What a series game's row says beside it. */
export function seriesGameTag(game: SeriesGame, games: ReadonlyArray<SeriesGame>): SeriesGameTag {
  const s = seriesState(games);
  if (game.status === NOT_NEEDED) return "not_needed";
  if (gameHasResult(game)) return "result";
  if (s.winnerId !== null) return "not_needed";
  if (s.next && s.next.id === game.id && game.home_team_id && game.away_team_id) return "next";
  if (!gameGuaranteed(game.series_game ?? 1, s, games)) return "if_needed";
  return "upcoming";
}

export const SERIES_TAG_TEXT: Record<Exclude<SeriesGameTag, "result" | "upcoming">, string> = {
  next: "Next",
  if_needed: "If needed",
  not_needed: "Not needed",
};

export type HeadlineTone = "gray" | "amber" | "green";

/** The series card's header pill: "Expos lead 1–0", "Bears win 2–0",
 *  "Tied 1–1", "Not started". */
export function seriesHeadline(
  games: ReadonlyArray<SeriesGame>,
  teamName: (id: string) => string,
): { text: string; tone: HeadlineTone } {
  const s = seriesState(games);
  const st = standing(s);
  if (s.winnerId) return { text: `${teamName(s.winnerId)} win ${st.high}–${st.low}`, tone: "green" };
  if (s.played === 0) return { text: "Not started", tone: "gray" };
  if (st.leader === null) return { text: `Tied ${st.high}–${st.low}`, tone: "amber" };
  return { text: `${teamName(st.leader)} lead ${st.high}–${st.low}`, tone: "amber" };
}

/** Where a series stands, inside a sentence: "Bears lead 1–0", "1–1", "0–0". */
function standingInSentence(s: SeriesState, teamName: (id: string) => string): string {
  const st = standing(s);
  return st.leader ? `${teamName(st.leader)} lead ${st.high}–${st.low}` : `${st.high}–${st.low}`;
}

/** The champion banner for a series Final: "Expos win the Final 2–1". Null
 *  until the Final is decided. */
export function seriesChampionLine(games: ReadonlyArray<SeriesGame>, teamName: (id: string) => string): string | null {
  const s = seriesState(games);
  if (!s.winnerId) return null;
  const st = standing(s);
  return `${teamName(s.winnerId)} win the Final ${st.high}–${st.low}`;
}

/** "Best of 3 — first to 2 wins" (the modal's series box). */
export function bestOfLine(length: number): string {
  return `Best of ${length} — first to ${winsNeeded(length)} wins`;
}

// ─── The card's actions and lines ─────────────────────────────────────────────

/** One row per series (its game 1) and every single game: what the tree lays
 *  out. Advancement and the connector lines key on the round and the bracket
 *  position, which every game of a series shares. */
export function oneRowPerSeries<T extends SeriesRow>(bracket: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  return [...bracket]
    .sort((a, b) => (a.series_game ?? 1) - (b.series_game ?? 1))
    .filter((g) => {
      const key = `${g.round}:${g.game_number}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.game_number - b.game_number);
}

/** What a series game offers (approved mockup screens 3 and 5). Result only on
 *  the NEXT game (both teams known, series undecided); Edit only on the LAST
 *  game with a result (results change from the latest game back); Move on
 *  every game without a result that is still needed. A not-needed game offers
 *  nothing. */
export function seriesGameActions(
  game: SeriesGame,
  games: ReadonlyArray<SeriesGame>,
): { result: boolean; edit: boolean; move: boolean } {
  if (game.status === NOT_NEEDED) return { result: false, edit: false, move: false };
  const tag = seriesGameTag(game, games);
  if (tag === "not_needed") return { result: false, edit: false, move: false };
  if (gameHasResult(game)) {
    const k = game.series_game ?? 1;
    const later = games.some((g) => (g.series_game ?? 1) > k && gameHasResult(g));
    return { result: false, edit: !later, move: false };
  }
  return { result: tag === "next", edit: false, move: true };
}

/** The series card's footer: Result and Move on the next game, Edit on the
 *  last game with a result. Null where there is none. */
export function seriesCardActions(games: ReadonlyArray<SeriesGame>): {
  result: SeriesGame | null;
  edit: SeriesGame | null;
  move: SeriesGame | null;
} {
  const s = seriesState(games);
  const next = s.next && seriesGameActions(s.next, games).move ? s.next : null;
  const edit = [...games].reverse().find((g) => seriesGameActions(g, games).edit) ?? null;
  return {
    result: next && seriesGameActions(next, games).result ? next : null,
    edit,
    move: next,
  };
}

/** A played game's result, winner first: "Expos 5–2". Null with no score. */
export function seriesResultText(game: SeriesGame, teamName: (id: string) => string): string | null {
  if (game.home_score == null || game.away_score == null || !game.winner_id) return null;
  const hi = Math.max(game.home_score, game.away_score);
  const lo = Math.min(game.home_score, game.away_score);
  return `${teamName(game.winner_id)} ${hi}–${lo}`;
}

/** "Expos home" once both teams are known; null before (no home team is
 *  named until then — decided 2026-10-20). */
export function seriesHomeNote(game: SeriesGame, teamName: (id: string) => string): string | null {
  return homeTeamKnown(game) && game.home_team_id ? `${teamName(game.home_team_id)} home` : null;
}

// ─── Entering and clearing results ────────────────────────────────────────────

/** Game k needs game k−1's result first. Shared by the modal's own check and
 *  the database's `series_order` reply. */
export function seriesOrderRefusal(previous: number): string {
  return `Game ${previous} of this series needs a result first — results go in order. If Game ${previous} was rained out, move it with Move.`;
}

/** A later game of the series has a result. Shared by the modal's own check
 *  and the database's `series_later_result` reply. */
export function seriesLaterResultRefusal(later: number, action: "edit" | "clear"): string {
  return action === "edit"
    ? `Game ${later} of this series has a result too. Clear it first, then edit this one — results are changed from the latest game back.`
    : `Game ${later} of this series has a result too. Clear it first — results are cleared from the latest game back.`;
}

/** The database's `game_not_needed` reply (a stale page): the modal's own
 *  check names the winner; this reply carries no names. */
export const SERIES_GAME_NOT_NEEDED =
  "This game isn't needed — its series is already decided. Refresh the page to see the latest.";

/**
 * The next round is a series and one of its games has a result, so this game
 * can't be changed or cleared. "The Final already has a result (Game 1: Expos
 * 3, Bears 2). Clear the Final's results first, then clear this one."
 */
export function nextSeriesBlockedMessage(
  nameInSentence: string,
  next: { seriesGame: number; homeName: string | null; homeScore: number | null; awayName: string | null; awayScore: number | null },
  action: "edit" | "clear",
): string {
  const score =
    next.homeScore !== null && next.awayScore !== null
      ? ` (Game ${next.seriesGame}: ${next.homeName ?? "Home"} ${next.homeScore}, ${next.awayName ?? "Away"} ${next.awayScore})`
      : "";
  const then = action === "clear" ? "then clear this one" : "then change this one";
  return `${capitalize(nameInSentence)} already has a result${score}. Clear ${nameInSentence}'s results first, ${then}.`;
}

function gameList(games: ReadonlyArray<SeriesGame>, withField?: (venueId: string | null) => string | null): string {
  const items = games.map((g) => {
    const parts: string[] = [];
    if (g.scheduled_date) parts.push(shortDate(g.scheduled_date));
    const field = withField ? withField(g.venue_id ?? null) : null;
    if (g.scheduled_date && field) parts.push(field);
    const when = parts.length ? ` (${parts.join(", ")})` : "";
    return `Game ${g.series_game ?? 1}${when}`;
  });
  return joinList(items);
}

/**
 * Why this game can't take a result now, or null. Results go in order: game k
 * needs game k−1's result. A game whose series is decided is not needed. Only
 * the last game with a result in a series can be edited.
 */
export function seriesEnterRefusal(
  game: SeriesGame,
  bracket: ReadonlyArray<SeriesGame>,
  teamName: (id: string) => string,
): string | null {
  if (!isSeriesGame(game, bracket)) return null;
  const games = seriesGamesOf(game, bracket);
  const s = seriesState(games);
  const k = game.series_game ?? 1;
  if (gameHasResult(game)) {
    const later = games.filter((g) => (g.series_game ?? 1) > k && gameHasResult(g));
    if (later.length) {
      return seriesLaterResultRefusal(later[later.length - 1].series_game ?? 1, "edit");
    }
    return null;
  }
  if (game.status === NOT_NEEDED || s.winnerId) {
    const st = standing(s);
    const w = s.winnerId ? teamName(s.winnerId) : "A team";
    return `This game isn't needed — ${w} won ${seriesNameInSentence(game, bracket)}, ${st.high}–${st.low}.`;
  }
  const prev = games.find((g) => (g.series_game ?? 1) === k - 1);
  if (prev && !gameHasResult(prev)) return seriesOrderRefusal(k - 1);
  return null;
}

/** Why this game's result can't be cleared now, or null: only the last game
 *  with a result in a series can be cleared. */
export function seriesClearRefusal(game: SeriesGame, bracket: ReadonlyArray<SeriesGame>): string | null {
  if (!isSeriesGame(game, bracket)) return null;
  const k = game.series_game ?? 1;
  const later = seriesGamesOf(game, bracket).filter((g) => (g.series_game ?? 1) > k && gameHasResult(g));
  if (!later.length) return null;
  return seriesLaterResultRefusal(later[later.length - 1].series_game ?? 1, "clear");
}

/** Where a series winner goes, inside a sentence: "the Final", "Semifinal 1",
 *  "Game 5" (a single game). Null for the last round. */
export function nextStepName(game: SeriesGame, bracket: ReadonlyArray<SeriesGame>): string | null {
  const t = singleElimTarget(game, bracket as SeriesGame[]);
  if (!t) return null;
  const target = t.target as SeriesGame;
  if (isSeriesGame(target, bracket)) return seriesNameInSentence(target, bracket);
  const shown = gameNumbering(bracket)(target.game_number);
  return `Game ${shown}`;
}

function withResult(g: SeriesGame, home: number | null, away: number | null): SeriesGame {
  const winner = home === null || away === null ? null : home > away ? g.home_team_id : away > home ? g.away_team_id : null;
  return {
    ...g,
    home_score: home,
    away_score: away,
    winner_id: winner,
    status: home === null ? "scheduled" : "completed",
  };
}

export type SeriesChange = {
  before: SeriesState;
  after: SeriesState;
  /** Games that become not needed. */
  cancels: SeriesGame[];
  /** Not-needed games that are needed again. */
  restores: SeriesGame[];
  /** The team that moves into the next round (newly decided), or null. */
  movesIn: string | null;
  /** The team removed from the next round (no longer the winner), or null. */
  movesOut: string | null;
};

/** What saving (scores) or clearing (nulls) this game does to its series. */
export function seriesChange(
  game: SeriesGame,
  bracket: ReadonlyArray<SeriesGame>,
  home: number | null,
  away: number | null,
): SeriesChange {
  const games = seriesGamesOf(game, bracket);
  const before = seriesState(games);
  const changed = games.map((g) => (g.id === game.id ? withResult(g, home, away) : g));
  // Every not-needed game is back in play for the recount.
  const reopened = changed.map((g) => (g.status === NOT_NEEDED ? { ...g, status: "scheduled" } : g));
  const after = seriesState(reopened);
  let cancels: SeriesGame[] = [];
  let restores: SeriesGame[] = [];
  if (after.winnerId) {
    const decidedAt = Math.max(
      ...reopened.filter((g) => gameHasResult(g)).map((g) => g.series_game ?? 1),
    );
    cancels = reopened.filter((g) => (g.series_game ?? 1) > decidedAt && !gameHasResult(g) && games.find((x) => x.id === g.id)?.status !== NOT_NEEDED);
  } else {
    restores = games.filter((g) => g.status === NOT_NEEDED);
  }
  return {
    before,
    after,
    cancels,
    restores,
    movesIn: after.winnerId && after.winnerId !== before.winnerId ? after.winnerId : null,
    movesOut: before.winnerId && before.winnerId !== after.winnerId ? before.winnerId : null,
  };
}

/**
 * The line under the scores in Edit result, once both are in and they differ.
 * "Saving this decides the series: Expos win 2–0. Game 3 (Sun 11/22) won't
 * be played, and Expos move into the Final."
 */
export function seriesEnterLine(
  game: SeriesGame,
  bracket: ReadonlyArray<SeriesGame>,
  home: number,
  away: number,
  teamName: (id: string) => string,
): string | null {
  if (!isSeriesGame(game, bracket) || home === away) return null;
  const c = seriesChange(game, bracket, home, away);
  const next = nextStepName(game, bracket);
  const st = standing(c.after);
  if (c.after.winnerId) {
    const w = teamName(c.after.winnerId);
    if (!c.movesIn) return `The series result doesn't change: ${w} win ${st.high}–${st.low}.`;
    const what = next === null ? "the Final" : "the series";
    const tail: string[] = [];
    if (c.cancels.length) {
      tail.push(`${gameList(c.cancels)} won't be played`);
    }
    if (next) tail.push(`${w} move into ${next}`);
    const rest = tail.length ? ` ${capitalize(tail.join(", and "))}.` : "";
    return `Saving this decides ${what}: ${w} win ${st.high}–${st.low}.${rest}`;
  }
  const parts = [`After this, ${st.leader ? `${teamName(st.leader)} lead ${st.high}–${st.low}` : `the series is tied ${st.high}–${st.low}`}.`];
  if (c.restores.length) parts.push(`${gameList(c.restores)} ${c.restores.length === 1 ? "is" : "are"} back on.`);
  if (c.movesOut && next) parts.push(`${teamName(c.movesOut)} will be removed from ${next} until the series is decided again.`);
  return parts.join(" ");
}

/**
 * The series lines of the Clear confirm (under "The score and winner will be
 * removed…"). "The series goes back to Bears lead 1–0, so Game 3 (Sun 11/22,
 * Perry) is scheduled again." / "Bears will be removed from the Final until
 * the series is decided again."
 */
export function seriesClearLines(
  game: SeriesGame,
  bracket: ReadonlyArray<SeriesGame>,
  teamName: (id: string) => string,
  fieldName: (venueId: string | null) => string | null,
): string[] {
  if (!isSeriesGame(game, bracket)) return [];
  const c = seriesChange(game, bracket, null, null);
  const back = `The series goes back to ${standingInSentence(c.after, teamName)}`;
  const out = [
    c.restores.length
      ? `${back}, so ${gameList(c.restores, fieldName)} ${c.restores.length === 1 ? "is" : "are"} scheduled again.`
      : `${back}.`,
  ];
  const next = nextStepName(game, bracket);
  if (c.movesOut && next) out.push(`${teamName(c.movesOut)} will be removed from ${next} until the series is decided again.`);
  return out;
}

// ─── Advancement (the TypeScript twin of 0114's series writes) ────────────────

/** Both team slots of one game, written together. */
export type SeriesSlotWrite = { gameId: string; home_team_id: string | null; away_team_id: string | null };

export type SeriesAdvancement =
  | { blocked: "next_game_has_result" | "advancement_mismatch" }
  | { writes: SeriesSlotWrite[] };

/**
 * Where a series winner (or a single game's winner) goes when its series is
 * decided, as whole-row writes. A single-game next round gets the winner in
 * its bracket slot, as today. A series next round gets the winner in EVERY
 * game: while the other team is unknown, in the bracket slot; once both are
 * known, home and away by `seriesHomeAway`. `previousWinner` is the team this
 * series sent on before (an edit that flips it), or null.
 */
export function seriesAdvanceWrites(
  game: SeriesGame,
  winnerId: string,
  previousWinner: string | null,
  bracket: ReadonlyArray<SeriesGame>,
  seedOf: SeedOf,
): SeriesAdvancement {
  const t = singleElimTarget(game, bracket as SeriesGame[]);
  if (!t) return { writes: [] };
  const rows = seriesGamesOf(t.target as SeriesGame, bracket);
  if (rows.some(gameHasResult)) return { blocked: "next_game_has_result" };
  const others = new Set<string>();
  for (const r of rows) {
    for (const id of [r.home_team_id, r.away_team_id]) {
      if (id && id !== winnerId && id !== previousWinner) others.add(id);
    }
  }
  if (others.size > 1) return { blocked: "advancement_mismatch" };
  const other = [...others][0] ?? null;
  return { writes: slotWrites(rows, t.field, winnerId, other, seedOf) };
}

/** The writes that take a series' winner back out of the next round. */
export function seriesClearWrites(
  game: SeriesGame,
  winnerId: string,
  bracket: ReadonlyArray<SeriesGame>,
  seedOf: SeedOf,
): SeriesAdvancement {
  const t = singleElimTarget(game, bracket as SeriesGame[]);
  if (!t) return { writes: [] };
  const rows = seriesGamesOf(t.target as SeriesGame, bracket);
  if (rows.some(gameHasResult)) return { blocked: "next_game_has_result" };
  if (!rows.every((r) => r.home_team_id === winnerId || r.away_team_id === winnerId)) {
    return { blocked: "advancement_mismatch" };
  }
  const others = new Set<string>();
  for (const r of rows) for (const id of [r.home_team_id, r.away_team_id]) if (id && id !== winnerId) others.add(id);
  if (others.size > 1) return { blocked: "advancement_mismatch" };
  return { writes: slotWrites(rows, t.field, null, [...others][0] ?? null, seedOf) };
}

function slotWrites(
  rows: ReadonlyArray<SeriesGame>,
  field: SlotField,
  incoming: string | null,
  other: string | null,
  seedOf: SeedOf,
): SeriesSlotWrite[] {
  const slotA = field === "home_team_id" ? incoming : other;
  const slotB = field === "home_team_id" ? other : incoming;
  return rows.map((r) => {
    const side =
      rows.length > 1 ? seriesHomeAway(r.series_game ?? 1, slotA, slotB, seedOf) : { home: slotA, away: slotB };
    return { gameId: r.id, home_team_id: side.home, away_team_id: side.away };
  });
}

/** True when this game's two teams are both known, so its home team is real
 *  and may be shown (public page, feed, CSV). A series game before then reads
 *  "Bears and Winner of Semifinal 1" — no team listed first as home. */
export function homeTeamKnown(game: Pick<SeriesGame, "home_team_id" | "away_team_id">): boolean {
  return game.home_team_id != null && game.away_team_id != null;
}

// ─── Setup (wizard + review) ──────────────────────────────────────────────────

export type WizardRound = { label: string; title: string; matchups: number };

/** The rounds a single-elimination bracket of `teamCount` will have, first
 *  round first, with how many matchups each holds. */
export function wizardRounds(teamCount: number): WizardRound[] {
  if (teamCount < 2) return [];
  const B = Math.pow(2, Math.ceil(Math.log2(teamCount)));
  const count = Math.log2(B);
  const labels: string[] = [];
  for (let r = 0; r < count; r++) {
    const games = B / Math.pow(2, r + 1);
    labels.push(r === 0 ? "R1" : games === 1 ? "F" : games === 2 ? "SF" : `R${r + 1}`);
  }
  const fake = labels.map((label) => ({ round: label, game_number: 0 }));
  return labels.map((label, r) => ({
    label,
    title: roundTitle(label, fake),
    matchups: r === 0 ? teamCount - B / 2 : B / Math.pow(2, r + 1),
  }));
}

/** The line beside a round's 1/3/5/7 control. */
export function roundLengthHelp(length: SeriesLength, matchups: number): string {
  if (length === 1) return matchups > 1 ? `1 game · ${matchups} matchups` : "1 game";
  const need = winsNeeded(length);
  const extra = Array.from({ length: length - need }, (_, i) => need + 1 + i);
  const which =
    extra.length === 1 ? `Game ${extra[0]} is` : `Games ${joinList(extra.map(String))} are`;
  const base = `Best of ${length} — first to ${need} wins. ${which} played only if needed.`;
  return matchups > 1 ? `${base} · ${matchups} series` : base;
}

/** The odd games, "games 1 and 3" / "games 1, 3 and 5", for the longest series. */
function oddGamesText(maxLength: number): string {
  const odd = Array.from({ length: Math.ceil(maxLength / 2) }, (_, i) => String(2 * i + 1));
  return `games ${joinList(odd)}`;
}

function inRound(title: string): string {
  return title.startsWith("Round") ? title : `the ${title}`;
}

/**
 * The note under the per-round controls, or null when every round is 1 game.
 * "Up to 11 games: 2 in Round 1, up to 6 in the Semifinals, up to 3 in the
 * Final — 3 of them only if needed. The higher seed is home in games 1 and 3.
 * If-needed games get a date and a field now and are cancelled automatically
 * when a series is decided."
 */
export function seriesSetupNote(rounds: WizardRound[], series: SeriesByRound): string | null {
  const lengths = rounds.map((r) => seriesLengthFor(series, r.label));
  if (lengths.every((l) => l === 1)) return null;
  let total = 0;
  let ifNeeded = 0;
  const parts = rounds.map((r, i) => {
    const l = lengths[i];
    total += r.matchups * l;
    ifNeeded += r.matchups * (l - winsNeeded(l));
    return l === 1 ? `${r.matchups * l} in ${inRound(r.title)}` : `up to ${r.matchups * l} in ${inRound(r.title)}`;
  });
  return (
    `Up to ${total} games: ${parts.join(", ")} — ${ifNeeded} of them only if needed. ` +
    `The higher seed is home in ${oddGamesText(Math.max(...lengths))}. ` +
    `If-needed games get a date and a field now and are cancelled automatically when a series is decided.`
  );
}

/** What `playoffs.series_by_round` stores for a plan: the rounds of these
 *  games longer than 1 game — nothing for any other format, and no round the
 *  games don't have (0114 refuses both). */
export function seriesByRoundPayload(
  format: string,
  series: SeriesByRound | null | undefined,
  games: ReadonlyArray<{ round: string }>,
): SeriesByRound {
  if (format !== "single_elimination") return {};
  const rounds = new Set(games.map((g) => g.round));
  const out: SeriesByRound = {};
  for (const [round, n] of Object.entries(series ?? {})) {
    if (rounds.has(round) && isSeriesLength(n) && n > 1) out[round] = n;
  }
  return out;
}

/** A bracket's games with every series played out: Σ matchups × length. */
export function seriesMaxGames(rounds: WizardRound[], series: SeriesByRound): number {
  return rounds.reduce((n, r) => n + r.matchups * seriesLengthFor(series, r.label), 0);
}

/** A stage panel's game count: "7 games", or "Up to 11 games" with a series. */
export function bracketGamesLabel(rounds: WizardRound[], series: SeriesByRound): string {
  const single = rounds.reduce((n, r) => n + r.matchups, 0);
  const max = seriesMaxGames(rounds, series);
  if (max === single) return `${single} ${single === 1 ? "game" : "games"}`;
  return `Up to ${max} games`;
}

export const PER_DAY_SERIES_HELP = "With 1, each game of a series is on its own day.";

/** Series are single elimination only (decided 2026-10-20). The refusal, or null. */
export function seriesFormatProblem(format: string, series: SeriesByRound | null | undefined): string | null {
  if (format === "single_elimination") return null;
  const any = Object.values(series ?? {}).some((n) => typeof n === "number" && n > 1);
  return any
    ? "Series are for single elimination only — double elimination and round robin play 1 game per round."
    : null;
}

/** Review: one line per round. "2 games · Sat 11/14"; "Best of 3 · Sun 11/15,
 *  Sat 11/21, Sun 11/22 (if needed)". */
export function seriesReviewRows(
  games: ReadonlyArray<{ round: string; game_number: number; series_game?: number; scheduled_date: string | null }>,
): { title: string; text: string }[] {
  const rounds = [...new Set(games.map((g) => g.round))];
  return rounds.map((round) => {
    const rows = games.filter((g) => g.round === round);
    const title = roundTitle(round, games);
    if (!isSeriesRound(round, games)) {
      const dates = [...new Set(rows.map((g) => g.scheduled_date).filter((d): d is string => !!d))].sort();
      const when = dates.length ? dates.map(shortDate).join(", ") : "no date";
      return { title, text: `${rows.length} ${rows.length === 1 ? "game" : "games"} · ${when}` };
    }
    const length = Math.max(...rows.map((g) => g.series_game ?? 1));
    const need = winsNeeded(length);
    const perGame: string[] = [];
    for (let k = 1; k <= length; k++) {
      const dates = rows.filter((g) => (g.series_game ?? 1) === k && g.scheduled_date).map((g) => g.scheduled_date!).sort();
      const when = dates.length ? shortDate(dates[0]) : "no date";
      perGame.push(k > need ? `${when} (if needed)` : when);
    }
    return { title, text: `Best of ${length} · ${perGame.join(", ")}` };
  });
}

/** Review: "Up to 11 — all 11 have a date and a field" / "Up to 11 — 10 have
 *  a date and a field". */
export function seriesGamesReviewLine(games: ReadonlyArray<{ scheduled_date: string | null }>): string {
  const dated = games.filter((g) => g.scheduled_date).length;
  const total = games.length;
  return dated === total
    ? `Up to ${total} — all ${total} have a date and a field`
    : `Up to ${total} — ${dated} have a date and a field`;
}

/** Review (and after Generate): the games left without a date, named.
 *  "1 game has no date, time or field yet: Final · Game 3 of 3 (if needed).
 *  It can be given one later with the calendar button on the game." */
export function undatedSeriesGamesLine(
  games: ReadonlyArray<{ round: string; game_number: number; series_game?: number; scheduled_date: string | null }>,
): string | null {
  const undated = games.filter((g) => !g.scheduled_date);
  if (!undated.length) return null;
  const numbering = gameNumbering(games);
  const names = undated.map((g) => {
    if (!isSeriesGame(g, games)) return `Game ${numbering(g.game_number)}`;
    const length = seriesLengthOf(g, games);
    const k = g.series_game ?? 1;
    return `${seriesName(g, games)} · Game ${k} of ${length}${k > winsNeeded(length) ? " (if needed)" : ""}`;
  });
  const n = undated.length;
  return (
    `${n} ${n === 1 ? "game has" : "games have"} no date, time or field yet: ${joinList(names)}. ` +
    `${n === 1 ? "It" : "They"} can be given one later with the calendar button on the game.`
  );
}

// ─── Confirms ─────────────────────────────────────────────────────────────────

/** The delete confirm's first line. "11 games — 2 single games and 3
 *  best-of-3 series. 5 have results; 1 is not needed." */
export function seriesDeleteLine(games: ReadonlyArray<SeriesGame>): string {
  const total = games.length;
  const singles = games.filter((g) => !isSeriesGame(g, games)).length;
  const byLength = new Map<number, Set<string>>();
  for (const g of games) {
    if (!isSeriesGame(g, games)) continue;
    const l = seriesLengthOf(g, games);
    if (!byLength.has(l)) byLength.set(l, new Set());
    byLength.get(l)!.add(`${g.round}:${g.game_number}`);
  }
  const parts: string[] = [];
  if (singles) parts.push(`${singles} single ${singles === 1 ? "game" : "games"}`);
  for (const l of [...byLength.keys()].sort((a, b) => a - b)) {
    parts.push(`${byLength.get(l)!.size} best-of-${l} series`);
  }
  const results = games.filter(gameHasResult).length;
  const notNeeded = games.filter((g) => g.status === NOT_NEEDED).length;
  const second =
    `${results} ${results === 1 ? "has a result" : "have results"}` +
    (notNeeded ? `; ${notNeeded} ${notNeeded === 1 ? "is" : "are"} not needed` : "");
  return `${total} ${total === 1 ? "game" : "games"} — ${joinList(parts)}. ${second}.`;
}

/** The seed confirm's series line, or null when every round is 1 game.
 *  "Semifinals and Final are best of 3; the higher seed is home in games 1
 *  and 3." */
export function seriesSeedLine(games: ReadonlyArray<{ round: string; game_number: number; series_game?: number }>): string | null {
  const rounds = [...new Set(games.map((g) => g.round))].filter((r) => isSeriesRound(r, games));
  if (!rounds.length) return null;
  const byLength = new Map<number, string[]>();
  for (const r of rounds) {
    const l = Math.max(...games.filter((g) => g.round === r).map((g) => g.series_game ?? 1));
    if (!byLength.has(l)) byLength.set(l, []);
    byLength.get(l)!.push(roundTitle(r, games));
  }
  const groups = [...byLength.entries()].sort((a, b) => a[0] - b[0]);
  const verb = (titles: string[]) => (titles.length === 1 && !titles[0].endsWith("s") ? "is" : "are");
  const text = groups
    .map(([l, titles], i) => `${joinList(titles)} ${i === 0 ? `${verb(titles)} ` : ""}best of ${l}`)
    .join(", ");
  return `${text}; the higher seed is home in ${oddGamesText(Math.max(...groups.map(([l]) => l)))}.`;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Sat 11/21 · 9:00 AM" for a series game's line, or "Date TBD". */
export function seriesGameWhen(g: Pick<SeriesGame, "scheduled_date" | "start_time">): string {
  if (!g.scheduled_date) return "Date TBD";
  return [shortDate(g.scheduled_date), ...(g.start_time ? [shortTime(g.start_time)] : [])].join(" · ");
}

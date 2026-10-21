// What a playoff SERIES is called — pure, no other playoff imports except the
// round order, so bracket-labels.ts can use it without a cycle. Every other
// series rule and sentence is in series.ts.
//
// A round is a series round when any of its games has `series_game` 2 or more:
// every game of a series (if-needed and not-needed ones included) is a stored
// row, so a best-of-3 round always holds a game 2. All games of one series
// share the round and the `game_number` (the bracket position, which
// advancement keys on); `series_game` is 1..length within it.
//
// Names (approved mockup docs/mockups/playoff-series.html, D2, revised
// 2026-10-20 after Whit's acceptance test): a round is named by its POSITION,
// never by its stored label. The LAST round is always the Final, and the one
// before it is the Semifinals when it holds two matchups — so a 2-team
// bracket's only round (stored "R1") is the Final, a 4-team bracket reads
// Semifinals, Final, and a 3-team bracket (2 vs 3, seed 1 on a bye) reads
// Round 1, Final. A later round
// with four bracket positions is a Quarterfinal; anything else — the first
// round of a bracket of 8 or more included — is "Round k" ("Round k · Series
// i"). The series number is the rank of its bracket position among the
// round's series, so a round with byes still reads 1, 2, 3 …
//
// Pass the WHOLE bracket (every game, dated or not): the last round is found
// among the rounds it holds.

import { getRoundOrder } from "@/lib/playoffs/advancement";

export type SeriesRow = { round: string; game_number: number; series_game?: number | null };

/** True when `round` is a series round in this bracket. */
export function isSeriesRound(round: string, bracket: ReadonlyArray<SeriesRow>): boolean {
  return bracket.some((g) => g.round === round && (g.series_game ?? 1) >= 2);
}

/** True when this game belongs to a series. */
export function isSeriesGame(game: SeriesRow, bracket: ReadonlyArray<SeriesRow>): boolean {
  return isSeriesRound(game.round, bracket);
}

/** The games of a bracket that are single games (not in a series round). */
export function singleGames<T extends SeriesRow>(bracket: ReadonlyArray<T>): T[] {
  const seriesRounds = new Set(bracket.filter((g) => (g.series_game ?? 1) >= 2).map((g) => g.round));
  return bracket.filter((g) => !seriesRounds.has(g.round));
}

/** Round k (1-based) of a round label in this bracket, by round order. */
function roundNumber(round: string, bracket: ReadonlyArray<SeriesRow>): number {
  const rounds = [...new Set(bracket.map((g) => g.round))].sort((a, b) => getRoundOrder(a) - getRoundOrder(b));
  return rounds.indexOf(round) + 1;
}

/** Matchups (bracket positions with a game) in a round of this bracket. */
function roundMatchups(round: string, bracket: ReadonlyArray<SeriesRow>): number {
  return new Set(bracket.filter((g) => g.round === round).map((g) => g.game_number)).size;
}

/** Bracket positions in a round = 2^(rounds after it). */
function roundPositions(round: string, bracket: ReadonlyArray<SeriesRow>): number {
  const rounds = new Set(bracket.map((g) => g.round)).size;
  return Math.pow(2, rounds - roundNumber(round, bracket));
}

export type RoundKind = "final" | "semifinal" | "quarterfinal" | "round";

export function roundKind(round: string, bracket: ReadonlyArray<SeriesRow>): RoundKind {
  const rounds = new Set(bracket.map((g) => g.round)).size;
  const k = roundNumber(round, bracket);
  if (round === "F" || k === rounds) return "final";
  if (round === "SF" || (k === rounds - 1 && roundMatchups(round, bracket) === 2)) return "semifinal";
  if (k > 1 && roundPositions(round, bracket) === 4) return "quarterfinal";
  return "round";
}

/** True for the labels a single-elimination bracket stores ("R1", "R2", "SF",
 *  "F") — never a round robin's "RR3" or a double elimination's "WB-R1". */
export function isSingleElimRoundLabel(round: string): boolean {
  return /^(R\d+|SF|F)$/.test(round);
}

/** True when this round is a single-elimination bracket's Final — its last
 *  round, whatever it is stored as. */
export function isFinalRound(round: string, bracket: ReadonlyArray<SeriesRow>): boolean {
  return isSingleElimRoundLabel(round) && roundKind(round, bracket) === "final";
}

/** A single-elimination round's name where the bracket has no series: "Final",
 *  "Semifinals", else "Round k" (no Quarterfinals — single-game brackets read
 *  as they always did, apart from the last two rounds). */
export function singleElimRoundTitle(round: string, bracket: ReadonlyArray<SeriesRow>): string {
  const k = roundKind(round, bracket);
  if (k === "final") return "Final";
  if (k === "semifinal") return "Semifinals";
  return `Round ${roundNumber(round, bracket)}`;
}

/** "Final", "Semifinals", "Quarterfinals", "Round 2" — a round's header. */
export function roundTitle(round: string, bracket: ReadonlyArray<SeriesRow>): string {
  const k = roundKind(round, bracket);
  if (k === "final") return "Final";
  if (k === "semifinal") return "Semifinals";
  if (k === "quarterfinal") return "Quarterfinals";
  return `Round ${roundNumber(round, bracket)}`;
}

/** "Final", "Semifinal 1", "Quarterfinal 3", "Round 1 · Series 3". */
export function seriesName(game: SeriesRow, bracket: ReadonlyArray<SeriesRow>): string {
  const k = roundKind(game.round, bracket);
  if (k === "final") return "Final";
  const positions = [...new Set(bracket.filter((g) => g.round === game.round).map((g) => g.game_number))].sort(
    (a, b) => a - b,
  );
  const i = positions.indexOf(game.game_number) + 1;
  if (k === "semifinal") return `Semifinal ${i}`;
  if (k === "quarterfinal") return `Quarterfinal ${i}`;
  return `Round ${roundNumber(game.round, bracket)} · Series ${i}`;
}

/** The series name as it sits in a sentence: "the Final", "Semifinal 1". */
export function seriesNameInSentence(game: SeriesRow, bracket: ReadonlyArray<SeriesRow>): string {
  const n = seriesName(game, bracket);
  return n === "Final" ? "the Final" : n;
}

/** How many games a series is (its highest `series_game`). 1 for a single game. */
export function seriesLengthOf(game: SeriesRow, bracket: ReadonlyArray<SeriesRow>): number {
  let n = 1;
  for (const g of bracket) {
    if (g.round === game.round && g.game_number === game.game_number) n = Math.max(n, g.series_game ?? 1);
  }
  return n;
}

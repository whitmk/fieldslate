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
// Names (approved mockup docs/mockups/playoff-series.html, D2): the round
// labelled "F" is the Final, "SF" a Semifinal, a later round with four bracket
// positions a Quarterfinal; anything else — and always the round labelled "R1",
// which the app calls "Round 1" today — is "Round k · Series i". The series
// number is the rank of its bracket position among the round's series, so a
// round with byes still reads 1, 2, 3 …

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

/** Bracket positions in a round = 2^(rounds after it). */
function roundPositions(round: string, bracket: ReadonlyArray<SeriesRow>): number {
  const rounds = new Set(bracket.map((g) => g.round)).size;
  return Math.pow(2, rounds - roundNumber(round, bracket));
}

export type RoundKind = "final" | "semifinal" | "quarterfinal" | "round";

export function roundKind(round: string, bracket: ReadonlyArray<SeriesRow>): RoundKind {
  if (round === "F") return "final";
  if (round === "SF") return "semifinal";
  if (round !== "R1" && roundPositions(round, bracket) === 4) return "quarterfinal";
  return "round";
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

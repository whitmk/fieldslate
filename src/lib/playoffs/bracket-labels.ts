// What a playoff game card says — shared by the on-screen bracket, the
// Edit-result modal and the printed bracket. Pure: no React, no clock.
//
// Empty slots: in single elimination an empty slot reads "Winner of Game N",
// where N is the game singleElimFeeder (advancement.ts) finds — the same rule
// that moves the winner there, never a second copy of the arithmetic. A slot
// with no feeder (round 1, or any other format) reads "TBD"; we never guess.
//
// Game numbers: `game_number` is the BRACKET POSITION (bracket-plan.ts) —
// advancement resolves targets by it, so it is never renumbered. With byes it
// has gaps (6 teams store Games 2, 4, 5, 6, 7). People never see it: every
// "Game N" and "Winner of Game N" goes through `gameNumbering` — the games
// that exist in that bracket, numbered 1..N in round order, then position.
// Stored numbers already ascend that way (later rounds continue after earlier
// ones, positions ascend within a round), so the rule is the rank of the
// stored number in its bracket: full brackets, round robins and double
// elimination (all gapless) read exactly as they are stored.
//
// Winners: a slot is the winner only when BOTH the game's winner and the
// slot's team are set and equal. An empty slot (team null) next to an
// undecided game (winner null) is NOT a match — `null === null` used to put a
// trophy and the winner's highlight on every empty slot.

import { singleElimFeeder, type GameRow, type SlotField } from "@/lib/playoffs/advancement";

export type Side = "home" | "away";

const FIELD: Record<Side, SlotField> = { home: "home_team_id", away: "away_team_id" };

/** Stored number → the number people see. Build one per BRACKET (a
 *  two-stage pair is two brackets). */
export type GameNumbering = (storedNumber: number) => number;

/** The numbering of one bracket's games: 1..N, in stored order. */
export function gameNumbering(bracket: ReadonlyArray<{ game_number: number }>): GameNumbering {
  const stored = [...new Set(bracket.map((g) => g.game_number))].sort((a, b) => a - b);
  const shown = new Map(stored.map((n, i) => [n, i + 1]));
  return (n) => shown.get(n) ?? 1 + stored.filter((x) => x < n).length;
}

/** One game's shown number within its bracket. */
export function shownGameNumber(game: { game_number: number }, bracket: ReadonlyArray<{ game_number: number }>): number {
  return gameNumbering(bracket)(game.game_number);
}

/** True only for a decided game's actual winner. */
export function slotWon(winnerId: string | null | undefined, teamId: string | null | undefined): boolean {
  return winnerId != null && teamId != null && winnerId === teamId;
}

/** A Stage 2 (two-stage playoffs) slot waiting for the admin's seeding carries
 *  its seed number. Absent or null everywhere else. */
export type SeedSlots = { seed_home?: number | null; seed_away?: number | null };

/** How a seed number reads. ONE place, so pools can later say "Pool A #1"
 *  for every surface at once (CLAUDE.md "PLANNED FOLLOW-UP — pools"). */
export function seedLabel(seed: number): string {
  return `Seed ${seed}`;
}

/** The label for an EMPTY slot: "Seed N" (an unseeded Stage 2 slot), else
 *  "Winner of Game N", else "TBD". */
export function emptySlotLabel(game: GameRow & SeedSlots, side: Side, allGames: GameRow[], format: string): string {
  const seed = side === "home" ? game.seed_home : game.seed_away;
  if (seed != null) return seedLabel(seed);
  if (format !== "single_elimination") return "TBD";
  const feeder = singleElimFeeder(game, FIELD[side], allGames);
  return feeder ? `Winner of Game ${shownGameNumber(feeder, allGames)}` : "TBD";
}

/** A slot's text: the team's name, else the empty-slot label. */
export function slotName(
  name: string | null | undefined,
  game: GameRow & SeedSlots,
  side: Side,
  allGames: GameRow[],
  format: string,
): string {
  return name ?? emptySlotLabel(game, side, allGames, format);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sat 11/7" from "2026-11-07" — calendar arithmetic in UTC, so the host
 *  zone can never shift the day. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
}

/** "10:45 AM" from "10:45" / "10:45:00". */
export function shortTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** The card's "when" line without the field: "Game 9 · Sat 11/7 · 10:45 AM",
 *  or "Game 11 · Date TBD" for a game with no date yet. The number is the
 *  game's SHOWN number in `bracket` (its own bracket's games). */
export function gameWhen(
  game: { game_number: number },
  bracket: ReadonlyArray<{ game_number: number }>,
  date: string | null,
  time: string | null,
): string {
  const label = `Game ${shownGameNumber(game, bracket)}`;
  if (!date) return `${label} · Date TBD`;
  return [label, shortDate(date), ...(time ? [shortTime(time)] : [])].join(" · ");
}

/** The whole line: "Game 9 · Sat 11/7 · 10:45 AM · Andrews". The printed card
 *  sets the field on a line of its own (real field names are long); every
 *  other use is this. */
export function gameWhenLine(
  game: { game_number: number },
  bracket: ReadonlyArray<{ game_number: number }>,
  date: string | null,
  time: string | null,
  venue: string | null,
): string {
  const when = gameWhen(game, bracket, date, time);
  return date && venue ? `${when} · ${venue}` : when;
}

// What a playoff game card says — shared by the on-screen bracket, the
// Edit-result modal and the printed bracket. Pure: no React, no clock.
//
// Empty slots: in single elimination an empty slot reads "Winner of Game N",
// where N is the game singleElimFeeder (advancement.ts) finds — the same rule
// that moves the winner there, never a second copy of the arithmetic. A slot
// with no feeder (round 1, or any other format) reads "TBD"; we never guess.
//
// Winners: a slot is the winner only when BOTH the game's winner and the
// slot's team are set and equal. An empty slot (team null) next to an
// undecided game (winner null) is NOT a match — `null === null` used to put a
// trophy and the winner's highlight on every empty slot.

import { singleElimFeeder, type GameRow, type SlotField } from "@/lib/playoffs/advancement";

export type Side = "home" | "away";

const FIELD: Record<Side, SlotField> = { home: "home_team_id", away: "away_team_id" };

/** True only for a decided game's actual winner. */
export function slotWon(winnerId: string | null | undefined, teamId: string | null | undefined): boolean {
  return winnerId != null && teamId != null && winnerId === teamId;
}

/** The label for an EMPTY slot: "Winner of Game N" or "TBD". */
export function emptySlotLabel(game: GameRow, side: Side, allGames: GameRow[], format: string): string {
  if (format !== "single_elimination") return "TBD";
  const feeder = singleElimFeeder(game, FIELD[side], allGames);
  return feeder ? `Winner of Game ${feeder.game_number}` : "TBD";
}

/** A slot's text: the team's name, else the empty-slot label. */
export function slotName(
  name: string | null | undefined,
  game: GameRow,
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
 *  or "Game 11 · Date TBD" for a game with no date yet. */
export function gameWhen(gameNumber: number, date: string | null, time: string | null): string {
  if (!date) return `Game ${gameNumber} · Date TBD`;
  return [`Game ${gameNumber}`, shortDate(date), ...(time ? [shortTime(time)] : [])].join(" · ");
}

/** The whole line: "Game 9 · Sat 11/7 · 10:45 AM · Andrews". The printed card
 *  sets the field on a line of its own (real field names are long); every
 *  other use is this. */
export function gameWhenLine(
  gameNumber: number,
  date: string | null,
  time: string | null,
  venue: string | null,
): string {
  const when = gameWhen(gameNumber, date, time);
  return date && venue ? `${when} · ${venue}` : when;
}

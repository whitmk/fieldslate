// Whether an official may take a slot — THE rule auto-assign picks by, as a
// pure function (2026-11-09, officials self-sign-up). Its SQL twin is
// `official_block_reason` (migration 0124), which officials' own claims and
// auto-assign's write (`insert_official_assignments`) run under lock.
//
// ONE RULE, TWO LANGUAGES, ONE TABLE: the OFFICIAL-BLOCK-TABLE block in
// scripts/sim/official-signup-sim.sql runs through the SQL function in the
// proof, and through this one in `npm run sim:official-claim-rules`. Change
// one and the other's side goes red. Never a second copy of the table.
//
// Order is auto-assign's pick order (hard blocks first, then availability,
// then the weekly cap), with the division rule right after "already on this
// game". Times are the league's WALL CLOCK, read from the stored string
// (eligibility.ts) — never an instant in the host's zone.

import { gameDayCode, gameStartMinutes, gameWeekKey, type AvailabilityWindow } from "./eligibility";

export type BlockReason =
  | "already_on_game"
  | "division_not_allowed"
  | "blackout"
  | "coach_conflict"
  | "conflict_of_interest"
  | "time_conflict"
  | "outside_availability"
  | "over_weekly_limit";

export type Booking = { start: string; minutes: number };

export type BlockInput = {
  onGame: boolean;
  /** False only when the official has a division list without this game's division. */
  divisionAllowed: boolean;
  /** The official's blackout dates, "YYYY-MM-DD". */
  blackouts: readonly string[];
  coaches: boolean;
  conflictOfInterest: boolean;
  /** The game's start, stored form or "YYYY-MM-DDTHH:MM". */
  start: string;
  minutes: number;
  /** The official's other games (not this one, not cancelled), past ones too. */
  bookings: readonly Booking[];
  windows: readonly AvailabilityWindow[];
  /** max_games_per_week; null or ≤ 0 = no cap. */
  cap: number | null;
};

/** Minutes since 1970-01-01 00:00 of a wall-clock string. */
function wallMinutes(s: string): number {
  const [y, mo, d] = s.slice(0, 10).split("-").map(Number);
  const [h, mi] = s.slice(11, 16).split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60_000;
}

function hhmm(t: string): number {
  const [h = 0, m = 0] = t.split(":").map((p) => parseInt(p, 10) || 0);
  return h * 60 + m;
}

export function blockReason(i: BlockInput): BlockReason | null {
  if (i.onGame) return "already_on_game";
  if (!i.divisionAllowed) return "division_not_allowed";
  if (i.blackouts.includes(i.start.slice(0, 10))) return "blackout";
  if (i.coaches) return "coach_conflict";
  if (i.conflictOfInterest) return "conflict_of_interest";

  const start = wallMinutes(i.start);
  const end = start + i.minutes;
  if (i.bookings.some((b) => wallMinutes(b.start) < end && start < wallMinutes(b.start) + b.minutes)) {
    return "time_conflict";
  }

  if (i.windows.length > 0) {
    const day = gameDayCode(i.start);
    const startOfDay = gameStartMinutes(i.start);
    const fits = i.windows.some(
      (w) =>
        w.day_of_week === day &&
        hhmm(w.start_time) <= startOfDay &&
        startOfDay + i.minutes <= hhmm(w.end_time),
    );
    if (!fits) return "outside_availability";
  }

  if (i.cap != null && i.cap > 0) {
    const week = gameWeekKey(i.start);
    if (i.bookings.filter((b) => gameWeekKey(b.start) === week).length >= i.cap) return "over_weekly_limit";
  }
  return null;
}

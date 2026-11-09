// Officials scheduling constraints (migration 0062): weekly availability
// windows, blackout dates, and max_games_per_week buckets.
//
// WALL-CLOCK ONLY (2026-11-09, fix/officials-wall-clock). A game's
// `scheduled_at` is stored as the league's wall-clock time with a +00 suffix
// ("2026-10-10T09:00:00+00:00" is a 9:00 AM game), so its date, weekday and
// minutes come from the STRING — never from `new Date(...)` and the host's
// zone. Before this, these helpers took a parsed Date and read
// getHours()/getDay() in the BROWSER's zone: from a Pacific browser a 9:00 AM
// Saturday game was checked as 2:00 AM, so an evening window never matched an
// evening game, and a morning window (Sa 08:00–12:00) accepted a 3–7 PM game —
// an assignment outside stated availability. `sim:officials` ran pinned to
// TZ=UTC, where local equals UTC, so nothing saw it. `sim:officials-wall-clock`
// now runs under UTC, Los Angeles and Kiritimati with literal expected values.
//
// These helpers are host-zone independent: the same answer in the browser,
// on a server, and in SQL (`wallClockDate`'s rule, src/lib/utils/org-today.ts).

import { wallClockDate } from "@/lib/utils/org-today";
import { weekKeyFromIsoDate } from "@/lib/venues/game-days";

export type AvailabilityWindow = {
  day_of_week: string; // 'Mo'..'Su' (official_availability check constraint)
  start_time: string; // "HH:MM:SS" (Postgres time)
  end_time: string;
};

const DAY_CODES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

/** The weekday code ('Mo'..'Su') of a stored game time's wall-clock date. */
export function gameDayCode(scheduledAt: string): string {
  const [y, m, d] = wallClockDate(scheduledAt).split("-").map(Number);
  // UTC arithmetic on fields we set ourselves — no host zone involved.
  return DAY_CODES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** The game's wall-clock date, "YYYY-MM-DD" — what official_blackouts.date
 *  is compared with. */
export function gameDateKey(scheduledAt: string): string {
  return wallClockDate(scheduledAt);
}

/** The Monday of the game's Mon–Sun week, for max_games_per_week. The app's
 *  ONE week definition (`weekKeyFromIsoDate`, game-days.ts). */
export function gameWeekKey(scheduledAt: string): string {
  return weekKeyFromIsoDate(scheduledAt);
}

/** Minutes after midnight of the game's wall-clock start. */
export function gameStartMinutes(scheduledAt: string): number {
  return timeToMinutes(scheduledAt.substring(11, 16));
}

function timeToMinutes(t: string): number {
  const [h = 0, m = 0] = t.split(":").map((p) => parseInt(p, 10) || 0);
  return h * 60 + m;
}

/**
 * True when the whole game (start through start + duration) fits inside one
 * of the official's weekly windows. An official with NO windows is treated as
 * always available — availability is opt-in detail, not a requirement.
 */
export function isWithinAvailability(
  windows: AvailabilityWindow[],
  scheduledAt: string,
  durationMinutes: number,
): boolean {
  if (windows.length === 0) return true;
  const code = gameDayCode(scheduledAt);
  const startMins = gameStartMinutes(scheduledAt);
  const endMins = startMins + durationMinutes;
  return windows.some(
    (w) =>
      w.day_of_week === code &&
      timeToMinutes(w.start_time) <= startMins &&
      endMins <= timeToMinutes(w.end_time),
  );
}

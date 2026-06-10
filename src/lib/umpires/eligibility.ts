// Officials scheduling constraints (migration 0062): weekly availability
// windows, blackout dates, and max_games_per_week buckets. All date math is
// done in the browser's local timezone — the same zone the schedule UI
// renders game times in, so "blacked out on Jun 14" means the Jun 14 the
// league admin sees on screen.
//
// CLIENT-SIDE ONLY: on a server (Vercel) "local" is UTC, which silently
// shifts day/week boundaries. If this is ever needed from a server action
// or route, these helpers must grow an explicit timezone parameter first.

export type AvailabilityWindow = {
  day_of_week: string; // 'Mo'..'Su' (official_availability check constraint)
  start_time: string; // "HH:MM:SS" (Postgres time)
  end_time: string;
};

const DAY_CODES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

export function dayCode(date: Date): string {
  return DAY_CODES[date.getDay()];
}

/** Local-timezone YYYY-MM-DD, matching official_blackouts.date semantics. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Monday-of-week local date key — buckets games into the Mon–Sun week used
 * for max_games_per_week.
 */
export function weekKey(date: Date): string {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDateKey(monday);
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
  gameStart: Date,
  durationMinutes: number,
): boolean {
  if (windows.length === 0) return true;
  const code = dayCode(gameStart);
  const startMins = gameStart.getHours() * 60 + gameStart.getMinutes();
  const endMins = startMins + durationMinutes;
  return windows.some(
    (w) =>
      w.day_of_week === code &&
      timeToMinutes(w.start_time) <= startMins &&
      endMins <= timeToMinutes(w.end_time),
  );
}

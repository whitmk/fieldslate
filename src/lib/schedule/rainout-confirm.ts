// Wording for the single-game rainout confirmation, shared by every surface
// that offers a one-tap rainout (division panel cloud, dashboard upcoming
// list, Schedule page list). One place, so the sentence cannot drift.

import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sat 10:00 AM" from a stored wall-clock ISO string. */
export function fmtGameDayTime(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-").map(Number);
  const weekday = WEEKDAYS_SHORT[new Date(year, month - 1, day, 12).getDay()];
  return `${weekday} ${fmtGameTime(iso)}`;
}

export function rainoutConfirmCopy(scheduledAt: string, matchup: string, venue: string | null) {
  return {
    title: `Mark ${fmtGameDayTime(scheduledAt)} ${matchup} as rained out?`,
    detail: venue ? `${fmtGameDate(scheduledAt)} · ${venue}` : fmtGameDate(scheduledAt),
    confirmLabel: "Mark rained out",
  };
}

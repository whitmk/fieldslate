// Snack shack shifts as volunteer spots (0122) — pure, shared by the admin
// screens and the sim. A shift's spots are its HEADCOUNT: its own number,
// else the season's (effectivePeople, 0119 — the database's
// volunteer_shift_people is its twin). Any family may take a spot (decided
// 2026-11-09, honor system); a shift assigned to a team says who it's for.
import { effectivePeople } from "@/lib/snack-shack/headcount";
import * as W from "./words";

export type ShiftRow = {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  start: string;
  /** "HH:MM" */
  end: string;
  assignedTeamId: string | null;
  people: number;
};

/** The snack shack's stored rows → shifts with their spots. */
export function shiftsFromRows(
  blocks: readonly { id: string; date: string; start_time: string; end_time: string; assigned_team_id: string | null; people_needed: number | null }[],
  peoplePerShift: number,
): ShiftRow[] {
  return blocks
    .map((b) => ({
      id: b.id,
      date: b.date,
      start: b.start_time.slice(0, 5),
      end: b.end_time.slice(0, 5),
      assignedTeamId: b.assigned_team_id,
      people: effectivePeople(b, peoplePerShift),
    }))
    .sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : a.date + a.start > b.date + b.start ? 1 : a.id < b.id ? -1 : 1));
}

/** "9:30 AM" from a wall clock time or timestamp. */
export function clockLabel(t: string): string {
  const m = /(?:T|^)(\d{2}):(\d{2})/.exec(t);
  if (!m) return "";
  const h = +m[1];
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "9:30–11:30 AM" / "11:30 AM–1:30 PM": one suffix when both share it. */
export function shiftTimes(start: string, end: string): string {
  const a = clockLabel(start);
  const b = clockLabel(end);
  if (!a || !b) return a || b;
  const [at, as] = a.split(" ");
  const [bt, bs] = b.split(" ");
  return as === bs ? `${at}–${bt} ${bs}` : `${a}–${b}`;
}

/** "For Braves families", or null for a shift open to anyone. */
export function shiftFor(teamName: string | null | undefined): string | null {
  return teamName ? W.SHIFT_FOR(teamName) : null;
}

/** "9:30–11:30 AM · For Braves families". */
export function shiftDetail(start: string, end: string, teamName: string | null | undefined): string {
  return [shiftTimes(start, end), shiftFor(teamName)].filter(Boolean).join(" · ");
}

/** The roles screen's snack shack row: "2 per shift" (or "some shifts
 *  differ" when any shift has its own number); total spots over the shifts. */
export function snackSpotsLabel(peoplePerShift: number, shifts: readonly ShiftRow[]): string {
  const varies = shifts.some((s) => s.people !== peoplePerShift);
  return W.SNACK_SPOTS(peoplePerShift, varies);
}

export function snackTotalSpots(shifts: readonly ShiftRow[]): number {
  return shifts.reduce((n, s) => n + s.people, 0);
}

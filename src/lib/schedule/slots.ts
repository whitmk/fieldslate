// Placeable-slot computation — the venue/date/time grid the scheduler places
// games onto.
//
// WHY THIS MODULE EXISTS (extraction, 2026-07-24)
// ───────────────────────────────────────────────
// `buildSlots` and `buildPlayingDates` were lifted VERBATIM out of
// generate-schedule.ts as a pure refactor — same code, same behavior, one
// definition. The generator still imports them from here, so its hot path is
// unchanged; the point of the lift is that generate-schedule.ts is a
// `"use client"` module that imports the browser Supabase client at module
// scope, so a SERVER consumer (the Reports field-utilization card) could not
// import buildSlots without dragging the client boundary and the browser
// client into a server render. This module carries no directive and depends
// only on the pure availability helpers, so both the client-side generator and
// the server-side report can share the exact same answer to "how many games
// fit" — which is the whole reason the extraction was worth its own commit.
//
// KEEP IT PURE. No `"use client"`, no Supabase import, no React. Anything that
// needs a DB client belongs in generate-schedule.ts, not here. The diagnostics
// module already keeps its own local `DiagnosticSlot` for this same reason;
// this is the canonical home the two of them can now agree on.

import {
  isVenueAvailable,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DivisionSettings {
  games_per_team: number;
  max_games_per_week: number;
  max_games_per_team_per_day: number;
  playing_days: string[];      // e.g. ["Sa","Su"]
  day_windows?: Record<string, { start: string; end: string }>; // per-day windows (new)
  earliest_start?: string;     // "HH:MM" — legacy fallback
  latest_start?: string;       // "HH:MM" — legacy fallback
  game_duration: number;       // minutes
  buffer_minutes: number;      // minutes
  max_games_per_field_per_day: number;
  bye_weeks: number;
  auto_rotate: boolean;
  teams: Array<{
    name: string;
    has_coach_conflict: boolean;
    conflict_division: string;
    conflict_team: string;
  }>;
}

export interface Slot {
  isoString: string;  // YYYY-MM-DDTHH:MM:SS  — stored in DB
  venueId: string;
  date: string;       // YYYY-MM-DD
  weekKey: string;    // YYYY-WNN
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

export const DAY_TO_JS: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};

export const JS_TO_DAY: Record<number, string> = {
  0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa",
};

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function minutesToTimeStr(mins: number): string {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

/** Local-time date string "YYYY-MM-DD" from a Date object — avoids toISOString() UTC shift. */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ISO week key so we can track games-per-week. */
export function weekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  // Thursday-anchored ISO week
  const thu = new Date(d);
  thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const wk = 1 + Math.round((thu.getTime() - jan4.getTime()) / 604800000);
  return `${thu.getFullYear()}-W${pad2(wk)}`;
}

// ─── Playing dates & slots ───────────────────────────────────────────────────────

/**
 * The dates buildSlots will consider: playing days inside [start, end], minus
 * blackouts, minus the trailing bye weeks.
 *
 * Extracted from buildSlots verbatim (pure refactor, no behavior change) so the
 * placement diagnostics can report a playing-date count that provably matches
 * the pool the walk actually saw, rather than re-deriving the same rules and
 * risking divergence.
 */
export function buildPlayingDates(
  startDate: string,
  endDate: string,
  s: DivisionSettings,
  blackoutDates: Set<string> = new Set(),
): string[] {
  const allowedDays = new Set(s.playing_days.map((d) => DAY_TO_JS[d]));

  // Collect all valid game dates (playing days, not blacked out)
  const allDates: string[] = [];
  const cur = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (cur <= end) {
    const iso = localDateStr(cur);
    if (allowedDays.has(cur.getDay()) && !blackoutDates.has(iso)) allDates.push(iso);
    cur.setDate(cur.getDate() + 1);
  }

  // Remove bye weeks — strip the last N distinct game-weeks
  if (s.bye_weeks > 0 && allDates.length > 0) {
    const uniqueWeeks = [...new Set(allDates.map(weekKey))];
    if (s.bye_weeks < uniqueWeeks.length) {
      const byeKeys = new Set(uniqueWeeks.slice(-s.bye_weeks));
      return allDates.filter((d) => !byeKeys.has(weekKey(d)));
    }
  }
  return allDates;
}

/**
 * Returns all (venue × datetime) pairs in chronological order.
 * Slots are spaced by game_duration + buffer_minutes, capped at
 * max_games_per_field_per_day per venue per day. Filters each candidate
 * slot through the per-venue availability map so we never propose a time
 * the venue isn't open.
 */
export function buildSlots(
  startDate: string,
  endDate: string,
  s: DivisionSettings,
  venueIds: string[],
  venueAvailability: Map<string, VenueAvailability>,
  blackoutDates: Set<string> = new Set(),
): Slot[] {
  if (!venueIds.length) return [];

  // Coerce JSONB values to Number before arithmetic (prevents "90"+"15"="9015").
  const gameDuration = Number(s.game_duration);
  const bufferMins = Number(s.buffer_minutes);
  const interval = Math.max(1, gameDuration + bufferMins);

  const validDates = buildPlayingDates(startDate, endDate, s, blackoutDates);

  const slots: Slot[] = [];

  for (const date of validDates) {
    const wk = weekKey(date);
    const dayKey = JS_TO_DAY[new Date(date + "T00:00:00").getDay()] as DayKey;

    // Per-day window — fall back to legacy earliest_start/latest_start for old divisions
    const dayWin = s.day_windows?.[dayKey];
    const earliest = timeToMinutes(dayWin?.start ?? s.earliest_start ?? "09:00");
    const latest   = timeToMinutes(dayWin?.end   ?? s.latest_start  ?? "17:00");

    // Derive the slot cap from this day's window when per-day windows are present;
    // otherwise use the stored max_games_per_field_per_day (backward compat).
    const maxPerField = dayWin
      ? Math.max(1, Math.floor((latest - earliest) / interval) + 1)
      : Number(s.max_games_per_field_per_day);

    let timeMin = earliest;
    let slotsThisDay = 0;

    while (timeMin <= latest && slotsThisDay < maxPerField) {
      const wallTime = minutesToTimeStr(timeMin);
      const isoString = `${date}T${wallTime}:00`;
      for (const venueId of venueIds) {
        // Venue-availability gate: drop slots the venue isn't open for. The
        // division-window check above still applies — the engine respects the
        // tighter of the two.
        const av = venueAvailability.get(venueId);
        if (!av) continue;
        if (!isVenueAvailable(av, dayKey, wallTime, gameDuration)) continue;
        slots.push({ isoString, venueId, date, weekKey: wk });
      }
      timeMin += interval;
      slotsThisDay++;
    }
  }

  // Chronological order; within same time spread across venues
  slots.sort(
    (a, b) =>
      a.isoString.localeCompare(b.isoString) ||
      a.venueId.localeCompare(b.venueId),
  );

  return slots;
}

// Candidate-slot construction for the reschedule picker (RainoutRescheduleModal).
//
// Lifted out of rainout-reschedule-modal.tsx so the real function can be driven
// by scripts/sim/reschedule-slots-sim.ts — that file is "use client" and imports
// the browser Supabase client at module scope, so a sim (or any server consumer)
// cannot import it. Same reason slots.ts was lifted out of generate-schedule.ts.
// This module carries no directive and depends only on the pure availability
// and team-constraint helpers.
//
// SCOPE: this is the PICKER ONLY. The generator (buildSlots / planSchedule /
// finishSchedule), the conflict detectors, the conflict resolver and the panel
// badge still use the old fixed-lattice + start-distance model. That divergence
// is deliberate and known — closing it is a separate, larger change. Do not
// "align" this file back to the lattice.
//
// ── What changed, and why both halves are required ────────────────────────────
//
// BEFORE: candidates sat on a fixed lattice anchored at the division's
// day-window open, stepping by (game_duration + buffer_minutes); a candidate was
// rejected when |candidate - existingStart| < that same interval.
//
// On SRALL's Andrews Field, Minors (105+30) yielded only 10:00 / 12:15 / 2:30 /
// 4:45. The Majors games at 10:00 and 1:00 killed the first three, leaving 4:45
// as the only offer — while the field was genuinely empty from 3:00 PM. An admin
// could not place a game at 3:30.
//
// AFTER, half 1: candidates step every SLOT_GRID_MINUTES (15) across the
// division's day window.
//
// AFTER, half 2: occupancy is tested by REAL SPAN. The start-distance test
// over-reserved here, but UNDER-reserves whenever an existing game is LONGER
// than the one being placed — so a finer grid alone would have started offering
// slots that genuinely overlap real games. The coarse lattice was masking that.
// Half 1 without half 2 is worse than neither; keep them together.
//
// ── Wall-clock only. Never parse the instant. ─────────────────────────────────
//
// Every comparison here is in minutes-from-midnight taken from the DATE and TIME
// SUBSTRINGS of the stored ISO, the house convention (see game-days.ts's header).
// `games` rows store the admin's intended wall-clock tagged +00
// ("2026-08-15T13:00:00+00" = a 1 PM game); candidates are built as bare local
// "YYYY-MM-DDTHH:MM:SS". Passing those two through `new Date()` would compare a
// UTC instant against a local one and be wrong by the browser's offset in every
// non-UTC zone.
//
// That is why `spansOverlap` below MIRRORS `gamesOverlap` from
// src/lib/umpires/conflicts.ts rather than reusing it: that function is
// millisecond-based (`new Date(scheduled_at).getTime()`), correct for its own
// all-instants inputs but unusable under this convention. The predicate is the
// identical half-open interval test, transposed to wall-clock minutes. The
// umpire path is deliberately left untouched.

import { isVenueAvailable, type DayKey, type VenueAvailability } from "@/lib/venues/availability";
import { violatesHardConstraint, type TeamConstraintRule } from "@/lib/schedule/team-constraints";

/** Candidate start times step by this many minutes across the division window.
 *  15 is the finest granularity the product's time inputs express. */
export const SLOT_GRID_MINUTES = 15;

/** Fallback when a game's division has no usable `game_duration`. Mirrors
 *  DEFAULT_GAME_DURATION_MINS in umpires/conflicts.ts and the modal's own
 *  historical `game_duration ?? 90`. */
export const DEFAULT_GAME_DURATION_MINS = 90;

export interface SlotOption {
  isoString: string; // "YYYY-MM-DDTHH:MM:SS"
  venueId: string;
  venueName: string;
  date: string; // "YYYY-MM-DD"
}

/** An occupied wall-clock span on one calendar date, in minutes-from-midnight.
 *  `durationMin` is resolved from THAT game's OWN division — never the division
 *  being placed. Carrying the real duration is the whole point of half 2. */
export interface OccupiedSpan {
  startMin: number;
  durationMin: number;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function localDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minsToHHMM(mins: number): string {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

/** Resolve a game's real duration from its own division settings, with the
 *  shared default. Mirrors bookingsFromRows' per-game resolution. */
export function durationFromSettings(settings: unknown): number {
  const s = (settings ?? {}) as { game_duration?: unknown };
  const d = Number(s.game_duration);
  return Number.isFinite(d) && d > 0 ? d : DEFAULT_GAME_DURATION_MINS;
}

const DAY_TO_JS: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};
const JS_TO_DAY: Record<number, string> = {
  0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa",
};

/**
 * Half-open interval overlap on wall-clock minutes: [aStart, aEnd) vs
 * [bStart, bEnd). Touching endpoints do NOT overlap — a game starting exactly
 * when another ends is legal.
 *
 * Minute-space mirror of `gamesOverlap` (src/lib/umpires/conflicts.ts):
 *   aStart < gameEndMs(b) && bStart < gameEndMs(a)
 * See this file's header for why it is mirrored rather than imported.
 */
export function spansOverlap(a: OccupiedSpan, b: OccupiedSpan): boolean {
  return (
    a.startMin < b.startMin + b.durationMin &&
    b.startMin < a.startMin + a.durationMin
  );
}

/**
 * True when a candidate game clears an existing occupied span.
 *
 * `bufferMin` is separation the PLACING division requires around its own game,
 * applied SYMMETRICALLY: the candidate's span is padded by `bufferMin` on each
 * side before the overlap test. Symmetric because the buffer exists so one set
 * of teams can clear the field and the next can warm up — a need that is
 * identical whether the candidate lands before or after the existing game.
 * After-only padding would let a candidate be crammed against an existing
 * game's START.
 *
 * The placing division's buffer is used (not the existing game's, not the max
 * of the two) because the buffer states how much room THIS division needs
 * around ITS games. Using the existing game's would make an unrelated
 * division's setting silently shrink this picker's offers.
 *
 * Worked example — existing Majors 1:00–3:00 (780..900), placing Minors
 * 105 min with a 30 min buffer:
 *   t=3:15 (915): padded 885..1080; 885 < 900 → overlaps → rejected.
 *   t=3:30 (930): padded 900..1095; 900 < 900 is false → clear → offered.
 * The first legal start is exactly (existing real end + placing buffer).
 */
export function candidateClearsSpan(
  candidateStartMin: number,
  candidateDurationMin: number,
  bufferMin: number,
  occupied: OccupiedSpan,
): boolean {
  const buf = Math.max(0, bufferMin);
  const padded: OccupiedSpan = {
    startMin: candidateStartMin - buf,
    durationMin: candidateDurationMin + buf * 2,
  };
  return !spansOverlap(padded, occupied);
}

export interface BuildAvailableSlotsParams {
  startDate: string;
  endDate: string;
  playingDays: string[];
  dayWindows: Record<string, { start: string; end: string }>;
  earliestStart: string;
  latestStart: string;
  /** The PLACING division's game length — the candidate's own span. */
  gameDuration: number;
  /** The PLACING division's separation requirement (see candidateClearsSpan). */
  bufferMinutes: number;
  maxPerTeamDay: number;
  venueIds: string[];
  venueNames: Record<string, string>;
  venueAvailability: Record<string, VenueAvailability>;
  blackoutDates: Set<string>;
  /** "venueId:YYYY-MM-DD" → occupied spans, each carrying its OWN duration. */
  venueBookings: Map<string, OccupiedSpan[]>;
  /** "YYYY-MM-DD" → spans this team already occupies, own durations. */
  homeTeamSpans: Map<string, OccupiedSpan[]>;
  awayTeamSpans: Map<string, OccupiedSpan[]>;
  homeTeamDayCounts: Map<string, number>;
  awayTeamDayCounts: Map<string, number>;
  homeTeamId: string;
  awayTeamId: string;
  constraintRules: Map<string, TeamConstraintRule[]>;
  /** Injectable "today" (YYYY-MM-DD) so the sim is deterministic. Defaults to
   *  the real local clock, matching production behavior. */
  today?: string;
}

/**
 * Every conflict-free candidate start, on a SLOT_GRID_MINUTES grid across the
 * division's day window.
 *
 * A candidate is offered when ALL hold:
 *   - its date is a playing day, not blacked out, not in the past;
 *   - neither team is already at its per-day game cap;
 *   - its FULL SPAN [t, t+duration) fits inside the division's day window;
 *   - its FULL SPAN fits inside the venue's open hours (isVenueAvailable);
 *   - neither team has a severity-'block' constraint covering the start;
 *   - it does not overlap (padded by the placing buffer) any game already at
 *     that venue on that date;
 *   - it does not overlap any game either team already plays that date.
 *
 * Window precedence is unchanged: per-day `day_windows`, else legacy
 * `earliest_start`/`latest_start`, else 09:00/17:00.
 *
 * NOTE the window is treated as a true WINDOW: the span must END by the close,
 * where the old lattice merely required the START to be <= it. That is the
 * stricter, safer reading and is what "fits inside the division window" means.
 */
export function buildAvailableSlots(params: BuildAvailableSlotsParams): SlotOption[] {
  const {
    startDate, endDate, playingDays, dayWindows,
    earliestStart, latestStart, gameDuration, bufferMinutes,
    maxPerTeamDay, venueIds, venueNames, venueAvailability, blackoutDates,
    venueBookings, homeTeamSpans, awayTeamSpans,
    homeTeamDayCounts, awayTeamDayCounts,
    homeTeamId, awayTeamId, constraintRules,
  } = params;

  const allowedDays = new Set(playingDays.map((d) => DAY_TO_JS[d]));
  const duration = Math.max(1, Number(gameDuration));
  const buffer = Math.max(0, Number(bufferMinutes) || 0);

  // Start from today (no point scheduling in the past)
  const today = params.today ?? localDateStr(new Date());
  const effectiveStart = startDate < today ? today : startDate;

  const slots: SlotOption[] = [];
  const cur = new Date(effectiveStart + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (cur <= end) {
    const date = localDateStr(cur);

    if (allowedDays.has(cur.getDay()) && !blackoutDates.has(date)) {
      const dayKey = JS_TO_DAY[cur.getDay()] as DayKey;
      const win = dayWindows[dayKey];
      const earliest = toMins(win?.start ?? earliestStart ?? "09:00");
      const latest   = toMins(win?.end   ?? latestStart  ?? "17:00");

      const homeDayCount = homeTeamDayCounts.get(date) ?? 0;
      const awayDayCount = awayTeamDayCounts.get(date) ?? 0;

      if (homeDayCount < maxPerTeamDay && awayDayCount < maxPerTeamDay) {
        const homeSpans = homeTeamSpans.get(date) ?? [];
        const awaySpans = awayTeamSpans.get(date) ?? [];

        // Full span must fit inside the division window, so the last candidate
        // is the latest start whose game still ENDS by the close.
        for (
          let timeMin = earliest;
          timeMin + duration <= latest;
          timeMin += SLOT_GRID_MINUTES
        ) {
          const wallTime = minsToHHMM(timeMin);
          const isoString = `${date}T${wallTime}:00`;

          // Neither team may already be playing across this span. Real-span,
          // not exact-timestamp: on a 15-minute grid a team's 10:00 game must
          // also block 10:15, which an equality check would have offered.
          const cand: OccupiedSpan = { startMin: timeMin, durationMin: duration };
          if (homeSpans.some((s) => spansOverlap(cand, s))) continue;
          if (awaySpans.some((s) => spansOverlap(cand, s))) continue;

          // Neither team may have a severity-'block' constraint window
          // covering this start time (0076).
          if (violatesHardConstraint(constraintRules, homeTeamId, isoString)) continue;
          if (violatesHardConstraint(constraintRules, awayTeamId, isoString)) continue;

          // Each venue: must be open for the full span (per venue.availability)
          // and free of overlapping games at this wall time.
          for (const venueId of venueIds) {
            const av = venueAvailability[venueId];
            if (!av) continue;
            if (!isVenueAvailable(av, dayKey, wallTime, duration)) continue;

            const booked = venueBookings.get(`${venueId}:${date}`) ?? [];
            const clear = booked.every((occ) =>
              candidateClearsSpan(timeMin, duration, buffer, occ),
            );
            if (clear) {
              slots.push({ isoString, venueId, venueName: venueNames[venueId] ?? venueId, date });
            }
          }
        }
      }
    }

    cur.setDate(cur.getDate() + 1);
  }

  // Chronological, then venue name
  slots.sort((a, b) => a.isoString.localeCompare(b.isoString) || a.venueName.localeCompare(b.venueName));
  return slots;
}

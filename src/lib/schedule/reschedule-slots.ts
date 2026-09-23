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

import {
  DAY_KEYS,
  dayKeyFromIsoDate,
  isMakeupDay,
  isVenueAvailable,
  venueDayFit,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";
import { violatesHardConstraint, type TeamConstraintRule } from "@/lib/schedule/team-constraints";

/** Candidate start times step by this many minutes across the division window.
 *  15 is the finest granularity the product's time inputs express. */
export const SLOT_GRID_MINUTES = 15;

/** Fallback when a game's division has no usable `game_duration`. Mirrors
 *  DEFAULT_GAME_DURATION_MINS in umpires/conflicts.ts and the modal's own
 *  historical `game_duration ?? 90`. */
export const DEFAULT_GAME_DURATION_MINS = 90;

/** Why a slot is an exception to the division's normal rules. Present ONLY on
 *  slots an override surfaced, so a surface can mark them and never let them
 *  blend in with normal offers. */
export type SlotException = "off_day" | "second_game";

export interface SlotOption {
  isoString: string; // "YYYY-MM-DDTHH:MM:SS"
  venueId: string;
  venueName: string;
  date: string; // "YYYY-MM-DD"
  /** OMITTED ENTIRELY on a normal slot — not an empty array. With both
   *  overrides off the builder's output is byte-identical to the pre-override
   *  tree, which the seeded differential in sim:picker-overrides pins. */
  exceptions?: SlotException[];
}

/**
 * Admin-chosen relaxations, both OFF by default (an absent object is off).
 *
 * Each lifts exactly ONE gate and nothing else: venue hours and occupancy, the
 * arriving team's buffer, blackout dates, the team's own games and its
 * team_game_constraints all still apply under both. Server-side nothing rejects
 * what these surface — neither reschedule gate reads playing_days, and no route,
 * gate or DB function reads max_games_per_team_per_day (verified 2026-09-23), so
 * the picker cannot offer a time the server would refuse.
 */
export interface SlotOverrides {
  /** Offer days the division does not normally play. On such a day the VENUE's
   *  hours govern — the division's `playing_days`/`day_windows` are not
   *  consulted for it. That is the settled makeup-day semantic, reused here
   *  with a wider eligibility test (any field OPEN that day, not only
   *  makeup-flagged ones) rather than a parallel branch. */
  includeNonPlayingDays?: boolean;
  /** Lift the per-day team cap. The team still cannot play two games that
   *  OVERLAP — that is the span check, not this gate — and venue buffer still
   *  separates games on the same field. */
  allowSecondGameSameDay?: boolean;
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

// ── Occupancy read scope ──────────────────────────────────────────────────────
//
// The picker's venue-occupancy read was `.in("venue_id", venueIds)` with NO date
// bound: org-wide, every season ever, unpaginated — straight into PostgREST's
// silent 1000-row cap. Under the old fixed lattice that was largely harmless
// (the coarse grid skipped past most danger anyway). With real-span occupancy it
// is LOAD-BEARING FOR CORRECTNESS: a row hidden by truncation is a game the
// picker cannot see, so it offers a slot directly on top of it. Truncation
// raises no error, so a correct list and a truncated one are indistinguishable.
//
// SCOPE BY DATE, NEVER BY SEASON. `buildAvailableSlots` consults occupancy only
// for dates in the division's window, and `venueBookings` is keyed
// `venueId:date` with only same-date spans compared — so the division's
// [start_date, end_date] is a sufficient superset. But `games` has no
// `division_id` and season means `league_id`, and scoping by league_id would
// HIDE a concurrent season's game at the same field on the same date. That game
// really does occupy the field. Adding a league filter here would be invisible
// today (only one league currently uses these venues) and wrong later.

export type OccupancyWindow = {
  /** Inclusive lower bound, explicit +00 offset. */
  fromIso: string;
  /** EXCLUSIVE upper bound — the day AFTER endDate at 00:00. */
  toIsoExclusive: string;
};

/** Next calendar day for a "YYYY-MM-DD", via local-midnight date arithmetic —
 *  the same substring convention as `dayKeyFromIsoDate`, never an instant. */
function nextDateStr(date: string): string {
  const d = new Date(date.substring(0, 10) + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return localDateStr(d);
}

/**
 * Half-open bounds `[fromIso, toIsoExclusive)` for the picker's occupancy reads.
 *
 * The upper bound is the day AFTER `endDate`, and that rollover is the whole
 * point: `scheduled_at` is a timestamp, so a `<= endDate` bound would compare
 * against `endDate 00:00` and silently DROP every game on the final day —
 * a 3:30 PM game on the last Saturday of the season is `> 2026-10-24`. That
 * dropped row is exactly the occupancy the picker needs in order to refuse a
 * colliding slot. Fixture F8 and mutant M11 pin this.
 *
 * Bounds carry an explicit `+00:00` so the comparison is exact regardless of the
 * database's configured timezone; stored `scheduled_at` values are `+00`.
 */
export function occupancyWindow(startDate: string, endDate: string): OccupancyWindow {
  return {
    fromIso: `${startDate.substring(0, 10)}T00:00:00+00:00`,
    toIsoExclusive: `${nextDateStr(endDate)}T00:00:00+00:00`,
  };
}

/**
 * Does a stored `scheduled_at` fall inside the window? Mirrors what the `.gte()`
 * / `.lt()` filters do server-side, so the sim can prove the scope keeps the
 * rows the picker depends on.
 *
 * Pure string comparison on the `YYYY-MM-DDTHH:MM:SS` prefix — no `Date`
 * parsing. Both sides are `+00`, so the prefixes are directly comparable and
 * this stays inside the wall-clock convention. Postgres returns
 * `"2026-10-24 15:30:00+00"` (space) while candidates use `T`; normalize first.
 */
export function inOccupancyWindow(scheduledAt: string, win: OccupancyWindow): boolean {
  const key = (s: string) => s.replace(" ", "T").substring(0, 19);
  const k = key(scheduledAt);
  return k >= key(win.fromIso) && k < key(win.toIsoExclusive);
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

/**
 * Why one DATE produced no slots.
 *
 * CAPTURED DURING THE BUILD, NEVER RECONSTRUCTED. Re-deriving the reason after
 * the fact would mean a second copy of the eligibility logic that drifts from
 * the first — the bug family this repo has been bitten by repeatedly. Each kind
 * below is written at the exact `continue`/`if` that caused it.
 *
 * The three that the picker surfaces as configuration problems:
 *   no_field         — case (a): nothing open and makeup-flagged that day.
 *   window_too_short — case (b): a field IS open and flagged, but its window
 *                      cannot fit this division's game span. Distinct from (a)
 *                      because the remedy differs: widen the window you have,
 *                      not open one you don't. Without this the picker sends an
 *                      admin to add hours to a field that already has them.
 *   occupied         — case (c): at least one real candidate (a start time the
 *                      day's window allows, at a field open for the whole span)
 *                      existed, and every one was rejected by a booking, a team
 *                      conflict or a team constraint. Nothing is misconfigured;
 *                      the day is full.
 *   day_window_too_short
 *                    — case (d): a field's own hours COULD fit the game, but no
 *                      start time on the day's window put the whole span inside
 *                      those hours — so there was never a candidate to reject.
 *                      The live shape: a division whose Wednesday window is
 *                      17:00–17:00 at a field open 17:00–21:00. Before (d)
 *                      existed that day was reported as (c), "already booked",
 *                      with ZERO rejections behind it — a confidently wrong
 *                      message on a day nothing was booked.
 *
 * (c) REQUIRES REJECTIONS. "occupied" is written only when the walk produced a
 * candidate; a field that fits in principle is not enough. Do not collapse (d)
 * back into (c) — mutant M13 in sim:reschedule-slots does exactly that.
 *
 * `blackout` and `team_cap` are date-specific rather than configuration, and
 * are reported separately so they are not mistaken for either.
 */
export type DayDiagnostic =
  | { kind: "blackout" }
  | { kind: "team_cap" }
  | { kind: "no_field" }
  | {
      kind: "window_too_short";
      /** The open-but-too-short fields, for a message that can name them. */
      venues: { venueId: string; venueName: string; start: string; end: string }[];
    }
  | {
      kind: "day_window_too_short";
      /** The window the time loop walked, "HH:MM". On a playing day this is the
       *  DIVISION's window for that weekday; on a makeup-only day it is the
       *  union of the makeup-flagged fields' hours (see `governedBy`). */
      window: { start: string; end: string };
      /** "makeup_union" = the makeup-flagged fields' hours; "override_union" =
       *  the hours of every field open that day, which only the
       *  includeNonPlayingDays override can produce. A new value rather than a
       *  rename of "makeup_union", so output with the overrides off is
       *  unchanged. */
      governedBy: "division" | "makeup_union" | "override_union";
      /** The placing game's span, so a message can say why it did not fit. */
      durationMin: number;
    }
  | {
      kind: "occupied";
      /** Which check ate the candidates — so case (c) can say "already booked"
       *  versus "your teams are already playing" without inventing a reason. */
      venueBookingRejections: number;
      teamRejections: number;
    };

/** Every date in the searched range that produced NO slots, keyed
 *  "YYYY-MM-DD". A date that produced slots is absent. */
export type DayDiagnostics = Map<string, DayDiagnostic>;

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
  /** Absent = today's behavior exactly. See SlotOverrides. */
  overrides?: SlotOverrides;
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
  return buildSlotsAndDiagnostics(params).slots;
}

/**
 * The real implementation: candidate slots PLUS the per-date reason each empty
 * day was empty.
 *
 * `buildAvailableSlots` above is a thin wrapper returning only `.slots`, kept so
 * the existing sim and any slots-only caller are unaffected. There is ONE
 * implementation — the wrapper cannot drift from it.
 */
export function buildSlotsAndDiagnostics(
  params: BuildAvailableSlotsParams,
): { slots: SlotOption[]; diagnostics: DayDiagnostics } {
  const {
    startDate, endDate, playingDays, dayWindows,
    earliestStart, latestStart, gameDuration, bufferMinutes,
    maxPerTeamDay, venueIds, venueNames, venueAvailability, blackoutDates,
    venueBookings, homeTeamSpans, awayTeamSpans,
    homeTeamDayCounts, awayTeamDayCounts,
    homeTeamId, awayTeamId, constraintRules,
  } = params;

  // Both default OFF. Read once so every gate below reads the same value.
  const includeNonPlayingDays = params.overrides?.includeNonPlayingDays === true;
  const allowSecondGameSameDay = params.overrides?.allowSecondGameSameDay === true;

  const allowedDays = new Set(playingDays.map((d) => DAY_TO_JS[d]));
  const duration = Math.max(1, Number(gameDuration));
  const buffer = Math.max(0, Number(bufferMinutes) || 0);

  // ── Makeup days ─────────────────────────────────────────────────────────────
  //
  // A day where at least one CANDIDATE venue is makeup-flagged becomes offerable
  // even when the division does not play it. On such a day THE VENUE'S HOURS
  // GOVERN: the division's `day_windows`/legacy band is not consulted at all,
  // which is what makes designating a makeup day require no new hours anywhere.
  //
  // The bounds below are the UNION across makeup-flagged venues — min(open),
  // max(close) — and are only a BOUNDING RANGE for the time loop. Each venue is
  // still narrowed to its OWN window by `isVenueAvailable` inside the venue
  // loop, exactly as on a normal playing day, so a wider union can never offer a
  // slot at a field that is shut. That is why this needed no loop inversion.
  //
  // GRID ANCHOR: the time loop steps by SLOT_GRID_MINUTES from `earliest`, so on
  // a makeup day the grid anchors at the venue's open time rather than the
  // division's. Live windows open on quarter hours (16:30), so offered times
  // stay on :00/:15/:30/:45 — but a venue opening at, say, 16:20 would anchor
  // the grid there and offer 16:20/16:35/16:50. That is not new behavior (a
  // division window opening at 16:20 does the same today), just newly reachable.
  //
  // THE OVERRIDE REUSES THIS EXACT MECHANISM. `includeNonPlayingDays` only
  // widens which fields count as candidates on a non-playing day: a
  // makeup-flagged field, or — under the override — any field OPEN that day.
  // Bounds, per-venue narrowing and the grid are untouched, which is why the
  // override needed no new branch. On a makeup day WITH the override on, the
  // union therefore widens to every open field (a deliberate decision: the
  // admin asked for the wider search), while with it off the makeup day
  // behaves exactly as it always has.
  const offDayWindowByDay = new Map<DayKey, { startMin: number; endMin: number }>();
  /** The pre-override union: makeup-flagged fields only. Kept even when the
   *  override is on, because it is the exact definition of "this slot would
   *  have been offered anyway" — see the per-slot flag below. */
  const makeupWindowByDay = new Map<DayKey, { startMin: number; endMin: number }>();
  for (const day of DAY_KEYS) {
    let lo = Number.POSITIVE_INFINITY, hi = Number.NEGATIVE_INFINITY;
    let mLo = Number.POSITIVE_INFINITY, mHi = Number.NEGATIVE_INFINITY;
    for (const venueId of venueIds) {
      const av = venueAvailability[venueId];
      if (!av) continue;
      const w = av[day];
      if (!w) continue;
      const flagged = isMakeupDay(av, day);
      if (flagged) {
        mLo = Math.min(mLo, toMins(w.start));
        mHi = Math.max(mHi, toMins(w.end));
      }
      if (!flagged && !includeNonPlayingDays) continue;
      lo = Math.min(lo, toMins(w.start));
      hi = Math.max(hi, toMins(w.end));
    }
    if (mLo <= mHi) makeupWindowByDay.set(day, { startMin: mLo, endMin: mHi });
    if (lo <= hi) offDayWindowByDay.set(day, { startMin: lo, endMin: hi });
  }

  // Start from today (no point scheduling in the past)
  const today = params.today ?? localDateStr(new Date());
  const effectiveStart = startDate < today ? today : startDate;

  const slots: SlotOption[] = [];
  const diagnostics: DayDiagnostics = new Map();
  const cur = new Date(effectiveStart + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (cur <= end) {
    const date = localDateStr(cur);

    const dayKey = JS_TO_DAY[cur.getDay()] as DayKey;
    const playsToday = allowedDays.has(cur.getDay());
    const offDayToday = offDayWindowByDay.get(dayKey);
    const makeupToday = makeupWindowByDay.get(dayKey);

    // IS THIS PARTICULAR SLOT ONE THE OVERRIDE SURFACED? Per SLOT, not per day.
    // A makeup day is offered with the override off, so its slots are not
    // exceptions — but with the override ON that same day WIDENS to every open
    // field and the whole of their hours, and those extra (field, time) pairs
    // ARE new. Flagging the day as a whole would let them blend in with the
    // pre-existing makeup offers, which is exactly what the flags exist to
    // prevent. A slot is pre-existing iff its field is makeup-flagged AND its
    // full span fits the makeup union the toggle-off loop would have walked.
    const isOverrideSlot = (venueId: string, timeMin: number): boolean => {
      if (playsToday) return false;
      const av = venueAvailability[venueId];
      if (!av || !isMakeupDay(av, dayKey)) return true;
      return (
        !makeupToday ||
        timeMin < makeupToday.startMin ||
        timeMin + duration > makeupToday.endMin
      );
    };

    // Every date in range is classified. A date that yields slots is deleted
    // from the map at the end of its iteration, so what remains is exactly the
    // empty days with the reason recorded where it happened.
    if (!playsToday && !offDayToday) {
      // Case (a) at the day gate: the division does not play, and no candidate
      // field is makeup-flagged. This is the Sunday case.
      diagnostics.set(date, { kind: "no_field" });
    } else if (blackoutDates.has(date)) {
      diagnostics.set(date, { kind: "blackout" });
    } else {
      // On a day the division PLAYS, nothing changes — the division window
      // governs even if some field is also makeup-flagged. Only a MAKEUP-ONLY
      // day switches to the venue-union bounds.
      const win = dayWindows[dayKey];
      const earliest = playsToday
        ? toMins(win?.start ?? earliestStart ?? "09:00")
        : offDayToday!.startMin;
      const latest = playsToday
        ? toMins(win?.end ?? latestStart ?? "17:00")
        : offDayToday!.endMin;

      const homeDayCount = homeTeamDayCounts.get(date) ?? 0;
      const awayDayCount = awayTeamDayCounts.get(date) ?? 0;
      // At the cap the team is already playing today. The override offers the
      // date anyway and marks what it offers; the overlap check below still
      // stops two games at once.
      const atTeamCap = homeDayCount >= maxPerTeamDay || awayDayCount >= maxPerTeamDay;

      if (atTeamCap && !allowSecondGameSameDay) {
        diagnostics.set(date, { kind: "team_cap" });
      } else {
        // The cap is a per-DATE fact; the off-day flag is per SLOT (above).
        const isSecondGameDay = atTeamCap;
        const exceptionsFor = (venueId: string, timeMin: number): SlotException[] | undefined => {
          const offDay = isOverrideSlot(venueId, timeMin);
          if (!offDay && !isSecondGameDay) return undefined; // normal slot: no key at all
          return [
            ...(offDay ? (["off_day"] as const) : []),
            ...(isSecondGameDay ? (["second_game"] as const) : []),
          ];
        };
        const homeSpans = homeTeamSpans.get(date) ?? [];
        const awaySpans = awayTeamSpans.get(date) ?? [];

        // Which fields participate today, and can each host this span AT ALL?
        // Asked once per date, before the time loop — `venueDayFit` separates
        // "closed" from "open but too short", which `isVenueAvailable` cannot.
        const participating = venueIds.filter((venueId) => {
          const av = venueAvailability[venueId];
          if (!av) return false;
          // On a playing day every field participates. Off a playing day only
          // makeup-flagged fields do — unless the override is on, when any
          // field with hours that day does.
          return playsToday || isMakeupDay(av, dayKey) || (includeNonPlayingDays && !!av[dayKey]);
        });
        const tooShort: { venueId: string; venueName: string; start: string; end: string }[] = [];
        let anyFits = false;
        for (const venueId of participating) {
          const av = venueAvailability[venueId]!;
          const fit = venueDayFit(av, dayKey, duration);
          if (fit === "fits") anyFits = true;
          else if (fit === "too_short") {
            const w = av[dayKey]!;
            tooShort.push({
              venueId,
              venueName: venueNames[venueId] ?? venueId,
              start: w.start,
              end: w.end,
            });
          }
        }
        // Counted during the walk, never inferred afterwards.
        let venueBookingRejections = 0;
        let teamRejections = 0;
        // (time, field) pairs that were REAL candidates: inside the day's window
        // AND inside that field's hours for the whole span. Case (c) "occupied"
        // is only true when at least one existed — see DayDiagnostic.
        let candidatePairs = 0;
        const slotsBefore = slots.length;

        // Full span must fit inside the division window, so the last candidate
        // is the latest start whose game still ENDS by the close.
        for (
          let timeMin = earliest;
          timeMin + duration <= latest;
          timeMin += SLOT_GRID_MINUTES
        ) {
          const wallTime = minsToHHMM(timeMin);
          const isoString = `${date}T${wallTime}:00`;

          // Which fields could host this start for the whole span? Asked BEFORE
          // the team checks (all pure) so a team rejection at a time no field
          // could host is not mistaken for a real candidate. This changes no
          // offered slot and no rejection count — it only feeds candidatePairs.
          // On a MAKEUP-ONLY day only the flagged fields participate: a field
          // that merely happens to be open that day was never offered for
          // rained-out games. On a playing day every field participates.
          const hostable = participating.filter((venueId) =>
            isVenueAvailable(venueAvailability[venueId]!, dayKey, wallTime, duration),
          );
          candidatePairs += hostable.length;

          // Neither team may already be playing across this span. Real-span,
          // not exact-timestamp: on a 15-minute grid a team's 10:00 game must
          // also block 10:15, which an equality check would have offered.
          const cand: OccupiedSpan = { startMin: timeMin, durationMin: duration };
          if (homeSpans.some((s) => spansOverlap(cand, s))) { teamRejections++; continue; }
          if (awaySpans.some((s) => spansOverlap(cand, s))) { teamRejections++; continue; }

          // Neither team may have a severity-'block' constraint window
          // covering this start time (0076).
          if (violatesHardConstraint(constraintRules, homeTeamId, isoString)) { teamRejections++; continue; }
          if (violatesHardConstraint(constraintRules, awayTeamId, isoString)) { teamRejections++; continue; }

          // Each hostable venue must be free of overlapping games at this time.
          for (const venueId of hostable) {
            const booked = venueBookings.get(`${venueId}:${date}`) ?? [];
            const clear = booked.every((occ) =>
              candidateClearsSpan(timeMin, duration, buffer, occ),
            );
            if (clear) {
              const exceptions = exceptionsFor(venueId, timeMin);
              slots.push({
                isoString, venueId, venueName: venueNames[venueId] ?? venueId, date,
                ...(exceptions ? { exceptions } : {}),
              });
            } else {
              venueBookingRejections++;
            }
          }
        }

        if (slots.length === slotsBefore) {
          // Nothing came out. Which gate closed?
          //   candidatePairs > 0 → real candidates existed and all were
          //                        rejected, so the day is FULL (c).
          //   anyFits            → a field's hours fit the span, but no start
          //                        on the day's window landed inside them —
          //                        never a candidate to reject (d).
          //   tooShort           → a field is open and flagged but cannot fit
          //                        the span (b).
          //   neither            → nothing open and flagged at all (a).
          // Ordered so (c) wins over (b): if ANY field could have taken the
          // game, the day is occupied, and telling the admin to widen a
          // different field's window would be wrong. (d) sits between them
          // for the same reason — the fitting field is the one that matters.
          if (candidatePairs > 0) {
            diagnostics.set(date, {
              kind: "occupied",
              venueBookingRejections,
              teamRejections,
            });
          } else if (anyFits) {
            diagnostics.set(date, {
              kind: "day_window_too_short",
              window: { start: minsToHHMM(earliest), end: minsToHHMM(latest) },
              governedBy: playsToday
                ? "division"
                : includeNonPlayingDays
                  ? "override_union"
                  : "makeup_union",
              durationMin: duration,
            });
          } else if (tooShort.length > 0) {
            diagnostics.set(date, { kind: "window_too_short", venues: tooShort });
          } else {
            diagnostics.set(date, { kind: "no_field" });
          }
        }
      }
    }

    cur.setDate(cur.getDate() + 1);
  }

  // Chronological, then venue name
  slots.sort((a, b) => a.isoString.localeCompare(b.isoString) || a.venueName.localeCompare(b.venueName));
  return { slots, diagnostics };
}

// ── Weekday roll-up of empty days ─────────────────────────────────────────────
//
// Diagnostics arrive PER DATE, which is the honest granularity — a blackout or a
// team cap belongs to one date. But a season holds ~10 Sundays that all fail for
// the identical reason, and ten identical rows is noise, so the rendering rolls
// them up by DAY OF WEEK. A weekday appears only when EVERY one of its dates in
// range produced nothing.
//
// ONE ENTRY PER DISTINCT REASON PER WEEKDAY, EACH WITH ITS OWN COUNT (2026-09-15).
// The previous roll-up picked the most common reason and reported it with the
// count of EVERY empty date of that weekday — "Mets already has a game that day
// (7 dates)" for 6 team-cap Saturdays and 1 blackout, and for 5 team-cap
// Wednesdays plus 2 where the team was free and only the division's 5pm–5pm
// window blocked it. The minority reasons vanished, and they were the actionable
// ones. Do not collapse back to a single reason per weekday (mutant RU1 in
// sim:interleague-picker).
//
// A "reason" is what a surface would PRINT, not just the kind (reasonKey):
// occupied splits by who is to blame (booked field vs the teams), and the two
// window kinds split by the window they name — two dates share a count only if
// they would render the same sentence. Order within a weekday: most dates first,
// ties by the earliest date that had the reason.
//
// Moved here from rainout-reschedule-modal.tsx (2026-09-14); both pickers use it.
export type DaySummary = {
  day: DayKey;
  /** Representative of THIS reason: the earliest date that had it. */
  diagnostic: DayDiagnostic;
  /** Dates of this weekday that had THIS reason. */
  dateCount: number;
  /** Distinct reasons this weekday had. 1 means this entry is the whole weekday. */
  reasonsOnDay: number;
};

/** Who an `occupied` day is blamed on. The single rule both pickers render. */
export function occupiedBlame(d: { teamRejections: number; venueBookingRejections: number }): "teams" | "booked" {
  return d.teamRejections > d.venueBookingRejections ? "teams" : "booked";
}

/** Two diagnostics share a key exactly when a surface would print the same reason. */
export function reasonKey(d: DayDiagnostic): string {
  switch (d.kind) {
    case "occupied":
      return `occupied:${occupiedBlame(d)}`;
    case "window_too_short":
      return `window_too_short:${d.venues
        .map((v) => `${v.venueId}@${v.start}-${v.end}`)
        .sort()
        .join("|")}`;
    case "day_window_too_short":
      return `day_window_too_short:${d.governedBy}:${d.window.start}-${d.window.end}:${d.durationMin}`;
    default:
      return d.kind;
  }
}

export function summarizeByWeekday(
  diagnostics: DayDiagnostics,
  slots: SlotOption[],
): DaySummary[] {
  const datesWithSlots = new Set(slots.map((s) => s.date));
  const dayHasSlots = new Set<DayKey>();
  for (const date of datesWithSlots) dayHasSlots.add(dayKeyFromIsoDate(date));

  // Chronological: the builder inserts dates in order, so the first diagnostic
  // seen for a reason is its earliest date.
  const byDay = new Map<DayKey, Map<string, { diagnostic: DayDiagnostic; count: number; order: number }>>();
  let order = 0;
  for (const [date, d] of [...diagnostics].sort(([a], [b]) => a.localeCompare(b))) {
    const day = dayKeyFromIsoDate(date);
    let reasons = byDay.get(day);
    if (!reasons) byDay.set(day, (reasons = new Map()));
    const key = reasonKey(d);
    const r = reasons.get(key);
    if (r) r.count++;
    else reasons.set(key, { diagnostic: d, count: 1, order: order++ });
  }

  const out: DaySummary[] = [];
  for (const day of DAY_KEYS) {
    // A weekday that produced ANY slot is not an empty day — say nothing.
    if (dayHasSlots.has(day)) continue;
    const reasons = byDay.get(day);
    if (!reasons || reasons.size === 0) continue;
    const sorted = [...reasons.values()].sort((a, b) => b.count - a.count || a.order - b.order);
    for (const r of sorted) {
      out.push({ day, diagnostic: r.diagnostic, dateCount: r.count, reasonsOnDay: sorted.length });
    }
  }
  return out;
}

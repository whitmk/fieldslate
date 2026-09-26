// "Enter a time manually" on the reschedule picker's MOVE variant — the escape
// hatch for a time or field the slot list doesn't offer. Pure, so
// `npm run sim:manual-move` drives exactly what the form calls.
//
// FULLY MANUAL, BY DESIGN (decided 2026-09-26). Any date, any time, any venue in
// the org — no filtering by division attachment, playing days, venue hours or
// occupancy. The admin has a reason; the product does not second-guess it.
//
// CONFLICTS ARE NOTICES, NEVER GATES, AND NOTHING IS RECORDED. This DIVERGES on
// purpose from Add Game and the conflict resolver's manual move, which block the
// save until the admin types a reason (recorded in `conflict_overrides`). Add
// Game is placing a NEW game and can afford to demand a justification; this is
// an escape hatch whose whole purpose is to stop asking. Do not "fix" it to
// match. What it must do is SAY what the save steps on — field already booked,
// a team already playing then, outside the field's hours (or none set, or
// closed that day), a day the division doesn't play, a blackout date — and a
// read that failed must say "couldn't check", never read as all-clear.
//
// SAME PREDICATES AS THE PICKER, so a manual time the picker would have refused
// is flagged for the same reason:
// - field occupancy: `candidateClearsSpan` — real spans, each existing game's
//   OWN division duration, the PLACING (arriving) division's buffer padded
//   symmetrically;
// - team occupancy: `spansOverlap` on real spans, no buffer;
// - hours: `dayWindowBounds` — the whole span must fit inside the window (a
//   window close means the game must END by it).
//
// INTERLEAGUE NEVER GETS HERE. The link renders only on the "move" variant
// (`manualEntryAvailable`), and that variant is opened only from a `plain`
// routeMoveTarget result — non-interleague, with a real away team. The four
// render paths that open the picker ungated for interleague (CLAUDE.md,
// reschedule picker KNOWN DEFECT) all use the RAINOUT variant, which is why the
// variant check IS the interleague guard. Keep it that way.

import {
  dayKeyFromIsoDate,
  dayWindowBounds,
  hasAnyDayConfigured,
  type VenueAvailability,
} from "@/lib/venues/availability";
import {
  candidateClearsSpan,
  spansOverlap,
  minsToHHMM,
  type OccupiedSpan,
} from "@/lib/schedule/reschedule-slots";
import type { RescheduleVariant } from "@/lib/schedule/reschedule-variant";
import { lockedReason } from "@/lib/schedule/division-lock";

/** The manual link exists on the MOVE variant only. Rainout recovery keeps
 *  offering slots — and is the variant the ungated interleague paths use. */
export function manualEntryAvailable(variant: RescheduleVariant): boolean {
  return variant === "move";
}

// House guard for native date/time inputs (CLAUDE.md, "Native date/time
// inputs"): an uncommitted segment leaves the value "", and a Postgres `time`
// may prefill as HH:MM:SS — the seconds tolerance is required.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

export type ManualDateTime = {
  date: string;
  startMin: number;
  /** Bare wall-clock string — the SAME shape the picker's save writes
   *  (SlotOption.isoString), so both paths store times identically. */
  isoString: string;
};

export function parseManualDateTime(date: string, time: string): ManualDateTime | null {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  const hhmm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return { date, startMin: h * 60 + m, isoString: `${date}T${hhmm}:00` };
}

export type ManualBookedGame = OccupiedSpan & {
  /** e.g. "Minors: Mets vs Cubs". */
  label: string;
};

export type ManualTeamGame = OccupiedSpan & {
  teamName: string;
  /** e.g. "vs Cubs at Andrews". */
  label: string;
};

export type ManualConflictKind =
  | "venue_booked"
  | "team_busy"
  | "venue_hours_unset"
  | "venue_closed"
  | "outside_hours"
  | "non_playing_day"
  | "blackout"
  | "unchecked";

export type ManualConflict = { kind: ManualConflictKind; text: string };

const DAY_NAME: Record<string, string> = {
  Mo: "Mondays", Tu: "Tuesdays", We: "Wednesdays", Th: "Thursdays",
  Fr: "Fridays", Sa: "Saturdays", Su: "Sundays",
};

/** "15:30" minutes → "3:30 PM". */
export function fmtMins(mins: number): string {
  const [h, m] = minsToHHMM(((mins % 1440) + 1440) % 1440).split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}

function spanText(s: OccupiedSpan): string {
  return `${fmtMins(s.startMin)}–${fmtMins(s.startMin + s.durationMin)}`;
}

export type ManualConflictInput = {
  when: ManualDateTime;
  durationMin: number;
  bufferMin: number;
  divisionName: string;
  playingDays: string[];
  blackoutDates: Set<string>;
  venue: {
    label: string;
    availabilityConfigured: boolean;
    availability: VenueAvailability;
  };
  /** Games at the chosen field on the chosen date (the moving game and
   *  cancelled games already excluded), or null when that read FAILED. */
  venueGames: ManualBookedGame[] | null;
  /** Either team's games on the chosen date (same exclusions), or null when
   *  that read FAILED. */
  teamGames: ManualTeamGame[] | null;
};

/**
 * Everything the chosen date/time/field steps on. Empty = nothing found.
 * NEVER a gate — the form saves regardless.
 */
export function manualMoveConflicts(p: ManualConflictInput): ManualConflict[] {
  const out: ManualConflict[] = [];
  const { when, durationMin, bufferMin } = p;
  const cand: OccupiedSpan = { startMin: when.startMin, durationMin };
  const day = dayKeyFromIsoDate(when.date);

  // 1. Field already booked.
  if (p.venueGames === null) {
    out.push({
      kind: "unchecked",
      text: `Couldn't check whether ${p.venue.label} is already booked then.`,
    });
  } else {
    for (const g of p.venueGames) {
      if (!candidateClearsSpan(when.startMin, durationMin, bufferMin, g)) {
        out.push({
          kind: "venue_booked",
          text: `${p.venue.label} is booked ${spanText(g)} (${g.label}).`,
        });
      }
    }
  }

  // 2. A team already playing at that time — the worst case.
  if (p.teamGames === null) {
    out.push({
      kind: "unchecked",
      text: "Couldn't check whether either team is already playing then.",
    });
  } else {
    for (const g of p.teamGames) {
      if (spansOverlap(cand, g)) {
        out.push({
          kind: "team_busy",
          text: `${g.teamName} already plays ${spanText(g)} (${g.label}).`,
        });
      }
    }
  }

  // 3. The field's hours. The whole span must fit: a close means END by it.
  if (!p.venue.availabilityConfigured || !hasAnyDayConfigured(p.venue.availability)) {
    out.push({
      kind: "venue_hours_unset",
      text: `${p.venue.label} has no hours set, so they couldn't be checked.`,
    });
  } else {
    const b = dayWindowBounds(p.venue.availability, day);
    if (!b) {
      out.push({
        kind: "venue_closed",
        text: `${p.venue.label} is closed on ${DAY_NAME[day]}.`,
      });
    } else if (when.startMin < b.startMin || when.startMin + durationMin > b.endMin) {
      out.push({
        kind: "outside_hours",
        text: `${p.venue.label} is open ${fmtMins(b.startMin)}–${fmtMins(b.endMin)}; this game would run ${spanText(cand)}.`,
      });
    }
  }

  // 4. A day the division doesn't play.
  if (!p.playingDays.includes(day)) {
    out.push({
      kind: "non_playing_day",
      text: `${p.divisionName} doesn't play on ${DAY_NAME[day]}.`,
    });
  }

  // 5. Blackout date.
  if (p.blackoutDates.has(when.date)) {
    out.push({ kind: "blackout", text: "That date is blacked out for this season." });
  }

  return out;
}

// ── The save-time lock re-read ────────────────────────────────────────────────
//
// routeMoveTarget refuses to open the picker on a locked division, so the
// manual path inherits the lock. But the lock can be switched on WHILE the form
// is open, and the 0082 trigger permits `scheduled_at` / `venue_id` writes on a
// locked division — so without a re-read at save, the manual path would be the
// way around the lock. The form re-reads the lock (fetchDivisionLocks, which
// throws rather than defaulting to unlocked) and asks THIS function. A failed
// read refuses: an unreadable lock must not read as "unlocked".
//
// Manual path ONLY (decided 2026-09-26). The picker's own save has the same
// stale-lock gap; it is pre-existing and recorded as a follow-up in CLAUDE.md.

export type LockRead =
  | { ok: true; locked: boolean }
  | { ok: false; message: string };

export function manualSaveLockRefusal(
  read: LockRead,
  divisionName: string,
): string | null {
  if (!read.ok) {
    return `Couldn't confirm the schedule isn't locked, so nothing was saved. ${read.message}`;
  }
  if (read.locked) return lockedReason(divisionName, "move");
  return null;
}

/**
 * Whether Save is enabled. Takes the conflicts ONLY to state, in code, that
 * they never block: a conflict list — even one full of "couldn't check" — is
 * not a reason to refuse. Only a missing date/time or field disables Save.
 */
export function manualSaveEnabled(p: {
  when: ManualDateTime | null;
  venueChosen: boolean;
  saving: boolean;
  conflicts: ManualConflict[] | null;
}): boolean {
  return !!p.when && p.venueChosen && !p.saving;
}

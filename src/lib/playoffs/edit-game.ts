// Manual date / time / field edit of ONE playoff game — the pure decisions.
// The modal (edit-playoff-game-modal.tsx) reads, renders and saves; everything
// it decides is here so `npm run sim:playoff-bracket` (part E) can drive it.
//
// CONFLICTS ARE NOTICES, NEVER GATES — the same rule, and the SAME function,
// as the reschedule picker's "Enter a time manually" (`manualMoveConflicts` in
// lib/schedule/manual-move.ts): field already booked by a real span with the
// placing division's buffer (`candidateClearsSpan`), a team already playing,
// outside the field's hours / closed / hours unset, a day the playoff doesn't
// play, a blackout date, and a read that failed says "couldn't check". Playoff
// games are checked against BOTH tables: the season's `games` at that field
// and the other `playoff_games` there (every division's bracket, since a
// field is one field).

import {
  manualMoveConflicts,
  parseManualDateTime,
  type ManualBookedGame,
  type ManualConflict,
  type ManualDateTime,
  type ManualTeamGame,
} from "@/lib/schedule/manual-move";
import type { VenueAvailability } from "@/lib/venues/availability";
import { fmtPlanDate, fmtMinutes } from "@/lib/playoffs/bracket-plan";

export { parseManualDateTime };
export type { ManualDateTime };

export type PlayoffEditInput = {
  when: ManualDateTime;
  durationMin: number;
  bufferMin: number;
  divisionName: string;
  /** The PLAYOFF's playing days (not the regular season's). */
  playingDays: string[];
  blackoutDates: Set<string>;
  venue: { label: string; availabilityConfigured: boolean; availability: VenueAvailability };
  /** Season games + other playoff games at the field that day; null = a read failed. */
  venueGames: ManualBookedGame[] | null;
  /** Either team's season or playoff games that day; null = a read failed.
   *  A TBD game has no teams and passes an empty list. */
  teamGames: ManualTeamGame[] | null;
};

export function playoffEditConflicts(p: PlayoffEditInput): ManualConflict[] {
  return manualMoveConflicts({
    when: p.when,
    durationMin: p.durationMin,
    bufferMin: p.bufferMin,
    divisionName: p.divisionName,
    playingDays: p.playingDays,
    blackoutDates: p.blackoutDates,
    venue: p.venue,
    venueGames: p.venueGames,
    teamGames: p.teamGames,
  });
}

/** Save is enabled with a parsed date/time and a field; conflicts never
 *  disable it (stated in code, as the manual-move form does). */
export function playoffEditSaveEnabled(p: {
  when: ManualDateTime | null;
  venueChosen: boolean;
  saving: boolean;
  conflicts: ManualConflict[] | null;
}): boolean {
  return !!p.when && p.venueChosen && !p.saving;
}

/** The UPDATE's `.select("id")` row count → an error sentence, or null on a
 *  one-row success. Zero rows is NEVER success: the game was deleted or
 *  regenerated under the admin's feet. */
export function playoffEditOutcome(rowsAffected: number): string | null {
  if (rowsAffected === 1) return null;
  if (rowsAffected === 0) {
    return "Nothing was saved — this playoff game no longer exists (the bracket may have been regenerated). Refresh and try again.";
  }
  return `Unexpected: ${rowsAffected} games were changed. Refresh and check the bracket.`;
}

/** Activity-log sentence for a saved edit. */
export function playoffEditLogMessage(p: {
  divisionName: string;
  roundLabel: string;
  homeName: string | null;
  awayName: string | null;
  when: ManualDateTime;
  venueLabel: string;
}): string {
  const matchup =
    p.homeName && p.awayName ? `${p.homeName} vs ${p.awayName}` : "TBD vs TBD";
  return `${p.divisionName} playoffs, ${p.roundLabel} (${matchup}) set to ${fmtPlanDate(p.when.date)} at ${fmtMinutes(p.when.startMin)} — ${p.venueLabel}`;
}

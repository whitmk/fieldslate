// "Record where it was played" — a retroactive correction for a game that was
// already played somewhere other than its schedule says (usually a rained-out
// game the coaches made up without telling the admin). Pure, so
// `npm run sim:record-played` drives exactly what the modal and the entry
// points call.
//
// THE DATABASE IS THE FENCE. record_game_played (0106) refuses everything this
// file refuses, in this order: not a member → Free plan → interleague → status
// not cancelled/scheduled → played date after today (org timezone) or before
// the season start → a field outside the org. This file decides what the admin
// SEES before the click (which games offer the action, why Save is off), and
// turns the function's refusal keys into sentences. It never decides alone.
//
// WHAT IS DELIBERATELY DIFFERENT FROM THE MOVE PICKER'S MANUAL PATH
// - ALLOWED ON A LOCKED DIVISION. A correction records what already happened;
//   the played-date rule (today or earlier) is what stops it being a way around
//   the lock for future games, and the database enforces it.
// - "SENT TO PARENTS" IS KEPT (the function restores posted/posted_at).
// - The activity-log entry is written by the FUNCTION, in the same
//   transaction, as `game_played_recorded` with the optional reason. There is
//   no log-message builder here on purpose — the wording lives in 0106.
// - Interleague is refused outright ("Interleague games can't be corrected
//   here yet."). picker-guard.ts / saveScope are NOT loosened by this feature.
//
// CONFLICTS ARE NOTICES, NEVER GATES — the manual move's rule, reused: the
// field/team/hours/playing-day/blackout notices are manualMoveConflicts
// verbatim, plus one this feature adds: an official assigned to THIS game is
// already on another game at the new time (the shared umpire overlap check,
// findConflictInBookings — never a parallel one). Only a missing input or a
// played date the database would refuse disables Save.
//
// "TODAY" is today in the ORG's timezone and a game's date is the wall-clock
// date part of scheduled_at — src/lib/utils/org-today.ts, the one shared rule.

import {
  manualMoveConflicts,
  type ManualConflict,
  type ManualConflictInput,
  type ManualDateTime,
} from "@/lib/schedule/manual-move";
import { findConflictInBookings, type GameTimeInfo } from "@/lib/umpires/conflicts";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { isOnOrBeforeToday } from "@/lib/utils/org-today";

/** The two statuses a played game can be wrongly sitting in. */
export const RECORD_PLAYED_STATUSES = ["cancelled", "scheduled"] as const;

export const INTERLEAGUE_REFUSAL = "Interleague games can't be corrected here yet.";

export const ENTRY_LABEL = "Record where it was played";
/** The rained-out card / panel row wording. */
export const RAINED_OUT_ENTRY_LABEL = "Already played? Record where.";
export const DATE_HELP = "Today or earlier only.";
export const STILL_SAVE = "You can still save.";

export type RecordPlayedGame = {
  status: string;
  interleague_org_id: string | null;
  scheduled_at: string;
};

/**
 * Whether an entry point shows the action for this game: a rained-out or
 * scheduled game whose ORIGINAL date is today or earlier in the org's zone.
 * Interleague games DO show it — the click explains why it can't be done here,
 * rather than the action silently missing on some games.
 */
export function recordPlayedOffered(game: RecordPlayedGame, today: string): boolean {
  return (
    (RECORD_PLAYED_STATUSES as readonly string[]).includes(game.status) &&
    isOnOrBeforeToday(game.scheduled_at, today)
  );
}

const STATUS_WORD: Record<string, string> = {
  completed: "completed",
  pending_interleague: "not yet agreed with the other league",
  reschedule_pending: "waiting on a reschedule request",
};

/**
 * Why the form must not open for this game, or null. `game` is null when it
 * could not be read — refuse (fail closed). Checked again inside the function.
 */
export function recordPlayedRefusal(game: RecordPlayedGame | null): string | null {
  if (!game) {
    return "Couldn't confirm what kind of game this is, so nothing can be recorded. Close and try again.";
  }
  if (game.interleague_org_id) return INTERLEAGUE_REFUSAL;
  if (!(RECORD_PLAYED_STATUSES as readonly string[]).includes(game.status)) {
    const is = STATUS_WORD[game.status] ?? game.status;
    return `This game is ${is}, so where it was played can't be recorded here.`;
  }
  return null;
}

function fmtDay(date: string): string {
  return fmtGameDate(`${date}T12:00:00`);
}

/**
 * Why the chosen played date can't be saved, or null. The same two rules the
 * function enforces — today or earlier (org timezone), on or after the season
 * start — so the admin is told before the click instead of after.
 */
export function playedDateRefusal(
  date: string,
  today: string,
  seasonStart: string | null,
): string | null {
  if (date > today) return "That date hasn't happened yet. Enter today or an earlier date.";
  if (!seasonStart) {
    return "This season has no start date, so a played date can't be recorded. Set the season's dates first.";
  }
  if (date < seasonStart) return `That's before the season started (${fmtDay(seasonStart)}).`;
  return null;
}

/** The line under the form. A scheduled game had no rainout to clear. */
export function recordPlayedInfoLine(status: string): string {
  return status === "cancelled"
    ? "This corrects the record. Nobody gets emailed, and the rainout is cleared."
    : "This corrects the record. Nobody gets emailed.";
}

// ── Conflicts ────────────────────────────────────────────────────────────────

export type RecordPlayedConflict =
  | ManualConflict
  | { kind: "official_busy"; text: string };

/** An official assigned to THIS game, with every other game they're on
 *  (`null` when that read FAILED). */
export type AssignedOfficial = {
  name: string;
  bookings: GameTimeInfo[] | null;
};

/**
 * Officials assigned to this game who are already on another game at the new
 * time. Uses the shared umpire overlap check. The candidate's time is given
 * with an explicit +00:00 — the overlap check parses instants, and a bare
 * wall-clock string would be read in the BROWSER's zone while every stored
 * booking is wall-clock at +00.
 */
export function officialConflicts(p: {
  gameId: string;
  when: ManualDateTime;
  durationMin: number;
  officials: AssignedOfficial[];
}): RecordPlayedConflict[] {
  const out: RecordPlayedConflict[] = [];
  const candidate: GameTimeInfo = {
    id: p.gameId,
    scheduled_at: `${p.when.isoString}+00:00`,
    duration_minutes: p.durationMin,
    home_team_name: "",
    away_team_name: "",
  };
  for (const o of p.officials) {
    if (o.bookings === null) {
      out.push({ kind: "unchecked", text: `Couldn't check whether ${o.name} is free then.` });
      continue;
    }
    const hit = findConflictInBookings(candidate, o.bookings);
    if (hit) {
      out.push({
        kind: "official_busy",
        text: `${o.name} is already officiating ${hit.home_team_name} vs ${hit.away_team_name} at ${fmtGameTime(hit.scheduled_at)} that day.`,
      });
    }
  }
  return out;
}

/** Everything the correction steps on. NEVER a gate — Save ignores it. */
export function recordPlayedConflicts(
  p: ManualConflictInput & { gameId: string; officials: AssignedOfficial[] },
): RecordPlayedConflict[] {
  return [
    ...manualMoveConflicts(p),
    ...officialConflicts({ gameId: p.gameId, when: p.when, durationMin: p.durationMin, officials: p.officials }),
  ];
}

/**
 * Whether Save is enabled. Takes the conflicts ONLY to state, in code, that
 * they never block. A missing date/time or field, a date the database would
 * refuse, or a save in flight are the only reasons Save is off.
 */
export function recordPlayedSaveEnabled(p: {
  when: ManualDateTime | null;
  venueChosen: boolean;
  dateRefusal: string | null;
  saving: boolean;
  conflicts: RecordPlayedConflict[] | null;
}): boolean {
  return !!p.when && p.venueChosen && p.dateRefusal === null && !p.saving;
}

// ── The function call ────────────────────────────────────────────────────────

export const RECORD_PLAYED_RPC = "record_game_played";

/** The RPC arguments, in one place. `isoString` is the bare wall-clock the
 *  manual path builds ("2026-10-04T15:30:00"); the function stores it at +00. */
export function recordPlayedArgs(p: {
  gameId: string;
  when: ManualDateTime;
  venueId: string;
  reason: string;
}) {
  return {
    p_game_id: p.gameId,
    p_scheduled_at: p.when.isoString,
    p_venue_id: p.venueId,
    p_reason: p.reason,
  };
}

const NOTHING = "Nothing was saved.";

const REFUSALS: Record<string, string> = {
  not_authorized: `You don't have access to this league. ${NOTHING}`,
  plan_required: `Recording where a game was played is part of Pro and Elite. ${NOTHING}`,
  interleague_not_supported: INTERLEAGUE_REFUSAL,
  status_not_eligible: `This game changed since you opened this — it's no longer rained out or scheduled. ${NOTHING}`,
  played_date_in_future: `That date hasn't happened yet in your league's timezone. ${NOTHING}`,
  played_date_before_season: `That date is before the season started. ${NOTHING}`,
  season_has_no_start_date: `This season has no start date, so a played date can't be recorded. ${NOTHING}`,
  venue_not_in_org: `That field isn't one of your league's fields. ${NOTHING}`,
  invalid_scheduled_at: `The date or time isn't valid. ${NOTHING}`,
  reason_too_long: `The reason is over 500 characters. ${NOTHING}`,
  game_not_found: `This game couldn't be found — it may have been deleted. ${NOTHING}`,
  league_not_found: `This game's season couldn't be found. ${NOTHING}`,
  nothing_saved: `This game changed since you opened this. ${NOTHING}`,
  org_timezone_unknown: `Couldn't work out your league's timezone. ${NOTHING}`,
};

/**
 * The sentence for a refused or failed call. Every refusal key the function
 * raises has one; anything else is shown as-is behind "Nothing was saved." —
 * never as success.
 */
export function recordPlayedErrorMessage(raw: string): string {
  for (const [key, text] of Object.entries(REFUSALS)) {
    if (raw.includes(key)) return text;
  }
  return `${NOTHING} ${raw}`.trim();
}

/** Every refusal key the function raises — the sim pins this list against the
 *  migration file so a new key cannot ship without a sentence. */
export const RECORD_PLAYED_REFUSAL_KEYS = Object.keys(REFUSALS);

// When a season auto-archives — ONE pure decision, used by every caller of
// autoArchivePastSeasons (Overview, Seasons, Reports). No clock, no I/O: the
// caller reads the league's "today" (org timezone), every game date and every
// playoff game, and hands them here.
//
// A season archives only when ALL of these hold:
//   1. its end date has passed in the LEAGUE's timezone (end date < today —
//      the end date itself is still a season day);
//   2. no game of any kind (regular season, any status; or playoff) is dated
//      today or later;
//   3. no playoff game is unfinished — missing a result, OR not dated at all
//      (a game that hasn't been scheduled hasn't been played).
// Anything unreadable (timezone, games, brackets) → do NOT archive. Archiving
// early hides a running season; not archiving costs one more visit.
//
// Regular-season STATUS and SCORES are deliberately not consulted: leagues
// don't enter regular-season results, so requiring them would stop every
// season from ever archiving. A regular-season game only matters by its date.

import { wallClockDate } from "@/lib/utils/org-today";

export type PlayoffGameForArchive = {
  /** playoff_games.scheduled_date ("YYYY-MM-DD") or null when not scheduled. */
  scheduledDate: string | null;
  status: string | null;
  winnerId: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

export type ArchiveInput = {
  /** leagues.end_date ("YYYY-MM-DD") or null. */
  endDate: string | null;
  /** Today in the league's timezone ("YYYY-MM-DD"); null when unreadable. */
  today: string | null;
  /** scheduled_at of EVERY game in the season (any status); null when unreadable. */
  gameTimes: string[] | null;
  /** Every playoff game of every bracket in the season; null when unreadable. */
  playoffGames: PlayoffGameForArchive[] | null;
};

export type ArchiveReason =
  | "unreadable"
  | "no_end_date"
  | "end_date_not_passed"
  | "game_today_or_later"
  | "playoff_unfinished"
  | "ready";

export type ArchiveDecision = { archive: boolean; reason: ArchiveReason; detail: string };

/** Rule 1 alone — exported so the caller can skip reading games for seasons
 *  whose end date hasn't passed. The same function decideAutoArchive uses. */
export function endDatePassed(endDate: string | null, today: string): boolean {
  return endDate !== null && endDate < today;
}

/** A playoff game counts as played when it has a result: completed, a winner
 *  or a score (0107's "has a result" test). */
export function playoffGameFinished(g: PlayoffGameForArchive): boolean {
  if (!g.scheduledDate) return false;
  return g.status === "completed" || g.winnerId !== null || g.homeScore !== null || g.awayScore !== null;
}

/** A playoff game its series never needed (0114) is never played: it is not
 *  ahead, not unfinished, and its date doesn't extend the season. */
export const NOT_NEEDED = "not_needed";

export function decideAutoArchive(input: ArchiveInput): ArchiveDecision {
  const { endDate, today, gameTimes } = input;
  const playoffGames = input.playoffGames === null ? null : input.playoffGames.filter((g) => g.status !== NOT_NEEDED);
  if (today === null) return { archive: false, reason: "unreadable", detail: "the league's timezone couldn't be read" };
  if (endDate === null) return { archive: false, reason: "no_end_date", detail: "the season has no end date" };
  if (!endDatePassed(endDate, today)) {
    return { archive: false, reason: "end_date_not_passed", detail: `the end date ${endDate} hasn't passed (today is ${today})` };
  }
  if (gameTimes === null) return { archive: false, reason: "unreadable", detail: "the season's games couldn't be read" };
  if (playoffGames === null) return { archive: false, reason: "unreadable", detail: "the season's playoff games couldn't be read" };

  const ahead = gameTimes.map(wallClockDate).filter((d) => d >= today).sort();
  const playoffAhead = playoffGames
    .map((g) => g.scheduledDate)
    .filter((d): d is string => d !== null && d >= today)
    .sort();
  const next = [...ahead, ...playoffAhead].sort()[0];
  if (next) return { archive: false, reason: "game_today_or_later", detail: `a game is scheduled on ${next}` };

  const unfinished = playoffGames.filter((g) => !playoffGameFinished(g)).length;
  if (unfinished > 0) {
    return {
      archive: false,
      reason: "playoff_unfinished",
      detail: `${unfinished} playoff game${unfinished === 1 ? " has" : "s have"} no result or no date yet`,
    };
  }
  return { archive: true, reason: "ready", detail: `the end date ${endDate} has passed and every game is done` };
}

// ── The feeds' last day (0112) ──────────────────────────────────────────────
// The public schedule and team calendar feeds stop FEED_GRACE_DAYS after the
// LATER of a season's end date and its last dated game. The DATABASE decides
// this (season_last_day, migration 0112, used by the two token readers and the
// three bracket functions that count "games on the public schedule"); this is
// its TypeScript twin, for the season page's wording and the sims. One case
// table pins the two: the LASTDAY-TABLE block in scripts/sim/feed-cutoff-sim.sql.

export const FEED_GRACE_DAYS = 7;

/**
 * The later of the end date and the last dated game — every regular-season
 * game (any status, by the wall-clock date of scheduled_at) and every DATED
 * playoff game. No end date → null: never cut off.
 */
export function seasonLastDay(
  endDate: string | null,
  gameTimes: string[],
  playoffDates: (string | null)[],
): string | null {
  if (endDate === null) return null;
  let last = endDate;
  for (const t of gameTimes) {
    const d = wallClockDate(t);
    if (d > last) last = d;
  }
  for (const d of playoffDates) if (d !== null && d > last) last = d;
  return last;
}

/** The playoff dates that count toward seasonLastDay: every dated game but a
 *  not-needed one (0114; the SQL helper's `status <> 'not_needed'`). */
export function countedPlayoffDates(games: { date: string | null; status: string | null }[]): (string | null)[] {
  return games.filter((g) => g.status !== NOT_NEEDED).map((g) => g.date);
}

/** "YYYY-MM-DD" plus n days, by calendar arithmetic (UTC fields, no clock). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whether the feeds still serve the season on `today` (league timezone). */
export function feedsServeOn(lastDay: string | null, today: string): boolean {
  return lastDay === null || today <= addDays(lastDay, FEED_GRACE_DAYS);
}

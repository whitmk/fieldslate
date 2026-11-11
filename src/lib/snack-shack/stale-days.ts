// Snack shack days that need rebuilding — the pure rules and every sentence
// the dashboard banner, the snack shack page notice and the one-day rebuild
// preview show (0131; plan: docs/plans/game-change-followthrough.md, Part B;
// mockup docs/mockups/snack-shack-stale-days.html, reviewed 2026-11-11).
// Surfaces render these VERBATIM. Nothing here reads the database or touches
// sign-up data — the dashboard banner imports this file, and sim:game-notes
// fences it. The preview's named lines live in preview-names.ts.
//
// A MARK (snack_shack_stale_days) only says "a game changed on this day". The
// days shown are the ones the REAL shift calculation flags (upcomingStaleness
// over loadShiftInputs). Marks the calculation doesn't flag are cleared.

import { fmtClock, fmtShiftRange } from "./shift-flags";
import { normalizeTime, type StoredShiftRow } from "./derive-shifts";
import type { RegeneratePlan } from "./regenerate-plan";

/** "Sat, Oct 17" for a "YYYY-MM-DD" date, the same in every host zone. */
export function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
  });
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ─── Which days to show ─────────────────────────────────────────────────────

/** The days the banner shows: the calculation's differing dates, limited to
 *  the marked ones — unless a mark failed since shifts were last made, when
 *  every differing date shows (the marks can't be trusted). */
export function bannerDays(marks: string[], failedSince: boolean, differing: string[]): string[] {
  if (failedSince) return [...differing].sort();
  const m = new Set(marks);
  return differing.filter((d) => m.has(d)).sort();
}

/** Marks the calculation doesn't flag — the app clears them. */
export function marksToClear(marks: string[], differing: string[]): string[] {
  const d = new Set(differing);
  return marks.filter((m) => !d.has(m)).sort();
}

/** The dashboard needs the full calculation only when there's a mark or a
 *  failed mark. */
export function needsCheck(marks: string[], failedSince: boolean): boolean {
  return failedSince || marks.length > 0;
}

/** snack_shack_stale_state's reply, or null when it isn't the expected shape
 *  (the banner then says "couldn't check", never silence). */
export type StaleState = { snackShackId: string | null; dates: string[]; failedSince: boolean };
export function parseStaleState(raw: unknown): StaleState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = r.snack_shack_id;
  if (id !== null && typeof id !== "string") return null;
  if (!Array.isArray(r.dates) || !r.dates.every((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))) return null;
  if (typeof r.failed_since !== "boolean") return null;
  return { snackShackId: id as string | null, dates: r.dates as string[], failedSince: r.failed_since };
}

// ─── Words: banner and page notice ──────────────────────────────────────────

export const BANNER_MAX_DAYS = 3;
export const NEEDS_REBUILD = "shifts need rebuilding";

export function dayNeedsRebuildLine(date: string): string {
  return `${fmtDay(date)} — ${NEEDS_REBUILD}`;
}

export function bannerHeadline(n: number): string {
  return n === 1
    ? "Snack shack: games changed on 1 day, and that day's shifts no longer match."
    : `Snack shack: games changed on ${n} days, and those days' shifts no longer match.`;
}

export function bannerMoreLine(more: number): string {
  return `and ${more} more day${more === 1 ? "" : "s"} — open the snack shack page`;
}

export const BANNER_COULDNT_CHECK = "Snack shack: couldn't check whether game changes affect its shifts.";

export function pageNoticeHeadline(n: number): string {
  return n === 1
    ? "The game schedule changed on 1 day since shifts were made."
    : `The game schedule changed on ${n} days since shifts were made.`;
}

/** The page notice's red line for a stored shift whose team now plays during
 *  it: "Sat, Oct 17 12:30pm — Cubs now plays during their shift". */
export function playsDuringLine(date: string, start: string, team: string): string {
  return `${fmtDay(date)} ${fmtClock(start)} — ${team} now plays during their shift`;
}

// ─── The rebuild preview: the resulting day ─────────────────────────────────

export type ResultShiftLine = { start: string; end: string; text: string; needsTeam: boolean };
export type DayResult = { date: string; shifts: ResultShiftLine[]; noLonger: string[] };

/** For every date the plan changes, the day as it will be after Confirm: each
 *  derived shift with its team and, where the team's shift that day moved,
 *  what it was; then every team that had a shift that day and won't. Manual
 *  shifts are untouched by a rebuild, so they're not listed — but a team
 *  holding one still has a shift that day. */
export function dayResults(
  plan: RegeneratePlan,
  stored: StoredShiftRow[],
  teamName: (id: string) => string,
): DayResult[] {
  const out: DayResult[] = [];
  for (const d of plan.dayChanges) {
    const date = d.date;
    const before = stored.filter((r) => r.date === date && r.is_recurring);
    const manualTeams = new Set(stored.filter((r) => r.date === date && !r.is_recurring && r.assigned_team_id).map((r) => r.assigned_team_id as string));
    const after = plan.desired
      .filter((s) => s.date === date)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const shifts: ResultShiftLine[] = after.map((s) => {
      const range = fmtShiftRange(s.start, s.end);
      if (!s.assigned_team_id) return { start: s.start, end: s.end, text: `${range}: Needs a team`, needsTeam: true };
      const team = teamName(s.assigned_team_id);
      const had = before.filter((r) => r.assigned_team_id === s.assigned_team_id);
      const same = had.some((r) => normalizeTime(r.start_time) === s.start && normalizeTime(r.end_time) === s.end);
      let suffix = "";
      if (!same && had.length > 0) suffix = ` (was ${had.map((r) => fmtShiftRange(r.start_time, r.end_time)).join(", ")})`;
      else if (!same && !manualTeams.has(s.assigned_team_id)) suffix = " (new this day)";
      return { start: s.start, end: s.end, text: `${range}: ${team}${suffix}`, needsTeam: false };
    });
    const afterTeams = new Set(after.map((s) => s.assigned_team_id).filter((t): t is string => !!t));
    const noLonger = [...new Set(before.map((r) => r.assigned_team_id).filter((t): t is string => !!t))]
      .filter((t) => !afterTeams.has(t) && !manualTeams.has(t))
      .map((t) => `${teamName(t)} no longer has a shift this day.`)
      .sort();
    out.push({ date, shifts, noLonger });
  }
  return out;
}

/** Did any TEAM assignment change? (A changed shift that kept its team is not
 *  a change.) Drives the "send updated emails?" prompt after Confirm. */
export function teamAssignmentsChanged(plan: RegeneratePlan): boolean {
  return plan.assignmentChanges.some((c) =>
    c.kind === "removed" ? true : c.kind === "added" ? c.toTeamId !== null : c.fromTeamId !== c.toTeamId);
}

export const EMAIL_PROMPT = "Team assignments changed. Send the updated schedule?";
export const EMAIL_PROMPT_DETAIL = "This sends the full season's snack shack schedule to one email address you choose.";

/** Title and subtitle for the preview: one day, or the whole season. */
export function previewTitle(onlyDates: string[] | null): { title: string; subtitle: string; confirm: string } {
  if (onlyDates && onlyDates.length === 1) {
    return {
      title: `Rebuild ${fmtDay(onlyDates[0])} from the game schedule`,
      subtitle: "Only this day changes. Every other day stays as it is. Nothing is written until you confirm.",
      confirm: "Confirm and rebuild this day",
    };
  }
  return {
    title: "Regenerate shifts from the game schedule",
    subtitle: "Nothing is written until you confirm.",
    confirm: "Confirm and regenerate",
  };
}

/** The "Plays during" red lines for the page notice, from the page's flag
 *  map: upcoming stored shifts whose team now plays during them. */
export function playsDuringLines(
  blocks: { id: string; date: string; start_time: string; assigned_team_id: string | null }[],
  isPlaysDuring: (blockId: string) => boolean,
  teamName: (id: string) => string,
): string[] {
  return blocks
    .filter((b) => b.assigned_team_id && isPlaysDuring(b.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))
    .map((b) => playsDuringLine(b.date, normalizeTime(b.start_time), teamName(b.assigned_team_id as string)));
}

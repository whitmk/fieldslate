// Shared pure helpers for team_game_constraints (migration 0076) — the
// team-level recurring (day-of-week, time-window) game rules. Same
// shared-pure-function mold as the officials' bookingsFromRows /
// findConflictInBookings (src/lib/umpires/conflicts.ts): every surface that
// checks a candidate game time against a team's constraints must go through
// these functions so the implementations can't drift.
//
// CLIENT-TIMEZONE-ONLY, same stance as src/lib/umpires/eligibility.ts: the
// day-of-week is derived from the naive local wall-clock timestamp
// ("YYYY-MM-DDTHH:MM:SS", no zone) exactly the way the schedule engine and
// UI read it. In the browser that is the commissioner's local zone — correct.
// On a server (Vercel), "local" is UTC and a game's day-of-week can shift
// across the boundary, silently moving a Saturday-morning game into a Friday
// rule or vice versa. Any server-side or DB-side reuse must add an explicit
// timezone parameter FIRST. Do not import this into an API route as-is.

import { DAY_KEYS, dayKeyFromIsoDate, type DayKey } from "@/lib/venues/availability";

export type TeamConstraintSeverity = "block" | "prefer";

/** Raw team_game_constraints row shape (the columns the checks need). */
export type TeamGameConstraintRow = {
  team_id: string;
  day_of_week: string;
  start_time: string | null; // Postgres `time` — "HH:MM:SS" (or "HH:MM")
  end_time: string | null;
  severity: string;
};

export type TeamConstraintRule = {
  teamId: string;
  dayOfWeek: DayKey;
  /** "HH:MM"; null together with endTime = the whole day. */
  startTime: string | null;
  endTime: string | null;
  severity: TeamConstraintSeverity;
};

const DAY_SET: ReadonlySet<string> = new Set(DAY_KEYS);

/** Postgres `time` values come back as "HH:MM:SS"; the engine's wall times
 *  are "HH:MM". Normalize to "HH:MM" so comparisons are same-length string
 *  compares — mixing the two lengths makes exact-boundary times compare
 *  wrong lexicographically ("17:00" < "17:00:00"). */
function toHHMM(t: string): string {
  return t.slice(0, 5);
}

/**
 * Group raw rows into per-team rule lists, 'block' rules ordered before
 * 'prefer' so findConstraintViolation surfaces the hard rule when both
 * cover the same time. Rows the DB CHECKs should make impossible (unknown
 * severity/day, half-set window) are dropped rather than guessed at.
 */
export function constraintsFromRows(
  rows: TeamGameConstraintRow[],
): Map<string, TeamConstraintRule[]> {
  const out = new Map<string, TeamConstraintRule[]>();
  for (const r of rows) {
    if (r.severity !== "block" && r.severity !== "prefer") continue;
    if (!DAY_SET.has(r.day_of_week)) continue;
    if ((r.start_time === null) !== (r.end_time === null)) continue;
    const windowed = r.start_time !== null && r.end_time !== null;
    const rule: TeamConstraintRule = {
      teamId: r.team_id,
      dayOfWeek: r.day_of_week as DayKey,
      startTime: windowed ? toHHMM(r.start_time!) : null,
      endTime: windowed ? toHHMM(r.end_time!) : null,
      severity: r.severity,
    };
    const list = out.get(r.team_id);
    if (list) list.push(rule);
    else out.set(r.team_id, [rule]);
  }
  for (const list of out.values()) {
    list.sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "block" ? -1 : 1,
    );
  }
  return out;
}

/** Window semantics: half-open [start, end) on the game's START wall time,
 *  matching the practices sibling's isBlocked convention. A whole-day rule
 *  (both times null) covers every time on that day. */
function ruleMatches(
  rule: TeamConstraintRule,
  dayKey: DayKey,
  wallTime: string,
): boolean {
  if (rule.dayOfWeek !== dayKey) return false;
  if (rule.startTime === null || rule.endTime === null) return true;
  return wallTime >= rule.startTime && wallTime < rule.endTime;
}

/**
 * First rule of this team covering the candidate start time, or null.
 * 'block' rules win over 'prefer' when both match (see constraintsFromRows).
 * `isoString` is the engine's naive local timestamp "YYYY-MM-DDTHH:MM:SS".
 */
export function findConstraintViolation(
  rules: Map<string, TeamConstraintRule[]>,
  teamId: string,
  isoString: string,
): TeamConstraintRule | null {
  const list = rules.get(teamId);
  if (!list || list.length === 0) return null;
  const dayKey = dayKeyFromIsoDate(isoString);
  const wallTime = isoString.substring(11, 16);
  for (const rule of list) {
    if (ruleMatches(rule, dayKey, wallTime)) return rule;
  }
  return null;
}

/** True when a severity-'block' rule covers the candidate start time —
 *  the generator's hard filter. 'prefer' rows never block. */
export function violatesHardConstraint(
  rules: Map<string, TeamConstraintRule[]>,
  teamId: string,
  isoString: string,
): boolean {
  return findConstraintViolation(rules, teamId, isoString)?.severity === "block";
}

/** True when a severity-'prefer' rule covers the candidate start time (and
 *  no 'block' rule does — block wins when both match, see constraintsFromRows).
 *  Prefer = prefer to AVOID the window (decided 2026-07-21). This is the
 *  generator's pass-1 soft filter; it must NEVER be used as a hard reject. */
export function prefersToAvoid(
  rules: Map<string, TeamConstraintRule[]>,
  teamId: string,
  isoString: string,
): boolean {
  return findConstraintViolation(rules, teamId, isoString)?.severity === "prefer";
}

// ── Display formatting (shared so every surface words rules identically) ────

const DAY_FULL: Record<DayKey, string> = {
  Mo: "Monday",
  Tu: "Tuesday",
  We: "Wednesday",
  Th: "Thursday",
  Fr: "Friday",
  Sa: "Saturday",
  Su: "Sunday",
};

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "Saturdays all day" / "Saturdays 9:00 AM – 12:00 PM". Windows describe
 *  game START times (half-open [start, end)) — keep any surrounding copy
 *  saying "start" so admins don't read them as whole-game spans. */
export function formatConstraintRule(rule: TeamConstraintRule): string {
  const day = `${DAY_FULL[rule.dayOfWeek]}s`;
  if (rule.startTime === null || rule.endTime === null) return `${day} all day`;
  return `${day} ${fmt12(rule.startTime)} – ${fmt12(rule.endTime)}`;
}

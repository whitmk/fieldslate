// Volunteer game-role slots: which games have them, how many, and whether a
// volunteer may take, change or cancel one (0121). PURE — no clock, no React,
// no database. The database decides every claim; this file is its TypeScript
// twin for the screens, pinned to it by ONE case table (the
// VSLOT-TABLE-BEGIN / -END block in scripts/sim/volunteer-claims-sim.sql —
// sim:volunteer-slots parses it; the 0121 proof runs it through the SQL).
//
// THE RULES
//   * A slot is role × game × (team) × position. Nothing stores slots; the
//     claim row names them, and a unique index keeps one person per spot.
//   * "per_game" roles: one set of spots per game, HOME games only — an
//     interleague game the partner hosts (is_away) has none. The slot's
//     division is the home team's.
//   * "per_team" roles: one set of spots per OUR team in the game — two of
//     our teams = two sets; interleague = our team only (games stores our
//     team as home_team_id). The slot's division is that team's.
//   * A role applies only to the divisions the admin picked.
//   * No slots on pending_interleague games, playoff games (v1), or a game
//     with no date or no home team.
//   * scheduled → open; reschedule_pending → open, "May move"; cancelled
//     (rained out) → claims stay, new claims refused; any other status →
//     claims stay, new claims refused.
//   * A new claim closes at the game's start (wall clock, league's zone).
//   * The sign-up page lists LOCKED divisions only (decided 2026-11-08), and
//     a role with sign-ups off takes no new claims.
//   * A volunteer may change or cancel until 24 hours before the start,
//     measured on the wall clock (the database does the same with timestamp
//     arithmetic — a clock change inside the window is not adjusted for).
//   * A role may START up to 120 minutes before the game (lead minutes,
//     default 0; decided 2026-11-08 — field prep at 8:15 for a 9:00 game).
//     The spot ends at game end. Its start — game start minus the lead — is
//     what the claim cutoff, the 24-hour window and the overlap check use.
//   * Overlap = same date, half-open spans (spansOverlap). A game spot runs
//     from its shifted start to game end (start + its own division's
//     game_duration, durationFromSettings).
import { durationFromSettings, spansOverlap } from "@/lib/schedule/reschedule-slots";

export type RoleKind = "per_game" | "per_team";

export type VolunteerRole = {
  id: string;
  kind: RoleKind;
  /** Spots per game (per_game) or per team (per_team), 1–10. */
  spots: number;
  signupsOpen: boolean;
  divisionIds: readonly string[];
  /** Minutes the spot starts before the game, 0–120 (default 0). */
  leadMinutes?: number;
};

export type SlotGame = {
  id: string;
  /** Stored wall clock, "YYYY-MM-DDTHH:MM…" (never parsed as an instant). */
  scheduledAt: string | null;
  status: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  interleagueOrgId: string | null;
  isAway: boolean;
};

export type SlotTarget = {
  roleId: string;
  /** The team the spots are for (per_team), or null (per_game). */
  forTeamId: string | null;
  /** The division the slot belongs to — its lock and role scope. */
  divisionId: string;
  spots: number;
};

export type GameSlotState = "open" | "may_move" | "rained_out" | "closed" | "none";

export type ClaimRefusal =
  | "no_slot"
  | "rained_out"
  | "closed"
  | "past"
  | "unpublished"
  | "signups_closed";

export const MAX_SPOTS = 10;
export const CHANGE_WINDOW_MIN = 24 * 60;
export const MAX_LEAD_MIN = 120;

/** A role's lead, clamped to 0–120 whole minutes. */
export function leadOf(role: Pick<VolunteerRole, "leadMinutes"> | null | undefined): number {
  const n = Math.trunc(Number(role?.leadMinutes ?? 0));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_LEAD_MIN) : 0;
}

/** The spot's start as a wall clock "YYYY-MM-DDTHH:MM": the game's start
 *  minus the lead (wall-clock arithmetic, so it may fall on the day before).
 *  Null when the game time is unreadable. */
export function spotStartWall(scheduledAt: string, leadMinutes: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(scheduledAt);
  if (!m) return null;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - Math.min(Math.max(Math.trunc(leadMinutes), 0), MAX_LEAD_MIN) * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/** What a game's status means for its slots. */
export function gameSlotState(status: string): GameSlotState {
  if (status === "scheduled") return "open";
  if (status === "reschedule_pending") return "may_move";
  if (status === "cancelled") return "rained_out";
  if (status === "pending_interleague") return "none";
  return "closed";
}

/** Every spot set a game carries for these roles. `teamDivision` maps a
 *  team id to its division id (teams with no division carry no slots). */
export function slotTargets(
  game: SlotGame,
  roles: readonly VolunteerRole[],
  teamDivision: ReadonlyMap<string, string>,
): SlotTarget[] {
  if (!game.scheduledAt || !game.homeTeamId) return [];
  if (gameSlotState(game.status) === "none") return [];
  const out: SlotTarget[] = [];
  for (const role of roles) {
    const spots = Math.min(Math.max(Math.trunc(role.spots), 0), MAX_SPOTS);
    if (spots === 0) continue;
    if (role.kind === "per_game") {
      if (game.interleagueOrgId && game.isAway) continue;
      const div = teamDivision.get(game.homeTeamId);
      if (div && role.divisionIds.includes(div)) {
        out.push({ roleId: role.id, forTeamId: null, divisionId: div, spots });
      }
      continue;
    }
    const ours = game.interleagueOrgId ? [game.homeTeamId] : [game.homeTeamId, game.awayTeamId];
    for (const teamId of ours) {
      if (!teamId) continue;
      const div = teamDivision.get(teamId);
      if (div && role.divisionIds.includes(div)) {
        out.push({ roleId: role.id, forTeamId: teamId, divisionId: div, spots });
      }
    }
  }
  return out;
}

/** Minutes from midnight of a stored wall clock, or null when unreadable. */
export function wallMinutes(at: string): number | null {
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(at);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes from wall clock `a` to wall clock `b` ("YYYY-MM-DDTHH:MM…"),
 *  wall-clock arithmetic only. Null when either is unreadable. */
export function wallMinutesBetween(a: string, b: string): number | null {
  const toMin = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
  };
  const x = toMin(a);
  const y = toMin(b);
  return x === null || y === null ? null : y - x;
}

/** The current wall clock in an IANA zone, "YYYY-MM-DDTHH:MM". Throws on an
 *  unknown zone. Call it AFTER mount in a client component, never in render. */
export function wallClockNow(timeZone: string, now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const [y, mo, d, h, mi] = [get("year"), get("month"), get("day"), get("hour"), get("minute")];
  if (!y || !mo || !d || !h || !mi) throw new Error(`wallClockNow: could not format a time in ${timeZone}`);
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

/** Why a NEW claim on this target is refused, or null when it may be taken.
 *  Checked in this order; the database's claim function uses the same order. */
export function claimRefusal(args: {
  game: SlotGame;
  target: SlotTarget | null;
  role: VolunteerRole | null;
  lockedDivisionIds: ReadonlySet<string>;
  /** The league's wall clock now ("YYYY-MM-DDTHH:MM"). */
  nowWall: string;
}): ClaimRefusal | null {
  const { game, target, role, lockedDivisionIds, nowWall } = args;
  if (!target || !role || !game.scheduledAt) return "no_slot";
  const state = gameSlotState(game.status);
  if (state === "none") return "no_slot";
  if (state === "rained_out") return "rained_out";
  if (state === "closed") return "closed";
  const start = spotStartWall(game.scheduledAt, leadOf(role));
  const untilStart = start === null ? null : wallMinutesBetween(nowWall, start);
  if (untilStart === null || untilStart <= 0) return "past";
  if (!lockedDivisionIds.has(target.divisionId)) return "unpublished";
  if (!role.signupsOpen) return "signups_closed";
  return null;
}

/** Whether a volunteer may still change or cancel a spot starting at
 *  `startWall`: strictly more than 24 hours away. */
export function canChangeSpot(startWall: string, nowWall: string): boolean {
  const m = wallMinutesBetween(nowWall, startWall);
  return m !== null && m > CHANGE_WINDOW_MIN;
}

/** A spot's span on its date. A game spot runs from its shifted start
 *  (game start − lead) to game end (start + its division's game_duration);
 *  a snack shack shift runs start → end. */
export type SpotSpan = { date: string; startMin: number; durationMin: number };

export function gameSpan(scheduledAt: string, divisionSettings: unknown, leadMinutes = 0): SpotSpan | null {
  const start = spotStartWall(scheduledAt, leadMinutes);
  const game = wallMinutes(scheduledAt);
  if (start === null || game === null) return null;
  const lead = wallMinutesBetween(start, scheduledAt) ?? 0;
  return { date: start.substring(0, 10), startMin: wallMinutes(start)!, durationMin: lead + durationFromSettings(divisionSettings) };
}

export function shiftSpan(date: string, start: string, end: string): SpotSpan | null {
  const s = /^(\d{2}):(\d{2})/.exec(start);
  const e = /^(\d{2}):(\d{2})/.exec(end);
  if (!s || !e || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const a = +s[1] * 60 + +s[2];
  const b = +e[1] * 60 + +e[2];
  return b > a ? { date, startMin: a, durationMin: b - a } : null;
}

/** Whether a new spot overlaps any spot the same email already holds. The
 *  warning that follows names no spot (decided 2026-11-08). */
export function overlapsHeld(next: SpotSpan, held: readonly SpotSpan[]): boolean {
  return held.some((h) => h.date === next.date && spansOverlap(h, next));
}

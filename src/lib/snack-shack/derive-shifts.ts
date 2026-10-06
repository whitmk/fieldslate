// Snack shack shifts DERIVED from the game schedule — the pure library.
//
// Everything here is a decision with no I/O: which games count, how a day's
// games become open windows, how a window divides into shifts, where a short
// leftover goes, which stored assignments survive a regenerate, and whether
// the stored shifts still match the schedule. The I/O wrapper (generate) and
// the page only call these; a rule added anywhere else is a rule the harness
// (`npm run sim:snack-shifts`) cannot see.
//
// THE RULES (decided 2026-10-05, see CLAUDE.md "Snack shack — derived shifts"):
//   - A game counts iff it is at one of the shack's attached venues
//     (home_venue_ids) AND `countsAsScheduledGame` (not cancelled, not a
//     pending interleague proposal). Away interleague games have no venue of
//     ours and never count.
//   - A day opens only if its weekday is in `daysOpen`. A counting game on a
//     closed weekday produces NO shifts and is reported in `closedDays`.
//   - A day's window opens `openBeforeMin` before the first game and closes
//     `closeAfterMin` after the last game ENDS (start + its own division's
//     duration, resolved with the playoff generator's policy — see
//     `resolveGameDurations`).
//   - GAPS: a break of GAP_SPLIT_MIN (60) or more between one game's end and
//     the next game's start splits the day into separate windows — UNLESS the
//     close/open offsets would make the two windows overlap or touch, in which
//     case the day stays one window (the shack never actually closes).
//   - A window divides into the FEWEST shifts of `maxShiftMin` or less; the
//     leftover is the LAST shift. When the leftover is UNDER
//     ABSORB_OFFER_UNDER_MIN (60) and there are at least two shifts, it is
//     absorbed per the day's stored choice — add to the first shift, add to
//     the last (previous) shift, or split evenly to the minute with the odd
//     minutes on the EARLIER shifts — defaulting to "last" when nothing is
//     stored. Exactly 60 minutes or more: no offer, the short shift stands.
//   - The absorb choice is keyed by DATE + WINDOW START ("HH:MM"), never by
//     array index. A stored choice whose window no longer exists, or no
//     longer has a short leftover, is reported in `staleChoices` and the
//     default applies.
//   - WALL-CLOCK ONLY. Dates and times are read from the stored ISO string by
//     substring (`YYYY-MM-DD` / `HH:MM`); nothing here parses an instant. The
//     weekday comes from `dayKeyFromIsoDate` (local midnight of the date
//     string, the house convention). A window clamped at midnight is
//     reported — `time` columns cannot carry a close past 24:00.
//
// Blackout dates are deliberately NOT consulted: the games are the truth, and
// a game hand-placed on a blackout date still brings a crowd.

import { countsAsScheduledGame } from "@/lib/venues/game-days";
import { dayKeyFromIsoDate, type DayKey } from "@/lib/venues/availability";
import { planSettingsFromDivision } from "@/lib/playoffs/bracket-plan";

export const GAP_SPLIT_MIN = 60;
export const ABSORB_OFFER_UNDER_MIN = 60;
export const OFFSET_OPTIONS_MIN = [0, 15, 30, 45, 60] as const;
export const MAX_SHIFT_OPTIONS_MIN = [90, 120, 150, 180, 210, 240] as const;

export type AbsorbChoice = "first" | "last" | "split";
export const ABSORB_CHOICES: AbsorbChoice[] = ["first", "last", "split"];
export const DEFAULT_ABSORB: AbsorbChoice = "last";

export type ShiftRule = {
  openBeforeMin: number;
  closeAfterMin: number;
  maxShiftMin: number;
  /** Weekdays the shack may open. A counting game on any other day → closedDays. */
  daysOpen: DayKey[];
  /** The shack's attached venues; only games here count. */
  homeVenueIds: string[];
};

/** A game row after its duration has been resolved (see resolveGameDurations). */
export type DerivationGame = {
  id: string;
  scheduled_at: string; // ISO wall-clock, e.g. "2026-08-15T10:00:00+00:00"
  status: string;
  venue_id: string | null;
  venue_name?: string | null;
  durationMin: number;
  durationDefaulted: boolean;
};

/** The raw row shape the wrapper reads: the division duration arrives as the
 *  projected jsonb key `game_duration:settings->game_duration`, so it is
 *  `unknown` (number, string, null or absent). */
export type RawGameRow = {
  id: string;
  scheduled_at: string;
  status: string;
  venue_id: string | null;
  venue_name?: string | null;
  game_duration: unknown;
};

/** Resolve each game's duration with the playoff generator's policy
 *  (`planSettingsFromDivision`: finite-and-positive, else 90 and FLAGGED).
 *  The flag is what lets a surface say "assumed 90 minutes" instead of
 *  silently closing the shack mid-game. */
export function resolveGameDurations(rows: RawGameRow[]): DerivationGame[] {
  return rows.map((r) => {
    const s = planSettingsFromDivision({ game_duration: r.game_duration });
    return {
      id: r.id,
      scheduled_at: r.scheduled_at,
      status: r.status,
      venue_id: r.venue_id,
      venue_name: r.venue_name ?? null,
      durationMin: s.durationMin,
      durationDefaulted: s.durationDefaulted,
    };
  });
}

// ─── Wall-clock helpers ───────────────────────────────────────────────────────

export function dateOf(iso: string): string {
  return iso.substring(0, 10);
}
/** "HH:MM" of the stored wall-clock, by substring — never an instant parse. */
export function hhmmOf(iso: string): string {
  return iso.substring(11, 16);
}
export function hhmmToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
/** Postgres `time` arrives as "09:30:00"; compare and store as "HH:MM". */
export function normalizeTime(t: string): string {
  return t.substring(0, 5);
}

// ─── Which games count, grouped by date ──────────────────────────────────────

export type GameSpan = { gameId: string; startMin: number; endMin: number; venueName: string | null };

/** date → the counting games' spans. Only attached-venue games that
 *  `countsAsScheduledGame`. Also returns the ids whose duration was assumed. */
export function countingSpansByDate(
  games: DerivationGame[],
  rule: Pick<ShiftRule, "homeVenueIds">,
): { byDate: Map<string, GameSpan[]>; assumedDurationGameIds: string[] } {
  const home = new Set(rule.homeVenueIds);
  const byDate = new Map<string, GameSpan[]>();
  const assumed: string[] = [];
  for (const g of games) {
    if (!countsAsScheduledGame(g.status)) continue;
    if (!g.venue_id || !home.has(g.venue_id)) continue;
    if (g.durationDefaulted) assumed.push(g.id);
    const date = dateOf(g.scheduled_at);
    const startMin = hhmmToMin(hhmmOf(g.scheduled_at));
    const span: GameSpan = { gameId: g.id, startMin, endMin: startMin + g.durationMin, venueName: g.venue_name ?? null };
    const list = byDate.get(date);
    if (list) list.push(span);
    else byDate.set(date, [span]);
  }
  return { byDate, assumedDurationGameIds: assumed };
}

// ─── Windows ─────────────────────────────────────────────────────────────────

export type OpenWindow = { startMin: number; endMin: number; gameIds: string[]; clamped: boolean };

/** A day's games → its open windows, in start order. See the header for the
 *  gap and overlap rules. */
export function windowsFromSpans(
  spans: GameSpan[],
  rule: Pick<ShiftRule, "openBeforeMin" | "closeAfterMin">,
): OpenWindow[] {
  const sorted = [...spans].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.gameId.localeCompare(b.gameId),
  );
  type Cluster = { start: number; maxEnd: number; gameIds: string[] };
  const clusters: Cluster[] = [];
  for (const s of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur) {
      const gap = s.startMin - cur.maxEnd;
      const closeAt = cur.maxEnd + rule.closeAfterMin;
      const openAt = s.startMin - rule.openBeforeMin;
      // Split only on a real break, and only if the offsets leave the shack
      // actually closed in between (closing strictly before reopening).
      if (gap >= GAP_SPLIT_MIN && closeAt < openAt) {
        clusters.push({ start: s.startMin, maxEnd: s.endMin, gameIds: [s.gameId] });
        continue;
      }
      cur.maxEnd = Math.max(cur.maxEnd, s.endMin);
      cur.gameIds.push(s.gameId);
      continue;
    }
    clusters.push({ start: s.startMin, maxEnd: s.endMin, gameIds: [s.gameId] });
  }
  return clusters.map((c) => {
    const rawStart = c.start - rule.openBeforeMin;
    const rawEnd = c.maxEnd + rule.closeAfterMin;
    const startMin = Math.max(0, rawStart);
    const endMin = Math.min(24 * 60, rawEnd);
    return { startMin, endMin, gameIds: c.gameIds, clamped: rawStart !== startMin || rawEnd !== endMin };
  });
}

// ─── Division into shifts + leftover absorb ─────────────────────────────────

export type Division = {
  lengths: number[];
  /** The last shift's length BEFORE any absorb; equals maxShiftMin when the
   *  window divides evenly, and the whole window when there is one shift. */
  leftoverMin: number;
  /** True when the leftover was under the threshold with 2+ shifts. */
  offered: boolean;
  /** The choice that was applied (stored or default); null when not offered. */
  applied: AbsorbChoice | null;
  /** True when offered and no stored choice existed. */
  defaulted: boolean;
};

export function divideWindow(totalMin: number, maxShiftMin: number, stored: AbsorbChoice | null): Division {
  const n = Math.max(1, Math.ceil(totalMin / maxShiftMin));
  const lengths: number[] = [];
  for (let i = 0; i < n - 1; i++) lengths.push(maxShiftMin);
  const leftoverMin = totalMin - (n - 1) * maxShiftMin;
  lengths.push(leftoverMin);
  const offered = n >= 2 && leftoverMin < ABSORB_OFFER_UNDER_MIN;
  if (!offered) return { lengths, leftoverMin, offered, applied: null, defaulted: false };
  const applied: AbsorbChoice = stored ?? DEFAULT_ABSORB;
  const runt = lengths.pop()!;
  if (applied === "first") {
    lengths[0] += runt;
  } else if (applied === "last") {
    lengths[lengths.length - 1] += runt;
  } else {
    // Split to the minute; the odd minutes go to the EARLIER shifts so the
    // total still lands exactly on closing time.
    const k = lengths.length;
    const base = Math.floor(runt / k);
    const extra = runt % k;
    for (let i = 0; i < k; i++) lengths[i] += base + (i < extra ? 1 : 0);
  }
  return { lengths, leftoverMin, offered, applied, defaulted: stored === null };
}

// ─── The full derivation ─────────────────────────────────────────────────────

export type DerivedShift = {
  start: string; // "HH:MM"
  end: string;
  startMin: number;
  endMin: number;
  lengthMin: number;
  /** This shift absorbed the leftover (or part of it). */
  extended: boolean;
};

export type DerivedWindow = {
  /** "HH:MM" window start — with the date, the durable absorb-choice key. */
  windowStart: string;
  startMin: number;
  endMin: number;
  gameIds: string[];
  shifts: DerivedShift[];
  leftoverMin: number;
  absorbOffered: boolean;
  absorbApplied: AbsorbChoice | null;
  absorbDefaulted: boolean;
  clamped: boolean;
};

export type DerivedDay = { date: string; day: DayKey; gameCount: number; windows: DerivedWindow[] };

export type ClosedDayGames = { date: string; day: DayKey; gameCount: number; venueNames: string[] };

export type StoredAbsorbChoice = { date: string; windowStart: string; choice: AbsorbChoice };

export type DerivationResult = {
  days: DerivedDay[];
  /** Counting games on weekdays the shack does not open. */
  closedDays: ClosedDayGames[];
  /** Stored choices that no longer apply (window gone, or no short leftover). */
  staleChoices: StoredAbsorbChoice[];
  assumedDurationGameIds: string[];
  /** Dates where a window was clamped at midnight. */
  clampedDates: string[];
};

export function absorbKey(date: string, windowStart: string): string {
  return `${date}|${windowStart}`;
}

export function deriveShifts(
  games: DerivationGame[],
  rule: ShiftRule,
  storedChoices: StoredAbsorbChoice[],
): DerivationResult {
  const { byDate, assumedDurationGameIds } = countingSpansByDate(games, rule);
  const daysOpen = new Set<DayKey>(rule.daysOpen);
  const choices = new Map<string, StoredAbsorbChoice>();
  for (const c of storedChoices) choices.set(absorbKey(c.date, c.windowStart), c);
  const usedChoiceKeys = new Set<string>();

  const days: DerivedDay[] = [];
  const closedDays: ClosedDayGames[] = [];
  const clampedDates: string[] = [];

  for (const date of [...byDate.keys()].sort()) {
    const spans = byDate.get(date)!;
    const day = dayKeyFromIsoDate(date);
    if (!daysOpen.has(day)) {
      const names = [...new Set(spans.map((s) => s.venueName).filter((n): n is string => !!n))].sort();
      closedDays.push({ date, day, gameCount: spans.length, venueNames: names });
      continue;
    }
    const windows: DerivedWindow[] = [];
    for (const w of windowsFromSpans(spans, rule)) {
      const windowStart = minToHHMM(w.startMin);
      const key = absorbKey(date, windowStart);
      const stored = choices.get(key) ?? null;
      const div = divideWindow(w.endMin - w.startMin, rule.maxShiftMin, stored?.choice ?? null);
      if (div.offered && stored) usedChoiceKeys.add(key);
      const shifts: DerivedShift[] = [];
      let t = w.startMin;
      div.lengths.forEach((len, i) => {
        const extended =
          div.offered &&
          (div.applied === "split" ||
            (div.applied === "first" && i === 0) ||
            (div.applied === "last" && i === div.lengths.length - 1));
        shifts.push({ start: minToHHMM(t), end: minToHHMM(t + len), startMin: t, endMin: t + len, lengthMin: len, extended });
        t += len;
      });
      if (w.clamped) clampedDates.push(date);
      windows.push({
        windowStart,
        startMin: w.startMin,
        endMin: w.endMin,
        gameIds: w.gameIds,
        shifts,
        leftoverMin: div.leftoverMin,
        absorbOffered: div.offered,
        absorbApplied: div.applied,
        absorbDefaulted: div.defaulted,
        clamped: w.clamped,
      });
    }
    days.push({ date, day, gameCount: spans.length, windows });
  }

  const staleChoices = storedChoices.filter((c) => !usedChoiceKeys.has(absorbKey(c.date, c.windowStart)));
  return { days, closedDays, staleChoices, assumedDurationGameIds, clampedDates: [...new Set(clampedDates)] };
}

/** Flatten a derivation to the rows the table stores. */
export type ShiftSlot = { date: string; start: string; end: string };
export function flattenShifts(result: DerivationResult): ShiftSlot[] {
  const out: ShiftSlot[] = [];
  for (const d of result.days) for (const w of d.windows) for (const s of w.shifts) out.push({ date: d.date, start: s.start, end: s.end });
  return out;
}

// ─── Regenerate: which stored rows survive ───────────────────────────────────

export type StoredShiftRow = {
  id: string;
  date: string;
  start_time: string; // "HH:MM" or "HH:MM:SS"
  end_time: string;
  assigned_team_id: string | null;
  is_recurring: boolean;
  /** 0104: the internal note and cash person, so the plan can say which a
   *  regenerate would carry or lose. Optional: the derivation ignores them. */
  notes?: string | null;
  cash_person_id?: string | null;
};

export type Reconciliation = {
  /** Stored derived rows whose date/start/end still exist — kept, assignment and all. */
  keep: StoredShiftRow[];
  /** Derived shifts with no matching stored row — to insert and assign. */
  create: ShiftSlot[];
  /** Stored derived rows with no matching derived shift — to delete. */
  remove: StoredShiftRow[];
};

export function slotKey(date: string, start: string, end: string): string {
  return `${date}|${normalizeTime(start)}|${normalizeTime(end)}`;
}

/** Manual rows (is_recurring=false) are never in any list — a regenerate does
 *  not touch them. A duplicate stored row for one slot keeps the first and
 *  removes the rest. */
export function reconcileWithStored(derived: ShiftSlot[], stored: StoredShiftRow[]): Reconciliation {
  const byKey = new Map<string, StoredShiftRow[]>();
  for (const r of stored) {
    if (!r.is_recurring) continue;
    const k = slotKey(r.date, r.start_time, r.end_time);
    const l = byKey.get(k);
    if (l) l.push(r);
    else byKey.set(k, [r]);
  }
  const keep: StoredShiftRow[] = [];
  const create: ShiftSlot[] = [];
  const remove: StoredShiftRow[] = [];
  const matched = new Set<string>();
  for (const s of derived) {
    const k = slotKey(s.date, s.start, s.end);
    const rows = byKey.get(k);
    if (rows && !matched.has(k)) {
      matched.add(k);
      keep.push(rows[0]);
      for (const extra of rows.slice(1)) remove.push(extra);
    } else {
      create.push(s);
    }
  }
  for (const [k, rows] of byKey) if (!matched.has(k)) remove.push(...rows);
  return { keep, create, remove };
}

// ─── Assignment: who works a NEW shift ───────────────────────────────────────
// THE RULES (2026-10-06, replacing the date-keyed picker that handed a team
// the shift covering its own game — live: SRALL Oct 17, RVLL Royals):
//   1. HARD, both modes, BEFORE equity: a team is never assigned a shift that
//      overlaps any of its games — home, away, interleague, pending, or a
//      playoff game with a date — from GAME_BUFFER_BEFORE_MIN before the start
//      to the game's end (start + its division's duration) plus
//      GAME_BUFFER_AFTER_MIN. Cancelled games don't count.
//   2. Prefer game days: the preferred teams are those with a game that day at
//      a snack-shack venue, home OR away, that the hard rule left eligible.
//      None → teams not playing that day → any eligible team. Leaving tier 1
//      is reported as `preference_not_met`.
//   3. Prefer off days: soft, and evenness wins as before — the fewest-shift
//      teams are found first and the preference only filters among them; when
//      they all play that day one of them is picked and `preference_not_met`
//      is set.
//   4. Within the chosen pool: fewest shifts so far (seeded with the kept
//      rows), then alphabetical by name, then id.
//   5. No eligible team at all → the shift is left UNASSIGNED and flagged
//      `unfilled`. Never a fallback to a team that is playing.
// The index is built from REGULAR and PLAYOFF games alike; the derivation
// (which games open the shack) is untouched and still reads `games` only.

export const GAME_BUFFER_BEFORE_MIN = 30;
export const GAME_BUFFER_AFTER_MIN = 0;

export type PickTeam = { id: string; name: string };
export type SchedulingPreference = "prefer_game_days" | "prefer_off_days";

/** One game, as the assignment sees it: wall-clock date + start, a resolved
 *  duration, and whether it is at one of the shack's venues. */
export type AssignmentGame = {
  home_team_id: string | null;
  away_team_id: string | null;
  venue_id: string | null;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  start: string;
  status: string;
  durationMin: number;
  kind: "game" | "playoff";
};

export type TeamGameSpan = { startMin: number; endMin: number; atShackVenue: boolean; kind: "game" | "playoff" };

export type AssignmentIndex = {
  /** `${teamId}|${date}` → that team's non-cancelled games that day. */
  byTeamDate: Map<string, TeamGameSpan[]>;
};

/** Regular `games` rows (scheduled_at wall-clock) → AssignmentGame, with the
 *  duration already resolved (see resolveGameDurations). */
export function assignmentGamesFromRows(
  rows: { home_team_id: string | null; away_team_id: string | null; venue_id: string | null; scheduled_at: string; status: string; durationMin: number }[],
): AssignmentGame[] {
  return rows.map((r) => ({
    home_team_id: r.home_team_id,
    away_team_id: r.away_team_id,
    venue_id: r.venue_id,
    date: dateOf(r.scheduled_at),
    start: hhmmOf(r.scheduled_at),
    status: r.status,
    durationMin: r.durationMin,
    kind: "game",
  }));
}

/** `playoff_games` rows that carry a date and a start → AssignmentGame. A row
 *  with no date or no start is not on the calendar yet and is skipped; a team
 *  slot that is still null (TBD) contributes nothing. */
export function assignmentGamesFromPlayoffRows(
  rows: { home_team_id: string | null; away_team_id: string | null; venue_id: string | null; scheduled_date: string | null; start_time: string | null; status: string; durationMin: number }[],
): AssignmentGame[] {
  const out: AssignmentGame[] = [];
  for (const r of rows) {
    if (!r.scheduled_date || !r.start_time) continue;
    out.push({
      home_team_id: r.home_team_id,
      away_team_id: r.away_team_id,
      venue_id: r.venue_id,
      date: r.scheduled_date.substring(0, 10),
      start: normalizeTime(r.start_time),
      status: r.status,
      durationMin: r.durationMin,
      kind: "playoff",
    });
  }
  return out;
}

export function teamDateKey(teamId: string, date: string): string {
  return `${teamId}|${date}`;
}

export function assignmentIndexFromGames(games: AssignmentGame[], homeVenueIds: string[]): AssignmentIndex {
  const home = new Set(homeVenueIds);
  const byTeamDate = new Map<string, TeamGameSpan[]>();
  for (const g of games) {
    if (g.status === "cancelled") continue;
    const startMin = hhmmToMin(g.start);
    const span: TeamGameSpan = { startMin, endMin: startMin + g.durationMin, atShackVenue: !!g.venue_id && home.has(g.venue_id), kind: g.kind };
    for (const teamId of [g.home_team_id, g.away_team_id]) {
      if (!teamId) continue;
      const k = teamDateKey(teamId, g.date);
      const l = byTeamDate.get(k);
      if (l) l.push(span);
      else byTeamDate.set(k, [span]);
    }
  }
  return { byTeamDate };
}

export function teamGamesOn(index: AssignmentIndex, teamId: string, date: string): TeamGameSpan[] {
  return index.byTeamDate.get(teamDateKey(teamId, date)) ?? [];
}

/** The hard rule for one game: the buffered game span intersects the shift. */
export function gameBlocksShift(g: TeamGameSpan, shiftStartMin: number, shiftEndMin: number): boolean {
  return g.startMin - GAME_BUFFER_BEFORE_MIN < shiftEndMin && g.endMin + GAME_BUFFER_AFTER_MIN > shiftStartMin;
}

export function teamBlockedForShift(index: AssignmentIndex, teamId: string, slot: ShiftSlot): boolean {
  const s = hhmmToMin(normalizeTime(slot.start));
  const e = hhmmToMin(normalizeTime(slot.end));
  return teamGamesOn(index, teamId, slot.date).some((g) => gameBlocksShift(g, s, e));
}

export type AssignmentFlag = "preference_not_met" | "unfilled" | "conflict";
export type AssignedSlot = ShiftSlot & { assignedTeamId: string | null; flag: AssignmentFlag | null };

export function assignNewShifts(
  create: ShiftSlot[],
  teams: PickTeam[],
  kept: { assigned_team_id: string | null }[],
  preference: SchedulingPreference,
  index: AssignmentIndex,
): AssignedSlot[] {
  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const count: Record<string, number> = {};
  for (const t of sortedTeams) count[t.id] = 0;
  for (const k of kept) if (k.assigned_team_id && k.assigned_team_id in count) count[k.assigned_team_id]++;
  const fewest = (pool: PickTeam[]): PickTeam[] => {
    const m = Math.min(...pool.map((t) => count[t.id]));
    return pool.filter((t) => count[t.id] === m);
  };
  const ordered = [...create].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const out: AssignedSlot[] = [];
  for (const slot of ordered) {
    // Rule 1 — the hard rule, before anything else.
    const eligible = sortedTeams.filter((t) => !teamBlockedForShift(index, t.id, slot));
    // Rule 5 — nobody free: unassigned and flagged, never a playing team.
    const pool = eligible.length > 0 ? eligible : [];
    if (pool.length === 0) {
      out.push({ ...slot, assignedTeamId: null, flag: "unfilled" });
      continue;
    }
    let candidates: PickTeam[];
    let flag: AssignmentFlag | null = null;
    if (preference === "prefer_game_days") {
      // Rule 2 — tiers first, then fewest shifts within the tier.
      const atShack = pool.filter((t) => teamGamesOn(index, t.id, slot.date).some((g) => g.atShackVenue));
      const offDay = pool.filter((t) => teamGamesOn(index, t.id, slot.date).length === 0);
      if (atShack.length > 0) candidates = fewest(atShack);
      else if (offDay.length > 0) { candidates = fewest(offDay); flag = "preference_not_met"; }
      else { candidates = fewest(pool); flag = "preference_not_met"; }
    } else {
      // Rule 3 — evenness first, the preference only among the fewest.
      candidates = fewest(pool);
      const free = candidates.filter((t) => teamGamesOn(index, t.id, slot.date).length === 0);
      if (free.length > 0) candidates = free;
      else flag = "preference_not_met";
    }
    const picked = candidates[0];
    count[picked.id]++;
    out.push({ ...slot, assignedTeamId: picked.id, flag });
  }
  return out;
}

/** The flag a STORED assignment would carry today — for the page, which must
 *  mark legacy rows and hand edits by the same rules. `conflict` is produced
 *  only here: a stored team that the hard rule would refuse. An unassigned
 *  derived row reads as `unfilled`. */
export function storedAssignmentFlag(
  index: AssignmentIndex,
  preference: SchedulingPreference,
  teamId: string | null,
  slot: ShiftSlot,
): AssignmentFlag | null {
  if (!teamId) return "unfilled";
  if (teamBlockedForShift(index, teamId, slot)) return "conflict";
  const games = teamGamesOn(index, teamId, slot.date);
  if (preference === "prefer_game_days") return games.some((g) => g.atShackVenue) ? null : "preference_not_met";
  return games.length === 0 ? null : "preference_not_met";
}

/** The sentence for a flag, verbatim on every surface. */
export function assignmentFlagLine(flag: AssignmentFlag, preference: SchedulingPreference): string {
  if (flag === "unfilled") return `No team is free — every team plays during this shift (within ${GAME_BUFFER_BEFORE_MIN} minutes of a game).`;
  if (flag === "conflict") return `This team plays during this shift (within ${GAME_BUFFER_BEFORE_MIN} minutes of a game).`;
  return preference === "prefer_game_days"
    ? "Not at the park that day — every team playing here is busy during this shift."
    : "Plays that day — every team with the fewest shifts has a game that day.";
}

// ─── Staleness: do the stored shifts still match the schedule? ───────────────

export type StalenessDiff = {
  /** Dates whose stored derived shifts differ from the current derivation
   *  (missing, extra, or different start/end). */
  differingDates: string[];
};

export function stalenessDiff(derived: ShiftSlot[], stored: StoredShiftRow[]): StalenessDiff {
  const sig = (m: Map<string, string[]>, date: string, start: string, end: string) => {
    const l = m.get(date) ?? [];
    l.push(`${normalizeTime(start)}-${normalizeTime(end)}`);
    m.set(date, l);
  };
  const a = new Map<string, string[]>();
  const b = new Map<string, string[]>();
  for (const s of derived) sig(a, s.date, s.start, s.end);
  for (const r of stored) if (r.is_recurring) sig(b, r.date, r.start_time, r.end_time);
  const dates = new Set([...a.keys(), ...b.keys()]);
  const differing: string[] = [];
  for (const d of [...dates].sort()) {
    const x = (a.get(d) ?? []).slice().sort().join(",");
    const y = (b.get(d) ?? []).slice().sort().join(",");
    if (x !== y) differing.push(d);
  }
  return { differingDates: differing };
}

/** The page's sentence, rendered verbatim by every surface. */
export function stalenessSummary(diff: StalenessDiff): string | null {
  const n = diff.differingDates.length;
  if (n === 0) return null;
  return `The schedule changed since shifts were made — ${n} day${n === 1 ? "" : "s"} differ.`;
}

/** The "not open that day" line, verbatim. */
export function closedDayLine(c: ClosedDayGames): string {
  const d = new Date(c.date + "T00:00:00");
  const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const where = c.venueNames.length > 0 ? ` at ${c.venueNames.join(", ")}` : "";
  return `${label} — ${c.gameCount === 1 ? "game" : `${c.gameCount} games`}${where}, shack not open that day`;
}

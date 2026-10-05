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
// Lifted from the fixed-block generator (equity counter + soft preference,
// deterministic alphabetical tiebreak). Seeded with the KEPT rows so new picks
// balance against assignments that survived.

export type PickTeam = { id: string; name: string };
export type SchedulingPreference = "prefer_game_days" | "prefer_off_days";
export type PreferenceMaps = {
  /** date → teams with a game at an attached venue that day. */
  homeGamesByDate: Map<string, Set<string>>;
  /** date → teams playing anywhere that day (any status but cancelled: a
   *  pending proposal still means the team might be busy). */
  anyGameByDate: Map<string, Set<string>>;
};

export type PreferenceGame = {
  home_team_id: string;
  away_team_id: string | null;
  venue_id: string | null;
  scheduled_at: string;
  status: string;
};

export function preferenceMapsFromGames(games: PreferenceGame[], homeVenueIds: string[]): PreferenceMaps {
  const home = new Set(homeVenueIds);
  const homeGamesByDate = new Map<string, Set<string>>();
  const anyGameByDate = new Map<string, Set<string>>();
  for (const g of games) {
    if (g.status === "cancelled") continue;
    const date = dateOf(g.scheduled_at);
    if (g.venue_id && home.has(g.venue_id)) {
      if (!homeGamesByDate.has(date)) homeGamesByDate.set(date, new Set());
      homeGamesByDate.get(date)!.add(g.home_team_id);
    }
    if (!anyGameByDate.has(date)) anyGameByDate.set(date, new Set());
    anyGameByDate.get(date)!.add(g.home_team_id);
    if (g.away_team_id) anyGameByDate.get(date)!.add(g.away_team_id);
  }
  return { homeGamesByDate, anyGameByDate };
}

export type AssignedSlot = ShiftSlot & { assignedTeamId: string };

export function assignNewShifts(
  create: ShiftSlot[],
  teams: PickTeam[],
  kept: { assigned_team_id: string | null }[],
  preference: SchedulingPreference,
  maps: PreferenceMaps,
): AssignedSlot[] {
  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const count: Record<string, number> = {};
  for (const t of sortedTeams) count[t.id] = 0;
  for (const k of kept) if (k.assigned_team_id && k.assigned_team_id in count) count[k.assigned_team_id]++;
  const ordered = [...create].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const out: AssignedSlot[] = [];
  for (const slot of ordered) {
    if (sortedTeams.length === 0) break;
    const minCount = Math.min(...sortedTeams.map((t) => count[t.id]));
    let candidates = sortedTeams.filter((t) => count[t.id] === minCount);
    if (preference === "prefer_game_days") {
      const homeTeams = maps.homeGamesByDate.get(slot.date) ?? new Set<string>();
      const preferred = candidates.filter((t) => homeTeams.has(t.id));
      if (preferred.length > 0) candidates = preferred;
    } else {
      const busy = maps.anyGameByDate.get(slot.date) ?? new Set<string>();
      const preferred = candidates.filter((t) => !busy.has(t.id));
      if (preferred.length > 0) candidates = preferred;
    }
    const picked = candidates[0];
    count[picked.id]++;
    out.push({ ...slot, assignedTeamId: picked.id });
  }
  return out;
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

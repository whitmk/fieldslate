// Playoff bracket planning — PURE. No Supabase, no "use client", so
// `npm run sim:playoff-bracket` drives exactly what generateBracket runs.
// generate-bracket.ts is the I/O wrapper: it loads the inputs, calls these,
// and writes the rows.
//
// WHAT WENT WRONG BEFORE (SRALL Fall 2026, 50/70, 2026-10-05) and what each
// piece here is for:
//
// 1. BYES. Six teams in an eight-slot bracket: the old builder skipped the two
//    bye pairs and wrote nothing for the bye teams, and advancement mapped
//    round-1 winners by their index in the COMPACTED list, so both winners
//    landed in the same semifinal and seeds 1 and 2 never played.
//    Now: `standardSeedOrder` lays the bracket out so seeds 1 and 2 are in
//    opposite halves (8: 1v8, 4v5 | 2v7, 3v6), a bye team is written into its
//    next-round slot AT GENERATION TIME, and every game carries its BRACKET
//    POSITION in `game_number` (round-1 position p is game_number p+1, bye pairs
//    leave a gap) so advancement.ts can send a winner to the right slot.
//
// 2. SPACING. A hardcoded 105-minute step (90 + 15) on a division that plays
//    180 + 30 — the second round-1 game started while the first was still on.
//    Now: duration and buffer come from the division's settings.
//
// 3. WRAPAROUND. When the dates ran out, the slot picker clamped to the LAST
//    date and restarted at its first slot, so the semifinals and final were
//    stacked on top of round 1 at 9:00 AM on one field. Now: slots are ONE
//    chronological list; rounds consume it in order, a later round never starts
//    before the earlier round's last game has ended (plus the buffer), and a
//    game with no slot left is saved unscheduled and REPORTED.
//
// 4. SILENT CLOSED DAYS. Friday was chosen but the only field is closed on
//    Fridays; the day produced nothing and nobody was told. Now every playing
//    date in the range gets a diagnostic (ok / closed / too_short) and the
//    warnings name the day and the field.
//
// WINDOW SEMANTIC: a day window's END and a field's closing time both mean the
// game must END by then (the reschedule picker's rule, CLAUDE.md "A window
// CLOSE means the span must END by it"). The regular-season generator still
// checks the start only; the playoff planner deliberately takes the stricter
// rule, so a Saturday 9:00–17:00 window fits two 180-minute games, not three.

import {
  dayKeyFromJsDate,
  dayWindowBounds,
  isVenueAvailable,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";
import type {
  DayWindowMap,
  PlayingDay,
  SeededTeam,
} from "@/components/playoffs/playoff-wizard-types";

// ─── Row shape ────────────────────────────────────────────────────────────────

export interface GameInsert {
  playoff_id: string;
  league_id: string;
  division_id: string;
  round: string;
  game_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  venue_id: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  status: "scheduled";
}

export type BracketIds = {
  playoffId: string;
  leagueId: string;
  divisionId: string;
};

// ─── Time helpers ─────────────────────────────────────────────────────────────

const DAY_TO_JS: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};

export const DAY_LONG: Record<DayKey, string> = {
  Mo: "Mondays", Tu: "Tuesdays", We: "Wednesdays", Th: "Thursdays",
  Fr: "Fridays", Sa: "Saturdays", Su: "Sundays",
};

function pad2(n: number) { return String(n).padStart(2, "0"); }

export function localDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function minutesToTimeStr(mins: number) {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}
/** "15:30" minutes → "3:30 PM". */
export function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? "PM" : "AM"}`;
}
/** "2026-11-06" → "Fri, Nov 6". Wall-clock substring, never an instant. */
export function fmtPlanDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Mirrors `durationFromSettings` / `bufferFromRaw` (the picker and the
 *  occupancy gate), but REPORTS when a default was used so the wizard can say
 *  so instead of silently assuming 90 minutes. */
export const DEFAULT_PLAYOFF_DURATION_MIN = 90;
export const DEFAULT_PLAYOFF_BUFFER_MIN = 15;

export type PlanSettings = {
  durationMin: number;
  bufferMin: number;
  durationDefaulted: boolean;
  bufferDefaulted: boolean;
};

export function planSettingsFromDivision(settings: unknown): PlanSettings {
  const s = (settings ?? {}) as { game_duration?: unknown; buffer_minutes?: unknown };
  const d = Number(s.game_duration);
  const b = Number(s.buffer_minutes);
  const durationOk = Number.isFinite(d) && d > 0;
  const bufferOk = Number.isFinite(b) && b >= 0;
  return {
    durationMin: durationOk ? d : DEFAULT_PLAYOFF_DURATION_MIN,
    bufferMin: bufferOk ? b : DEFAULT_PLAYOFF_BUFFER_MIN,
    durationDefaulted: !durationOk,
    bufferDefaulted: !bufferOk,
  };
}

// ─── Wizard defaults from the division (item 6) ───────────────────────────────

const VALID_DAYS = new Set<string>(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
const HHMM = /^\d{2}:\d{2}$/;

/**
 * The playoff Dates step's starting point when a division is picked: the
 * division's own playing days and windows, so a Saturday-only division does not
 * start from the wizard's Sa+Su 9–5 default. Only days the division PLAYS get a
 * window (an orphan window for a non-playing day is dropped). Anything
 * unparseable falls back to the supplied defaults.
 */
export function playoffDefaultsFromDivision(
  settings: unknown,
  fallback: { playing_days: PlayingDay[]; day_windows: DayWindowMap },
): { playing_days: PlayingDay[]; day_windows: DayWindowMap } {
  const s = (settings ?? {}) as { playing_days?: unknown; day_windows?: unknown };
  const days = Array.isArray(s.playing_days)
    ? (s.playing_days.filter((d): d is PlayingDay => typeof d === "string" && VALID_DAYS.has(d)))
    : [];
  if (days.length === 0) {
    return { playing_days: [...fallback.playing_days], day_windows: { ...fallback.day_windows } };
  }
  const rawWin = (s.day_windows && typeof s.day_windows === "object" ? s.day_windows : {}) as Record<
    string,
    { start?: unknown; end?: unknown } | undefined
  >;
  const day_windows: DayWindowMap = {};
  for (const d of days) {
    const w = rawWin[d];
    const start = typeof w?.start === "string" && HHMM.test(w.start) ? w.start : null;
    const end = typeof w?.end === "string" && HHMM.test(w.end) ? w.end : null;
    day_windows[d] =
      start && end && timeToMinutes(start) < timeToMinutes(end)
        ? { start, end }
        : { ...(fallback.day_windows[d] ?? { start: "09:00", end: "17:00" }) };
  }
  return { playing_days: days, day_windows };
}

// ─── Slot grid ────────────────────────────────────────────────────────────────

export interface PlanSlot {
  date: string;
  time: string;
  startMin: number;
  venueId: string;
}

export type PlanVenue = {
  id: string;
  name: string;
  /** null = the availability read did not return this venue. It passes
   *  through unfiltered (the wizard already limits the choice to configured
   *  venues), so a failed read degrades to the old behaviour instead of
   *  producing an empty bracket. */
  availability: VenueAvailability | null;
};

export type DayDiagnostic =
  | { date: string; day: DayKey; kind: "ok"; slotCount: number }
  /** No selected field is open that day. */
  | { date: string; day: DayKey; kind: "closed"; venueNames: string[] }
  /** At least one field is open, but no start fits the game inside BOTH the
   *  day window and that field's hours. */
  | { date: string; day: DayKey; kind: "too_short"; venueNames: string[] };

export type SlotGridInput = {
  startDate: string;
  endDate: string;
  playingDays: string[];
  dayWindows: DayWindowMap;
  venues: PlanVenue[];
  durationMin: number;
  bufferMin: number;
};

export type SlotGrid = { slots: PlanSlot[]; days: DayDiagnostic[] };

/** When a playing day has no window of its own (legacy rows), the old
 *  09:00–21:00 band is kept so existing saved playoffs keep producing slots. */
const LEGACY_WINDOW = { start: "09:00", end: "21:00" };

/**
 * Every (date × time × venue) a playoff game could occupy, in chronological
 * order (date, then time, then venue — so two same-round games land on
 * different fields at one time before the same field is reused).
 *
 * The time step is duration + buffer, anchored at the day window's start. A
 * start is offered only if the whole game ENDS inside the day window and
 * inside the field's hours for that weekday.
 */
export function buildSlotGrid(input: SlotGridInput): SlotGrid {
  const slots: PlanSlot[] = [];
  const days: DayDiagnostic[] = [];
  if (!input.startDate || !input.endDate || input.venues.length === 0) {
    return { slots, days };
  }
  const allowed = new Set(
    input.playingDays.map((d) => DAY_TO_JS[d]).filter((n) => n !== undefined),
  );
  if (allowed.size === 0) return { slots, days };

  const step = input.durationMin + input.bufferMin;
  const cur = new Date(input.startDate + "T00:00:00");
  const end = new Date(input.endDate + "T00:00:00");

  while (cur <= end) {
    if (allowed.has(cur.getDay())) {
      const iso = localDateStr(cur);
      const day = dayKeyFromJsDate(cur);
      const win = input.dayWindows[day] ?? LEGACY_WINDOW;
      const winStart = timeToMinutes(win.start);
      const winEnd = timeToMinutes(win.end);

      const before = slots.length;
      for (let t = winStart; t + input.durationMin <= winEnd; t += step) {
        const time = minutesToTimeStr(t);
        for (const v of input.venues) {
          if (v.availability && !isVenueAvailable(v.availability, day, time, input.durationMin)) {
            continue;
          }
          slots.push({ date: iso, time, startMin: t, venueId: v.id });
        }
      }
      const count = slots.length - before;
      if (count > 0) {
        days.push({ date: iso, day, kind: "ok", slotCount: count });
      } else {
        // Nothing fit. Say WHY: closed everywhere, or open but too short.
        const open = input.venues.filter(
          (v) => v.availability === null || dayWindowBounds(v.availability, day) !== null,
        );
        if (open.length === 0) {
          days.push({ date: iso, day, kind: "closed", venueNames: input.venues.map((v) => v.name) });
        } else {
          days.push({ date: iso, day, kind: "too_short", venueNames: open.map((v) => v.name) });
        }
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return { slots, days };
}

// ─── Slot picker — sequential, round-ordered, never wraps ─────────────────────

export type SlotPicker = {
  pick: (round: string) => PlanSlot | null;
  /** Slots passed over because they fell before an earlier round's games had
   *  ended. Reported, so "not enough slots" can say why a free slot went unused. */
  skippedForOrder: () => number;
};

/**
 * Hands out slots in chronological order. Each new ROUND must start no earlier
 * than the previous round's latest end plus the buffer — a semifinal cannot
 * begin while a quarterfinal is still being played. Within a round, slots are
 * consumed in order (venue-staggered within each time). When the list runs out
 * every further pick is null: the game stays unscheduled and the caller reports
 * it. It NEVER clamps to the last date or restarts at the first slot — that is
 * the wraparound that stacked three games on one field at 9:00 AM.
 */
export function makeSlotPicker(slots: PlanSlot[], settings: { durationMin: number; bufferMin: number }): SlotPicker {
  let cursor = 0;
  let lastRound = "";
  let prevRoundEnd: { date: string; endMin: number } | null = null;
  let thisRoundEnd: { date: string; endMin: number } | null = null;
  let skipped = 0;

  const later = (a: { date: string; endMin: number }, b: { date: string; endMin: number }) =>
    a.date > b.date || (a.date === b.date && a.endMin > b.endMin);

  function pick(round: string): PlanSlot | null {
    if (round !== lastRound) {
      if (thisRoundEnd) prevRoundEnd = thisRoundEnd;
      thisRoundEnd = null;
      lastRound = round;
    }
    if (prevRoundEnd) {
      const earliest = prevRoundEnd.endMin + settings.bufferMin;
      while (
        cursor < slots.length &&
        (slots[cursor].date < prevRoundEnd.date ||
          (slots[cursor].date === prevRoundEnd.date && slots[cursor].startMin < earliest))
      ) {
        cursor++;
        skipped++;
      }
    }
    const slot = slots[cursor] ?? null;
    if (!slot) return null;
    cursor++;
    const endsAt = { date: slot.date, endMin: slot.startMin + settings.durationMin };
    if (!thisRoundEnd || later(endsAt, thisRoundEnd)) thisRoundEnd = endsAt;
    return slot;
  }

  return { pick, skippedForOrder: () => skipped };
}

function gameFromSlot(
  ids: BracketIds,
  round: string,
  gameNumber: number,
  homeId: string | null,
  awayId: string | null,
  slot: PlanSlot | null,
): GameInsert {
  return {
    playoff_id: ids.playoffId, league_id: ids.leagueId, division_id: ids.divisionId,
    round, game_number: gameNumber,
    home_team_id: homeId, away_team_id: awayId,
    venue_id: slot?.venueId ?? null,
    scheduled_date: slot?.date ?? null,
    start_time: slot?.time ?? null,
    status: "scheduled",
  };
}

// ─── Single elimination ───────────────────────────────────────────────────────

/**
 * Standard bracket order for `bracketSize` (a power of two), as 1-based seed
 * numbers: adjacent pairs are round-1 games, and the halves recurse, so the
 * top two seeds can only meet in the final.
 *   2 → [1,2]   4 → [1,4,2,3]   8 → [1,8,4,5,2,7,3,6]
 */
export function standardSeedOrder(bracketSize: number): number[] {
  let order = [1];
  while (order.length < bracketSize) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) next.push(s, n + 1 - s);
    order = next;
  }
  return order;
}

export function bracketSizeFor(teamCount: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(2, teamCount))));
}

/** Round label by position (0 = first round) for a bracket of `size`. The
 *  first round is always "R1"; the last is "F", the one before it "SF" — the
 *  labels bracket-view / the export already understand. */
export function singleElimRoundLabel(roundIdx: number, bracketSize: number): string {
  if (roundIdx === 0) return "R1";
  const gamesInRound = bracketSize / Math.pow(2, roundIdx + 1);
  if (gamesInRound === 1) return "F";
  if (gamesInRound === 2) return "SF";
  return `R${roundIdx + 1}`;
}

/** Number of games in round `roundIdx` of a bracket of `size`. */
export function singleElimRoundSize(roundIdx: number, bracketSize: number): number {
  return bracketSize / Math.pow(2, roundIdx + 1);
}

/**
 * `game_number` of position 0 in round `roundIdx`: rounds are numbered
 * positionally and consecutively (B/2 numbers for round 1, then B/4, …), so a
 * game's position in its round is `game_number - singleElimFirstNumber(...)`.
 * A bye pair in round 1 simply leaves its number unused.
 */
export function singleElimFirstNumber(roundIdx: number, bracketSize: number): number {
  return 1 + bracketSize - bracketSize / Math.pow(2, roundIdx);
}

export function buildSingleElimination(
  seeds: SeededTeam[],
  ids: BracketIds,
  picker: SlotPicker,
): GameInsert[] {
  const n = seeds.length;
  if (n < 2) return [];
  const B = bracketSizeFor(n);
  const order = standardSeedOrder(B);
  const leaves: (SeededTeam | null)[] = order.map((s) => seeds[s - 1] ?? null);
  const roundCount = Math.log2(B);

  // Pre-placed teams for every later round, keyed `${roundIdx}:${pos}`.
  const placed = new Map<string, { home: string | null; away: string | null }>();
  const place = (roundIdx: number, pos: number, side: "home" | "away", teamId: string) => {
    const key = `${roundIdx}:${pos}`;
    const cur = placed.get(key) ?? { home: null, away: null };
    cur[side] = teamId;
    placed.set(key, cur);
  };

  const games: GameInsert[] = [];

  // Round 1: position p = leaves[2p] vs leaves[2p+1]. A pair with one team is a
  // BYE — that team is written straight into round 2, slot by p's parity, and
  // the pair's game_number is left unused so positions stay honest.
  const r1 = singleElimRoundLabel(0, B);
  for (let p = 0; p < B / 2; p++) {
    const home = leaves[2 * p];
    const away = leaves[2 * p + 1];
    if (home && away) {
      games.push(gameFromSlot(ids, r1, singleElimFirstNumber(0, B) + p, home.team_id, away.team_id, picker.pick(r1)));
    } else {
      const bye = home ?? away;
      if (bye && roundCount > 1) place(1, Math.floor(p / 2), p % 2 === 0 ? "home" : "away", bye.team_id);
    }
  }

  // Later rounds: every game exists (TBD slots filled by advancement), with any
  // bye team already in its seat.
  for (let r = 1; r < roundCount; r++) {
    const label = singleElimRoundLabel(r, B);
    const first = singleElimFirstNumber(r, B);
    for (let p = 0; p < singleElimRoundSize(r, B); p++) {
      const pre = placed.get(`${r}:${p}`);
      games.push(gameFromSlot(ids, label, first + p, pre?.home ?? null, pre?.away ?? null, picker.pick(label)));
    }
  }

  return games;
}

// ─── Double elimination (UNTESTED FORMAT — moved verbatim, picker only) ───────

// The only team counts the double-elim generator + advancement mapping
// support. Any other count silently drops "bye" teams from the bracket
// entirely (e.g. 3 teams → seed 1 never plays), and >32 needs round labels
// ROUND_ORDER doesn't know. generateBracket rejects everything else until
// bye handling exists for this format. (Single elimination handles byes
// above; double elimination has NOT been given the same treatment.)
export const DOUBLE_ELIM_SUPPORTED_COUNTS = [2, 4, 8, 16, 32];

export function buildDoubleElimination(
  seeds: SeededTeam[],
  ids: BracketIds,
  picker: SlotPicker,
): GameInsert[] {
  const n = seeds.length;
  if (n < 2) return [];

  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
  const games: GameInsert[] = [];
  let gameNumber = 1;

  function mkGame(round: string, homeId: string | null, awayId: string | null): GameInsert {
    return gameFromSlot(ids, round, gameNumber++, homeId, awayId, picker.pick(round));
  }

  // WB Round 1 (known matchups)
  const wbR1Count = bracketSize / 2;
  for (let i = 0; i < wbR1Count; i++) {
    const home = seeds[i] ?? null;
    const away = seeds[bracketSize - 1 - i] ?? null;
    if (home && away) games.push(mkGame("WB-R1", home.team_id, away.team_id));
  }

  // WB subsequent rounds
  let wbRound = 2;
  let wbSize = wbR1Count / 2;
  while (wbSize >= 1) {
    const label = wbSize === 1 ? "WB-F" : `WB-R${wbRound}`;
    for (let i = 0; i < wbSize; i++) games.push(mkGame(label, null, null));
    wbRound++;
    wbSize = wbSize / 2;
  }

  // LB rounds
  const totalWbRounds = Math.log2(bracketSize);
  let lbSize = bracketSize / 4;
  for (let lbR = 1; lbR <= (totalWbRounds - 1) * 2; lbR++) {
    const count = Math.max(1, Math.ceil(lbSize));
    const label = lbR === (totalWbRounds - 1) * 2 ? "LB-F" : `LB-R${lbR}`;
    for (let i = 0; i < count; i++) games.push(mkGame(label, null, null));
    if (lbR % 2 === 0) lbSize = Math.max(1, lbSize / 2);
  }

  games.push(mkGame("GF", null, null));
  games.push(mkGame("GF-R", null, null));

  return games;
}

// ─── Round robin (UNTESTED FORMAT — moved verbatim, picker only) ──────────────

function roundRobinRounds(ids: string[]): [string, string][][] {
  const arr = ids.length % 2 === 0 ? [...ids] : [...ids, "__bye__"];
  const n = arr.length;
  const rounds: [string, string][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__bye__" && b !== "__bye__") round.push([a, b]);
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop()!);
  }

  return rounds;
}

export function buildRoundRobin(
  seeds: SeededTeam[],
  ids: BracketIds,
  picker: SlotPicker,
): GameInsert[] {
  const teamIds = seeds.map((s) => s.team_id);
  if (teamIds.length < 2) return [];

  const rounds = roundRobinRounds(teamIds);
  const games: GameInsert[] = [];
  let gameNumber = 1;

  rounds.forEach((round, rIdx) => {
    const label = `RR${rIdx + 1}`;
    round.forEach(([homeId, awayId]) => {
      games.push(gameFromSlot(ids, label, gameNumber++, homeId, awayId, picker.pick(label)));
    });
  });

  return games;
}

// ─── The plan: slots + games + warnings, in one call ──────────────────────────

export type PlayoffFormatKey = "single_elimination" | "double_elimination" | "round_robin";

export type PlanInput = {
  format: PlayoffFormatKey;
  seeds: SeededTeam[];
  ids: BracketIds;
  grid: SlotGridInput;
  settings: PlanSettings;
  divisionName: string;
};

export type BracketPlan = {
  games: GameInsert[];
  slots: PlanSlot[];
  days: DayDiagnostic[];
  tbdCount: number;
  skippedForOrder: number;
  /** Plain-English, one per problem, each with its reason. Rendered VERBATIM
   *  by the review (pre-flight) and success screens. */
  warnings: string[];
};

export function planBracket(input: PlanInput): BracketPlan {
  const { slots, days } = buildSlotGrid(input.grid);
  const picker = makeSlotPicker(slots, input.settings);
  let games: GameInsert[];
  if (input.format === "single_elimination") {
    games = buildSingleElimination(input.seeds, input.ids, picker);
  } else if (input.format === "double_elimination") {
    games = buildDoubleElimination(input.seeds, input.ids, picker);
  } else {
    games = buildRoundRobin(input.seeds, input.ids, picker);
  }
  const tbdCount = games.filter((g) => g.scheduled_date === null).length;
  const skippedForOrder = picker.skippedForOrder();
  const warnings = planWarnings({
    days, slotCount: slots.length, gameCount: games.length, tbdCount, skippedForOrder,
    settings: input.settings, divisionName: input.divisionName,
  });
  return { games, slots, days, tbdCount, skippedForOrder, warnings };
}

export function planWarnings(p: {
  days: DayDiagnostic[];
  slotCount: number;
  gameCount: number;
  tbdCount: number;
  skippedForOrder: number;
  settings: PlanSettings;
  divisionName: string;
}): string[] {
  const out: string[] = [];
  const div = p.divisionName || "This division";

  if (p.settings.durationDefaulted || p.settings.bufferDefaulted) {
    const parts: string[] = [];
    if (p.settings.durationDefaulted) parts.push(`${DEFAULT_PLAYOFF_DURATION_MIN}-minute games`);
    if (p.settings.bufferDefaulted) parts.push(`a ${DEFAULT_PLAYOFF_BUFFER_MIN}-minute buffer`);
    out.push(
      `${div} has no ${p.settings.durationDefaulted ? "game duration" : "buffer"} set, so ${parts.join(" and ")} ${parts.length > 1 ? "were" : "was"} assumed. Set it on the division to space playoff games correctly.`,
    );
  }

  // Closed / too-short days, one line per (weekday, kind) so a 3-Friday range
  // reads as one sentence, not three.
  const seen = new Set<string>();
  for (const d of p.days) {
    if (d.kind === "ok") continue;
    const key = `${d.day}:${d.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dates = p.days.filter((x) => x.kind === d.kind && x.day === d.day).map((x) => fmtPlanDate(x.date));
    const fields = d.venueNames.join(", ");
    if (d.kind === "closed") {
      out.push(
        `${dates.join(", ")}: no games were placed — ${fields.length ? fields : "the selected field"} ${d.venueNames.length === 1 ? "is" : "are"} closed on ${DAY_LONG[d.day]}. Open the field that day on the Venues page, or take ${DAY_LONG[d.day]} out of the playoff days.`,
      );
    } else {
      out.push(
        `${dates.join(", ")}: no games were placed — ${fields} ${d.venueNames.length === 1 ? "is" : "are"} open, but no ${p.settings.durationMin}-minute game fits inside both the ${DAY_LONG[d.day]} playoff window and the field's hours. Widen one of them.`,
      );
    }
  }

  if (p.tbdCount > 0) {
    const why =
      p.skippedForOrder > 0
        ? ` ${p.skippedForOrder} slot${p.skippedForOrder === 1 ? " was" : "s were"} skipped because ${p.skippedForOrder === 1 ? "it" : "they"} fell before an earlier round's games had finished — a later round can't start until the round before it is over.`
        : "";
    out.push(
      `${p.tbdCount} of ${p.gameCount} games could not be placed: the chosen dates, windows and fields give ${p.slotCount} slot${p.slotCount === 1 ? "" : "s"} and the bracket needs ${p.gameCount}.${why} ${p.tbdCount === 1 ? "It is" : "They are"} saved without a date, time or field (TBD). Add dates or fields and regenerate, or set each one from the bracket's list view.`,
    );
  }

  return out;
}

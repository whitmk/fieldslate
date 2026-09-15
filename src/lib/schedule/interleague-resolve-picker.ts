// Interleague counter-proposal "Edit" — slot picker inputs and wording.
//
// The Interleague page's counter-proposed games offer Accept proposal / Keep
// original / Edit / Decline. Edit used to be a free-typed date-time field: the
// admin guessed, submitted, and the resolve route's occupancy gate rejected the
// guess. This module lets the Edit modal OFFER the times the gate would accept.
//
// Pure: no directive, no Supabase client. The modal runs the reads and hands the
// raw results here, so scripts/sim/interleague-resolve-picker-sim.ts drives the
// same assembly, fail-closed decisions and wording the component renders.
//
// ── What it deliberately reuses ──────────────────────────────────────────────
//
//   * `buildSlotsAndDiagnostics` (reschedule-slots.ts) — the one correct slot
//     model: 15-minute grid, per-day windows, real-span half-open overlap, the
//     arriving team's buffer, must-END-by, explained empty days.
//   * `durationFromSettings` + the occupancy gate's own `bufferFromRaw` — the
//     SAME fallbacks `gateRescheduleOccupancy` applies. Picker and server must
//     agree, so the picker never offers a time the gate would refuse. Never
//     `Number(s.game_duration ?? 90)` (the rainout modal's form), which is NaN
//     for a non-numeric setting.
//   * `summarizeByWeekday` — the rainout picker's weekday roll-up.
//
// ── Scope decisions (approved 2026-09-14) ────────────────────────────────────
//
//   * ONE FIELD: the game's current venue. The resolve route writes
//     `scheduled_at` and never `venue_id`, and both server gates read the venue
//     off the stored row — offering another field would save the time while the
//     gates tested the old field. It is also the field the partner was told.
//   * NO MAKEUP DAYS. `makeup` means "a rained-out game may move here"; a
//     counter-proposal is not a rainout. Flags are stripped before the build.
//   * NO PICKER WITHOUT A FIELD. `venue_id` null (every away game in production)
//     means the field is the partner's, whose hours and bookings we do not have.
//     Offering "available" times there would be a guess wearing a label. Keyed
//     on `venue_id`, like the occupancy gate — never on `is_away`.
//   * Our team only. `away_team_id` is null on every interleague game; the
//     partner team's schedule is unknown, so its checks match nothing. Team
//     constraints are home-team-only for interleague (CLAUDE.md).
//
// The server gates are unchanged and stay authoritative. The picker is
// STRICTER than them (it also enforces playing days, the division window, our
// team's other games and constraints), so it can hide a time the server would
// allow — never offer one it would reject.

import {
  parseAvailability,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";
import {
  buildSlotsAndDiagnostics,
  durationFromSettings,
  summarizeByWeekday,
  toMins,
  type BuildAvailableSlotsParams,
  type DayDiagnostics,
  type DaySummary,
  type OccupiedSpan,
  type SlotOption,
} from "@/lib/schedule/reschedule-slots";
import {
  constraintsFromRows,
  type TeamGameConstraintRow,
} from "@/lib/schedule/team-constraints";
import { bufferFromRaw } from "@/lib/venues/occupancy-gate";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";

// ── Mode ─────────────────────────────────────────────────────────────────────

export type ResolveEditMode =
  /** Our field: pick from real available times. */
  | "picker"
  /** The partner's field: free-typed date, time and field is the normal flow. */
  | "away_free_typed"
  /** No field and not an away game (no live rows): free-typed, no picker. */
  | "no_venue_free_typed";

export function resolveEditMode(game: {
  venue_id: string | null;
  is_away: boolean;
}): ResolveEditMode {
  if (game.venue_id) return "picker";
  return game.is_away ? "away_free_typed" : "no_venue_free_typed";
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type ReadResult<T> = { data: T | null; error: { message: string } | null };

/** Placeholder for a read the caller skipped because an earlier one already
 *  decided the outcome. It is an ERROR on purpose: if assembly ever reached it,
 *  it must fail closed rather than read as an empty list. */
export const NOT_ATTEMPTED: ReadResult<never> = {
  data: null,
  error: { message: "not attempted" },
};

export type PickerDivisionRow = {
  name: string;
  start_date: string | null;
  end_date: string | null;
  settings: unknown;
};

export type PickerVenueRow = {
  id: string;
  name: string;
  availability: unknown;
  availability_configured: boolean;
  location: { name: string } | null;
};

/** A game row carrying its OWN division's duration as a projected key. */
export type PickerGameRow = {
  scheduled_at: string;
  home_team: { division: { game_duration: unknown } | null } | null;
};

export type PickerReads = {
  division: ReadResult<PickerDivisionRow>;
  venue: ReadResult<PickerVenueRow>;
  blackouts: ReadResult<{ date: string }[]>;
  /** Paginated read (fetchAllRows): rows, or the error it threw. */
  venueGames: ReadResult<PickerGameRow[]>;
  teamGames: ReadResult<PickerGameRow[]>;
  constraints: ReadResult<TeamGameConstraintRow[]>;
};

export type PickerContext = {
  gameId: string;
  homeTeamId: string;
  homeTeamName: string;
  /** Injectable "today" for the sim; production uses the builder's clock. */
  today?: string;
};

export type AssembleResult =
  | {
      ok: true;
      params: BuildAvailableSlotsParams;
      fieldName: string;
      divisionName: string;
    }
  | { ok: false; reason: "read_failed"; message: string }
  | { ok: false; reason: "venue_unconfigured"; fieldName: string }
  | { ok: false; reason: "division_dates_missing"; divisionName: string };

/** Clear every `makeup` flag. A counter-proposal is not a rainout. */
export function stripMakeup(av: VenueAvailability): VenueAvailability {
  const out: VenueAvailability = {};
  for (const [day, w] of Object.entries(av) as [DayKey, NonNullable<VenueAvailability[DayKey]>][]) {
    out[day] = { ...w, makeup: false };
  }
  return out;
}

function spanOf(row: PickerGameRow): OccupiedSpan {
  return {
    startMin: toMins(row.scheduled_at.substring(11, 16)),
    durationMin: durationFromSettings({ game_duration: row.home_team?.division?.game_duration }),
  };
}

/**
 * Turn the six raw reads into builder parameters — or refuse.
 *
 * FAIL CLOSED ON EVERY READ. Each read's error, and a missing single row, ends
 * here with nothing to pick from. An empty list after a failed read would say
 * "nothing available" when the truth is "we could not check", and a partial
 * occupancy list would offer times on top of real games. (The rainout modal
 * ignores its blackout_dates error; this does not copy that.)
 */
export function assemblePickerInputs(reads: PickerReads, ctx: PickerContext): AssembleResult {
  const failed = (what: string): AssembleResult => ({
    ok: false,
    reason: "read_failed",
    message: `Couldn't load ${what}, so no times are shown. Try again.`,
  });

  // ORDER IS DELIBERATE: the division (its dates bound every games read) and
  // the venue are checked before the reads that depend on them, so a caller
  // that stops early may pass not-attempted placeholders for the rest — and a
  // placeholder is an ERROR, so reaching one still fails closed.
  if (reads.division.error || !reads.division.data) return failed("the division's settings");
  const div = reads.division.data;
  if (!div.start_date || !div.end_date) {
    return { ok: false, reason: "division_dates_missing", divisionName: div.name };
  }
  if (reads.venue.error || !reads.venue.data) return failed("the field's hours");
  const venue = reads.venue.data;
  const fieldName = qualifiedVenueLabel({ name: venue.name, location: venue.location });
  if (!venue.availability_configured) return { ok: false, reason: "venue_unconfigured", fieldName };

  if (reads.blackouts.error || !reads.blackouts.data) return failed("the season's blackout dates");
  if (reads.venueGames.error || !reads.venueGames.data) return failed("the games already at this field");
  if (reads.teamGames.error || !reads.teamGames.data) return failed(`${ctx.homeTeamName}'s other games`);
  if (reads.constraints.error || !reads.constraints.data) return failed(`${ctx.homeTeamName}'s scheduling constraints`);

  const s = (div.settings ?? {}) as Record<string, unknown>;
  const playingDays = (Array.isArray(s.playing_days) ? s.playing_days : ["Sa", "Su"]) as string[];
  const dayWindows = (typeof s.day_windows === "object" && s.day_windows
    ? s.day_windows
    : {}) as Record<string, { start: string; end: string }>;

  const venueBookings = new Map<string, OccupiedSpan[]>();
  for (const g of reads.venueGames.data) {
    const key = `${venue.id}:${g.scheduled_at.substring(0, 10)}`;
    if (!venueBookings.has(key)) venueBookings.set(key, []);
    venueBookings.get(key)!.push(spanOf(g));
  }

  const homeTeamSpans = new Map<string, OccupiedSpan[]>();
  const homeTeamDayCounts = new Map<string, number>();
  for (const g of reads.teamGames.data) {
    const date = g.scheduled_at.substring(0, 10);
    if (!homeTeamSpans.has(date)) homeTeamSpans.set(date, []);
    homeTeamSpans.get(date)!.push(spanOf(g));
    homeTeamDayCounts.set(date, (homeTeamDayCounts.get(date) ?? 0) + 1);
  }

  const params: BuildAvailableSlotsParams = {
    startDate: div.start_date,
    endDate: div.end_date,
    playingDays,
    dayWindows,
    earliestStart: (s.earliest_start as string | undefined) ?? "09:00",
    latestStart: (s.latest_start as string | undefined) ?? "17:00",
    // The gate's own fallbacks, so picker and server agree on the span and gap.
    gameDuration: durationFromSettings(div.settings),
    bufferMinutes: bufferFromRaw(s.buffer_minutes),
    maxPerTeamDay: Math.max(1, Number(s.max_games_per_team_per_day ?? 1) || 1),
    venueIds: [venue.id],
    venueNames: { [venue.id]: fieldName },
    venueAvailability: { [venue.id]: stripMakeup(parseAvailability(venue.availability)) },
    blackoutDates: new Set(reads.blackouts.data.map((b) => b.date)),
    venueBookings,
    homeTeamSpans,
    // The partner team's schedule is not ours to see; its checks match nothing.
    awayTeamSpans: new Map(),
    homeTeamDayCounts,
    awayTeamDayCounts: new Map(),
    homeTeamId: ctx.homeTeamId,
    awayTeamId: "",
    constraintRules: constraintsFromRows(reads.constraints.data),
    ...(ctx.today ? { today: ctx.today } : {}),
  };

  return { ok: true, params, fieldName, divisionName: div.name };
}

// ── Build ────────────────────────────────────────────────────────────────────

export type PickerBuild =
  | Exclude<AssembleResult, { ok: true }>
  | {
      ok: true;
      fieldName: string;
      divisionName: string;
      slots: SlotOption[];
      diagnostics: DayDiagnostics;
      lines: EmptyDayLine[];
      /** No date in range was even examined: the season's last date is before
       *  today. Every examined date yields slots or a diagnostic, so an empty
       *  result with no diagnostics can only mean this. */
      seasonOver: boolean;
    };

export function buildResolvePicker(reads: PickerReads, ctx: PickerContext): PickerBuild {
  const a = assemblePickerInputs(reads, ctx);
  if (!a.ok) return a;
  const { slots, diagnostics } = buildSlotsAndDiagnostics(a.params);
  const lines = emptyDayLines(summarizeByWeekday(diagnostics, slots), {
    fieldName: a.fieldName,
    divisionName: a.divisionName,
    teamName: ctx.homeTeamName,
    playingDays: a.params.playingDays,
  });
  return {
    ok: true,
    fieldName: a.fieldName,
    divisionName: a.divisionName,
    slots,
    diagnostics,
    lines,
    seasonOver: slots.length === 0 && diagnostics.size === 0,
  };
}

// ── Empty-day wording ────────────────────────────────────────────────────────
//
// One line per weekday that produced nothing, in the builder's own terms. There
// is exactly one field here, so every line can name it. The four configuration
// / occupancy reasons are kept DISTINCT on purpose — collapsing them into "no
// slots available" is the failure this exists to prevent (mutant M3).

export type EmptyDayLine = {
  /** Stable key for rendering. */
  key: string;
  /** "Wednesdays", or null for the merged not-a-playing-day line. */
  dayLabel: string | null;
  /** Which reason produced this line — for the sim, never rendered. */
  kind:
    | "not_playing_day"
    | "field_closed"
    | "field_too_short"
    | "day_window_too_short"
    | "occupied_booked"
    | "occupied_team"
    | "blackout"
    | "team_cap";
  /** "config": something is set up so this day can't work (amber).
   *  "info": nothing is misconfigured — the day is taken (grey). */
  tone: "config" | "info";
  text: string;
  /** Show a link to the Venues page (field-hours reasons only). */
  venuesLink: boolean;
};

const DAY_PLURAL: Record<DayKey, string> = {
  Mo: "Mondays", Tu: "Tuesdays", We: "Wednesdays", Th: "Thursdays",
  Fr: "Fridays", Sa: "Saturdays", Su: "Sundays",
};

/** "17:00" → "5pm", "09:30" → "9:30am". */
export function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}

function dates(n: number): string {
  return `${n} ${n === 1 ? "date" : "dates"}`;
}

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export function emptyDayLines(
  summaries: DaySummary[],
  ctx: { fieldName: string; divisionName: string; teamName: string; playingDays: string[] },
): EmptyDayLine[] {
  const plays = new Set(ctx.playingDays);
  const notPlaying: DayKey[] = [];
  const lines: EmptyDayLine[] = [];

  for (const { day, diagnostic: d, dateCount } of summaries) {
    const base = { key: day, dayLabel: DAY_PLURAL[day] };

    if (d.kind === "no_field") {
      // The builder records no_field at the day gate for a day the division
      // does not play, and for a playing day the one field is shut. With
      // makeup flags stripped, playing-day membership is what separates them.
      if (!plays.has(day)) { notPlaying.push(day); continue; }
      lines.push({
        ...base, kind: "field_closed", tone: "config", venuesLink: true,
        text: `${ctx.fieldName} is closed that day.`,
      });
    } else if (d.kind === "window_too_short") {
      const w = d.venues[0];
      lines.push({
        ...base, kind: "field_too_short", tone: "config", venuesLink: true,
        text: w
          ? `${ctx.fieldName} is open ${fmt12(w.start)}–${fmt12(w.end)}, which isn't long enough for this game.`
          : `${ctx.fieldName}'s hours that day aren't long enough for this game.`,
      });
    } else if (d.kind === "day_window_too_short") {
      const { window: w, durationMin } = d;
      const windowTooShort = toMins(w.end) - toMins(w.start) < durationMin;
      lines.push({
        ...base, kind: "day_window_too_short", tone: "config", venuesLink: false,
        text:
          d.governedBy !== "division"
            ? `no start time fits a ${durationMin}-minute game in ${ctx.fieldName}'s hours.`
            : windowTooShort
              ? `${ctx.divisionName}'s game window that day is ${fmt12(w.start)}–${fmt12(w.end)}, which isn't long enough for a ${durationMin}-minute game.`
              : `${ctx.divisionName}'s game window that day (${fmt12(w.start)}–${fmt12(w.end)}) doesn't overlap ${ctx.fieldName}'s hours enough for a ${durationMin}-minute game.`,
      });
    } else if (d.kind === "occupied") {
      const team = d.teamRejections > d.venueBookingRejections;
      lines.push({
        ...base, kind: team ? "occupied_team" : "occupied_booked", tone: "info", venuesLink: false,
        text: team
          ? `${ctx.teamName} already has a game or a scheduling block at every time ${ctx.fieldName} is free (${dates(dateCount)}).`
          : `${ctx.fieldName} is already booked at every time that fits (${dates(dateCount)}).`,
      });
    } else if (d.kind === "blackout") {
      lines.push({
        ...base, kind: "blackout", tone: "info", venuesLink: false,
        text: `blacked out (${dates(dateCount)}).`,
      });
    } else {
      lines.push({
        ...base, kind: "team_cap", tone: "info", venuesLink: false,
        text: `${ctx.teamName} already has a game that day (${dates(dateCount)}).`,
      });
    }
  }

  if (notPlaying.length > 0) {
    // Five identical "doesn't play" rows are noise; one sentence says it.
    lines.push({
      key: "not-playing", dayLabel: null, kind: "not_playing_day", tone: "info", venuesLink: false,
      text: `${ctx.divisionName} doesn't play on ${joinOr(notPlaying.map((d) => DAY_PLURAL[d]))}.`,
    });
  }
  return lines;
}

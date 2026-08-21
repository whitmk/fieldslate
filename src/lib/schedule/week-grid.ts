// Pure derivations for the Schedule page's "week by field" view mode.
//
// Rows are FIELDS, columns are the seven days of one week, cells hold that
// field's games that day. Everything here is pure — no reads, no clock, with
// the single documented exception of `currentWeekStartLocal`.
//
// ── DATE CONVENTION ──────────────────────────────────────────────────────────
// Same wall-clock rule as game-days.ts / availability.ts: a game's day is read
// from the DATE SUBSTRING of its stored ISO wall-clock, never by parsing the
// instant. `games` rows store the admin's intended wall-clock tagged +00, so a
// `new Date(scheduled_at)` parse would roll a late-evening game onto the wrong
// weekday in any non-UTC browser.
//
// Week bucketing REUSES `weekKeyFromIsoDate` rather than defining its own
// Monday. That helper is the house week definition (Sports Connect RoundNo, the
// venue game-days derivation, and the division panel's bye line are the other
// three consumers); a second week definition is exactly the drift CLAUDE.md
// forbids. Date arithmetic here builds `Date` objects from explicit
// year/month/day fields and reads them back with local getters, which is
// timezone-independent — the banned pattern is parsing a stored instant or
// reading the ambient clock on a server, not calendar math.

import { dayKeyFromIsoDate, DAY_KEYS, type DayKey } from "@/lib/venues/availability";
import { weekKeyFromIsoDate } from "@/lib/venues/game-days";
import { fmtGameTime } from "@/lib/utils/game-time";
import type { ScheduleGame } from "@/components/schedule/schedule-list";

/** `?week=` carries the MONDAY of the displayed week as a local date string,
 *  mirroring how calendar mode's `?month=` carries "YYYY-MM". */
export const WEEK_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Normalize a raw `?week=` value to the Monday of the week it falls in, or null
 * when it is missing or malformed.
 *
 * Returning NULL rather than defaulting to "this week" is load-bearing: the
 * only correct answer to "which week is now" depends on the VIEWER's timezone,
 * and this function runs on the server, where the clock is UTC. See
 * `currentWeekStartLocal`.
 */
export function parseWeekParam(raw: string | undefined): string | null {
  if (!raw || !WEEK_PARAM_RE.test(raw)) return null;
  // Snap a hand-typed mid-week date to its Monday, via the shared definition.
  return weekKeyFromIsoDate(raw);
}

/**
 * Monday of the week containing the browser's current local date.
 *
 * CLIENT COMPONENTS ONLY. This is the one function here that reads the ambient
 * clock, and on a server that clock is UTC — which is wrong for every US league
 * for the last 5-8 hours of each day, silently showing next week from ~4pm
 * local. The schedule page therefore never computes a default week; it renders
 * whatever `?week=` says and lets the client fill the param in when absent.
 */
export function currentWeekStartLocal(): string {
  return weekKeyFromIsoDate(localDateStr(new Date()));
}

/** Move a week start forward/back by whole weeks. Pure string in, string out. */
export function shiftWeek(weekStart: string, deltaWeeks: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(y, m - 1, d + deltaWeeks * 7);
  return localDateStr(dt);
}

/** The week's seven local dates, Monday-first — index-aligned with DAY_KEYS
 *  (which is already `["Mo" … "Su"]`), since `weekStart` is always a Monday. */
export function weekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split("-").map(Number);
  return DAY_KEYS.map((_, i) => localDateStr(new Date(y, m - 1, d + i)));
}

/** Half-open range for the games query: `[start 00:00, dayAfterEnd 00:00)`.
 *
 *  The upper bound rolls to the day AFTER Sunday for the same reason the
 *  reschedule picker's occupancy window does: `scheduled_at` is a timestamp, so
 *  a naive `<= sunday` compares against Sunday 00:00 and DROPS every game that
 *  day — a 3:30pm Sunday game is `> 2026-08-23`. */
export function weekRange(weekStart: string): {
  startDate: string;
  dayAfterEnd: string;
} {
  const dates = weekDates(weekStart);
  return { startDate: dates[0], dayAfterEnd: shiftWeek(weekStart, 1) };
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Aug 17 – 23, 2026" / "Aug 31 – Sep 6, 2026" / spanning a year boundary,
 *  "Dec 28, 2026 – Jan 3, 2027". Formatted from string parts rather than
 *  `toLocaleDateString`, matching game-time.ts's header: locale formatting
 *  varies between the Node and browser ICU builds and tears hydration. */
export function weekLabel(weekStart: string): string {
  const dates = weekDates(weekStart);
  const [ys, ms, ds] = dates[0].split("-").map(Number);
  const [ye, me, de] = dates[6].split("-").map(Number);
  const start = `${MONTHS_SHORT[ms - 1]} ${ds}`;
  const end = me === ms && ye === ys ? `${de}` : `${MONTHS_SHORT[me - 1]} ${de}`;
  if (ye !== ys) return `${start}, ${ys} – ${end}, ${ye}`;
  return `${start} – ${end}, ${ye}`;
}

// ── Time range ───────────────────────────────────────────────────────────────

function minutesToLabel(mins: number): string {
  // Wrap past midnight rather than rendering "25:00" — a late game plus its
  // duration can legitimately cross the day boundary.
  const wrapped = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${pad2(m)} ${period}`;
}

/**
 * True when a block will render its START TIME ALONE because no usable duration
 * reached it. Exported so a caller (and the harness's anti-vacuity counter)
 * asks the SAME predicate the renderer uses, rather than re-deriving "is it
 * undefined" and drifting from it.
 *
 * Finite-and-positive, never `typeof` — mirroring `isUsableDuration` in
 * detect-conflicts.ts, where NaN passing a typeof check collapses a span to
 * zero length and silently matches nothing.
 */
export function rendersStartOnly(durationMin?: number): boolean {
  return !hasUsableDuration(durationMin);
}

/** Finite AND positive. A type predicate so the renderer narrows off the same
 *  check the counter asks. */
function hasUsableDuration(v: number | undefined): v is number {
  return v !== undefined && Number.isFinite(v) && v > 0;
}

/**
 * "9:00 AM – 10:30 AM", or just "9:00 AM" when the duration is unresolved.
 *
 * NEVER `?? 0` AND NEVER A 90-MINUTE FALLBACK. `durationMin` is finite-and-
 * positive or absent (see ScheduleGame.durationMin); when it is absent the
 * honest render is the start time alone. Inventing an end time would put a
 * number a league could schedule against on screen with nothing behind it, and
 * coercing to 0 would render "9:00 AM – 9:00 AM", which reads as real data.
 * This view has exactly these two states and adds no third duration policy.
 */
export function fmtTimeRange(iso: string, durationMin?: number): string {
  const start = fmtGameTime(iso);
  if (!hasUsableDuration(durationMin)) return start;
  const [h, m] = iso.substring(11, 16).split(":").map(Number);
  return `${start} – ${minutesToLabel(h * 60 + m + durationMin)}`;
}

// ── Matchup label ────────────────────────────────────────────────────────────

/**
 * "Home vs Away" for a cell block.
 *
 * FOURTH COPY, DELIBERATE AND SCOPED. schedule-list, schedule-calendar and
 * schedule-print-region each carry their own private version; print-region's
 * header already acknowledges that duplication. Unifying all four is a real
 * change with three surfaces to re-verify and is out of scope here. The
 * DRIFT HAZARD is the interleague branches — if one copy's interleague wording
 * changes, change them together or accept that they differ.
 *
 * The `is_away` branch the other copies carry is deliberately absent: an away
 * interleague game has `venue_id` null, so it can never reach a field row.
 */
export function weekMatchupLabel(g: ScheduleGame): string {
  const home = g.home_team?.name ?? "TBD";
  if (g.away_team?.name) return `${home} vs ${g.away_team.name}`;
  if (g.interleague_org_id) {
    const orgName = g.interleague_org?.name ?? "Other org";
    const team = g.external_team_name?.trim();
    return `${home} vs ${team ? team : `TBD — ${orgName}`}`;
  }
  return `${home} vs TBD`;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** A venue as it arrives from the eligibility read or from a game's embed. */
export type WeekVenueInput = {
  venueId: string;
  name: string;
  locationName: string | null;
};

export type WeekRow = WeekVenueInput;

/**
 * The grid's row set: venues flagged `division_venues.allow_games` for a
 * division in this season, UNIONed with any venue carrying ANY game in the
 * displayed week — every status, cancelled and pending_interleague included.
 *
 * THE UNION ARM IS DEFENCE, not decoration: a venue whose eligibility was
 * unticked after its games were scheduled must not silently drop real games off
 * the grid. It is keyed on the game rows themselves, so it cannot disagree with
 * what the cells render.
 *
 * DELIBERATELY NOT SHARED WITH THE REPORTS VENUES x DIVISIONS MATRIX. That
 * derivation looks almost identical and answers a different question: it is
 * season-wide, DIVISION-keyed, and filters through `countsAsScheduledGame`
 * (excluding cancelled and pending_interleague). This one is week-scoped,
 * FIELD-keyed, and includes every status precisely because a cancelled or
 * pending game still tells an admin something about that field's week. Merging
 * them would force one of the two to answer the other's question. Keep them
 * apart; see CLAUDE.md.
 *
 * SORT: location name (nulls LAST), then venue name — chosen, not emergent, so
 * a park's fields cluster while location-less venues collect at the bottom
 * instead of sorting under an empty string.
 */
export function buildWeekRows(
  eligible: WeekVenueInput[],
  games: ScheduleGame[],
): WeekRow[] {
  const byId = new Map<string, WeekRow>();
  for (const v of eligible) byId.set(v.venueId, v);
  for (const g of games) {
    if (!g.venue_id || byId.has(g.venue_id)) continue;
    byId.set(g.venue_id, {
      venueId: g.venue_id,
      name: g.venue?.name ?? "Unknown field",
      locationName: g.venue?.location?.name ?? null,
    });
  }
  return [...byId.values()].sort((a, b) => {
    if (a.locationName !== b.locationName) {
      if (a.locationName === null) return 1; // nulls last
      if (b.locationName === null) return -1;
      const byLoc = a.locationName.localeCompare(b.locationName);
      if (byLoc !== 0) return byLoc;
    }
    return a.name.localeCompare(b.name);
  });
}

// ── Cells ────────────────────────────────────────────────────────────────────

/** Cell key: `${venueId}|${dayKey}`. */
export function cellKey(venueId: string, day: DayKey): string {
  return `${venueId}|${day}`;
}

/**
 * Games bucketed into (field, day-of-week) cells, each cell ordered by start
 * time then id (a stable tiebreak — games routinely share a start time).
 *
 * Games are matched against the week's SEVEN DATES before their day column is
 * taken. The date filter is not redundant with the query's range narrowing: it
 * also guarantees correctness when the caller has not narrowed at all, which is
 * exactly the state on a first render before `?week=` has been resolved. Column
 * choice still goes through `dayKeyFromIsoDate` — the wall-clock substring.
 *
 * Null-venue games (interleague AWAY) are dropped: they are played at the
 * partner's field, which this grid has no row for. Correct, not a gap.
 */
export function bucketWeekGames(
  games: ScheduleGame[],
  weekStart: string,
): Map<string, ScheduleGame[]> {
  const inWeek = new Set(weekDates(weekStart));
  const out = new Map<string, ScheduleGame[]>();
  for (const g of games) {
    if (!g.venue_id) continue;
    if (!inWeek.has(g.scheduled_at.substring(0, 10))) continue;
    const key = cellKey(g.venue_id, dayKeyFromIsoDate(g.scheduled_at));
    const bucket = out.get(key);
    if (bucket) bucket.push(g);
    else out.set(key, [g]);
  }
  for (const bucket of out.values()) {
    bucket.sort((a, b) => {
      const t = a.scheduled_at
        .substring(11, 16)
        .localeCompare(b.scheduled_at.substring(11, 16));
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
  }
  return out;
}

/** Away interleague games in the displayed week — counted only so the grid can
 *  SAY they are missing rather than leave an admin hunting for them. */
export function countAwayGamesInWeek(
  games: ScheduleGame[],
  weekStart: string,
): number {
  const inWeek = new Set(weekDates(weekStart));
  return games.filter(
    (g) => !g.venue_id && inWeek.has(g.scheduled_at.substring(0, 10)),
  ).length;
}

// ── Render decisions ─────────────────────────────────────────────────────────
//
// These two live here rather than inside the component for one reason: they are
// the decisions most likely to be silently wrong, and a harness cannot drive
// JSX. The component calls exactly these — there is no second copy.

/**
 * The blocks one cell renders for a given "Show cancelled" state.
 *
 * IT HIDES BLOCKS, NEVER ROWS. Rows come from `buildWeekRows`, which never sees
 * this flag, so a field whose only game this week is cancelled KEEPS its row —
 * empty — when the toggle is off. That separation is the whole safety property:
 * a display toggle must not restructure the grid, because a field silently
 * vanishing reads as "this field has nothing on it", which is the opposite of
 * what a cancelled game means. Do not move this filter into `buildWeekRows`,
 * and do not route it through the query.
 */
export function visibleBlocks(
  cell: ScheduleGame[],
  showCancelled: boolean,
): ScheduleGame[] {
  return showCancelled ? cell : cell.filter((g) => g.status !== "cancelled");
}

/** Which markers a block carries. Mutually exclusive by construction:
 *  a pending interleague game is labelled "pending interleague", not both. */
export type BlockMarkers = {
  cancelled: boolean;
  pending: boolean;
  interleague: boolean;
};

/**
 * A pending interleague game genuinely OCCUPIES the field — the reschedule
 * picker's occupancy read counts it — so this grid shows and labels it. Note
 * that `countsAsScheduledGame` EXCLUDES it and this view deliberately
 * disagrees: that predicate answers "is this a real scheduled game" for exports
 * and reports, while this grid answers "is this field spoken for".
 */
export function blockMarkers(g: ScheduleGame): BlockMarkers {
  const pending = g.status === "pending_interleague";
  return {
    cancelled: g.status === "cancelled",
    pending,
    interleague: !!g.interleague_org_id && !pending,
  };
}

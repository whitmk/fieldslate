// Honest skip-reason attribution for the schedule generator.
//
// WHY THIS EXISTS
// ───────────────
// The placement walk used to record exactly one cause bit (constraintRejected).
// Every other abandonment — weekly cap, daily cap, venue collision, coach
// block, empty pool — landed in an undifferentiated unscheduledCount, and the
// UI hard-coded the interpretation ("Not enough slots. Try extending dates,
// adding venues…"). That copy was wrong twice in one day: once the real cause
// was a weekly-cap corner the greedy painted itself into, once a venue
// availability window an hour short of what the division needed. Both times it
// pointed at venue capacity and sent the admin investigating the wrong thing.
//
// TWO DESIGN RULES, BOTH LOAD-BEARING
// ───────────────────────────────────
// 1. ATTRIBUTION RUNS AFTER ABANDONMENT, NOT INLINE.
//    The walk short-circuits (`continue`) on the first failing filter, so
//    inline per-slot counters would be biased by chain ORDER: the first filter
//    checked takes credit for every slot the later filters would also have
//    rejected. (Today's constraint attribution is honest only because the
//    constraint check sits LAST — see the comment in generate-schedule.ts.)
//    Instead, `tallyRejections` runs only for matchups that already failed,
//    evaluates every filter INDEPENDENTLY with no short-circuit, and mutates
//    nothing. Cost is zero on the success path and placement cannot move.
//
// 2. ARITHMETIC ONLY WHERE AN INDEPENDENT CONFIG-LEVEL COMPUTATION PROVES A
//    SHORTFALL. A dominant cause tells you WHICH filter bit; it does not tell
//    you by HOW MUCH, because a filter can bite from pure greedy cascade on a
//    perfectly feasible config. So every gap number here is derived from
//    settings + venue hours + slot supply ALONE, never from the walk. When
//    that computation says the config is feasible, we report cause and count
//    with NO number — see `describeShortfall`. A fabricated gap in exactly the
//    scenario this module exists to fix would be worse than the old message.
//
// NO LEVER RECOMMENDATIONS. Widening a window, shortening a buffer, and adding
// a field can all close the same gap, and which is right depends on facts the
// code does not have (whether the city will grant earlier field time). Name the
// gap; let the admin pick the lever. Nothing in this file may suggest one.

import {
  violatesHardConstraint,
  type TeamConstraintRule,
} from "./team-constraints";
import {
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";

// Full day names — the shortfall sentence is prose, so the abbreviated
// DAY_LABELS ("Sat") would read as "open 09:00–17:00 on Sats".
const DAY_FULL: Record<DayKey, string> = {
  Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday",
  Fr: "Friday", Sa: "Saturday", Su: "Sunday",
};

// ─── Filters ───────────────────────────────────────────────────────────────────

// One entry per filter in the slot-walk chain, in chain order. `prefer` is
// deliberately absent: it never blocks (pass 2 ignores it), so it can never be
// the cause of an abandonment.
export type RejectionFilter =
  | "venue_booking"
  | "org_field_cap"
  | "team_time"
  | "daily_cap"
  | "weekly_cap"
  | "coach_block"
  | "team_constraint";

export const REJECTION_FILTERS: RejectionFilter[] = [
  "venue_booking",
  "org_field_cap",
  "team_time",
  "daily_cap",
  "weekly_cap",
  "coach_block",
  "team_constraint",
];

// User-facing filter names. Plain English, no jargon, no lever attached.
const FILTER_LABELS: Record<RejectionFilter, string> = {
  venue_booking: "field availability",
  org_field_cap: "the partner league's field limit",
  team_time: "teams already playing at those times",
  daily_cap: "the games-per-day limit",
  weekly_cap: "the weekly game limit",
  coach_block: "shared-coach conflicts",
  team_constraint: "team scheduling constraints",
};

export type RejectionTally = Record<RejectionFilter, number>;

export function emptyTally(): RejectionTally {
  return {
    venue_booking: 0,
    org_field_cap: 0,
    team_time: 0,
    daily_cap: 0,
    weekly_cap: 0,
    coach_block: 0,
    team_constraint: 0,
  };
}

// ─── Aggregate result ──────────────────────────────────────────────────────────

export interface PlacementDiagnostics {
  /** Unplaced matchups whose slot pool was empty before the walk began — a
   *  distinct terminal case from "every slot was rejected". */
  emptyPool: number;
  /** Unplaced matchups attributed to each filter (one dominant cause each). */
  byCause: RejectionTally;
  /** Unplaced matchups where two or more filters tied for most rejections. */
  ambiguous: number;
}

export function emptyDiagnostics(): PlacementDiagnostics {
  return { emptyPool: 0, byCause: emptyTally(), ambiguous: 0 };
}

/**
 * Per-matchup dominant cause: the filter that rejected the most slots. A tie
 * for the top spot is `null` (ambiguous) — picking arbitrarily between two
 * equally-responsible filters is exactly the confidently-wrong answer this
 * module exists to end.
 */
export function dominantFilter(tally: RejectionTally): RejectionFilter | null {
  let best: RejectionFilter | null = null;
  let bestN = 0;
  let tied = false;
  for (const f of REJECTION_FILTERS) {
    const n = tally[f];
    if (n > bestN) {
      best = f;
      bestN = n;
      tied = false;
    } else if (n === bestN && n > 0) {
      tied = true;
    }
  }
  if (bestN === 0 || tied) return null;
  return best;
}

/** Folds one abandoned matchup's tally into the aggregate. */
export function recordAbandonment(
  diag: PlacementDiagnostics,
  tally: RejectionTally,
): void {
  const cause = dominantFilter(tally);
  if (cause === null) diag.ambiguous++;
  else diag.byCause[cause]++;
}

// ─── The read-only diagnostic pass ─────────────────────────────────────────────

// Structural mirror of the planner's internal Slot — kept local so this module
// has no dependency on generate-schedule.ts (which is a "use client" module).
export interface DiagnosticSlot {
  isoString: string;
  venueId: string;
  date: string;
  weekKey: string;
}

export interface DiagnosticMatchup {
  homeId: string;
  awayId: string | null;
  interleagueOrgId: string | null;
  isAway: boolean;
}

/** Read-only view of the planner's booking state at abandonment time. */
export interface DiagnosticState {
  venueBookings: Map<string, number[]>;
  teamTimes: Map<string, Set<string>>;
  teamDay: Map<string, number>;
  teamWeek: Map<string, number>;
  awayByOrgDate: Map<string, number>;
  blocked: Map<string, Set<string>>;
  constraintRules: Map<string, TeamConstraintRule[]>;
  orgFieldCount: Map<string, number>;
  minVenueGap: number;
  maxPerTeamDay: number;
  maxGamesPerWeek: number;
}

/**
 * Tallies, for one already-abandoned matchup, how many slots each filter would
 * reject — every filter evaluated INDEPENDENTLY (no short-circuit), so the
 * counts are not biased by the walk's chain order.
 *
 * STRICTLY READ-ONLY. It reads the same maps the walk mutates and writes to
 * none of them. Mirrors pass-2 semantics (hard filters only), which is the
 * pass a matchup is abandoned out of.
 */
export function tallyRejections(
  matchup: DiagnosticMatchup,
  pool: DiagnosticSlot[],
  st: DiagnosticState,
): RejectionTally {
  const { homeId, awayId, interleagueOrgId, isAway } = matchup;
  const tally = emptyTally();

  for (const slot of pool) {
    const slotMins = timeToMinutes(slot.isoString.substring(11, 16));

    if (!isAway) {
      const booked = st.venueBookings.get(`${slot.venueId}:${slot.date}`) ?? [];
      if (booked.some((t) => Math.abs(t - slotMins) < st.minVenueGap)) {
        tally.venue_booking++;
      }
    } else if (interleagueOrgId) {
      const cap = st.orgFieldCount.get(interleagueOrgId) ?? 1;
      const used = st.awayByOrgDate.get(`${interleagueOrgId}|${slot.date}`) ?? 0;
      if (used >= cap) tally.org_field_cap++;
    }

    if (
      st.teamTimes.get(homeId)?.has(slot.isoString) ||
      (awayId !== null && st.teamTimes.get(awayId)?.has(slot.isoString))
    ) {
      tally.team_time++;
    }

    const hDay = st.teamDay.get(`${homeId}|${slot.date}`) ?? 0;
    const aDay = awayId ? st.teamDay.get(`${awayId}|${slot.date}`) ?? 0 : 0;
    if (hDay >= st.maxPerTeamDay || (awayId !== null && aDay >= st.maxPerTeamDay)) {
      tally.daily_cap++;
    }

    const hWeek = st.teamWeek.get(`${homeId}|${slot.weekKey}`) ?? 0;
    const aWeek = awayId ? st.teamWeek.get(`${awayId}|${slot.weekKey}`) ?? 0 : 0;
    if (hWeek >= st.maxGamesPerWeek || (awayId !== null && aWeek >= st.maxGamesPerWeek)) {
      tally.weekly_cap++;
    }

    if (
      st.blocked.get(homeId)?.has(slot.isoString) ||
      (awayId !== null && st.blocked.get(awayId)?.has(slot.isoString))
    ) {
      tally.coach_block++;
    }

    if (
      violatesHardConstraint(st.constraintRules, homeId, slot.isoString) ||
      (awayId !== null && violatesHardConstraint(st.constraintRules, awayId, slot.isoString))
    ) {
      tally.team_constraint++;
    }
  }

  return tally;
}

// ─── Config-level supply arithmetic ────────────────────────────────────────────
//
// WHICH FILTERS CARRY ARITHMETIC — and why the others deliberately do not.
//
// CARRY A NUMBER (an independent config-level computation can prove the gap):
//   • venue_booking  → via the VENUE WINDOW supply analysis below. Note the
//                      venue window is NOT a walk filter at all: isVenueAvailable
//                      runs inside buildSlots, so a too-short window yields a
//                      SMALLER SLOT POOL and then shows up in the walk as venue
//                      collisions. A walk counter for it would read zero in
//                      exactly the case that misleads. Hence supply-side.
//   • weekly_cap     → games per team vs. playing weeks × cap.
//   • daily_cap      → games per team vs. playing dates × cap.
//   • org_field_cap  → away games needed vs. partner field count × dates.
//
// NEVER CARRY A NUMBER (any gap would be fabricated):
//   • team_time      → pure cascade of prior placements; no meaningful unit.
//   • coach_block    → determined by ANOTHER division's already-persisted
//                      schedule, which this run does not control.
//   • team_constraint→ windows are arbitrary per-team sets; a single "gap"
//                      would collapse unrelated rules into one invented number.
//
// AND THE CAVEAT THAT MATTERS MOST: even for the four that can carry a number,
// the number is emitted ONLY when the config-level computation shows a genuine
// shortfall. When weeks × cap >= games per team and the weekly cap still
// dominates, the config is feasible and the games stranded behind already-placed
// ones — there is no gap to report, and inventing one would misdirect exactly
// as the old copy did.

export interface ShortfallContext {
  /** Games each team is scheduled to play (division setting). */
  gamesPerTeam: number;
  maxGamesPerWeek: number;
  maxPerTeamDay: number;
  /** Distinct dates buildSlots considered (playing days, minus blackouts/byes). */
  playingDates: string[];
  /** Home (venue-claiming) matchups this run tried to place. */
  homeMatchupCount: number;
  /** Away-interleague matchups per partner org id. */
  awayMatchupsByOrg: Map<string, number>;
  orgFieldCount: Map<string, number>;
  orgNames: Map<string, string>;
  /** The real slot pool — supply is COUNTED from it, never re-derived. */
  slots: DiagnosticSlot[];
  venueAvailability: Map<string, VenueAvailability>;
  venueNames: Map<string, string>;
  /** Division per-day windows, already resolved against the legacy fallback. */
  dayWindow: (day: DayKey) => { start: string; end: string };
  gameDuration: number;
  bufferMinutes: number;
}

// ─── Wording ───────────────────────────────────────────────────────────────────

/**
 * The single source of the shortfall sentence. Every surface renders this
 * string verbatim — same rule as the schedule-lock wording helpers: never
 * hand-write a shortfall sentence at a call site.
 *
 * Returns null when nothing went unplaced.
 */
export function describeShortfall(
  diag: PlacementDiagnostics,
  ctx: ShortfallContext,
): string | null {
  const total =
    diag.emptyPool +
    diag.ambiguous +
    REJECTION_FILTERS.reduce((n, f) => n + diag.byCause[f], 0);

  if (total === 0) return null;

  const games = (n: number) => `${n} game${n === 1 ? "" : "s"}`;

  // Empty pool is a terminal case, not a filter — report it on its own when it
  // accounts for a majority.
  if (diag.emptyPool * 2 > total) {
    return `${diag.emptyPool} of ${games(total)} that couldn't be placed had no candidate times at all — no field is open during this division's playing days and hours.`;
  }

  // Dominance requires a strict majority. "9 of 20" is not a dominant cause,
  // and naming it as one would be the arbitrary pick we're avoiding.
  let top: RejectionFilter | null = null;
  let topN = 0;
  for (const f of REJECTION_FILTERS) {
    if (diag.byCause[f] > topN) {
      top = f;
      topN = diag.byCause[f];
    }
  }

  if (top === null || topN * 2 <= total) {
    const largest =
      top === null
        ? ""
        : ` The largest single cause was ${FILTER_LABELS[top]} (${topN}).`;
    return `No single cause dominated the ${games(total)} that couldn't be placed.${largest}`;
  }

  const headline = `${topN} of ${games(total)} that couldn't be placed were blocked by ${FILTER_LABELS[top]}.`;
  const detail = gapDetail(top, ctx);
  return detail ? `${headline} ${detail}` : headline;
}

/**
 * The arithmetic, in the rejecting filter's own units — or null when no
 * config-level shortfall is provable. Null is the CORRECT answer for a
 * feasible config whose games stranded behind earlier placements; see the
 * caveat above.
 */
function gapDetail(filter: RejectionFilter, ctx: ShortfallContext): string | null {
  switch (filter) {
    case "weekly_cap":
      return weeklyCapGap(ctx);
    case "daily_cap":
      return dailyCapGap(ctx);
    case "org_field_cap":
      return orgFieldCapGap(ctx);
    case "venue_booking":
      return venueWindowGap(ctx);
    // team_time, coach_block and team_constraint deliberately carry no
    // arithmetic — see the block comment above. Do not add one.
    default:
      return null;
  }
}

function weeklyCapGap(ctx: ShortfallContext): string | null {
  const weeks = new Set(ctx.slots.map((s) => s.weekKey)).size;
  if (weeks === 0 || ctx.maxGamesPerWeek <= 0 || ctx.gamesPerTeam <= 0) return null;
  const room = weeks * ctx.maxGamesPerWeek;
  if (room >= ctx.gamesPerTeam) {
    // Feasible config — the cap bit from cascade, not from a shortage.
    return `The season has room for ${room} game${room === 1 ? "" : "s"} per team at this limit, which covers the ${ctx.gamesPerTeam} each team is set to play — these games stranded behind ones already placed, not against a season-wide shortage.`;
  }
  return `Each team is set to play ${ctx.gamesPerTeam} games, but the season has ${weeks} playing week${weeks === 1 ? "" : "s"} at ${ctx.maxGamesPerWeek} per week — room for ${room}, short by ${ctx.gamesPerTeam - room}.`;
}

function dailyCapGap(ctx: ShortfallContext): string | null {
  const dates = ctx.playingDates.length;
  if (dates === 0 || ctx.maxPerTeamDay <= 0 || ctx.gamesPerTeam <= 0) return null;
  const room = dates * ctx.maxPerTeamDay;
  if (room >= ctx.gamesPerTeam) {
    return `The season has room for ${room} game${room === 1 ? "" : "s"} per team at this limit, which covers the ${ctx.gamesPerTeam} each team is set to play — these games stranded behind ones already placed, not against a season-wide shortage.`;
  }
  return `Each team is set to play ${ctx.gamesPerTeam} games, but the season has ${dates} playing date${dates === 1 ? "" : "s"} at ${ctx.maxPerTeamDay} per day — room for ${room}, short by ${ctx.gamesPerTeam - room}.`;
}

function orgFieldCapGap(ctx: ShortfallContext): string | null {
  const dates = new Set(ctx.slots.map((s) => s.date)).size;
  if (dates === 0) return null;

  // Report the single worst partner — a list of orgs is as unhelpful as a list
  // of causes.
  let worstOrg: string | null = null;
  let worstShort = 0;
  let worstNeeded = 0;
  let worstRoom = 0;
  for (const [orgId, needed] of ctx.awayMatchupsByOrg) {
    const cap = ctx.orgFieldCount.get(orgId) ?? 1;
    const room = cap * dates;
    if (needed - room > worstShort) {
      worstShort = needed - room;
      worstOrg = orgId;
      worstNeeded = needed;
      worstRoom = room;
    }
  }
  if (!worstOrg) return null;

  const name = ctx.orgNames.get(worstOrg) ?? "the partner league";
  const cap = ctx.orgFieldCount.get(worstOrg) ?? 1;
  return `${worstNeeded} away game${worstNeeded === 1 ? "" : "s"} are needed at ${name}, which lists ${cap} field${cap === 1 ? "" : "s"} across ${dates} playing date${dates === 1 ? "" : "s"} — room for ${worstRoom}, short by ${worstShort}.`;
}

/**
 * Venue-window supply, for the venue_booking cause.
 *
 * Supply is COUNTED from the real slot pool (never re-derived), then the
 * per-field narration is recomputed and CHECKED against that count. If the two
 * disagree — mixed per-venue windows, or the legacy
 * max_games_per_field_per_day path — the narration is suppressed and we fall
 * back to cause-and-count. A number we cannot reproduce from the real pool is
 * exactly the fabricated gap this module refuses to print.
 */
function venueWindowGap(ctx: ShortfallContext): string | null {
  if (!ctx.slots.length || ctx.homeMatchupCount <= 0) return null;

  const interval = Math.max(1, ctx.gameDuration + ctx.bufferMinutes);
  if (ctx.gameDuration <= 0) return null;

  // Slots per date, and the day-of-week each date falls on.
  const byDate = new Map<string, number>();
  for (const s of ctx.slots) byDate.set(s.date, (byDate.get(s.date) ?? 0) + 1);

  const dates = [...byDate.keys()].sort();
  const totalDates = ctx.playingDates.length || dates.length;
  const supplyTotal = ctx.slots.length;

  // Demand is home (venue-claiming) games only — away-interleague games claim
  // no slot here.
  if (supplyTotal >= ctx.homeMatchupCount) return null;

  const demandPerDate = Math.ceil(ctx.homeMatchupCount / totalDates);

  // Narrate the binding day: the date with the fewest slots.
  let tightestDate = dates[0];
  for (const d of dates) {
    if ((byDate.get(d) ?? 0) < (byDate.get(tightestDate) ?? 0)) tightestDate = d;
  }
  const dayKey = dayKeyOf(tightestDate);
  const win = ctx.dayWindow(dayKey);
  const supplyThatDate = byDate.get(tightestDate) ?? 0;

  // Which venues are open that day, and do they all share one window? Mixed
  // windows make a single "starts per field" figure untrue.
  const openVenues: string[] = [];
  let sharedStart: number | null = null;
  let sharedEnd: number | null = null;
  let mixed = false;
  for (const [vid, av] of ctx.venueAvailability) {
    const w = av[dayKey];
    if (!w) continue;
    openVenues.push(vid);
    const s = timeToMinutes(w.start);
    const e = timeToMinutes(w.end);
    if (sharedStart === null) {
      sharedStart = s;
      sharedEnd = e;
    } else if (sharedStart !== s || sharedEnd !== e) {
      mixed = true;
    }
  }
  if (mixed || sharedStart === null || sharedEnd === null || !openVenues.length) {
    return null;
  }

  // Effective start window: the tighter of division and venue, with the game
  // required to FINISH inside the venue window (isVenueAvailable's rule).
  const wStart = Math.max(timeToMinutes(win.start), sharedStart);
  const wEnd = Math.min(timeToMinutes(win.end), sharedEnd - ctx.gameDuration);
  if (wEnd < wStart) return null;

  const startsPerField = Math.floor((wEnd - wStart) / interval) + 1;

  // Reproduce-or-stay-silent: the narration must match the real pool exactly.
  if (startsPerField * openVenues.length !== supplyThatDate) return null;

  const neededPerField = Math.ceil(demandPerDate / openVenues.length);
  if (neededPerField <= startsPerField) return null;

  const shortMinutes = (neededPerField - 1) * interval - (wEnd - wStart);
  if (shortMinutes <= 0) return null;

  const venueLabel =
    openVenues.length === 1
      ? ctx.venueNames.get(openVenues[0]) ?? "The assigned field"
      : `${openVenues.length} fields`;
  const dayName = DAY_FULL[dayKey];
  const fieldWord = openVenues.length === 1 ? "field" : "fields";

  return `${venueLabel} ${openVenues.length === 1 ? "is" : "are"} open ${fmtHHMM(sharedStart)}–${fmtHHMM(sharedEnd)} on ${dayName}s. With ${ctx.gameDuration}-minute games plus a ${ctx.bufferMinutes}-minute buffer, that fits ${startsPerField} start${startsPerField === 1 ? "" : "s"} per ${fieldWord} — ${supplyThatDate} game${supplyThatDate === 1 ? "" : "s"} per ${dayName}. This division needs ${demandPerDate}. The window is ${fmtDuration(shortMinutes)} short of fitting ${neededPerField} start${neededPerField === 1 ? "" : "s"} per ${fieldWord}.`;
}

// ─── Local pure helpers ────────────────────────────────────────────────────────

const JS_TO_DAY_KEY: Record<number, DayKey> = {
  0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa",
};

function dayKeyOf(isoDate: string): DayKey {
  return JS_TO_DAY_KEY[new Date(`${isoDate}T00:00:00`).getDay()];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fmtHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h}h ${m}m`;
}

// Re-exported for the harness's independent recount.
export const __testing = { timeToMinutes, fmtDuration, dayKeyOf };

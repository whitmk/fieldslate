// Derived venue game-days-of-week.
//
// A venue's "game days" are computed from ACTUAL scheduled games, never from
// wizard/division config (config's playing_days × division_venues.allow_games
// is a proven-too-broad superset — it says a game COULD land here, not that one
// DOES). The honest source is the `games` table.
//
// CLIENT-SIDE ONLY, same stance as eligibility.ts / availability.ts: every
// day-of-week and week bucket is read from the DATE SUBSTRING of the stored ISO
// wall-clock (via dayKeyFromIsoDate), never by parsing the instant. `games`
// rows store the admin's intended wall-clock tagged +00 (e.g.
// "2026-10-24T09:00:00+00" = a 9am Saturday game); a `new Date(scheduled_at)`
// parse would roll a late-evening game to the wrong weekday in any non-UTC
// browser. Do NOT reintroduce instant parsing here. If this is ever needed
// server-side, it must grow an explicit timezone parameter first.

import { dayKeyFromIsoDate, type DayKey } from "./availability";

/** The `games` columns this derivation needs. */
export type GameDayInput = {
  venue_id: string | null;
  scheduled_at: string; // ISO wall-clock, e.g. "2026-10-24T09:00:00+00:00"
  status: string;
};

// Statuses that must NOT count as a real, scheduled game:
//   cancelled           — the game was called off.
//   pending_interleague — an unconfirmed interleague proposal, not a real game.
// Everything else (scheduled, completed, …) counts.
//
// Exported so any other games-derived view (e.g. the Reports venues×divisions
// matrix) shares the exact same exclusion set — the two must never drift.
export const NON_COUNTING_STATUSES = new Set([
  "cancelled",
  "pending_interleague",
]);

/** True when a game row counts as a real, scheduled game (not cancelled or a
 *  pending interleague proposal). The single predicate every games-derived
 *  view should filter on.
 *
 *  DRIFT HAZARD — read before "simplifying" against `teamIsOccupiedThisWeek`
 *  below. They are NOT synonyms and must not be merged. This one applies a
 *  STATUS FILTER (excludes cancelled and pending_interleague) because it feeds
 *  views that report real, played/scheduled games — venue game-days, Sports
 *  Connect, Reports. `teamIsOccupiedThisWeek` deliberately applies NO status
 *  filter, because "is this team free" is a different question from "is this a
 *  real game": a cancelled or pending row still means the team might be
 *  playing. Do not route the bye computation through this function, and do not
 *  give the other one a status filter to match this one. */
export function countsAsScheduledGame(status: string): boolean {
  return !NON_COUNTING_STATUSES.has(status);
}

/** True when a game row makes a team OCCUPIED for its week — i.e. the row
 *  should prevent that team from being listed as on bye.
 *
 *  It IGNORES status ON PURPOSE — this is not an unfinished helper. A team is on
 *  bye for a week only if it has ZERO game rows of ANY status that week, so any
 *  row at all occupies the team. The named seam is kept because the reason is
 *  worth stating at the call site: this line answers "is it safe to move a game
 *  onto this team this week," and for that question "might be playing" must
 *  never read as free. A cancelled game (awaiting a makeup) and a
 *  pending_interleague proposal (an invite that may yet be accepted) both mean
 *  the team might have a commitment — so both occupy the week. Contrast
 *  `countsAsScheduledGame` above, which DOES filter status; do not add a status
 *  filter here to "match" it. The `status` param is intentionally unread — it
 *  documents that status was considered and deliberately not consulted, and
 *  keeps the call site reading `teamIsOccupiedThisWeek(g.status)`. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- see above: status is deliberately unread
export function teamIsOccupiedThisWeek(status: string): boolean {
  return true;
}

// A day-of-week only becomes a recurring "game day" once games land on it in at
// least this many DISTINCT calendar weeks at the venue. This suppresses a
// one-off makeup/rainout game from flagging an entire weekday all season — a
// single stray Monday game must not make every Monday a game day.
export const GAME_DAY_WEEK_THRESHOLD = 2;

/** day-of-week → number of distinct weeks that day hosts games (the "N" shown
 *  as "…on N Saturdays this season"). Only days meeting the threshold appear. */
export type VenueGameDays = Map<DayKey, number>;

/** Monday-of-week local date key for the date portion of an ISO wall-clock.
 *  Same substring/local-midnight convention as dayKeyFromIsoDate — never parses
 *  the instant, so it cannot roll across a timezone boundary. Exported so the
 *  Sports Connect export's RoundNo shares the exact same week bucketing. */
export function weekKeyFromIsoDate(iso: string): string {
  const d = new Date(iso.substring(0, 10) + "T00:00:00");
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Mon=0 … Sun=6 back to Monday
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const day = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Minimal game shape the bye computation needs. Deliberately structural (not
 *  the panel's GameRow) so this stays a pure, testable helper. */
export type ByeGameInput = {
  scheduled_at: string; // ISO wall-clock, e.g. "2026-10-24T09:00:00+00:00"
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
};

/** Minimal team shape: id (identity) + name (display). */
export type ByeTeamInput = { id: string; name: string };

/**
 * For each week that has AT LEAST ONE game row, the teams on bye that week
 * (sorted by name). Keyed by `weekKeyFromIsoDate` (the same Monday-start,
 * wall-clock-substring bucket Sports Connect's RoundNo and the venue game-days
 * derivation use — never a second week definition).
 *
 * A team is on bye for a week when it has ZERO rows that week, where a row
 * occupies a team's week iff the team is its `home_team_id` OR `away_team_id`.
 * Status is NOT consulted — any row (scheduled, cancelled, or
 * pending_interleague) means the team might be playing, so it is not free (see
 * `teamIsOccupiedThisWeek`'s header for why this line treats "might be playing"
 * as occupied).
 *
 * Weeks with no game rows never appear here (nothing to key them off, and the
 * panel renders no day-group for them — accepted for v1). Callers MUST pass the
 * FULL division game set — filtering first would make teams playing elsewhere
 * read as on bye, the exact failure this line exists to prevent.
 */
export function byeTeamsByWeek(
  games: ByeGameInput[],
  teams: ByeTeamInput[],
): Map<string, string[]> {
  const weeks = new Set<string>();
  const occupiedByWeek = new Map<string, Set<string>>();
  for (const g of games) {
    const wk = weekKeyFromIsoDate(g.scheduled_at);
    weeks.add(wk); // any row anchors the week (a day-group renders for it)
    if (!teamIsOccupiedThisWeek(g.status)) continue;
    let occupied = occupiedByWeek.get(wk);
    if (!occupied) {
      occupied = new Set();
      occupiedByWeek.set(wk, occupied);
    }
    if (g.home_team_id) occupied.add(g.home_team_id);
    if (g.away_team_id) occupied.add(g.away_team_id);
  }

  const out = new Map<string, string[]>();
  for (const wk of weeks) {
    const occupied = occupiedByWeek.get(wk) ?? new Set<string>();
    const byes = teams
      .filter((t) => !occupied.has(t.id))
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b));
    out.set(wk, byes);
  }
  return out;
}

/**
 * Derive each venue's recurring game days-of-week (with distinct-week counts)
 * from a flat list of games. Non-counting statuses and null-venue rows are
 * ignored; only days meeting GAME_DAY_WEEK_THRESHOLD distinct weeks are kept.
 * A venue with no qualifying day is absent from the result.
 */
export function deriveVenueGameDays(
  games: GameDayInput[],
): Map<string, VenueGameDays> {
  // venue_id → day-of-week → set of distinct week keys
  const acc = new Map<string, Map<DayKey, Set<string>>>();
  for (const g of games) {
    if (!g.venue_id) continue;
    if (NON_COUNTING_STATUSES.has(g.status)) continue;
    const day = dayKeyFromIsoDate(g.scheduled_at);
    const wk = weekKeyFromIsoDate(g.scheduled_at);
    let byDay = acc.get(g.venue_id);
    if (!byDay) {
      byDay = new Map();
      acc.set(g.venue_id, byDay);
    }
    let weeks = byDay.get(day);
    if (!weeks) {
      weeks = new Set();
      byDay.set(day, weeks);
    }
    weeks.add(wk);
  }

  const out = new Map<string, VenueGameDays>();
  for (const [venueId, byDay] of acc) {
    const counts: VenueGameDays = new Map();
    for (const [day, weeks] of byDay) {
      if (weeks.size >= GAME_DAY_WEEK_THRESHOLD) counts.set(day, weeks.size);
    }
    if (counts.size > 0) out.set(venueId, counts);
  }
  return out;
}

/** Venue ids with at least one COUNTING game (any weekday, any week). Drives
 *  the card's "no schedule yet" empty state — distinct from deriveVenueGameDays,
 *  which needs the >=2-week threshold. */
export function venuesWithAnyGame(games: GameDayInput[]): Set<string> {
  const out = new Set<string>();
  for (const g of games) {
    if (!g.venue_id) continue;
    if (NON_COUNTING_STATUSES.has(g.status)) continue;
    out.add(g.venue_id);
  }
  return out;
}

/** Derived game days for one venue — empty map when the venue has none. */
export function gameDaysForVenue(
  all: Map<string, VenueGameDays>,
  venueId: string,
): VenueGameDays {
  return all.get(venueId) ?? new Map();
}

/** True when day D is a derived (recurring) game day at this venue. */
export function isGameDay(gameDays: VenueGameDays, day: DayKey): boolean {
  return gameDays.has(day);
}

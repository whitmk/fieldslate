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

// Statuses that must NOT count toward "this venue hosts games on day D":
//   cancelled           — the game was called off.
//   pending_interleague — an unconfirmed interleague proposal, not a real game.
// Everything else (scheduled, completed, …) counts.
const NON_COUNTING_STATUSES = new Set(["cancelled", "pending_interleague"]);

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
 *  the instant, so it cannot roll across a timezone boundary. */
function weekKeyFromIsoDate(iso: string): string {
  const d = new Date(iso.substring(0, 10) + "T00:00:00");
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Mon=0 … Sun=6 back to Monday
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const day = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

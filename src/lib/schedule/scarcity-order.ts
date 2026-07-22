// Scarcity-based division run-ordering for the season-page "Generate all
// divisions" control. Pure, and DELIBERATELY generator-free: it computes how
// boxed-in each division is BEFORE any games are placed, so the batch loop can
// schedule the most-constrained divisions first (they have the fewest legal
// slots to lose to earlier divisions' bookings).
//
// Supply is measured with the generator's OWN slot builder — buildSlots
// (exported from generate-schedule.ts for exactly this reuse) — so the legal
// (venue × datetime) pool this ordering reasons about can never drift from the
// pool the generator actually draws from. buildSlots is a pure function of
// stored settings/venues/blackouts and issues no DB reads; nothing here calls
// generateSchedule or touches the placement loop.
//
// CLIENT-TIMEZONE-ONLY, same stance as buildSlots itself: the day/week math is
// derived from naive local wall-clock dates. In the browser that's the
// commissioner's zone — correct. Any server-side reuse must pin the zone first
// (the sim harness runs under TZ=UTC for exactly this reason).

import { buildSlots } from "./generate-schedule";
import type { VenueAvailability } from "@/lib/venues/availability";

/** The settings shape buildSlots consumes, borrowed structurally so we don't
 *  have to re-export the engine's internal DivisionSettings interface. */
export type ScheduleSettings = Parameters<typeof buildSlots>[2];

/** Everything needed to score one division, all of it stored data. */
export interface DivisionScarcityInput {
  divisionId: string;
  /** divisions.created_at — the stable, non-arbitrary tiebreak anchor. */
  createdAt: string;
  startDate: string;
  endDate: string;
  settings: ScheduleSettings;
  /** Availability-configured, game-allowed venue ids (buildSlots ignores any
   *  venue missing from venueAvailability, so keep the two in sync). */
  venueIds: string[];
  venueAvailability: Map<string, VenueAvailability>;
  blackoutDates: Set<string>;
  teamCount: number;
  gamesPerTeam: number;
  /** Interleague HOME games (they claim a local venue slot). Away interleague
   *  games are venue-less, so they don't count against local supply. */
  homeInterleagueGames: number;
}

export interface DivisionScarcityKey {
  divisionId: string;
  /** Legal (venue × datetime) slots — the exact count buildSlots would yield. */
  supply: number;
  /** Venue-slot-consuming games the division needs placed. */
  demand: number;
  /** supply − demand. Smaller (more negative) = more boxed-in. */
  slack: number;
  createdAt: string;
}

/** Legal slot pool for a division, straight from the generator's slot builder. */
export function divisionSupply(input: DivisionScarcityInput): number {
  return buildSlots(
    input.startDate,
    input.endDate,
    input.settings,
    input.venueIds,
    input.venueAvailability,
    input.blackoutDates,
  ).length;
}

/**
 * Venue-slot demand for a division: the intra-division round-robin game total
 * (teams × games-per-team, halved because each game serves two teams) plus the
 * interleague HOME games (away games claim no local slot). A single-team (or
 * empty) division needs no intra games.
 */
export function divisionDemand(
  teamCount: number,
  gamesPerTeam: number,
  homeInterleagueGames: number,
): number {
  const intra =
    teamCount >= 2 ? Math.ceil((teamCount * Math.max(0, gamesPerTeam)) / 2) : 0;
  return intra + Math.max(0, homeInterleagueGames);
}

/** Compute the full scarcity key for a division from stored inputs only. */
export function scarcityKey(input: DivisionScarcityInput): DivisionScarcityKey {
  const supply = divisionSupply(input);
  const demand = divisionDemand(
    input.teamCount,
    input.gamesPerTeam,
    input.homeInterleagueGames,
  );
  return {
    divisionId: input.divisionId,
    supply,
    demand,
    slack: supply - demand,
    createdAt: input.createdAt,
  };
}

/**
 * Total-order comparator, most-constrained first:
 *   1. slack ascending      — fewest available slots relative to need
 *   2. supply ascending     — fewer absolute legal slots
 *   3. createdAt ascending  — matches the wizard's existing convention
 *   4. divisionId ascending — unique final key, so the order is never arbitrary
 * Levels 3 and 4 guarantee a deterministic total order even when two divisions
 * are equally constrained.
 */
export function compareScarcity(
  a: DivisionScarcityKey,
  b: DivisionScarcityKey,
): number {
  if (a.slack !== b.slack) return a.slack - b.slack;
  if (a.supply !== b.supply) return a.supply - b.supply;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.divisionId !== b.divisionId) return a.divisionId < b.divisionId ? -1 : 1;
  return 0;
}

/** Return the keys sorted most-constrained-first (non-mutating). */
export function orderByScarcity(
  keys: DivisionScarcityKey[],
): DivisionScarcityKey[] {
  return [...keys].sort(compareScarcity);
}

/** Convenience: score a set of divisions and return their ids in run order. */
export function scarcityOrderedIds(
  inputs: DivisionScarcityInput[],
): string[] {
  return orderByScarcity(inputs.map(scarcityKey)).map((k) => k.divisionId);
}

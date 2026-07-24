/**
 * Shared planSchedule fixtures for placement-diagnostics-sim.ts AND for the
 * golden recorder that captures pre-change placements.
 *
 * DELIBERATELY DEPENDENCY-LIGHT: this module imports only the
 * `PlanScheduleInput` TYPE from the generator. That is what lets it be copied
 * into a worktree of the pre-change tree and run there to record the golden —
 * if it imported placement-diagnostics.ts, recording against the old code
 * would be impossible and placement invariance could never be proven.
 *
 * Every fixture leaves all filters wide open except the one it is exercising,
 * which is what makes the harness's two-sided "and only when" assertions
 * possible.
 */

import type { PlanScheduleInput } from "@/lib/schedule/generate-schedule";

export const WEEKS = ["2026-W37", "2026-W38", "2026-W39", "2026-W40"];
export const DATES = ["2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03"];
export const TIMES = ["09:00:00", "11:00:00"];

export function slotGrid(venueIds: string[] = ["venue-0"]) {
  const slots = [];
  for (let d = 0; d < DATES.length; d++) {
    for (const t of TIMES) {
      for (const v of venueIds) {
        slots.push({
          isoString: `${DATES[d]}T${t}`,
          venueId: v,
          date: DATES[d],
          weekKey: WEEKS[d],
        });
      }
    }
  }
  return slots;
}

/** Base input: every filter wide open, so nothing rejects unless a fixture
 *  deliberately closes one. */
export function baseInput(over: Partial<PlanScheduleInput> = {}): PlanScheduleInput {
  const teamTimes = new Map<string, Set<string>>();
  for (const id of ["A", "B"]) teamTimes.set(id, new Set());
  return {
    leagueId: "league-1",
    matchups: [
      { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
      { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
    ],
    slots: slotGrid(),
    venueBookings: new Map(),
    teamTimes,
    teamDay: new Map(),
    teamWeek: new Map(),
    awayByOrgDate: new Map(),
    blocked: new Map(),
    constraintRules: new Map(),
    orgFieldCount: new Map(),
    minVenueGap: 90,
    maxPerTeamDay: 99,
    maxGamesPerWeek: 99,
    ...over,
  };
}

/**
 * A run where a matchup is ABANDONED BETWEEN two placeable ones (E–F is
 * blocked at every slot). This is the shape that makes the invariance proof
 * non-vacuous: in every other fixture the diagnostic pass either never runs or
 * runs only after the last placement, so a pass that mutated booking state
 * would leave no trace. Here, four placements happen after the abandonment —
 * any leaked write shifts them.
 *
 * `omitAbandoned` drops the E–F matchup. A read-only pass must produce
 * IDENTICAL placements either way; that equality is assertion INV2.
 */
export function abandonmentFixture(omitAbandoned = false): PlanScheduleInput {
  const ids = ["A", "B", "C", "D", "E", "F"];
  const teamTimes = new Map<string, Set<string>>();
  for (const id of ids) teamTimes.set(id, new Set());

  const blocked = new Map<string, Set<string>>();
  blocked.set("E", new Set(slotGrid().map((s) => s.isoString)));

  const matchups = [
    { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
    ...(omitAbandoned
      ? []
      : [{ homeId: "E", awayId: "F", interleagueOrgId: null, isAway: false }]),
    { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
    { homeId: "C", awayId: "D", interleagueOrgId: null, isAway: false },
    { homeId: "C", awayId: "D", interleagueOrgId: null, isAway: false },
  ];

  return baseInput({
    matchups,
    teamTimes,
    blocked,
    maxPerTeamDay: 1,
    maxGamesPerWeek: 1,
  });
}

/**
 * The placement-invariance fixture set. Each must be built FRESH per call —
 * planSchedule mutates the booking maps in place.
 *
 * Chosen to cover the shapes where a leak from the diagnostic pass would show
 * up: an abandonment followed by further placements (the load-bearing one — see
 * abandonmentFixture), a fully-placed run (the pass must never run), venue
 * contention (pre-seeded bookings), and an away-interleague run (the org-cap
 * branch and the deduped date-time pool).
 */
export function goldenFixtures(): Array<[string, PlanScheduleInput]> {
  const partial = () =>
    baseInput({
      matchups: [
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
      ],
      maxPerTeamDay: 1,
      maxGamesPerWeek: 1,
    });

  const allPlaced = () =>
    baseInput({
      matchups: [
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
      ],
      maxPerTeamDay: 1,
      maxGamesPerWeek: 1,
    });

  const venueContention = () => {
    const venueBookings = new Map<string, number[]>();
    venueBookings.set(`venue-0:${DATES[0]}`, [540]);
    return baseInput({
      matchups: [
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
      ],
      venueBookings,
      maxPerTeamDay: 1,
      maxGamesPerWeek: 1,
    });
  };

  const away = () =>
    baseInput({
      matchups: [
        { homeId: "A", awayId: null, interleagueOrgId: "org-1", isAway: true },
        { homeId: "B", awayId: null, interleagueOrgId: "org-1", isAway: true },
      ],
      orgFieldCount: new Map([["org-1", 1]]),
      maxPerTeamDay: 1,
      maxGamesPerWeek: 1,
    });

  return [
    ["partial", partial()],
    ["allPlaced", allPlaced()],
    ["venueContention", venueContention()],
    ["away", away()],
    ["withAbandonment", abandonmentFixture()],
  ];
}

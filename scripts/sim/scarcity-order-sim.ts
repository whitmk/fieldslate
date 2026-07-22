/**
 * Simulation harness for scarcity-based division run-ordering
 * (src/lib/schedule/scarcity-order.ts), the sort that decides which division
 * the season-page "Generate all divisions" control schedules first.
 *
 * Run with:  TZ=UTC npx tsx scripts/sim/scarcity-order-sim.ts
 * (or `npm run sim:scarcity`). TZ=UTC is mandatory: supply is measured by the
 * REAL generator slot builder (buildSlots), whose day-of-week math reads naive
 * local wall-clock dates — under any other zone a Saturday date can read as a
 * Friday and the slot counts drift. The harness refuses to run otherwise.
 *
 * What it proves:
 *  - MORE-CONSTRAINED SORTS AHEAD: shortening a season, adding teams, or
 *    removing venues each moves a division earlier in the order.
 *  - DETERMINISTIC TIEBREAK: equally-constrained divisions fall to the exact
 *    documented chain — slack → supply → created_at → id — and permuting the
 *    input order never changes the result.
 *  - KEY FROM STORED DATA ONLY: every key is computed from fixtures
 *    (settings / venue availability / blackouts) through buildSlots, with NO
 *    generateSchedule call and no Supabase client anywhere in this file. An
 *    open fixture yields a known nonzero slot count and a closed one yields
 *    zero — proof buildSlots actually drives the number rather than a stub.
 *
 * Anti-vacuity counters (the run FAILS if any is zero): each tiebreak level
 * (slack, supply, created_at, id) must have DECIDED at least one comparison,
 * so no level of the chain is asserted vacuously.
 */

import {
  scarcityKey,
  divisionSupply,
  divisionDemand,
  compareScarcity,
  orderByScarcity,
  type DivisionScarcityInput,
  type ScheduleSettings,
} from "../../src/lib/schedule/scarcity-order";
import type { VenueAvailability } from "../../src/lib/venues/availability";

// ── Guard: pinned zone (see header) ──────────────────────────────────────────
if (process.env.TZ !== "UTC") {
  console.error("This harness must run under TZ=UTC (see file header). Aborting.");
  process.exit(1);
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

// ── Fixture builders ─────────────────────────────────────────────────────────

/** Venue open on the given day-keys, 09:00–11:00 (fits two 60-min games). */
function venueAvail(days: string[]): VenueAvailability {
  const av: VenueAvailability = {};
  for (const d of days) {
    (av as Record<string, { start: string; end: string }>)[d] = {
      start: "09:00",
      end: "11:00",
    };
  }
  return av;
}

function settings(): ScheduleSettings {
  return {
    games_per_team: 2,
    max_games_per_week: 10,
    max_games_per_team_per_day: 1,
    playing_days: ["Sa", "Su"],
    day_windows: { Sa: { start: "09:00", end: "11:00" }, Su: { start: "09:00", end: "11:00" } },
    game_duration: 60,
    buffer_minutes: 0,
    max_games_per_field_per_day: 3,
    bye_weeks: 0,
    auto_rotate: true,
    teams: [],
  } as unknown as ScheduleSettings;
}

type Overrides = Partial<DivisionScarcityInput> & { venueDays?: string[] };

function makeInput(
  divisionId: string,
  createdAt: string,
  o: Overrides = {},
): DivisionScarcityInput {
  const venueDays = o.venueDays ?? ["Sa", "Su"];
  const venueAvailability =
    o.venueAvailability ??
    new Map<string, VenueAvailability>([["v1", venueAvail(venueDays)]]);
  const venueIds = o.venueIds ?? [...venueAvailability.keys()];
  return {
    divisionId,
    createdAt,
    startDate: o.startDate ?? "2026-03-07", // Saturday
    endDate: o.endDate ?? "2026-03-08", // Sunday (one weekend)
    settings: o.settings ?? settings(),
    venueIds,
    venueAvailability,
    blackoutDates: o.blackoutDates ?? new Set<string>(),
    teamCount: o.teamCount ?? 4,
    gamesPerTeam: o.gamesPerTeam ?? 2,
    homeInterleagueGames: o.homeInterleagueGames ?? 0,
  };
}

// ── Anti-vacuity: which tiebreak level decided each comparison ────────────────
const decidedBy = { slack: 0, supply: 0, createdAt: 0, id: 0 };
function classifyDecision(a: DivisionScarcityInput, b: DivisionScarcityInput): void {
  const ka = scarcityKey(a);
  const kb = scarcityKey(b);
  if (ka.slack !== kb.slack) decidedBy.slack++;
  else if (ka.supply !== kb.supply) decidedBy.supply++;
  else if (ka.createdAt !== kb.createdAt) decidedBy.createdAt++;
  else if (ka.divisionId !== kb.divisionId) decidedBy.id++;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("scarcity-order-sim — division run-ordering invariants\n");

// (0) buildSlots really drives supply: exact known count + a zero case.
{
  const base = makeInput("d", "2026-01-01T00:00:00Z");
  // One weekend (Sa+Su) × one venue × 2 fitting slots/day = 4.
  assert(divisionSupply(base) === 4, `open fixture supply should be 4, got ${divisionSupply(base)}`);

  // Playing weekends but venue open only weekdays → no legal slots.
  const closed = makeInput("d", "2026-01-01T00:00:00Z", { venueDays: ["Mo", "Tu"] });
  assert(divisionSupply(closed) === 0, `closed-venue fixture supply should be 0, got ${divisionSupply(closed)}`);

  // Extending the season strictly raises supply (reads stored dates).
  const longer = makeInput("d", "2026-01-01T00:00:00Z", { endDate: "2026-03-15" }); // two weekends
  assert(divisionSupply(longer) === 8, `two-weekend supply should be 8, got ${divisionSupply(longer)}`);

  // demand math: 4 teams × 2 gpt / 2 = 4 intra (+0 interleague).
  assert(divisionDemand(4, 2, 0) === 4, "demand(4,2,0) should be 4");
  assert(divisionDemand(6, 2, 0) === 6, "demand(6,2,0) should be 6");
  assert(divisionDemand(1, 2, 0) === 0, "single-team division needs 0 intra games");
  assert(divisionDemand(4, 2, 3) === 7, "home interleague games add to demand");
}

// (1) More-constrained sorts ahead — one lever at a time.
{
  // Shorter season → less supply → tighter.
  const shorter = makeInput("short", "2026-01-01T00:00:00Z", { endDate: "2026-03-07" }); // Sat only, supply 2, slack -2
  const base = makeInput("base", "2026-01-02T00:00:00Z"); // supply 4, slack 0
  const longer = makeInput("long", "2026-01-03T00:00:00Z", { endDate: "2026-03-15" }); // supply 8, slack +4
  const order = orderByScarcity([base, longer, shorter].map(scarcityKey)).map((k) => k.divisionId);
  assert(
    JSON.stringify(order) === JSON.stringify(["short", "base", "long"]),
    `season-length order should be [short, base, long], got ${JSON.stringify(order)}`,
  );

  // More teams → more demand → tighter (supply held equal to base).
  const crowded = makeInput("crowded", "2026-01-04T00:00:00Z", { teamCount: 6 }); // supply 4, demand 6, slack -2
  const order2 = orderByScarcity([base, crowded].map(scarcityKey)).map((k) => k.divisionId);
  assert(
    JSON.stringify(order2) === JSON.stringify(["crowded", "base"]),
    `demand order should be [crowded, base], got ${JSON.stringify(order2)}`,
  );

  // Fewer venues → less supply → tighter.
  const twoVenues = new Map<string, VenueAvailability>([
    ["v1", venueAvail(["Sa", "Su"])],
    ["v2", venueAvail(["Sa", "Su"])],
  ]);
  const roomy = makeInput("roomy", "2026-01-05T00:00:00Z", { venueAvailability: twoVenues }); // supply 8
  const order3 = orderByScarcity([roomy, base].map(scarcityKey)).map((k) => k.divisionId);
  assert(
    JSON.stringify(order3) === JSON.stringify(["base", "roomy"]),
    `venue-count order should be [base, roomy], got ${JSON.stringify(order3)}`,
  );

  classifyDecision(shorter, base); // slack
  classifyDecision(crowded, base); // slack
  classifyDecision(base, roomy); // slack
}

// (2) Tiebreak chain: slack tie → supply → created_at → id.
{
  // Equal slack (-2), different supply: shorter(supply2) before crowded(supply4).
  const shorter = makeInput("A-short", "2026-02-01T00:00:00Z", { endDate: "2026-03-07" }); // slack -2, supply 2
  const crowded = makeInput("A-crowd", "2026-02-01T00:00:00Z", { teamCount: 6 }); // slack -2, supply 4
  const bySupply = orderByScarcity([crowded, shorter].map(scarcityKey)).map((k) => k.divisionId);
  assert(
    JSON.stringify(bySupply) === JSON.stringify(["A-short", "A-crowd"]),
    `supply tiebreak should put A-short first, got ${JSON.stringify(bySupply)}`,
  );
  classifyDecision(crowded, shorter); // supply

  // Identical slack AND supply, different created_at: earlier first.
  const early = makeInput("z-early", "2026-01-01T00:00:00Z"); // note id sorts LATER than late's
  const late = makeInput("a-late", "2026-06-01T00:00:00Z");
  const byCreated = orderByScarcity([late, early].map(scarcityKey)).map((k) => k.divisionId);
  assert(
    JSON.stringify(byCreated) === JSON.stringify(["z-early", "a-late"]),
    `created_at tiebreak should put z-early first, got ${JSON.stringify(byCreated)}`,
  );
  classifyDecision(late, early); // created_at (decides before id, though ids also differ)

  // Identical slack, supply AND created_at, different id: smaller id first.
  const idA = makeInput("id-aaa", "2026-04-01T00:00:00Z");
  const idB = makeInput("id-bbb", "2026-04-01T00:00:00Z");
  const byId = orderByScarcity([idB, idA].map(scarcityKey)).map((k) => k.divisionId);
  assert(
    JSON.stringify(byId) === JSON.stringify(["id-aaa", "id-bbb"]),
    `id tiebreak should put id-aaa first, got ${JSON.stringify(byId)}`,
  );
  classifyDecision(idB, idA); // id
  // Direct comparator sanity: fully-equal keys compare 0.
  assert(compareScarcity(scarcityKey(idA), scarcityKey(idA)) === 0, "identical key should compare equal");
}

// (3) Determinism: permuting inputs never changes the sorted result.
{
  const pool = [
    makeInput("p1", "2026-01-01T00:00:00Z", { endDate: "2026-03-07" }),
    makeInput("p2", "2026-01-02T00:00:00Z"),
    makeInput("p3", "2026-01-03T00:00:00Z", { endDate: "2026-03-15" }),
    makeInput("p4", "2026-01-02T00:00:00Z", { teamCount: 6 }),
    makeInput("p5", "2026-04-01T00:00:00Z"),
    makeInput("p6", "2026-04-01T00:00:00Z"),
  ];
  const canonical = orderByScarcity(pool.map(scarcityKey)).map((k) => k.divisionId);
  // A few fixed permutations (no Math.random — determinism must be provable).
  const perms = [
    [5, 4, 3, 2, 1, 0],
    [2, 0, 4, 1, 5, 3],
    [1, 3, 0, 5, 2, 4],
  ];
  for (const perm of perms) {
    const shuffled = perm.map((i) => pool[i]);
    const out = orderByScarcity(shuffled.map(scarcityKey)).map((k) => k.divisionId);
    assert(
      JSON.stringify(out) === JSON.stringify(canonical),
      `permutation ${JSON.stringify(perm)} changed the order: ${JSON.stringify(out)} vs ${JSON.stringify(canonical)}`,
    );
  }
}

// ── Anti-vacuity: every tiebreak level must have decided a comparison ────────
console.log("\nDecision coverage:", decidedBy);
for (const [level, n] of Object.entries(decidedBy)) {
  assert(n > 0, `tiebreak level '${level}' never decided a comparison (asserted vacuously)`);
}

// ─────────────────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll scarcity-order invariants held ✓");

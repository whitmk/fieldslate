/**
 * Simulation harness: the schedule generator's reads FAIL CLOSED, and no read
 * that can fail runs after something destructive.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every `games` read in generate-schedule.ts used to discard its error. The
 * worst of them is the venue-booking pre-load: on a read error it produced an
 * EMPTY booking map, which the placement walk reads as "every field is free at
 * every time". The generator would then double-book fields across divisions and
 * report success — and, because the read ran AFTER the regenerate delete, it did
 * so with the division's previous schedule already destroyed. One transient
 * network blip was enough. Nothing in the product would have said a word.
 *
 * WHAT THIS PROVES
 *   A — every failing read aborts with a plain-English error (no silent nulls)
 *   B — an aborted run leaves the database EXACTLY as it found it (the ordering
 *       fix: reads moved above the delete)
 *   C — the happy path still schedules a full season
 *   D — the delete-mirror predicate is neither under- nor over-subtracting
 *   E — the post-write conflict read cannot claim a clean bill of health it
 *       didn't earn
 *
 * GROUP D IS THE PRICE OF THE ORDERING FIX AND THE EASIEST THING TO GET WRONG.
 * Reading before the delete means the reads still see the rows the delete is
 * about to remove, so they subtract them via willBeClearedByRegenerate. Get that
 * subtraction wrong in either direction and the generator breaks quietly:
 *   D1 under-subtracting → the division's own outgoing games block the slots
 *      meant to replace them, and a regenerate places far fewer games
 *   D2 over-subtracting  → OTHER divisions' games stop blocking, which is the
 *      original double-booking bug arriving through the front door
 * The predicate and the SQL delete cannot be derived from each other, so these
 * two assertions are the only thing pinning them together.
 *
 * Run: npm run sim:generator-failclosed   (TZ=UTC mandatory)
 */

import {
  generateSchedule,
  finishSchedule,
  willBeClearedByRegenerate,
} from "../../src/lib/schedule/generate-schedule";
import { FakeClient, type Db } from "./fake-supabase";

if (process.env.TZ !== "UTC") {
  console.error("This harness requires TZ=UTC (run via npm run sim:generator-failclosed).");
  process.exit(1);
}

// ── Assertion plumbing ──────────────────────────────────────────────────────
let assertions = 0;
const failures: string[] = [];

function ok(label: string, cond: boolean, detail = "") {
  assertions++;
  if (!cond) failures.push(`[${label}] ${detail || "assertion failed"}`);
}
function eq<T>(label: string, actual: T, expected: T, detail = "") {
  assertions++;
  if (actual !== expected) {
    failures.push(
      `[${label}] expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${detail ? ` — ${detail}` : ""}`,
    );
  }
}

// ── Anti-vacuity counters ───────────────────────────────────────────────────
const seen = {
  abortsProven: 0, // a fault caused a fail-closed abort
  intactnessProven: 0, // an abort left the DB byte-identical
  faultsThatFired: 0, // injected faults that actually matched a read
  seededGamesPresent: 0, // fixtures that actually had pre-existing games
  foreignGameBlocked: 0, // D2 actually had a foreign-division game
  conflictsUnknownProven: 0,
  happyPathPlacements: 0,
};

// ── Fixture ─────────────────────────────────────────────────────────────────
// Deliberately EXACTLY tight: 6 Saturdays x 2 venue slots = 12 slots, and the
// division needs exactly 12 games. Zero slack is what makes group D crisp —
// under-subtracting drops placement to 0, over-subtracting shows up as one
// extra game squeezed into a slot that was supposed to be taken.

const LEAGUE_ID = "league-1";
const DIVISION_ID = "div-1";
const OTHER_DIVISION_ID = "div-2";
const VENUE_ID = "venue-0";
const TEAM_COUNT = 4;
const GAMES_PER_TEAM = 6;
const EXPECTED_GAMES = (TEAM_COUNT * GAMES_PER_TEAM) / 2; // 12

// Ten available Saturdays; each fixture picks how many the season actually
// spans. TIGHT (6) = exactly 12 slots for exactly 12 games, which is what makes
// an over-subtracted slot show up as a measurable loss. ROOMY (8) = just enough
// slack that UNDER-subtraction reduces placement to a specific wrong number
// instead of annihilating it — without that slack the run total-fails and the
// count assertion never even evaluates (M3 died to the outer success check on
// the first mutation pass, leaving D1-count unproven).
const SATURDAYS = [
  "2026-03-07", "2026-03-14", "2026-03-21", "2026-03-28", "2026-04-04",
  "2026-04-11", "2026-04-18", "2026-04-25", "2026-05-02", "2026-05-09",
];
const TIGHT_WEEKS = 6;
// EIGHT, not ten. The subtraction happens in TWO loops — venue bookings and
// team caps — and the fixture has to be tight enough for BOTH to matter. At ten
// weeks each team still had seven free weeks for six games, so dropping the
// team-cap subtraction changed nothing and M9 escaped group D entirely (it died
// at an unrelated post-write assertion instead). At eight weeks the seeds cost
// each team three of its eight weeks, leaving five for six games — so both
// mutants now land on D1-count.
const ROOMY_WEEKS = 8;
/** Saturdays the seeded previous schedule occupies (always the first six). */
const SEEDED_WEEKS = 6;
const SLOT_TIMES = ["09:00:00", "10:00:00"];

const teamId = (i: number) => `team-${i}`;

type FixtureOpts = {
  /** Seed the division's own previous schedule (the rows the delete removes). */
  seedOwnSchedule?: boolean;
  /** Seed a game owned by ANOTHER division at Saturday 1, 09:00. */
  seedForeignGame?: boolean;
  /** Seed a cross-division coach link so the coach read is issued. */
  coachLink?: boolean;
  /** Leave the division short of its game target (for finishSchedule). */
  partialSchedule?: number;
  /** How many Saturdays the season spans. Defaults to TIGHT_WEEKS. */
  weeks?: number;
};

function buildDb(o: FixtureOpts = {}): FakeClient {
  const db: Db = {
    divisions: [],
    teams: [],
    venues: [],
    division_venues: [],
    blackout_dates: [],
    games: [],
    division_interleague_games: [],
    interleague_orgs: [],
    team_game_constraints: [],
  };

  const settingsTeams = Array.from({ length: TEAM_COUNT }, (_, i) => ({
    name: `Team ${i}`,
    // Team 0 shares a coach with a team in the OTHER division, which is what
    // makes the generator issue its coach-linked games read.
    has_coach_conflict: !!o.coachLink && i === 0,
    conflict_division: o.coachLink && i === 0 ? "Other" : "",
    conflict_team: o.coachLink && i === 0 ? "Rival A" : "",
  }));

  const settings = {
    games_per_team: GAMES_PER_TEAM,
    max_games_per_week: 1,
    max_games_per_team_per_day: 1,
    playing_days: ["Sa"],
    earliest_start: "09:00",
    latest_start: "10:00",
    game_duration: 60,
    buffer_minutes: 0,
    max_games_per_field_per_day: 12,
    bye_weeks: 0,
    auto_rotate: true,
    teams: settingsTeams,
  };

  const weeks = o.weeks ?? TIGHT_WEEKS;

  db.divisions.push({
    id: DIVISION_ID,
    league_id: LEAGUE_ID,
    name: "Majors",
    start_date: SATURDAYS[0],
    end_date: SATURDAYS[weeks - 1],
    intra_division_games_per_team: GAMES_PER_TEAM,
    settings,
  });
  db.divisions.push({
    id: OTHER_DIVISION_ID,
    league_id: LEAGUE_ID,
    name: "Other",
    start_date: SATURDAYS[0],
    end_date: SATURDAYS[weeks - 1],
    intra_division_games_per_team: 0,
    settings: { ...settings, teams: [] },
  });

  const allDays: Record<string, { start: string; end: string }> = {};
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
    allDays[d] = { start: "07:00", end: "22:00" };
  }
  db.venues.push({
    id: VENUE_ID,
    name: "Field 0",
    availability: allDays,
    availability_configured: true,
  });
  db.division_venues.push({
    division_id: DIVISION_ID,
    venue_id: VENUE_ID,
    allow_games: true,
  });

  for (let i = 0; i < TEAM_COUNT; i++) {
    db.teams.push({
      id: teamId(i),
      league_id: LEAGUE_ID,
      division_id: DIVISION_ID,
      name: `Team ${i}`,
    });
  }
  // Foreign team, used both for the coach link and the foreign-game fixture.
  db.teams.push({
    id: "team-foreign",
    league_id: LEAGUE_ID,
    division_id: OTHER_DIVISION_ID,
    name: "Rival A",
  });

  // The division's own previous schedule — every one of these rows matches the
  // regenerate delete predicate (status 'scheduled', no interleague org).
  if (o.seedOwnSchedule) {
    let n = 0;
    for (const date of SATURDAYS.slice(0, SEEDED_WEEKS)) {
      for (const t of SLOT_TIMES) {
        db.games.push({
          id: `own-${n}`,
          league_id: LEAGUE_ID,
          home_team_id: teamId(n % TEAM_COUNT),
          away_team_id: teamId((n + 1) % TEAM_COUNT),
          interleague_org_id: null,
          venue_id: VENUE_ID,
          scheduled_at: `${date}T${t}`,
          status: "scheduled",
          is_away: false,
        });
        n++;
      }
    }
  }

  // A game belonging to ANOTHER division at one of our slots. The delete must
  // NOT touch it (its home team isn't ours), so it must still block.
  if (o.seedForeignGame) {
    db.games.push({
      id: "foreign-1",
      league_id: LEAGUE_ID,
      home_team_id: "team-foreign",
      away_team_id: null,
      interleague_org_id: null,
      venue_id: VENUE_ID,
      scheduled_at: `${SATURDAYS[0]}T${SLOT_TIMES[0]}`,
      status: "scheduled",
      is_away: false,
    });
  }

  if (o.partialSchedule) {
    for (let n = 0; n < o.partialSchedule; n++) {
      db.games.push({
        id: `partial-${n}`,
        league_id: LEAGUE_ID,
        home_team_id: teamId(n % TEAM_COUNT),
        away_team_id: teamId((n + 1) % TEAM_COUNT),
        interleague_org_id: null,
        venue_id: VENUE_ID,
        scheduled_at: `${SATURDAYS[Math.floor(n / 2)]}T${SLOT_TIMES[n % 2]}`,
        status: "scheduled",
        is_away: false,
      });
    }
  }

  return new FakeClient(db);
}

/** Stable snapshot of the games table, for byte-identical intactness checks. */
function snapshot(db: Db): string {
  return JSON.stringify(
    [...db.games]
      .map((g) => ({ ...g }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
}

const gamesCount = (db: Db) => db.games.length;

// The engine's own select strings — used to target a single read. Kept as
// literals so a select-shape change makes the fault stop matching and the
// anti-vacuity counter fails the run, rather than the assertion passing empty.
const SEL_VENUE_BOOKINGS = "venue_id, scheduled_at, league_id";
const SEL_PRESERVED = "home_team_id, scheduled_at, league_id";
const SEL_ACCEPTED_IL = "home_team_id, interleague_org_id, is_away";
// Exact match: "scheduled_at" is a substring of every other games select.
const SEL_COACH_LINKED_EXACT = "scheduled_at";
const SEL_CROSSDIV = "home_team:teams!home_team_id";
const SEL_FINISH_EXISTING = "id, home_team_id, away_team_id, interleague_org_id";
const SEL_FINISH_VENUE = "venue_id, scheduled_at, home_team_id, away_team_id";

async function run() {
  // ══ C. Happy path — a full season still schedules ════════════════════════
  // Deliberately UNSEEDED. C must test only "a clean season schedules"; if it
  // also carried a pre-existing schedule it would double as a subtraction test
  // and absorb mutants that group D exists to catch (M3 died here first on the
  // initial pass, leaving D1 unproven).
  {
    const c = buildDb({});
    eq("C-clean", gamesCount(c.db), 0, "happy-path fixture must start empty");
    const res = await generateSchedule(DIVISION_ID, c.asClient());
    ok("C", res.success, res.success ? "" : res.error);
    if (res.success) {
      eq("C-count", res.gamesCreated, EXPECTED_GAMES, "full season must place");
      eq("C-conflictsKnown", res.conflictsUnavailable, null);
      seen.happyPathPlacements += res.gamesCreated;
    }
  }

  // ══ D1. Under-subtraction guard ══════════════════════════════════════════
  // The division's OWN previous schedule occupies every slot. Those rows are
  // deleted, so they must not block. If the subtraction is missing, the walk
  // sees a fully booked venue and places nothing.
  {
    const c = buildDb({ seedOwnSchedule: true, weeks: ROOMY_WEEKS });
    eq("D1-seeded", gamesCount(c.db), EXPECTED_GAMES, "fixture must pre-fill the first six weeks");
    seen.seededGamesPresent++;
    const res = await generateSchedule(DIVISION_ID, c.asClient());
    ok("D1", res.success, res.success ? "" : res.error);
    if (res.success) {
      eq(
        "D1-count",
        res.gamesCreated,
        EXPECTED_GAMES,
        "the division's own outgoing games must not block their replacements",
      );
    }
  }

  // ══ D2. Over-subtraction guard ═══════════════════════════════════════════
  // One slot is taken by ANOTHER division's game, which the delete never
  // touches. It must still block, costing exactly one game.
  {
    const c = buildDb({ seedOwnSchedule: true, seedForeignGame: true });
    const foreign = c.db.games.filter((g) => g.id === "foreign-1");
    ok("D2-fixture", foreign.length === 1, "foreign game must exist");
    seen.foreignGameBlocked++;
    const res = await generateSchedule(DIVISION_ID, c.asClient());
    ok("D2", res.success, res.success ? "" : res.error);
    if (res.success) {
      // The PRECISE claim: nothing new may be placed in the taken slot.
      // Asserting a total instead would be fragile — how many games are lost
      // downstream depends on greedy cascade and weekly caps, not on the guard
      // under test. (A first draft expected 11 and got 10, for exactly that
      // reason: the displaced pair had no remaining week where both teams were
      // under their weekly cap.)
      const takenIso = `${SATURDAYS[0]}T${SLOT_TIMES[0]}`;
      const intruders = c.db.games.filter(
        (g) =>
          g.id !== "foreign-1" &&
          g.venue_id === VENUE_ID &&
          String(g.scheduled_at).substring(0, 19) === takenIso,
      );
      eq(
        "D2-slot",
        intruders.length,
        0,
        "another division's game must still block its exact venue+time",
      );
      ok(
        "D2-cost",
        res.gamesCreated < EXPECTED_GAMES,
        `blocking a slot in an exactly-tight fixture must cost games (placed ${res.gamesCreated})`,
      );
      const stillThere = c.db.games.some((g) => g.id === "foreign-1");
      ok("D2-survives", stillThere, "the foreign game must not be deleted");
    }
  }

  // ══ D3. The predicate itself, directly ═══════════════════════════════════
  {
    const ours = new Set([teamId(0), teamId(1)]);
    ok(
      "D3-intra",
      willBeClearedByRegenerate(
        { league_id: LEAGUE_ID, home_team_id: teamId(0), status: "scheduled", interleague_org_id: null },
        LEAGUE_ID,
        ours,
      ),
      "a plain scheduled game of ours is cleared",
    );
    ok(
      "D3-acceptedIL",
      !willBeClearedByRegenerate(
        { league_id: LEAGUE_ID, home_team_id: teamId(0), status: "scheduled", interleague_org_id: "org-1" },
        LEAGUE_ID,
        ours,
      ),
      "an ACCEPTED interleague game is preserved",
    );
    ok(
      "D3-pendingIL",
      willBeClearedByRegenerate(
        { league_id: LEAGUE_ID, home_team_id: teamId(0), status: "pending_interleague", interleague_org_id: "org-1" },
        LEAGUE_ID,
        ours,
      ),
      "a pending interleague game is cleared",
    );
    ok(
      "D3-foreignTeam",
      !willBeClearedByRegenerate(
        { league_id: LEAGUE_ID, home_team_id: "team-foreign", status: "scheduled", interleague_org_id: null },
        LEAGUE_ID,
        ours,
      ),
      "another division's game is never cleared",
    );
    ok(
      "D3-foreignLeague",
      !willBeClearedByRegenerate(
        { league_id: "other-league", home_team_id: teamId(0), status: "scheduled", interleague_org_id: null },
        LEAGUE_ID,
        ours,
      ),
      "another season's game is never cleared",
    );
  }

  // ══ A + B. Every failing read aborts, and leaves the DB untouched ════════
  const abortCases: Array<{ label: string; sel?: string; selExact?: string; expectIn: string; opts?: FixtureOpts }> = [
    { label: "venue-bookings", sel: SEL_VENUE_BOOKINGS, expectIn: "venue times" },
    { label: "preserved-games", sel: SEL_PRESERVED, expectIn: "existing games" },
    { label: "accepted-interleague", sel: SEL_ACCEPTED_IL, expectIn: "already accepted" },
    { label: "coach-linked", selExact: SEL_COACH_LINKED_EXACT, expectIn: "sharing a coach", opts: { coachLink: true } },
  ];

  for (const tc of abortCases) {
    const c = buildDb({ seedOwnSchedule: true, ...(tc.opts ?? {}) });
    const before = snapshot(c.db);
    const beforeCount = gamesCount(c.db);
    ok(`AB-${tc.label}-seeded`, beforeCount > 0, "fixture must have rows to lose");

    c.injectReadFault({
      table: "games",
      selectIncludes: tc.sel,
      selectEquals: tc.selExact,
      message: "simulated network failure",
    });

    const res = await generateSchedule(DIVISION_ID, c.asClient());

    // A — fails closed with a real message
    ok(`A-${tc.label}`, !res.success, "a failed read must abort the run");
    if (!res.success) {
      seen.abortsProven++;
      ok(
        `A-${tc.label}-wording`,
        res.error.includes(tc.expectIn),
        `error must name what couldn't be read: ${res.error}`,
      );
      ok(
        `A-${tc.label}-cause`,
        res.error.includes("simulated network failure"),
        "error must carry the underlying cause",
      );
    }

    // B — nothing was destroyed. THIS is the ordering assertion: with the
    // delete back above these reads, the seeded schedule would be gone.
    eq(`B-${tc.label}-count`, gamesCount(c.db), beforeCount, "no rows may be deleted");
    ok(
      `B-${tc.label}-identical`,
      snapshot(c.db) === before,
      "the games table must be byte-identical after an aborted run",
    );
    if (snapshot(c.db) === before) seen.intactnessProven++;

    // Anti-vacuity: the fault must actually have matched a read.
    ok(
      `AV-${tc.label}-fired`,
      c.faultHits[0] > 0,
      "injected fault never matched a read — this assertion proved nothing",
    );
    if (c.faultHits[0] > 0) seen.faultsThatFired++;
  }

  // ══ E. Post-write conflict read: unknown, never a false all-clear ════════
  {
    const c = buildDb({ seedOwnSchedule: true });
    c.injectReadFault({
      table: "games",
      selectIncludes: SEL_CROSSDIV,
      message: "simulated network failure",
    });
    const res = await generateSchedule(DIVISION_ID, c.asClient());
    ok("E", res.success, "the write already happened — the run must not report failure");
    if (res.success) {
      eq("E-created", res.gamesCreated, EXPECTED_GAMES, "games must still be written");
      ok(
        "E-unknown",
        !!res.conflictsUnavailable,
        "a failed conflict check must be reported as UNKNOWN, not as zero conflicts",
      );
      ok(
        "E-empty",
        res.conflicts.length === 0,
        "no conflicts may be invented when the check didn't run",
      );
      seen.conflictsUnknownProven++;
    }
    ok("AV-E-fired", c.faultHits[0] > 0, "crossdiv fault never fired");
  }

  // ══ F. finishSchedule reads fail closed too ══════════════════════════════
  const finishCases: Array<{ label: string; sel: string; expectIn: string }> = [
    { label: "finish-existing", sel: SEL_FINISH_EXISTING, expectIn: "existing games" },
    { label: "finish-venue", sel: SEL_FINISH_VENUE, expectIn: "venue times" },
  ];
  for (const tc of finishCases) {
    const c = buildDb({ partialSchedule: 4 });
    const before = snapshot(c.db);
    const beforeCount = gamesCount(c.db);
    ok(`F-${tc.label}-seeded`, beforeCount > 0);
    c.injectReadFault({
      table: "games",
      selectIncludes: tc.sel,
      message: "simulated network failure",
    });
    const res = await finishSchedule(DIVISION_ID, c.asClient());
    ok(`F-${tc.label}`, !res.success, "finish must abort on a failed read");
    if (!res.success) {
      seen.abortsProven++;
      ok(
        `F-${tc.label}-wording`,
        res.error.includes(tc.expectIn),
        `error must name what couldn't be read: ${res.error}`,
      );
    }
    eq(`F-${tc.label}-intact`, gamesCount(c.db), beforeCount, "finish must not write on abort");
    ok(
      `F-${tc.label}-identical`,
      snapshot(c.db) === before,
      "the games table must be byte-identical after an aborted finish run",
    );
    if (snapshot(c.db) === before) seen.intactnessProven++;
    ok(`AV-${tc.label}-fired`, c.faultHits[0] > 0, "injected fault never matched a read");
    if (c.faultHits[0] > 0) seen.faultsThatFired++;
  }

  // ══ Anti-vacuity ═════════════════════════════════════════════════════════
  for (const [name, n] of Object.entries(seen)) {
    ok(`vacuity:${name}`, n > 0, `"${name}" never happened — related assertions prove nothing`);
  }

  // ══ Report ═══════════════════════════════════════════════════════════════
  console.log(`\ngenerator fail-closed sim: ${assertions} assertions`);
  console.log(
    "coverage " + Object.entries(seen).map(([k, v]) => `${k}=${v}`).join(" "),
  );
  if (failures.length) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const f of failures) console.error("  " + f);
    process.exit(1);
  }
  console.log("ALL PASS\n");
}

run().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});

// ── Mutation log (2026-07-23) ───────────────────────────────────────────────
// 9 mutants, all killed BY THE ASSERTION WRITTEN FOR THEM. Applied one at a
// time to generate-schedule.ts and restored between each.
//
//   M1  venue-booking read fails open        → [A-venue-bookings]
//   M2  delete moved back ABOVE the reads    → [B-venue-bookings-count]
//        (the original ordering bug: "expected 12, got 0" — the seeded
//         schedule was destroyed before the failing read could abort)
//   M3  no subtraction, venue loop           → [D1-count] expected 12, got 4
//   M4  predicate always returns true        → [D2-slot] expected 0, got 1
//   M5  finish existing-games fails open     → [F-finish-existing]
//   M6  cross-division conflict read fails open → [E-unknown]
//   M7  accepted-interleague read fails open → [A-accepted-interleague]
//   M8  coach-linked read fails open         → [A-coach-linked]
//   M9  no subtraction, preserved loop       → [D1-count] expected 12, got 8
//
// THREE HARNESS DEFECTS THIS PASS EXPOSED — all of them cases where the tally
// said "all killed" while the assertion under test proved nothing:
//
//   1. M8 died to [A-coach-linked-wording], not [A-coach-linked]. The fault
//      matched on the substring "scheduled_at", which is contained in EVERY
//      other games select — so it retargeted to the venue read and aborted with
//      the wrong message. Fixed by adding `selectEquals` (exact match) to the
//      fake client. A substring matcher silently testing a different read is
//      the subtlest version of this failure.
//   2. M3 died to [C] and [D1] — the outer success checks — because the happy
//      path ALSO seeded a previous schedule, making it a second subtraction
//      test that absorbed the mutant, and because the fixture was so tight that
//      under-subtraction annihilated placement rather than reducing it, so the
//      count assertion never evaluated. Fixed by making C start empty and
//      giving D1 slack.
//   3. M9 escaped group D entirely and died at [E-created]. Subtraction happens
//      in TWO loops (venue bookings and team caps); at ten weeks each team still
//      had seven free weeks for six games, so dropping the team-cap subtraction
//      changed nothing D1 could see. Fixed by tightening ROOMY_WEEKS to 8, where
//      both loops bind.
//
// The lesson each time: a red run is not the answer, the right red line is.

/**
 * Simulation harness for round-order matchup placement (the 2026-07-23 fix
 * for the round-destroying shuffle).
 *
 * The bug: generateSchedule wrapped buildMatchups' output in a cross-list
 * shuffle, interleaving pairs from different round-robin rounds. Under a
 * tight weekly cap (games_per_team == playing weeks × max_games_per_week —
 * the live Saturday-league shape) the greedy placer then stranded matchups
 * behind exhausted weekly caps and reported "not enough slots" on divisions
 * with ample fields (eight consecutive live regenerations scored 23–30 of
 * 30). The fix: place round by round (each round is a perfect matching),
 * shuffling only WITHIN a round, most-constrained pairs first.
 *
 * Run with:  TZ=UTC npx tsx scripts/sim/round-order-sim.ts
 * (or `npm run sim:round-order`). TZ=UTC pins the engine's client-timezone
 * date math; the harness refuses to run in any other zone.
 *
 * Invariants asserted on every playthrough (real generateSchedule /
 * finishSchedule via the shared fake client — full playthroughs, never
 * isolated internals, except the targeted orderMatchupsForPlacement unit
 * block):
 *  - 100% PLACEMENT: every fixture here is constructed feasible (weekly
 *    ceiling and venue supply both sufficient — several exactly tight, with
 *    zero slack in one or both dimensions), so unscheduledCount must be 0
 *    and gamesCreated must equal the round-robin's full intent. This is the
 *    assertion the pre-fix engine fails (see mutation procedure).
 *  - BALANCE: the placed schedule IS the round-robin — per-team totals hit
 *    games_per_team exactly (min..min+1 for odd team counts), every pair
 *    plays between floor and ceil of gamesPerTeam/(teamCount-1), and no
 *    matchup is silently dropped.
 *  - REGRESSION: weekly cap, per-day cap, venue min-gap, and team
 *    same-time exclusivity all hold on the final table (independent math,
 *    not the engine's helpers).
 *  - CONSTRAINED-FIRST IS LOAD-BEARING: the 50/70-shaped fixture (6 teams,
 *    one team hard-blocked after 12:00, two 09:00 slots per Saturday) only
 *    reaches 100% placement if the blocked team's pair gets first pick each
 *    round — every one of its games must land at 09:00.
 *  - NO COACH TIER: same-division coach links must not influence ordering.
 *    The COACH12 fixture carries real settings.teams coach links and asserts
 *    only that placement and balance are unaffected by their presence. It
 *    deliberately asserts NOTHING about where coach-linked teams' games land:
 *    the generator does not prevent same-division coach overlap (deferred
 *    Chunk 2), and a coach-first ordering would actively manufacture it by
 *    handing both pairs the same earliest start on different fields.
 *  - STATUS FILTER: finishSchedule ignores cancelled games when counting a
 *    team's games — a cancelled seed must be re-made-up and the cancelled
 *    row left untouched.
 *  - orderMatchupsForPlacement unit block: round groups stay contiguous
 *    (cross-round order never randomized), constrained-before-plain ordering
 *    inside each round (stable), per-round multiset preserved,
 *    interleague-shaped entries (awayId null) handled.
 *
 * Anti-vacuity counters (the run FAILS if any is zero):
 *  - weekExactRuns: playthroughs whose fixture satisfies
 *    dates × max_games_per_week == games_per_team (proven from the fixture
 *    numbers, not assumed) — the exactly-tight scenario the fix exists for
 *  - venueExactRuns: playthroughs where computed slots/date == pairs/round —
 *    zero venue slack, so any ordering mistake is unrecoverable
 *  - constrainedNineAmGames: games proving the constrained-first ordering
 *    actually steered placement
 *  - coachLinkRuns: playthroughs whose fixture really carried same-division
 *    coach links — proof the no-regression coach coverage isn't vacuous
 *  - cancelledSeedRuns: finish playthroughs that really contained a
 *    cancelled seed row
 *  - oddByeRuns: odd-team playthroughs (bye rotation exercised)
 *  - unitOrderVariety: within-round shuffle produced both relative orders
 *    of two equal-priority pairs across unit iterations
 *
 * Mutation-test procedure (manual, per the harness standard). One at a
 * time; the harness must FAIL for every one; restore and re-verify green
 * after each:
 *   1. Re-wrap the intra matchup list in a cross-round shuffle at the
 *      generateSchedule call site (the restored bug) — the exact-tight
 *      fixtures (T12/T16/T6 and tight randoms) fail 100%-placement.
 *   2. Remove the constrained-first priority sort in
 *      orderMatchupsForPlacement — T6's all-at-09:00 assertion and the unit
 *      priority block fail.
 *   3. Remove the within-round shuffle — unitOrderVariety hits zero.
 *   4. Remove finishSchedule's `.neq("status", "cancelled")` — the CANCEL
 *      fixture's per-team non-cancelled counts fail.
 */

process.env.TZ = "UTC";

import {
  generateSchedule,
  finishSchedule,
  orderMatchupsForPlacement,
  type ScheduleResult,
} from "@/lib/schedule/generate-schedule";
import { FakeClient, type Db } from "./fake-supabase";

if (new Date("2026-08-15T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error(
    "This harness must run with TZ=UTC (client-timezone date math would " +
      "shift day boundaries). Re-run as: TZ=UTC npx tsx scripts/sim/round-order-sim.ts",
  );
  process.exit(1);
}

// ── Tiny assertion framework ────────────────────────────────────────────────

let assertions = 0;
let playthroughs = 0;
let weekExactRuns = 0;
let venueExactRuns = 0;
let constrainedNineAmGames = 0;
let coachLinkRuns = 0;
let cancelledSeedRuns = 0;
let oddByeRuns = 0;
let unitOrderVariety = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) failures.push(msg);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const LEAGUE_ID = "league-1";
const DIVISION_ID = "div-1";
// 2026-08-15 .. 2026-10-17 spans exactly 10 Saturdays — the live SRALL Fall
// 2026 season shape (Aug 15/22/29, Sep 5/12/19/26, Oct 3/10/17).
const START_DATE = "2026-08-15";
const END_DATE = "2026-10-17";
const SEASON_DATES = 10;

type ConstraintSpec = {
  day: string;
  start?: string;
  end?: string;
  severity: "block" | "prefer";
};

type CoachLink = { teamIdx: number; linkedIdx: number };

type ShapeSpec = {
  name: string;
  teamCount: number;
  gamesPerTeam: number;
  maxPerWeek: number;
  window: { start: string; end: string }; // earliest_start / latest_start
  gameDuration: number;
  bufferMinutes: number;
  venueCount: number;
  autoRotate?: boolean;
  constraints?: Record<number, ConstraintSpec[]>;
  coachLinks?: CoachLink[];
  seedGames?: Array<{
    homeIdx: number;
    awayIdx: number;
    iso: string;
    venueIdx?: number;
    status?: string;
  }>;
};

function teamId(i: number): string {
  return `team-${i}`;
}

function buildDb(spec: ShapeSpec): FakeClient {
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

  // Only SAME-division coach links: cross-division entries would issue an
  // .ilike() the shared fake doesn't implement (deliberately — the fake
  // throws on new query shapes so they get modeled, not stubbed).
  const settingsTeams = Array.from({ length: spec.teamCount }, (_, i) => {
    const link = (spec.coachLinks ?? []).find((l) => l.teamIdx === i);
    return {
      name: `Team ${i}`,
      has_coach_conflict: !!link,
      conflict_division: "",
      conflict_team: link ? `Team ${link.linkedIdx}` : "",
    };
  });

  db.divisions.push({
    id: DIVISION_ID,
    league_id: LEAGUE_ID,
    name: spec.name,
    start_date: START_DATE,
    end_date: END_DATE,
    intra_division_games_per_team: spec.gamesPerTeam,
    settings: {
      games_per_team: spec.gamesPerTeam,
      max_games_per_week: spec.maxPerWeek,
      max_games_per_team_per_day: 1,
      playing_days: ["Sa"],
      earliest_start: spec.window.start,
      latest_start: spec.window.end,
      game_duration: spec.gameDuration,
      buffer_minutes: spec.bufferMinutes,
      max_games_per_field_per_day: 12,
      bye_weeks: 0,
      auto_rotate: spec.autoRotate ?? true,
      teams: settingsTeams,
    },
  });

  const allDays: Record<string, { start: string; end: string }> = {};
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
    allDays[d] = { start: "07:00", end: "22:00" };
  }
  for (let vi = 0; vi < spec.venueCount; vi++) {
    db.venues.push({
      id: `venue-${vi}`,
      name: `Field ${vi}`,
      availability: allDays,
      availability_configured: true,
    });
    db.division_venues.push({
      division_id: DIVISION_ID,
      venue_id: `venue-${vi}`,
      allow_games: true,
    });
  }

  for (let ti = 0; ti < spec.teamCount; ti++) {
    db.teams.push({
      id: teamId(ti),
      league_id: LEAGUE_ID,
      division_id: DIVISION_ID,
      name: `Team ${ti}`,
    });
  }

  for (const [idxStr, rules] of Object.entries(spec.constraints ?? {})) {
    for (const [ri, c] of rules.entries()) {
      db.team_game_constraints.push({
        id: `tgc-${idxStr}-${ri}`,
        team_id: teamId(Number(idxStr)),
        day_of_week: c.day,
        start_time: c.start ? `${c.start}:00` : null,
        end_time: c.end ? `${c.end}:00` : null,
        severity: c.severity,
        notes: null,
      });
    }
  }

  for (const [si, g] of (spec.seedGames ?? []).entries()) {
    db.games.push({
      id: `seed-${si}`,
      league_id: LEAGUE_ID,
      home_team_id: teamId(g.homeIdx),
      away_team_id: teamId(g.awayIdx),
      interleague_org_id: null,
      venue_id: `venue-${g.venueIdx ?? 0}`,
      scheduled_at: g.iso,
      status: g.status ?? "scheduled",
      is_away: false,
    });
  }

  return new FakeClient(db);
}

// ── Independent capacity math (not the engine's buildSlots) ─────────────────

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Start times per venue per date, replicated from the fixture numbers. The
 *  09:00-anchored grid with interval = duration + buffer, last start at or
 *  before the window end (venue hours 07:00–22:00 never bind in these
 *  fixtures — every fixture's last game ends by 20:30). */
function startsPerVenue(spec: ShapeSpec): number {
  const interval = spec.gameDuration + spec.bufferMinutes;
  return (
    Math.floor((timeToMin(spec.window.end) - timeToMin(spec.window.start)) / interval) + 1
  );
}

/** Prove (not assume) the fixture's tightness class, and bump the
 *  anti-vacuity counters. Every fixture must at least be feasible:
 *  weekly ceiling and venue supply both >= demand. */
function classifyTightness(spec: ShapeSpec): void {
  const n = spec.teamCount;
  const pairsPerRound = Math.floor(n / 2);
  const demand = Math.ceil((n * spec.gamesPerTeam) / 2);
  const weeklyCeiling = pairsPerRound * spec.maxPerWeek * SEASON_DATES;
  const slotsPerDate = startsPerVenue(spec) * spec.venueCount;
  const venueSupply = slotsPerDate * SEASON_DATES;

  assert(
    weeklyCeiling >= demand && venueSupply >= demand,
    `[${spec.name}] fixture is INFEASIBLE by construction: demand ${demand}, weekly ceiling ${weeklyCeiling}, venue supply ${venueSupply}`,
  );
  if (n % 2 === 0 && SEASON_DATES * spec.maxPerWeek === spec.gamesPerTeam) {
    weekExactRuns++;
  }
  if (slotsPerDate === pairsPerRound) {
    venueExactRuns++;
  }
}

// ── Invariant checks over the final games table ─────────────────────────────

type GameRow = {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
  venue_id: string | null;
  scheduled_at: string;
  status: string;
};

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const thu = new Date(d);
  thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const wk = 1 + Math.round((thu.getTime() - jan4.getTime()) / 604800000);
  return `${thu.getFullYear()}-W${String(wk).padStart(2, "0")}`;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function checkPlaythrough(
  label: string,
  spec: ShapeSpec,
  fake: FakeClient,
  res: ScheduleResult,
): void {
  const ctx = (msg: string) => `[${label}] ${msg}`;
  assert(res.success, ctx(`run failed outright: ${res.success ? "" : res.error}`));
  if (!res.success) return;

  // 100% placement — the headline assertion the pre-fix engine fails.
  assert(
    res.unscheduledCount === 0,
    ctx(`${res.unscheduledCount} matchups left unscheduled in a feasible fixture`),
  );

  const games = (fake.db.games as unknown as GameRow[]).filter(
    (g) => g.status !== "cancelled",
  );

  const n = spec.teamCount;
  const isOdd = n % 2 === 1;

  // BALANCE: per-team totals and pair distribution.
  const perTeam = new Map<string, number>();
  const perPair = new Map<string, number>();
  const opponents = new Map<string, Set<string>>();
  for (let i = 0; i < n; i++) {
    perTeam.set(teamId(i), 0);
    opponents.set(teamId(i), new Set());
  }
  for (const g of games) {
    if (!g.away_team_id) continue;
    perTeam.set(g.home_team_id, (perTeam.get(g.home_team_id) ?? 0) + 1);
    perTeam.set(g.away_team_id, (perTeam.get(g.away_team_id) ?? 0) + 1);
    const pk = pairKey(g.home_team_id, g.away_team_id);
    perPair.set(pk, (perPair.get(pk) ?? 0) + 1);
    opponents.get(g.home_team_id)?.add(g.away_team_id);
    opponents.get(g.away_team_id)?.add(g.home_team_id);
  }
  for (const [tid, count] of perTeam) {
    if (isOdd) {
      assert(
        count >= spec.gamesPerTeam && count <= spec.gamesPerTeam + 1,
        ctx(`${tid} has ${count} games, expected ${spec.gamesPerTeam}–${spec.gamesPerTeam + 1} (odd division)`),
      );
    } else {
      assert(
        count === spec.gamesPerTeam,
        ctx(`${tid} has ${count} games, expected exactly ${spec.gamesPerTeam}`),
      );
    }
  }
  const lo = Math.floor(spec.gamesPerTeam / (n - 1));
  const hi = Math.ceil((spec.gamesPerTeam + (isOdd ? 1 : 0)) / (n - 1));
  for (const [pk, count] of perPair) {
    assert(
      count >= 0 && count <= hi,
      ctx(`pair ${pk} plays ${count} games — outside round-robin balance (max ${hi})`),
    );
  }
  if (!isOdd && spec.gamesPerTeam % (n - 1) === 0) {
    // Full uniform cycles: EVERY pair must play exactly gamesPerTeam/(n-1).
    const want = spec.gamesPerTeam / (n - 1);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const count = perPair.get(pairKey(teamId(i), teamId(j))) ?? 0;
        assert(
          count === want,
          ctx(`pair ${teamId(i)}|${teamId(j)} plays ${count}, expected exactly ${want}`),
        );
      }
    }
  } else if (!isOdd && spec.gamesPerTeam < n - 1) {
    // Fewer passes than rounds: all-distinct opponents, no repeats.
    for (const [tid, opps] of opponents) {
      assert(
        opps.size === spec.gamesPerTeam,
        ctx(`${tid} has ${opps.size} distinct opponents, expected ${spec.gamesPerTeam}`),
      );
    }
    for (const [pk, count] of perPair) {
      assert(count <= 1, ctx(`pair ${pk} repeats (${count}) before the round-robin completes`));
    }
  }
  void lo;

  // REGRESSION invariants (independent math over the final table).
  const minGap = spec.gameDuration + spec.bufferMinutes;
  const byVenueDate = new Map<string, number[]>();
  const byTeamTime = new Map<string, number>();
  const byTeamDate = new Map<string, number>();
  const byTeamWeek = new Map<string, number>();
  for (const g of games) {
    const date = g.scheduled_at.substring(0, 10);
    const mins = timeToMin(g.scheduled_at.substring(11, 16));
    if (g.venue_id != null) {
      const list = byVenueDate.get(`${g.venue_id}:${date}`) ?? [];
      list.push(mins);
      byVenueDate.set(`${g.venue_id}:${date}`, list);
    }
    for (const side of [g.home_team_id, g.away_team_id]) {
      if (side == null) continue;
      const tKey = `${side}|${g.scheduled_at.substring(0, 19)}`;
      byTeamTime.set(tKey, (byTeamTime.get(tKey) ?? 0) + 1);
      const dKey = `${side}|${date}`;
      byTeamDate.set(dKey, (byTeamDate.get(dKey) ?? 0) + 1);
      const wKey = `${side}|${isoWeekKey(date)}`;
      byTeamWeek.set(wKey, (byTeamWeek.get(wKey) ?? 0) + 1);
    }
  }
  for (const [key, minsList] of byVenueDate) {
    const sorted = [...minsList].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      assert(
        sorted[i] - sorted[i - 1] >= minGap,
        ctx(`venue double-book at ${key}: ${sorted[i - 1]} and ${sorted[i]} (< ${minGap}m apart)`),
      );
    }
  }
  for (const [key, count] of byTeamTime) {
    assert(count <= 1, ctx(`team double-booked at ${key}`));
  }
  for (const [key, count] of byTeamDate) {
    assert(count <= 1, ctx(`per-day cap broken at ${key}: ${count} > 1`));
  }
  for (const [key, count] of byTeamWeek) {
    assert(
      count <= spec.maxPerWeek,
      ctx(`per-week cap broken at ${key}: ${count} > ${spec.maxPerWeek}`),
    );
  }
}

// ── Playthrough drivers ─────────────────────────────────────────────────────

async function runGenerate(label: string, spec: ShapeSpec): Promise<FakeClient> {
  classifyTightness(spec);
  const fake = buildDb(spec);
  playthroughs++;
  const res = await generateSchedule(DIVISION_ID, fake.asClient());
  checkPlaythrough(label, spec, fake, res);
  if (spec.teamCount % 2 === 1) oddByeRuns++;
  return fake;
}

// ── Fixture suite ───────────────────────────────────────────────────────────

// T12 — the live Majors shape, exactly tight in BOTH dimensions: 12 teams ×
// 10 games / cap 1 per week over exactly 10 Saturdays (every team must play
// every Saturday), and 6 venue slots per Saturday for exactly 6 pairs per
// round (2 fields × starts 09:00/12:00/15:00). Any cross-round interleaving
// strands matchups; the pre-fix engine fails this shape most runs.
const T12: ShapeSpec = {
  name: "T12 majors exact-tight",
  teamCount: 12,
  gamesPerTeam: 10,
  maxPerWeek: 1,
  window: { start: "09:00", end: "15:00" },
  gameDuration: 120,
  bufferMinutes: 60,
  venueCount: 2,
};

// T6 — the live 50/70 shape with the real constraint pattern: 6 teams × 10
// games / cap 1 over 10 Saturdays (week-exact), team 0 hard-blocked from
// 12:00 on (the SRALL Expos rule), so its ONLY legal start is 09:00 and only
// two 09:00 slots exist per Saturday. 100% placement REQUIRES the
// constrained pair to pick before unconstrained pairs claim both 09:00s —
// this is the constrained-first mutation detector.
const T6: ShapeSpec = {
  name: "T6 50/70 constrained exact-tight",
  teamCount: 6,
  gamesPerTeam: 10,
  maxPerWeek: 1,
  window: { start: "09:00", end: "16:00" },
  gameDuration: 180,
  bufferMinutes: 30,
  venueCount: 2,
  constraints: { 0: [{ day: "Sa", start: "12:00", end: "23:59", severity: "block" }] },
};

// T16 — the Rookies shape WITH sufficient fields (the live Rookies division
// is genuinely short — out of scope): 16 teams × 10 games / cap 1 over 10
// Saturdays, single venue with exactly 8 starts (09:00–19:30 every 90min)
// for exactly 8 pairs per round. Week-exact AND venue-exact at once.
const T16: ShapeSpec = {
  name: "T16 rookies-with-fields exact-tight",
  teamCount: 16,
  gamesPerTeam: 10,
  maxPerWeek: 1,
  window: { start: "09:00", end: "19:30" },
  gameDuration: 60,
  bufferMinutes: 30,
  venueCount: 1,
};

// ODD5 — bye rotation: 5 teams, 4 games each. Each of the 5 rounds benches
// one team; after 5 passes every team sits at exactly 4.
const ODD5: ShapeSpec = {
  name: "ODD5 bye rotation",
  teamCount: 5,
  gamesPerTeam: 4,
  maxPerWeek: 1,
  window: { start: "09:00", end: "15:00" },
  gameDuration: 60,
  bufferMinutes: 30,
  venueCount: 1,
};

// COACH12 — same-division coach link between Team 0 and Team 1 (slack shape,
// 15 slots for 6 pairs). There is NO coach tier in the ordering: this
// fixture exists to prove that carrying real coach links in settings.teams
// changes nothing about placement or balance. It asserts NOTHING about where
// teams 0/1's games land — the generator does not prevent their overlap
// (deferred Chunk 2), and a coach-first ordering would hand both pairs the
// same earliest start on different fields, manufacturing that overlap. Never
// add a where-did-the-coach-games-land assertion here.
const COACH12: ShapeSpec = {
  name: "COACH12 coach-first ordering",
  teamCount: 12,
  gamesPerTeam: 4,
  maxPerWeek: 1,
  window: { start: "09:00", end: "15:00" },
  gameDuration: 60,
  bufferMinutes: 30,
  venueCount: 3,
  coachLinks: [{ teamIdx: 0, linkedIdx: 1 }],
};

// CANCEL — finishSchedule's cancelled-game status filter: team 2 vs team 3's
// game was cancelled, so it must NOT count toward their totals; finish must
// bring every team's NON-cancelled count to games_per_team while leaving the
// cancelled row untouched.
const CANCEL: ShapeSpec = {
  name: "CANCEL finish ignores cancelled",
  teamCount: 4,
  gamesPerTeam: 3,
  maxPerWeek: 1,
  window: { start: "09:00", end: "15:00" },
  gameDuration: 60,
  bufferMinutes: 30,
  venueCount: 2,
  seedGames: [
    { homeIdx: 0, awayIdx: 1, iso: "2026-08-15T09:00:00", venueIdx: 0, status: "scheduled" },
    { homeIdx: 2, awayIdx: 3, iso: "2026-08-15T10:30:00", venueIdx: 0, status: "cancelled" },
  ],
};

async function fixedShapes(): Promise<void> {
  // The exact-tight shapes get repeated runs: the within-round shuffle makes
  // each run a fresh ordering, and every single one must fully place.
  for (let i = 0; i < 15; i++) {
    const fake = await runGenerate(`T12#${i}`, T12);
    void fake;
  }

  for (let i = 0; i < 15; i++) {
    const fake = await runGenerate(`T6#${i}`, T6);
    const games = fake.db.games as unknown as GameRow[];
    const t0Games = games.filter(
      (g) => g.home_team_id === teamId(0) || g.away_team_id === teamId(0),
    );
    for (const g of t0Games) {
      const wall = g.scheduled_at.substring(11, 16);
      assert(
        wall === "09:00",
        `[T6#${i}] blocked team's game at ${g.scheduled_at} — only 09:00 is legal`,
      );
      if (wall === "09:00") constrainedNineAmGames++;
    }
  }

  for (let i = 0; i < 10; i++) {
    await runGenerate(`T16#${i}`, T16);
  }

  for (let i = 0; i < 10; i++) {
    await runGenerate(`ODD5#${i}`, ODD5);
  }

  // COACH12: placement and balance (asserted inside runGenerate) must be
  // unaffected by the presence of coach links. No assertion about WHERE the
  // coach-linked teams' games land — see the fixture comment.
  for (let i = 0; i < 10; i++) {
    const fake = await runGenerate(`COACH12#${i}`, COACH12);
    const divSettings = (fake.db.divisions[0] as { settings: { teams: Array<{ has_coach_conflict: boolean }> } }).settings;
    const linked = divSettings.teams.filter((t) => t.has_coach_conflict).length;
    assert(linked > 0, `[COACH12#${i}] fixture lost its coach links`);
    if (linked > 0) coachLinkRuns++;
  }

  // CANCEL — finish path.
  for (let i = 0; i < 5; i++) {
    classifyTightness(CANCEL);
    const fake = buildDb(CANCEL);
    const hadCancelled = fake.db.games.some((g) => g.status === "cancelled");
    assert(hadCancelled, `[CANCEL#${i}] fixture lost its cancelled seed`);
    if (hadCancelled) cancelledSeedRuns++;
    playthroughs++;
    const res = await finishSchedule(DIVISION_ID, fake.asClient());
    assert(
      res.success,
      `[CANCEL#${i}] finish failed: ${res.success ? "" : res.error}`,
    );
    if (!res.success) continue;
    const games = fake.db.games as unknown as GameRow[];
    // Non-cancelled per-team counts must reach games_per_team for EVERY team
    // — with the status filter mutated away, the cancelled game masks teams
    // 2/3's deficit and they end a game short.
    for (let ti = 0; ti < CANCEL.teamCount; ti++) {
      const count = games.filter(
        (g) =>
          g.status !== "cancelled" &&
          (g.home_team_id === teamId(ti) || g.away_team_id === teamId(ti)),
      ).length;
      assert(
        count === CANCEL.gamesPerTeam,
        `[CANCEL#${i}] ${teamId(ti)} has ${count} non-cancelled games, expected ${CANCEL.gamesPerTeam}`,
      );
    }
    const cancelledRow = fake.db.games.find((g) => g.id === "seed-1");
    assert(
      cancelledRow?.status === "cancelled" &&
        cancelledRow?.scheduled_at === "2026-08-15T10:30:00",
      `[CANCEL#${i}] the cancelled row was moved or un-cancelled`,
    );
  }
}

// ── Seeded random feasible shapes ───────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function randomShapes(): Promise<void> {
  const rand = mulberry32(20260723);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  for (let i = 0; i < 40; i++) {
    const teamCount = [4, 6, 8, 10, 12, 14, 16][int(0, 6)];
    const gamesPerTeam = int(4, 10); // == 10 → week-exact (cap 1 × 10 Saturdays)
    // 5 starts/venue (09:00–15:00 every 90min); enough venues for a full round.
    const venueCount = Math.max(1, Math.ceil(teamCount / 2 / 5));
    const spec: ShapeSpec = {
      name: `RAND${i} n=${teamCount} g=${gamesPerTeam}`,
      teamCount,
      gamesPerTeam,
      maxPerWeek: 1,
      window: { start: "09:00", end: "15:00" },
      gameDuration: 60,
      bufferMinutes: 30,
      venueCount,
      autoRotate: rand() < 0.5,
    };
    await runGenerate(`RAND${i}`, spec);
  }
}

// ── orderMatchupsForPlacement unit block ────────────────────────────────────

type UnitPair = { homeId: string; awayId: string | null; tag: string; group: number };

function unitChecks(): void {
  const mk = (group: number, tag: string, a: string, b: string | null): UnitPair => ({
    homeId: a,
    awayId: b,
    tag,
    group,
  });
  // Three groups; constrained team "k" (including an interleague-shaped
  // entry whose only side is constrained). "c" is an ordinary team that
  // happens to share a coach — it must get NO priority, which is exactly
  // what the group-2 assertion below pins down.
  const groups: UnitPair[][] = [
    [
      mk(0, "plain-a", "p1", "p2"),
      mk(0, "coach", "c", "p3"),
      mk(0, "constrained", "k", "p4"),
      mk(0, "plain-b", "p5", "p6"),
    ],
    [mk(1, "il-constrained", "k", null), mk(1, "plain-c", "p1", "p2")],
    [mk(2, "coach-2", "p5", "c"), mk(2, "constrained-2", "p3", "k")],
  ];
  const constrained = new Set(["k"]);

  const seenOrders = new Set<string>();
  for (let iter = 0; iter < 60; iter++) {
    const out = orderMatchupsForPlacement(
      groups.map((g) => [...g]),
      constrained,
    );
    assert(out.length === 8, `[unit] flatten lost pairs: ${out.length} != 8`);

    // Cross-group order is NEVER randomized: group ids must be non-decreasing.
    const groupSeq = out.map((p) => p.group);
    assert(
      groupSeq.every((g, idx) => idx === 0 || g >= groupSeq[idx - 1]),
      `[unit] round groups interleaved: ${groupSeq.join(",")}`,
    );

    // Per-group multiset preserved.
    for (let gi = 0; gi < groups.length; gi++) {
      const want = groups[gi].map((p) => p.tag).sort().join(",");
      const got = out
        .filter((p) => p.group === gi)
        .map((p) => p.tag)
        .sort()
        .join(",");
      assert(got === want, `[unit] group ${gi} multiset changed: ${got} != ${want}`);
    }

    // Priority ordering inside group 0: the constrained pair leads; the
    // coach-sharing pair ranks with the plains (no coach tier).
    const g0 = out.filter((p) => p.group === 0).map((p) => p.tag);
    assert(
      g0[0] === "constrained",
      `[unit] group 0 starts with ${g0[0]}, not the constrained pair`,
    );
    // Interleague-shaped entry (awayId null, constrained home) leads group 1.
    const g1 = out.filter((p) => p.group === 1).map((p) => p.tag);
    assert(
      g1[0] === "il-constrained",
      `[unit] group 1 starts with ${g1[0]} — null-away constrained pair must rank`,
    );
    // NO COACH TIER: group 2 pits a coach-sharing pair against a constrained
    // pair. The constrained one must ALWAYS lead — if a coach tier is ever
    // reintroduced, this flips and fails.
    const g2 = out.filter((p) => p.group === 2).map((p) => p.tag);
    assert(
      g2[0] === "constrained-2",
      `[unit] group 2 starts with ${g2[0]} — a coach-sharing pair outranked a constrained pair`,
    );

    seenOrders.add(g0.slice(1).join(","));
  }
  // Within-round shuffle variety: the three equal-priority pairs of group 0
  // must appear in more than one order across iterations (kills a removed
  // shuffle).
  if (seenOrders.size > 1) unitOrderVariety++;
  assert(
    seenOrders.size > 1,
    "[unit] within-round shuffle never varied the equal-priority order across 60 iterations",
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await fixedShapes();
  await randomShapes();
  unitChecks();

  assert(weekExactRuns > 0, "no week-exact playthrough ran — the tight scenario the fix exists for was never exercised");
  assert(venueExactRuns > 0, "no venue-exact playthrough ran — zero-venue-slack coverage is vacuous");
  assert(
    constrainedNineAmGames > 0,
    "constrained-first ordering never steered a placement — T6 coverage is vacuous",
  );
  assert(
    coachLinkRuns > 0,
    "no playthrough carried same-division coach links — the no-coach-tier no-regression coverage is vacuous",
  );
  assert(cancelledSeedRuns > 0, "the cancelled-seed finish path never ran");
  assert(oddByeRuns > 0, "no odd-team (bye rotation) playthrough ran");
  assert(unitOrderVariety > 0, "unit variety counter never tripped");

  console.log(
    `round-order sim: ${playthroughs} playthroughs, ${assertions} assertions, ${failures.length} failures`,
  );
  console.log(
    `  coverage: ${weekExactRuns} week-exact, ${venueExactRuns} venue-exact, ` +
      `${constrainedNineAmGames} constrained-first placements, ${coachLinkRuns} coach-linked runs, ` +
      `${cancelledSeedRuns} cancelled-seed runs, ${oddByeRuns} odd-team runs`,
  );
  if (failures.length > 0) {
    for (const f of failures.slice(0, 40)) console.error("FAIL:", f);
    if (failures.length > 40) console.error(`… and ${failures.length - 40} more`);
    process.exit(1);
  }
}

void main().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});

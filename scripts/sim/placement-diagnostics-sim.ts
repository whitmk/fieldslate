/**
 * Simulation harness for honest skip-reason attribution.
 * Run: `npm run sim:diagnostics` (TZ=UTC is mandatory — see below).
 *
 * WHAT IT PROVES
 * ──────────────
 *  A. Per-filter attribution fires WHEN AND ONLY WHEN that filter is the
 *     rejecting one. Each Part-1 fixture is built so exactly one filter can
 *     reject, and the assertion is two-sided: the expected cause equals the
 *     unplaced count AND every other cause is zero AND ambiguous is zero.
 *  B. A genuine tie reports as AMBIGUOUS rather than picking arbitrarily.
 *  C. An empty slot pool is a distinct terminal case, not a filter rejection.
 *  D. Arithmetic appears ONLY where a config-level computation proves a gap:
 *     an infeasible weekly cap gets a number, a FEASIBLE weekly cap that bit
 *     from greedy cascade explicitly gets none, and team-time / coach-block /
 *     team-constraint never get one.
 *  E. No shortfall sentence anywhere in the run contains lever advice.
 *  F. PLACEMENT INVARIANCE: the real planSchedule reproduces, exactly, the
 *     placements recorded from the pre-change code at
 *     fixtures/placement-golden.json. This is a reporting change; if a single
 *     game moves, the run fails. Re-record only via the documented procedure
 *     in that file's header — never to make a red run go green.
 *
 * THREE-PART STANDARD
 *  1. Real code, full playthroughs — Part 1 drives the real planSchedule,
 *     Parts 2/3 drive the real generateSchedule and finishSchedule against
 *     the shared fake Supabase client (environment faked, logic never).
 *  2. Mutation-tested — see the procedure block at the bottom of this file.
 *  3. Anti-vacuity counters — every filter must have DOMINATED at least once
 *     across the fixture set, and emptyPool/ambiguous must each have fired.
 *     A counter left at zero fails the run.
 *
 * TZ=UTC is mandatory: buildSlots and the diagnostics' day-of-week derivation
 * both use client-local date math. Pinning the zone keeps Node deterministic;
 * never "fix" a harness date issue by adding timezone handling to the engine.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  planSchedule,
  generateSchedule,
  finishSchedule,
} from "@/lib/schedule/generate-schedule";
import {
  baseInput,
  slotGrid,
  goldenFixtures,
  abandonmentFixture,
  DATES,
  WEEKS,
} from "./fixtures/placement-fixtures";
import {
  describeShortfall,
  REJECTION_FILTERS,
  type PlacementDiagnostics,
  type RejectionFilter,
} from "@/lib/schedule/placement-diagnostics";
import { constraintsFromRows } from "@/lib/schedule/team-constraints";
import { FakeClient, type Db } from "./fake-supabase";

if (process.env.TZ !== "UTC") {
  console.error("This harness requires TZ=UTC. Run it via `npm run sim:diagnostics`.");
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Assertion plumbing ──────────────────────────────────────────────────────

let assertions = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) failures.push(msg);
}

// Anti-vacuity: every filter must dominate at least once, and the two
// non-filter terminal cases must each occur at least once.
const dominatedAtLeastOnce: Record<RejectionFilter, number> = {
  venue_booking: 0, org_field_cap: 0, team_time: 0, daily_cap: 0,
  weekly_cap: 0, coach_block: 0, team_constraint: 0,
};
let emptyPoolSeen = 0;
let ambiguousSeen = 0;
let summariesChecked = 0;
let arithmeticSummaries = 0;
let noArithmeticSummaries = 0;

// ── The no-lever rule, enforced on EVERY sentence the run produces ──────────
//
// Widening a window, shortening a buffer and adding a field can all close the
// same gap, and which is right depends on facts the code doesn't have. Any
// sentence that tells the admin what to change fails the run.
const LEVER_PATTERNS: RegExp[] = [
  /\btry\b/i,
  /\bextend/i,
  /\badd(ing)? (a )?(venue|field|date|week)/i,
  /\breduc/i,
  /\bshorten/i,
  /\bconsider\b/i,
  /\byou (should|could|may want)/i,
];

function checkSentence(label: string, s: string | null): void {
  if (s === null) return;
  summariesChecked++;
  // SHOW_SENTENCES=1 prints every sentence the run produces — the fastest way
  // to read this feature's actual output the way an admin would.
  if (process.env.SHOW_SENTENCES) console.log(`  [${label}] ${s}`);
  for (const re of LEVER_PATTERNS) {
    assert(!re.test(s), `[${label}] shortfall sentence carries lever advice (${re}): "${s}"`);
  }
}

const ARITHMETIC_MARKERS = [/short by \d+/, /short of fitting/, /room for \d+/];
function hasArithmetic(s: string): boolean {
  return ARITHMETIC_MARKERS.some((re) => re.test(s));
}

// ── Part 1 fixtures: direct planSchedule, one filter isolated per fixture ───
//
// planSchedule is pure, so these fixtures state the booking maps exactly.
// Every fixture leaves ALL filters but one in a state where they cannot
// reject, which is what makes the two-sided "and only when" assertion possible.

function totalAttributed(d: PlacementDiagnostics): number {
  return d.emptyPool + d.ambiguous + REJECTION_FILTERS.reduce((n, f) => n + d.byCause[f], 0);
}

/**
 * Two-sided attribution check: `expect` accounts for every unplaced matchup
 * and no other cause fired at all. The "only when" half is what catches a
 * counter that increments on the wrong filter.
 */
function assertSoleCause(label: string, d: PlacementDiagnostics, expect: RejectionFilter, n: number): void {
  assert(d.byCause[expect] === n, `[${label}] ${expect} attributed ${d.byCause[expect]}, expected ${n}`);
  assert(totalAttributed(d) === n, `[${label}] total attributed ${totalAttributed(d)}, expected ${n}`);
  for (const f of REJECTION_FILTERS) {
    if (f === expect) continue;
    assert(d.byCause[f] === 0, `[${label}] ${f} wrongly attributed ${d.byCause[f]}`);
  }
  assert(d.ambiguous === 0, `[${label}] ${d.ambiguous} matchups reported ambiguous`);
  assert(d.emptyPool === 0, `[${label}] ${d.emptyPool} matchups reported empty-pool`);
  if (d.byCause[expect] > 0) dominatedAtLeastOnce[expect]++;
}

function part1(): void {
  // F1 — weekly cap: both teams at cap in every week of the pool.
  {
    const teamWeek = new Map<string, number>();
    for (const w of WEEKS) {
      teamWeek.set(`A|${w}`, 2);
      teamWeek.set(`B|${w}`, 2);
    }
    const res = planSchedule(baseInput({ teamWeek, maxGamesPerWeek: 2 }));
    assert(res.games.length === 0, "[F1] weekly-cap fixture placed a game it should not have");
    assertSoleCause("F1 weekly_cap", res.diagnostics, "weekly_cap", 2);
  }

  // F2 — daily cap: both teams at the per-day cap on every date.
  {
    const teamDay = new Map<string, number>();
    for (const d of DATES) {
      teamDay.set(`A|${d}`, 1);
      teamDay.set(`B|${d}`, 1);
    }
    const res = planSchedule(baseInput({ teamDay, maxPerTeamDay: 1 }));
    assert(res.games.length === 0, "[F2] daily-cap fixture placed a game it should not have");
    assertSoleCause("F2 daily_cap", res.diagnostics, "daily_cap", 2);
  }

  // F3 — venue booking: every (venue, date) already booked at both times.
  {
    const venueBookings = new Map<string, number[]>();
    for (const d of DATES) venueBookings.set(`venue-0:${d}`, [540, 660]);
    const res = planSchedule(baseInput({ venueBookings }));
    assert(res.games.length === 0, "[F3] venue fixture placed a game it should not have");
    assertSoleCause("F3 venue_booking", res.diagnostics, "venue_booking", 2);
  }

  // F4 — team-time collision: team A already booked at every slot time.
  {
    const teamTimes = new Map<string, Set<string>>();
    teamTimes.set("A", new Set(slotGrid().map((s) => s.isoString)));
    teamTimes.set("B", new Set());
    const res = planSchedule(baseInput({ teamTimes }));
    assert(res.games.length === 0, "[F4] team-time fixture placed a game it should not have");
    assertSoleCause("F4 team_time", res.diagnostics, "team_time", 2);
  }

  // F5 — coach block: every slot blocked for team A by a linked team's game.
  {
    const blocked = new Map<string, Set<string>>();
    blocked.set("A", new Set(slotGrid().map((s) => s.isoString)));
    const res = planSchedule(baseInput({ blocked }));
    assert(res.games.length === 0, "[F5] coach-block fixture placed a game it should not have");
    assertSoleCause("F5 coach_block", res.diagnostics, "coach_block", 2);
  }

  // F6 — team constraint: a whole-day severity-'block' rule on both playing
  // days, built through the real constraintsFromRows.
  {
    const constraintRules = constraintsFromRows([
      { team_id: "A", day_of_week: "Sa", start_time: null, end_time: null, severity: "block" },
    ] as never);
    const res = planSchedule(baseInput({ constraintRules }));
    assert(res.games.length === 0, "[F6] constraint fixture placed a game it should not have");
    assertSoleCause("F6 team_constraint", res.diagnostics, "team_constraint", 2);
    // The pre-existing constraintBlockedCount must stay consistent with the
    // new attribution — they count the same matchups from opposite ends.
    assert(
      res.constraintBlockedCount === 2,
      `[F6] constraintBlockedCount ${res.constraintBlockedCount} disagrees with the attribution`,
    );
  }

  // F7 — org field cap: away interleague, partner at capacity on every date.
  {
    const awayByOrgDate = new Map<string, number>();
    for (const d of DATES) awayByOrgDate.set(`org-1|${d}`, 1);
    const res = planSchedule(baseInput({
      matchups: [
        { homeId: "A", awayId: null, interleagueOrgId: "org-1", isAway: true },
        { homeId: "B", awayId: null, interleagueOrgId: "org-1", isAway: true },
      ],
      awayByOrgDate,
      orgFieldCount: new Map([["org-1", 1]]),
    }));
    assert(res.games.length === 0, "[F7] org-cap fixture placed a game it should not have");
    assertSoleCause("F7 org_field_cap", res.diagnostics, "org_field_cap", 2);
  }

  // F8 — empty pool: a distinct terminal case, NOT a filter rejection.
  {
    const res = planSchedule(baseInput({ slots: [] }));
    assert(res.diagnostics.emptyPool === 2, `[F8] emptyPool ${res.diagnostics.emptyPool}, expected 2`);
    assert(
      REJECTION_FILTERS.every((f) => res.diagnostics.byCause[f] === 0),
      "[F8] an empty pool was attributed to a filter",
    );
    assert(res.diagnostics.ambiguous === 0, "[F8] empty pool reported as ambiguous");
    emptyPoolSeen += res.diagnostics.emptyPool;
  }

  // F9 — genuine tie: coach-block covers exactly half the slots, weekly cap
  // exactly the other half. Reporting either one would be an arbitrary pick.
  {
    const all = slotGrid();
    const half = all.slice(0, all.length / 2);
    const rest = all.slice(all.length / 2);
    const blocked = new Map<string, Set<string>>();
    blocked.set("A", new Set(half.map((s) => s.isoString)));
    const teamWeek = new Map<string, number>();
    for (const s of rest) teamWeek.set(`A|${s.weekKey}`, 2);
    const res = planSchedule(baseInput({ blocked, teamWeek, maxGamesPerWeek: 2 }));
    assert(res.games.length === 0, "[F9] tie fixture placed a game it should not have");
    assert(res.diagnostics.ambiguous === 2, `[F9] ambiguous ${res.diagnostics.ambiguous}, expected 2`);
    assert(
      REJECTION_FILTERS.every((f) => res.diagnostics.byCause[f] === 0),
      "[F9] a tie was attributed to a single filter",
    );
    ambiguousSeen += res.diagnostics.ambiguous;
  }

  // F10 — the diagnostic pass is READ-ONLY. Same fixture, run twice against
  // freshly-built maps, must produce identical placements AND identical
  // diagnostics; and a partially-placeable fixture must not have its maps
  // corrupted by the failed matchups' attribution walk.
  {
    const mk = () => baseInput({
      matchups: [
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
        { homeId: "A", awayId: "B", interleagueOrgId: null, isAway: false },
      ],
      maxPerTeamDay: 1,
      maxGamesPerWeek: 1,
      slots: slotGrid().slice(0, 2), // one date, two times — only 1 placeable
    });
    const a = planSchedule(mk());
    const b = planSchedule(mk());
    assert(
      JSON.stringify(a.games) === JSON.stringify(b.games),
      "[F10] identical fixtures produced different placements",
    );
    assert(
      JSON.stringify(a.diagnostics) === JSON.stringify(b.diagnostics),
      "[F10] identical fixtures produced different diagnostics",
    );
    assert(a.games.length === 1, `[F10] expected 1 placement, got ${a.games.length}`);
    assert(totalAttributed(a.diagnostics) === 2, "[F10] unplaced matchups not fully attributed");
  }
}

// ── Part 2: describeShortfall — the arithmetic rules ────────────────────────

function ctxFor(over: Partial<Parameters<typeof describeShortfall>[1]> = {}) {
  return {
    gamesPerTeam: 10,
    maxGamesPerWeek: 1,
    maxPerTeamDay: 1,
    playingDates: DATES,
    homeMatchupCount: 4,
    awayMatchupsByOrg: new Map<string, number>(),
    orgFieldCount: new Map<string, number>(),
    orgNames: new Map<string, string>(),
    slots: slotGrid(),
    venueAvailability: new Map(),
    venueNames: new Map(),
    dayWindow: () => ({ start: "09:00", end: "17:00" }),
    gameDuration: 90,
    bufferMinutes: 15,
    ...over,
  };
}

function diagWith(cause: RejectionFilter, n: number): PlacementDiagnostics {
  const d: PlacementDiagnostics = {
    emptyPool: 0,
    ambiguous: 0,
    byCause: {
      venue_booking: 0, org_field_cap: 0, team_time: 0, daily_cap: 0,
      weekly_cap: 0, coach_block: 0, team_constraint: 0,
    },
  };
  d.byCause[cause] = n;
  return d;
}

function part2(): void {
  // D1 — weekly cap, genuinely INFEASIBLE config: a number is correct.
  // 4 playing weeks at 1/week = room for 4; each team needs 10.
  {
    const s = describeShortfall(diagWith("weekly_cap", 6), ctxFor())!;
    checkSentence("D1", s);
    assert(/weekly game limit/.test(s), `[D1] cause not named: "${s}"`);
    assert(/room for 4, short by 6/.test(s), `[D1] arithmetic wrong or missing: "${s}"`);
    arithmeticSummaries++;
  }

  // D2 — weekly cap, FEASIBLE config: the cap bit from greedy cascade, so
  // there is NO gap to report. This is the case that misled the founder;
  // inventing a number here would be worse than the old message.
  {
    const s = describeShortfall(diagWith("weekly_cap", 6), ctxFor({ gamesPerTeam: 3 }))!;
    checkSentence("D2", s);
    assert(/weekly game limit/.test(s), `[D2] cause not named: "${s}"`);
    assert(!/short by/.test(s), `[D2] fabricated a gap on a feasible config: "${s}"`);
    assert(/stranded behind/.test(s), `[D2] did not say the config is feasible: "${s}"`);
    noArithmeticSummaries++;
  }

  // D3 — daily cap, infeasible: 4 playing dates at 1/day = room for 4.
  {
    const s = describeShortfall(diagWith("daily_cap", 6), ctxFor())!;
    checkSentence("D3", s);
    assert(/games-per-day limit/.test(s), `[D3] cause not named: "${s}"`);
    assert(/room for 4, short by 6/.test(s), `[D3] arithmetic wrong or missing: "${s}"`);
    arithmeticSummaries++;
  }

  // D4 — org field cap, infeasible: 12 away games, 1 field, 4 dates.
  {
    const s = describeShortfall(diagWith("org_field_cap", 8), ctxFor({
      awayMatchupsByOrg: new Map([["org-1", 12]]),
      orgFieldCount: new Map([["org-1", 1]]),
      orgNames: new Map([["org-1", "Westside Little League"]]),
    }))!;
    checkSentence("D4", s);
    assert(/Westside Little League/.test(s), `[D4] partner not named: "${s}"`);
    assert(/room for 4, short by 8/.test(s), `[D4] arithmetic wrong or missing: "${s}"`);
    arithmeticSummaries++;
  }

  // D5 — the three filters that deliberately carry NO arithmetic. A gap here
  // would be fabricated: cascades, another division's schedule, and arbitrary
  // per-team rule sets have no clean unit.
  for (const f of ["team_time", "coach_block", "team_constraint"] as RejectionFilter[]) {
    const s = describeShortfall(diagWith(f, 5), ctxFor())!;
    checkSentence(`D5 ${f}`, s);
    assert(/5 of 5 games/.test(s), `[D5 ${f}] count missing: "${s}"`);
    assert(!hasArithmetic(s), `[D5 ${f}] fabricated arithmetic: "${s}"`);
    noArithmeticSummaries++;
  }

  // D6 — no dominant cause: a plurality short of a majority must NOT be
  // reported as the cause.
  {
    const d = diagWith("weekly_cap", 4);
    d.byCause.coach_block = 3;
    d.byCause.team_time = 3;
    const s = describeShortfall(d, ctxFor())!;
    checkSentence("D6", s);
    assert(/No single cause dominated/.test(s), `[D6] claimed a dominant cause: "${s}"`);
    assert(!hasArithmetic(s), `[D6] arithmetic attached to a non-dominant cause: "${s}"`);
    noArithmeticSummaries++;
  }

  // D7 — nothing unplaced means no sentence at all.
  {
    const d = diagWith("weekly_cap", 0);
    assert(describeShortfall(d, ctxFor()) === null, "[D7] produced a sentence with nothing unplaced");
  }

  // D8 — empty pool majority reports the terminal case, not a filter.
  {
    const d = diagWith("weekly_cap", 1);
    d.emptyPool = 5;
    const s = describeShortfall(d, ctxFor())!;
    checkSentence("D8", s);
    assert(/no candidate times at all/.test(s), `[D8] empty pool not named: "${s}"`);
  }
}

// ── Part 3: full playthroughs against the real engine + fake client ─────────

const LEAGUE_ID = "league-1";
const DIVISION_ID = "div-1";

type Fixture = {
  name: string;
  teamCount: number;
  gamesPerTeam: number;
  startDate: string;
  endDate: string;
  playingDays: string[];
  /** venue open window per playing day */
  venueWindow: { start: string; end: string };
  divisionWindow?: { start: string; end: string };
  /** Use the legacy earliest_start/latest_start + max_games_per_field_per_day
   *  path instead of day_windows — the shape where the venue-window narration
   *  CANNOT be reproduced from the real pool and must stay silent. */
  legacyMaxPerFieldPerDay?: number;
  gameDuration: number;
  bufferMinutes: number;
  maxPerWeek: number;
  maxPerTeamDay: number;
  venueCount: number;
  constraints?: Array<{ teamIdx: number; day: string; severity: "block" | "prefer" }>;
  seedGames?: Array<{ homeIdx: number; awayIdx: number; iso: string; venueIdx: number }>;
};

function buildDb(f: Fixture): FakeClient {
  const db: Db = {
    divisions: [], teams: [], venues: [], division_venues: [],
    blackout_dates: [], games: [], division_interleague_games: [],
    interleague_orgs: [], team_game_constraints: [],
  };

  const win = f.divisionWindow ?? f.venueWindow;
  const dayWindows: Record<string, { start: string; end: string }> = {};
  for (const d of f.playingDays) dayWindows[d] = win;
  const legacy = f.legacyMaxPerFieldPerDay !== undefined;

  db.divisions.push({
    id: DIVISION_ID,
    league_id: LEAGUE_ID,
    name: f.name,
    start_date: f.startDate,
    end_date: f.endDate,
    intra_division_games_per_team: f.gamesPerTeam,
    settings: {
      games_per_team: f.gamesPerTeam,
      max_games_per_week: f.maxPerWeek,
      max_games_per_team_per_day: f.maxPerTeamDay,
      playing_days: f.playingDays,
      // Legacy divisions have no day_windows; buildSlots then caps the day at
      // max_games_per_field_per_day rather than deriving it from the window.
      ...(legacy
        ? { earliest_start: win.start, latest_start: win.end }
        : { day_windows: dayWindows }),
      game_duration: f.gameDuration,
      buffer_minutes: f.bufferMinutes,
      max_games_per_field_per_day: f.legacyMaxPerFieldPerDay ?? 12,
      bye_weeks: 0,
      auto_rotate: true,
      teams: [],
    },
  });

  const venueAvail: Record<string, { start: string; end: string }> = {};
  for (const d of f.playingDays) venueAvail[d] = f.venueWindow;
  for (let v = 0; v < f.venueCount; v++) {
    db.venues.push({
      id: `venue-${v}`,
      name: v === 0 ? "Riverside Field" : `Field ${v}`,
      availability: venueAvail,
      availability_configured: true,
    });
    db.division_venues.push({ division_id: DIVISION_ID, venue_id: `venue-${v}`, allow_games: true });
  }

  for (let i = 0; i < f.teamCount; i++) {
    db.teams.push({ id: `team-${i}`, division_id: DIVISION_ID, league_id: LEAGUE_ID, name: `Team ${i}` });
  }

  for (const c of f.constraints ?? []) {
    db.team_game_constraints.push({
      id: `tgc-${db.team_game_constraints.length}`,
      team_id: `team-${c.teamIdx}`,
      day_of_week: c.day,
      start_time: null,
      end_time: null,
      severity: c.severity,
    });
  }

  for (const [i, g] of (f.seedGames ?? []).entries()) {
    db.games.push({
      id: `seed-${i}`,
      league_id: LEAGUE_ID,
      home_team_id: `team-${g.homeIdx}`,
      away_team_id: `team-${g.awayIdx}`,
      interleague_org_id: null,
      venue_id: `venue-${g.venueIdx}`,
      scheduled_at: g.iso,
      status: "scheduled",
      is_away: false,
    });
  }

  return new FakeClient(db);
}

async function part3(): Promise<void> {
  // P1 — VENUE-WINDOW-STARVED. The motivating fixture: the window is genuinely
  // too short, so the pool is small and the walk then reports venue collisions.
  // 09:00–17:00 with 180+30 fits exactly 2 starts (16:00 would end at 19:00).
  {
    const fx: Fixture = {
      name: "T-Ball",
      teamCount: 6,
      gamesPerTeam: 8,
      startDate: "2026-09-05", // Saturday
      endDate: "2026-10-24",   // 8 Saturdays
      playingDays: ["Sa"],
      venueWindow: { start: "09:00", end: "17:00" },
      gameDuration: 180,
      bufferMinutes: 30,
      maxPerWeek: 3,
      maxPerTeamDay: 2,
      venueCount: 1,
    };
    const res = await generateSchedule(DIVISION_ID, buildDb(fx).asClient());
    assert(res.success, `[P1] generate failed: ${res.success ? "" : res.error}`);
    if (res.success) {
      assert(res.unscheduledCount > 0, "[P1] starved fixture placed everything — fixture is wrong");
      const s = res.shortfallSummary;
      assert(s !== null, "[P1] no shortfall summary on a run with unplaced games");
      if (s) {
        checkSentence("P1", s);
        assert(/field availability/.test(s), `[P1] cause not named: "${s}"`);
        assert(/Riverside Field is open 09:00–17:00 on Saturdays/.test(s), `[P1] window not named: "${s}"`);
        assert(/180-minute games plus a 30-minute buffer/.test(s), `[P1] inputs not named: "${s}"`);
        assert(/fits 2 starts per field/.test(s), `[P1] starts-per-field wrong: "${s}"`);
        assert(/short of fitting 3 starts/.test(s), `[P1] gap wrong or missing: "${s}"`);
        arithmeticSummaries++;
      }
      dominatedAtLeastOnce.venue_booking++;
    }
  }

  // P2 — WEEKLY-CAP-EXACT and feasible. games_per_team == weeks × cap, the
  // live Saturday-league shape. Whatever goes unplaced must NOT be handed a
  // fabricated weekly-cap gap.
  {
    const fx: Fixture = {
      name: "Majors",
      teamCount: 6,
      gamesPerTeam: 8,
      startDate: "2026-09-05",
      endDate: "2026-10-24", // 8 Saturdays
      playingDays: ["Sa"],
      venueWindow: { start: "08:00", end: "20:00" },
      gameDuration: 90,
      bufferMinutes: 15,
      maxPerWeek: 1,
      maxPerTeamDay: 1,
      venueCount: 3,
    };
    const res = await generateSchedule(DIVISION_ID, buildDb(fx).asClient());
    assert(res.success, `[P2] generate failed: ${res.success ? "" : res.error}`);
    if (res.success) {
      checkSentence("P2", res.shortfallSummary);
      if (res.shortfallSummary && /weekly game limit/.test(res.shortfallSummary)) {
        assert(
          !/short by/.test(res.shortfallSummary),
          `[P2] fabricated a weekly gap on a feasible config: "${res.shortfallSummary}"`,
        );
      }
    }
  }

  // P3 — CONSTRAINT-BLOCKED. A whole-day block on the only playing day makes
  // every one of that team's matchups unplaceable for a reason the walk can
  // name exactly.
  {
    const fx: Fixture = {
      name: "Rookies",
      teamCount: 4,
      gamesPerTeam: 6,
      startDate: "2026-09-05",
      endDate: "2026-10-24",
      playingDays: ["Sa"],
      venueWindow: { start: "08:00", end: "20:00" },
      gameDuration: 90,
      bufferMinutes: 15,
      maxPerWeek: 2,
      maxPerTeamDay: 1,
      venueCount: 3,
      constraints: [{ teamIdx: 0, day: "Sa", severity: "block" }],
    };
    const res = await generateSchedule(DIVISION_ID, buildDb(fx).asClient());
    assert(res.success, `[P3] generate failed: ${res.success ? "" : res.error}`);
    if (res.success) {
      assert(res.unscheduledCount > 0, "[P3] constraint fixture placed everything — fixture is wrong");
      assert(res.constraintBlockedCount > 0, "[P3] constraintBlockedCount did not fire");
      const s = res.shortfallSummary;
      assert(s !== null, "[P3] no shortfall summary");
      if (s) {
        checkSentence("P3", s);
        assert(/team scheduling constraints/.test(s), `[P3] cause not named: "${s}"`);
        assert(!hasArithmetic(s), `[P3] fabricated arithmetic for a constraint block: "${s}"`);
        noArithmeticSummaries++;
      }
      dominatedAtLeastOnce.team_constraint++;
    }
  }

  // P5 — REPRODUCE-OR-STAY-SILENT. A legacy division (no day_windows) has its
  // day capped by max_games_per_field_per_day, so the per-field narration
  // derived from the window does NOT reproduce the real pool: the 09:00–17:00
  // window fits 2 starts at 180+30, but the legacy cap of 1 means the real
  // pool holds ONE slot per Saturday. Every later guard in venueWindowGap
  // passes here (2 starts < the 3 needed, gap 2h) — so the reproduce check is
  // the ONLY thing preventing "fits 2 starts per field — 1 game per Saturday",
  // a sentence that contradicts itself. Deliberately tuned this way: an
  // earlier version of this fixture exited at a later guard and let the
  // corresponding mutant survive.
  {
    const fx: Fixture = {
      name: "Legacy",
      teamCount: 6,
      gamesPerTeam: 8,
      startDate: "2026-09-05",
      endDate: "2026-10-24",
      playingDays: ["Sa"],
      venueWindow: { start: "09:00", end: "17:00" },
      gameDuration: 180,
      bufferMinutes: 30,
      maxPerWeek: 3,
      maxPerTeamDay: 2,
      venueCount: 1,
      legacyMaxPerFieldPerDay: 1,
    };
    const res = await generateSchedule(DIVISION_ID, buildDb(fx).asClient());
    assert(res.success, `[P5] generate failed: ${res.success ? "" : res.error}`);
    if (res.success) {
      assert(res.unscheduledCount > 0, "[P5] legacy fixture placed everything — fixture is wrong");
      const s = res.shortfallSummary;
      assert(s !== null, "[P5] no shortfall summary");
      if (s) {
        checkSentence("P5", s);
        assert(/field availability/.test(s), `[P5] cause not named: "${s}"`);
        assert(
          !/fits \d+ start/.test(s) && !/short of fitting/.test(s),
          `[P5] narrated a per-field figure it cannot reproduce from the real pool: "${s}"`,
        );
        noArithmeticSummaries++;
      }
    }
  }

  // P4 — FINISH PATH. finishSchedule carries a deliberate inline copy of the
  // walk; its attribution must fire too. Seeding a full Saturday and leaving
  // a tight window forces deficits the copy cannot place.
  {
    const fx: Fixture = {
      name: "Finish",
      teamCount: 6,
      gamesPerTeam: 8,
      startDate: "2026-09-05",
      endDate: "2026-10-24",
      playingDays: ["Sa"],
      venueWindow: { start: "09:00", end: "17:00" },
      gameDuration: 180,
      bufferMinutes: 30,
      maxPerWeek: 3,
      maxPerTeamDay: 2,
      venueCount: 1,
      seedGames: [
        { homeIdx: 0, awayIdx: 1, iso: "2026-09-05T09:00:00", venueIdx: 0 },
        { homeIdx: 2, awayIdx: 3, iso: "2026-09-05T12:30:00", venueIdx: 0 },
      ],
    };
    const res = await finishSchedule(DIVISION_ID, buildDb(fx).asClient());
    assert(res.success, `[P4] finish failed: ${res.success ? "" : res.error}`);
    if (res.success) {
      assert(res.unscheduledCount > 0, "[P4] finish placed everything — fixture is wrong");
      const s = res.shortfallSummary;
      assert(s !== null, "[P4] finish produced no shortfall summary despite unplaced games");
      if (s) {
        checkSentence("P4", s);
        assert(
          /blocked by|No single cause dominated|no candidate times/.test(s),
          `[P4] finish summary named no cause: "${s}"`,
        );
      }
    }
  }
}

// ── Part 4: placement invariance ───────────────────────────────────────────
//
// The golden file records the placements the PRE-CHANGE code produced for the
// Part-1 fixtures. This is a reporting change: if a single game moves, the
// diagnostic pass has leaked into placement and the run must fail.

function part4(): void {
  const goldenPath = join(HERE, "fixtures", "placement-golden.json");
  let golden: Record<string, unknown>;
  try {
    golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  } catch {
    failures.push(`[INV] golden file missing or unreadable at ${goldenPath} — placement invariance UNPROVEN`);
    assertions++;
    return;
  }

  for (const [name, input] of goldenFixtures()) {
    const res = planSchedule(input);
    const actual = JSON.stringify(res.games);
    const expected = JSON.stringify((golden as Record<string, unknown>)[name]);
    assert(
      expected !== undefined,
      `[INV] golden has no entry for fixture "${name}" — re-record before trusting this run`,
    );
    assert(
      actual === expected,
      `[INV] placement moved for "${name}".\n  before: ${expected}\n  after:  ${actual}`,
    );
  }

  // INV2 — the read-only property, proven without the golden. An abandoned
  // matchup triggers the diagnostic pass; if that pass wrote to any booking
  // map, the FOUR placements that follow it would differ from the same run
  // with the abandoned matchup removed. This is the assertion that fails if
  // someone moves the pass above the abandonment check or lets it mutate.
  {
    const withAbandon = planSchedule(abandonmentFixture(false));
    const without = planSchedule(abandonmentFixture(true));
    assert(
      withAbandon.diagnostics.emptyPool + withAbandon.diagnostics.ambiguous +
        REJECTION_FILTERS.reduce((n, f) => n + withAbandon.diagnostics.byCause[f], 0) === 1,
      "[INV2] fixture did not abandon exactly one matchup — the invariance check would be vacuous",
    );
    assert(
      withAbandon.games.length === 4,
      `[INV2] expected 4 placements after the abandonment, got ${withAbandon.games.length}`,
    );
    assert(
      JSON.stringify(withAbandon.games) === JSON.stringify(without.games),
      "[INV2] the diagnostic pass changed placement — it is not read-only.\n" +
        `  with abandoned matchup: ${JSON.stringify(withAbandon.games.map((g) => g.scheduled_at))}\n` +
        `  without:                ${JSON.stringify(without.games.map((g) => g.scheduled_at))}`,
    );
  }
}

// ── Anti-vacuity ────────────────────────────────────────────────────────────

function antiVacuity(): void {
  for (const f of REJECTION_FILTERS) {
    assert(
      dominatedAtLeastOnce[f] > 0,
      `[VACUITY] filter "${f}" never dominated in any fixture — its attribution is unproven`,
    );
  }
  assert(emptyPoolSeen > 0, "[VACUITY] the empty-pool terminal case never fired");
  assert(ambiguousSeen > 0, "[VACUITY] the ambiguous (tie) case never fired");
  assert(arithmeticSummaries >= 4, `[VACUITY] only ${arithmeticSummaries} summaries carried arithmetic`);
  assert(noArithmeticSummaries >= 4, `[VACUITY] only ${noArithmeticSummaries} summaries deliberately omitted arithmetic`);
  assert(summariesChecked >= 10, `[VACUITY] only ${summariesChecked} sentences were lever-scanned`);
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  part1();
  part2();
  await part3();
  part4();
  antiVacuity();

  console.log(`\nplacement-diagnostics-sim: ${assertions} assertions`);
  console.log(
    `  coverage — dominated: ${REJECTION_FILTERS.map((f) => `${f}=${dominatedAtLeastOnce[f]}`).join(" ")}`,
  );
  console.log(
    `  coverage — emptyPool=${emptyPoolSeen} ambiguous=${ambiguousSeen} ` +
    `withArithmetic=${arithmeticSummaries} withoutArithmetic=${noArithmeticSummaries} ` +
    `leverScanned=${summariesChecked}`,
  );

  if (failures.length) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  all green\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/* ── MUTATION PROCEDURE ──────────────────────────────────────────────────────
 *
 * KILL CRITERION: a mutant is killed only when a BASELINE ASSERTION FAILS —
 * not merely when behavior differs. Run each mutant, confirm a red run, then
 * restore and re-verify green.
 *
 *  M1  planSchedule: delete the `recordAbandonment(...)` call.
 *  M2  finishSchedule: delete its `recordAbandonment(...)` call.
 *  M3  planSchedule: replace `diagnostics.emptyPool++` with a no-op.
 *  M4  tallyRejections: drop the `venue_booking` increment.
 *  M5  tallyRejections: drop the `weekly_cap` increment.
 *  M6  tallyRejections: drop the `daily_cap` increment.
 *  M7  tallyRejections: drop the `team_time` increment.
 *  M8  tallyRejections: drop the `coach_block` increment.
 *  M9  tallyRejections: drop the `team_constraint` increment.
 *  M10 tallyRejections: drop the `org_field_cap` increment.
 *  M11 dominantFilter: return the first non-zero filter instead of the max
 *      (i.e. remove the tie check) — must break the ambiguous fixture.
 *  M12 weeklyCapGap: emit the "short by" number unconditionally, dropping the
 *      feasible-config branch. THIS IS THE FABRICATED-GAP MUTANT — it must be
 *      killed by D2, the case that misled the founder.
 *  M13 venueWindowGap: drop the reproduce-or-stay-silent check
 *      (`startsPerField * openVenues.length !== supplyThatDate`).
 *  M14 describeShortfall: report the top cause on a plurality (drop the
 *      `topN * 2 <= total` majority test) — must break D6.
 *  M15 planSchedule: make the diagnostic pass mutate state (e.g. call it
 *      before the abandonment check) — must break the INV placement golden.
 */

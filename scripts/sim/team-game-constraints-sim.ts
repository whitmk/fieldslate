/**
 * Simulation harness for team-level game hard-block constraints (0076).
 *
 * Drives the REAL schedule generator — generateSchedule and finishSchedule,
 * including finishSchedule's deliberate inline copy of the planner loop —
 * against an in-memory fake of the Supabase client implementing exactly the
 * query-builder subset and PostgREST embeds the engine issues. Fixtures are
 * generated division shapes: teams with severity-'block' and 'prefer'
 * constraint rows (windowed and whole-day), venues, interleague configs,
 * and pre-seeded existing games for the finish path.
 *
 * Run with:  TZ=UTC npx tsx scripts/sim/team-game-constraints-sim.ts
 * (or `npm run sim:game-constraints`). TZ=UTC pins the engine's
 * client-timezone date math (see src/lib/schedule/team-constraints.ts) so
 * day-of-week boundaries are unambiguous in Node; the harness refuses to
 * run in any other zone.
 *
 * Invariants asserted on every playthrough:
 *  - CORE: no game is ever placed at a (day, time) covered by a
 *    severity-'block' rule of its home team, or of its away team when the
 *    away side is a local team. Checked with an INDEPENDENT re-implementation
 *    of the window semantics (not the shared lib the engine uses), so a lib
 *    bug cannot self-verify.
 *  - interleague rows check the home (local) team only: away_team_id null,
 *    pending status, away games venue-less, per-org daily field_count held
 *  - 'prefer' rows never block: games still land inside prefer windows
 *  - prefer honored when possible (chunk 2b two-pass): with ample non-prefer
 *    slots a prefer team's games land OUTSIDE its windows and
 *    preferMissCount is 0; when ALL legal slots sit inside a prefer window
 *    the matchups still schedule (pass-2 fallback) and preferMissCount
 *    matches an independent per-shape recount; shapes with no prefer rules
 *    always report preferMissCount 0, and preferMissCount never exceeds the
 *    independently-recounted number of placements inside prefer windows
 *  - pre-existing rows survive finishSchedule untouched — including a seeded
 *    game deliberately inside a block window (manual placements are not the
 *    generator's to move)
 *  - venue min-gap, team double-book, per-day and per-week caps all hold
 *    (regression guard: the new filter must not loosen the old ones)
 *  - result accounting: gamesCreated matches rows written;
 *    constraintBlockedCount <= unscheduledCount; a fully-blocked team gets
 *    zero games and a nonzero distinct constraint report; the total-failure
 *    error message names the constraint cause
 *  - fail-closed: an injected team_game_constraints read error aborts the
 *    run BEFORE any delete/insert touches games
 *
 * Anti-vacuity counters (the run FAILS if any is zero):
 *  - planDeflections / finishDeflections: games placed by each loop copy
 *    whose team had an EARLIER same-day candidate slot inside a block
 *    window — proof that each copy actually rejected blocked candidates
 *    (and therefore that disabling either copy's check is detectable)
 *  - constraintBlockedReports: distinct constraint-blocked matchups reported
 *  - preferInWindowGames: games scheduled inside 'prefer' windows — proof
 *    the prefer-never-blocks invariant isn't running vacuously
 *  - preferMissTotal: pass-2 placements reported across runs — proof the
 *    pass-2 fallback actually fires (and that disabling pass-1's skip is
 *    detectable: with the skip gone, first-fit lands in-window and the
 *    prefer-honored shapes fail their hard assertions)
 *  - planPreferDeflections / finishPreferDeflections: games of prefer teams
 *    placed OUTSIDE their windows where an earlier same-day candidate sat
 *    inside one — proof each loop copy's pass-1 skip actually deflected
 *
 * Mutation-test procedure (manual, per the harness standard): one at a
 * time, disable in each loop copy (a) the violatesHardConstraint checks and
 * (b) pass-1's prefersToAvoid skip; the harness must FAIL for every mutant;
 * restore and re-verify green after each. The deflection counters above
 * guarantee all four mutants are exercised by the fixtures.
 */

process.env.TZ = "UTC";

import {
  generateSchedule,
  finishSchedule,
  type ScheduleResult,
} from "@/lib/schedule/generate-schedule";
import { FakeClient, type Db } from "./fake-supabase";

if (new Date("2026-09-05T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error(
    "This harness must run with TZ=UTC (client-timezone date math would " +
      "shift day boundaries). Re-run as: TZ=UTC npx tsx scripts/sim/team-game-constraints-sim.ts",
  );
  process.exit(1);
}

// ── Tiny assertion framework ────────────────────────────────────────────────

let assertions = 0;
let playthroughs = 0;
let planDeflections = 0;
let finishDeflections = 0;
let constraintBlockedReports = 0;
let preferInWindowGames = 0;
let preferMissTotal = 0;
let planPreferDeflections = 0;
let finishPreferDeflections = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) failures.push(msg);
}

// ── In-memory fake Supabase client: shared module (./fake-supabase.ts) ──────

// ── Fixture generation ──────────────────────────────────────────────────────

const LEAGUE_ID = "league-1";
const DIVISION_ID = "div-1";
// 2026-09-05 is a Saturday; 8 weekends before 2026-10-25.
const START_DATE = "2026-09-05";
const END_DATE = "2026-10-25";

type ConstraintSpec = {
  day: string; // Mo..Su
  start?: string; // "HH:MM"; omit both for whole-day
  end?: string;
  severity: "block" | "prefer";
};

type ShapeSpec = {
  name: string;
  teamCount: number;
  /** team index → constraint rows */
  constraints: Record<number, ConstraintSpec[]>;
  gamesPerTeam: number;
  playingDays: string[];
  window: { start: string; end: string }; // earliest_start / latest_start
  gameDuration?: number; // default 75
  bufferMinutes?: number; // default 15
  maxPerTeamDay?: number; // default 1
  maxPerWeek?: number; // default 3
  venueCount?: number; // default 1
  interleague?: { gameCount: number; homePerTeam: number; fieldCount: number };
  /** pre-seeded existing games (finish-path shapes) */
  seedGames?: Array<{
    homeIdx: number;
    awayIdx: number;
    iso: string; // "YYYY-MM-DDTHH:MM:SS"
    venueIdx?: number;
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

  db.divisions.push({
    id: DIVISION_ID,
    league_id: LEAGUE_ID,
    name: spec.name,
    start_date: START_DATE,
    end_date: END_DATE,
    intra_division_games_per_team: spec.gamesPerTeam,
    settings: {
      games_per_team: spec.gamesPerTeam,
      max_games_per_week: spec.maxPerWeek ?? 3,
      max_games_per_team_per_day: spec.maxPerTeamDay ?? 1,
      playing_days: spec.playingDays,
      earliest_start: spec.window.start,
      latest_start: spec.window.end,
      game_duration: spec.gameDuration ?? 75,
      buffer_minutes: spec.bufferMinutes ?? 15,
      max_games_per_field_per_day: 12,
      bye_weeks: 0,
      auto_rotate: true,
      teams: [], // no coach-conflict entries — that path is out of scope here
    },
  });

  const venueCount = spec.venueCount ?? 1;
  const allDays: Record<string, { start: string; end: string }> = {};
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
    allDays[d] = { start: "07:00", end: "22:00" };
  }
  for (let vi = 0; vi < venueCount; vi++) {
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

  for (const [idxStr, rules] of Object.entries(spec.constraints)) {
    for (const [ri, c] of rules.entries()) {
      db.team_game_constraints.push({
        id: `tgc-${idxStr}-${ri}`,
        team_id: teamId(Number(idxStr)),
        day_of_week: c.day,
        // stored as HH:MM:SS to mirror Postgres `time` output
        start_time: c.start ? `${c.start}:00` : null,
        end_time: c.end ? `${c.end}:00` : null,
        severity: c.severity,
        notes: null,
      });
    }
  }

  if (spec.interleague) {
    db.interleague_orgs.push({
      id: "org-1",
      field_count: spec.interleague.fieldCount,
    });
    db.division_interleague_games.push({
      division_id: DIVISION_ID,
      interleague_org_id: "org-1",
      game_count: spec.interleague.gameCount,
      home_games_per_team: spec.interleague.homePerTeam,
    });
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
      status: "scheduled",
      is_away: false,
    });
  }

  return new FakeClient(db);
}

// ── Independent invariant math (NOT the shared lib the engine uses) ─────────

const JS_TO_DAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function dayCodeOf(dateStr: string): string {
  return JS_TO_DAY[new Date(dateStr + "T00:00:00").getDay()];
}

function hhmm(t: string): string {
  return t.slice(0, 5);
}

type ConstraintRow = {
  team_id: string;
  day_of_week: string;
  start_time: string | null;
  end_time: string | null;
  severity: string;
};

function ruleCovers(c: ConstraintRow, iso: string): boolean {
  if (c.day_of_week !== dayCodeOf(iso.substring(0, 10))) return false;
  if (c.start_time == null || c.end_time == null) return true;
  const wall = iso.substring(11, 16);
  return wall >= hhmm(c.start_time) && wall < hhmm(c.end_time);
}

/** Thursday-anchored ISO week key — mirrors the engine's weekKey for the
 *  per-week cap invariant. */
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const thu = new Date(d);
  thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const wk = 1 + Math.round((thu.getTime() - jan4.getTime()) / 604800000);
  return `${thu.getFullYear()}-W${String(wk).padStart(2, "0")}`;
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minToTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** The division's candidate start times, replicated from the shape's window
 *  and interval — used only to prove deflections (earlier blocked slots on
 *  the same day) actually existed. */
function gridTimes(spec: ShapeSpec): string[] {
  const interval = Math.max(1, (spec.gameDuration ?? 75) + (spec.bufferMinutes ?? 15));
  const out: string[] = [];
  for (let t = timeToMin(spec.window.start); t <= timeToMin(spec.window.end); t += interval) {
    out.push(minToTime(t));
  }
  return out;
}

// ── Playthrough invariant checks ────────────────────────────────────────────

type GameRow = {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
  interleague_org_id: string | null;
  venue_id: string | null;
  scheduled_at: string;
  status: string;
  is_away: boolean;
};

function checkPlaythrough(
  label: string,
  spec: ShapeSpec,
  fake: FakeClient,
  res: ScheduleResult,
  beforeIds: Set<string>,
  path: "plan" | "finish",
): void {
  const ctx = (msg: string) => `[${label}] ${msg}`;
  assert(res.success, ctx(`run failed outright: ${res.success ? "" : res.error}`));
  if (!res.success) return;

  const db = fake.db;
  const games = db.games as unknown as GameRow[];
  const inserted = games.filter((g) => !beforeIds.has(g.id));
  const constraints = db.team_game_constraints as unknown as ConstraintRow[];
  const blocksByTeam = new Map<string, ConstraintRow[]>();
  const prefersByTeam = new Map<string, ConstraintRow[]>();
  for (const c of constraints) {
    const target = c.severity === "block" ? blocksByTeam : prefersByTeam;
    const list = target.get(c.team_id) ?? [];
    list.push(c);
    target.set(c.team_id, list);
  }

  // result accounting
  assert(
    res.gamesCreated === inserted.length,
    ctx(`gamesCreated ${res.gamesCreated} != inserted rows ${inserted.length}`),
  );
  assert(
    res.constraintBlockedCount <= res.unscheduledCount,
    ctx(
      `constraintBlockedCount ${res.constraintBlockedCount} > unscheduledCount ${res.unscheduledCount}`,
    ),
  );
  constraintBlockedReports += res.constraintBlockedCount;

  // preferMissCount accounting (chunk 2b), independently recounted: every
  // pass-2 placement lands inside someone's prefer window, so the reported
  // count can never exceed the recount; a shape with no prefer rules can
  // never report a miss.
  const insertedInPreferWindow = inserted.filter((g) =>
    [g.home_team_id, g.away_team_id].some(
      (side) =>
        side != null &&
        (prefersByTeam.get(side) ?? []).some((c) => ruleCovers(c, g.scheduled_at)),
    ),
  ).length;
  assert(
    res.preferMissCount <= insertedInPreferWindow,
    ctx(
      `preferMissCount ${res.preferMissCount} exceeds independent in-window recount ${insertedInPreferWindow}`,
    ),
  );
  if (prefersByTeam.size === 0) {
    assert(
      res.preferMissCount === 0,
      ctx(`no prefer rules exist but preferMissCount is ${res.preferMissCount}`),
    );
  }
  preferMissTotal += res.preferMissCount;

  const grid = gridTimes(spec);

  for (const g of inserted) {
    // CORE: no game inside a severity-'block' window of either local team
    for (const side of [g.home_team_id, g.away_team_id]) {
      if (side == null) continue;
      for (const c of blocksByTeam.get(side) ?? []) {
        assert(
          !ruleCovers(c, g.scheduled_at),
          ctx(
            `game ${g.id} at ${g.scheduled_at} violates ${side}'s block ` +
              `${c.day_of_week} ${c.start_time ?? "all"}–${c.end_time ?? "day"}`,
          ),
        );
      }
    }

    // interleague shape: away_team_id null, pending status, away = venue-less
    if (g.interleague_org_id != null) {
      assert(g.away_team_id === null, ctx(`interleague game ${g.id} has an away_team_id`));
      assert(
        g.status === "pending_interleague",
        ctx(`interleague game ${g.id} status ${g.status}`),
      );
      if (g.is_away) {
        assert(g.venue_id === null, ctx(`away interleague game ${g.id} claims a venue`));
      }
    } else {
      assert(g.away_team_id !== null, ctx(`intra game ${g.id} missing away_team_id`));
    }

    // deflection counter: this team had an EARLIER candidate time on the
    // same date sitting inside one of its block windows — i.e. first-fit
    // must have rejected it to land here. Split per path so BOTH loop
    // copies are proven load-bearing.
    const date = g.scheduled_at.substring(0, 10);
    const wall = g.scheduled_at.substring(11, 16);
    for (const side of [g.home_team_id, g.away_team_id]) {
      if (side == null) continue;
      const blocks = blocksByTeam.get(side) ?? [];
      if (blocks.length === 0) continue;
      const deflected = grid.some(
        (t) => t < wall && blocks.some((c) => ruleCovers(c, `${date}T${t}:00`)),
      );
      if (deflected) {
        if (path === "plan") planDeflections++;
        else finishDeflections++;
      }
    }

    // prefer-never-blocks coverage
    for (const side of [g.home_team_id, g.away_team_id]) {
      if (side == null) continue;
      if ((prefersByTeam.get(side) ?? []).some((c) => ruleCovers(c, g.scheduled_at))) {
        preferInWindowGames++;
      }
    }

    // prefer-honored deflections (chunk 2b): a prefer team's game placed
    // OUTSIDE its windows while an earlier same-day candidate (not hard-
    // blocked for that team) sat inside one — pass-1's skip must have
    // rejected it. Split per path so BOTH loop copies' pass-1 skips are
    // proven load-bearing.
    for (const side of [g.home_team_id, g.away_team_id]) {
      if (side == null) continue;
      const prefers = prefersByTeam.get(side) ?? [];
      if (prefers.length === 0) continue;
      if (prefers.some((c) => ruleCovers(c, g.scheduled_at))) continue; // in-window: no deflection
      const blocks = blocksByTeam.get(side) ?? [];
      const deflected = grid.some((t) => {
        if (t >= wall) return false;
        const candidate = `${date}T${t}:00`;
        return (
          prefers.some((c) => ruleCovers(c, candidate)) &&
          !blocks.some((c) => ruleCovers(c, candidate))
        );
      });
      if (deflected) {
        if (path === "plan") planPreferDeflections++;
        else finishPreferDeflections++;
      }
    }
  }

  // regression invariants over ALL games (seeds were built non-violating
  // except where a shape deliberately seeds a violating row — those are
  // excluded from the block check above by the beforeIds filter):
  const minGap = (spec.gameDuration ?? 75) + (spec.bufferMinutes ?? 15);
  const byVenueDate = new Map<string, number[]>();
  const byTeamTime = new Map<string, number>();
  const byTeamDate = new Map<string, number>();
  const byTeamWeek = new Map<string, number>();
  const byOrgDateAway = new Map<string, number>();
  for (const g of games) {
    const date = g.scheduled_at.substring(0, 10);
    const mins = timeToMin(g.scheduled_at.substring(11, 16));
    if (g.venue_id != null) {
      const key = `${g.venue_id}:${date}`;
      const list = byVenueDate.get(key) ?? [];
      list.push(mins);
      byVenueDate.set(key, list);
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
    if (g.is_away && g.interleague_org_id != null) {
      const key = `${g.interleague_org_id}|${date}`;
      byOrgDateAway.set(key, (byOrgDateAway.get(key) ?? 0) + 1);
    }
  }
  for (const [key, minsList] of byVenueDate) {
    const sorted = [...minsList].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      assert(
        sorted[i] - sorted[i - 1] >= minGap,
        ctx(`venue double-book at ${key}: starts ${sorted[i - 1]} and ${sorted[i]} (< ${minGap}m apart)`),
      );
    }
  }
  for (const [key, count] of byTeamTime) {
    assert(count <= 1, ctx(`team double-booked at ${key}`));
  }
  const maxPerDay = spec.maxPerTeamDay ?? 1;
  for (const [key, count] of byTeamDate) {
    assert(count <= maxPerDay, ctx(`per-day cap broken at ${key}: ${count} > ${maxPerDay}`));
  }
  const maxPerWeek = spec.maxPerWeek ?? 3;
  for (const [key, count] of byTeamWeek) {
    assert(count <= maxPerWeek, ctx(`per-week cap broken at ${key}: ${count} > ${maxPerWeek}`));
  }
  if (spec.interleague) {
    for (const [key, count] of byOrgDateAway) {
      assert(
        count <= spec.interleague.fieldCount,
        ctx(`org field_count broken at ${key}: ${count} > ${spec.interleague.fieldCount}`),
      );
    }
  }
}

// ── Playthrough drivers ─────────────────────────────────────────────────────

async function runGenerate(
  label: string,
  spec: ShapeSpec,
): Promise<{ fake: FakeClient; res: ScheduleResult }> {
  const fake = buildDb(spec);
  const beforeIds = new Set(fake.db.games.map((g) => g.id as string));
  playthroughs++;
  const res = await generateSchedule(DIVISION_ID, fake.asClient());
  checkPlaythrough(label, spec, fake, res, beforeIds, "plan");
  return { fake, res };
}

async function runFinish(
  label: string,
  spec: ShapeSpec,
  fake?: FakeClient,
): Promise<{ fake: FakeClient; res: ScheduleResult }> {
  const f = fake ?? buildDb(spec);
  const beforeIds = new Set(f.db.games.map((g) => g.id as string));
  const beforeSnapshot = new Map(
    f.db.games.map((g) => [g.id as string, `${g.scheduled_at}|${g.venue_id}`]),
  );
  playthroughs++;
  const res = await finishSchedule(DIVISION_ID, f.asClient());
  checkPlaythrough(label, spec, f, res, beforeIds, "finish");
  // finish never moves or deletes pre-existing rows
  for (const [id, snap] of beforeSnapshot) {
    const now = f.db.games.find((g) => g.id === id);
    assert(!!now, `[${label}] pre-existing game ${id} disappeared during finish`);
    if (now) {
      assert(
        `${now.scheduled_at}|${now.venue_id}` === snap,
        `[${label}] pre-existing game ${id} was moved during finish`,
      );
    }
  }
  return { fake: f, res };
}

// ── Fixed shapes ────────────────────────────────────────────────────────────

// Grid with 75+15 interval and 09:00–15:00 window: 09:00 10:30 12:00 13:30 15:00.
const WINDOW = { start: "09:00", end: "15:00" };

async function fixedShapes(): Promise<void> {
  // A. Baseline — no constraints, everything schedules, zero reports.
  {
    const spec: ShapeSpec = {
      name: "A baseline",
      teamCount: 4,
      constraints: {},
      gamesPerTeam: 3,
      playingDays: ["Sa", "Su"],
      window: WINDOW,
      venueCount: 2,
    };
    const { res } = await runGenerate("A", spec);
    if (res.success) {
      assert(res.unscheduledCount === 0, `[A] baseline left ${res.unscheduledCount} unscheduled`);
      assert(res.constraintBlockedCount === 0, `[A] baseline reported constraint blocks`);
    }
  }

  // B. Morning block — team 0 can't play Sa before 12:00. The blocked window
  // covers the EARLIEST slots, so first-fit would violate without the check
  // (this is the planSchedule mutation-detector shape).
  {
    const spec: ShapeSpec = {
      name: "B morning block",
      teamCount: 4,
      constraints: {
        0: [{ day: "Sa", start: "09:00", end: "12:00", severity: "block" }],
      },
      gamesPerTeam: 4,
      playingDays: ["Sa"],
      window: WINDOW,
      venueCount: 2,
    };
    const { fake, res } = await runGenerate("B", spec);
    if (res.success) {
      const t0Games = (fake.db.games as unknown as GameRow[]).filter(
        (g) => g.home_team_id === teamId(0) || g.away_team_id === teamId(0),
      );
      assert(t0Games.length > 0, "[B] blocked-morning team got no games at all");
    }
  }

  // C. Whole-day block — team 0 never plays Saturdays; Sundays only.
  {
    const spec: ShapeSpec = {
      name: "C whole-day block",
      teamCount: 4,
      constraints: { 0: [{ day: "Sa", severity: "block" }] },
      gamesPerTeam: 3,
      playingDays: ["Sa", "Su"],
      window: WINDOW,
      venueCount: 2,
    };
    const { fake, res } = await runGenerate("C", spec);
    if (res.success) {
      const t0OnSat = (fake.db.games as unknown as GameRow[]).filter(
        (g) =>
          (g.home_team_id === teamId(0) || g.away_team_id === teamId(0)) &&
          dayCodeOf(g.scheduled_at.substring(0, 10)) === "Sa",
      );
      assert(t0OnSat.length === 0, `[C] whole-day-blocked team got ${t0OnSat.length} Saturday games`);
    }
  }

  // D. Fully blocked team — every playing day covered by blocks. The team
  // must get ZERO games and the run must report the distinct cause.
  {
    const spec: ShapeSpec = {
      name: "D fully blocked",
      teamCount: 4,
      constraints: { 0: [{ day: "Sa", severity: "block" }] },
      gamesPerTeam: 2,
      playingDays: ["Sa"],
      window: WINDOW,
      venueCount: 2,
    };
    const { fake, res } = await runGenerate("D", spec);
    if (res.success) {
      const t0Games = (fake.db.games as unknown as GameRow[]).filter(
        (g) => g.home_team_id === teamId(0) || g.away_team_id === teamId(0),
      );
      assert(t0Games.length === 0, `[D] fully-blocked team still got ${t0Games.length} games`);
      assert(
        res.constraintBlockedCount > 0,
        "[D] fully-blocked team produced no distinct constraint report",
      );
    }
  }

  // E. Prefer-only — prefer rows must NOT block: the team's games still land
  // inside its prefer window (which covers the entire playing window).
  {
    const spec: ShapeSpec = {
      name: "E prefer only",
      teamCount: 4,
      constraints: {
        0: [{ day: "Sa", start: "09:00", end: "16:00", severity: "prefer" }],
      },
      gamesPerTeam: 3,
      playingDays: ["Sa"],
      window: WINDOW,
      venueCount: 2,
    };
    const { fake, res } = await runGenerate("E", spec);
    if (res.success) {
      const t0Games = (fake.db.games as unknown as GameRow[]).filter(
        (g) => g.home_team_id === teamId(0) || g.away_team_id === teamId(0),
      );
      assert(t0Games.length > 0, "[E] prefer-only team was starved — prefer acted like a block");
      assert(res.constraintBlockedCount === 0, "[E] prefer-only run reported constraint blocks");
    }
  }

  // F. Block + prefer on the same team — block enforced, prefer ignored.
  {
    const spec: ShapeSpec = {
      name: "F block+prefer",
      teamCount: 4,
      constraints: {
        0: [
          { day: "Sa", start: "09:00", end: "12:00", severity: "block" },
          { day: "Sa", start: "13:00", end: "16:00", severity: "prefer" },
        ],
      },
      gamesPerTeam: 4,
      playingDays: ["Sa"],
      window: WINDOW,
      venueCount: 2,
    };
    await runGenerate("F", spec);
  }

  // G. Interleague — home team's morning block holds for interleague games
  // (home AND away variants); org field_count cap holds.
  {
    const spec: ShapeSpec = {
      name: "G interleague",
      teamCount: 3,
      constraints: {
        0: [{ day: "Sa", start: "09:00", end: "12:00", severity: "block" }],
      },
      gamesPerTeam: 2,
      playingDays: ["Sa", "Su"],
      window: WINDOW,
      venueCount: 2,
      maxPerWeek: 4,
      maxPerTeamDay: 2,
      interleague: { gameCount: 2, homePerTeam: 1, fieldCount: 1 },
    };
    const { fake, res } = await runGenerate("G", spec);
    if (res.success) {
      const il = (fake.db.games as unknown as GameRow[]).filter(
        (g) => g.interleague_org_id != null,
      );
      assert(il.length > 0, "[G] no interleague games were generated");
      assert(
        il.some((g) => g.is_away),
        "[G] no away interleague games were generated",
      );
    }
  }

  // H. finishSchedule with a block — seed a partial schedule (leaving a
  // deficit) plus one seeded game deliberately INSIDE team 0's block window
  // (a manual placement the generator must not touch). New fills must
  // respect the block; the violating seed must survive unmoved. Blocked
  // window again covers the earliest slots (the finish-copy
  // mutation-detector shape).
  {
    const spec: ShapeSpec = {
      name: "H finish with block",
      teamCount: 4,
      constraints: {
        0: [{ day: "Sa", start: "09:00", end: "12:00", severity: "block" }],
      },
      gamesPerTeam: 4,
      playingDays: ["Sa"],
      window: WINDOW,
      venueCount: 2,
      seedGames: [
        // deliberate pre-existing violation: team 0 at 09:00 Saturday
        { homeIdx: 0, awayIdx: 1, iso: "2026-09-05T09:00:00", venueIdx: 0 },
        { homeIdx: 2, awayIdx: 3, iso: "2026-09-05T10:30:00", venueIdx: 1 },
      ],
    };
    const { fake, res } = await runFinish("H", spec);
    if (res.success) {
      assert(res.gamesCreated > 0, "[H] finish filled nothing — deficit shape is broken");
      const seedStillThere = fake.db.games.find((g) => g.id === "seed-0");
      assert(
        seedStillThere?.scheduled_at === "2026-09-05T09:00:00",
        "[H] finish moved the manually-placed violating seed game",
      );
    }
  }

  // I. finish after a complete generate — no deficit, zero fills, zero noise.
  {
    const spec: ShapeSpec = {
      name: "I finish idempotent",
      teamCount: 4,
      constraints: {
        0: [{ day: "Sa", start: "09:00", end: "12:00", severity: "block" }],
      },
      gamesPerTeam: 3,
      playingDays: ["Sa", "Su"],
      window: WINDOW,
      venueCount: 2,
    };
    const { fake, res } = await runGenerate("I gen", spec);
    if (res.success && res.unscheduledCount === 0) {
      const { res: fin } = await runFinish("I fin", spec, fake);
      if (fin.success) {
        assert(fin.gamesCreated === 0, `[I] finish after complete generate created ${fin.gamesCreated}`);
        assert(fin.constraintBlockedCount === 0, "[I] no-op finish reported constraint blocks");
      }
    } else {
      assert(false, "[I] setup generate did not fully schedule — shape needs retuning");
    }
  }

  // J. Fail-closed — an injected constraints read error aborts BEFORE any
  // game rows are deleted or written.
  {
    const spec: ShapeSpec = {
      name: "J fail closed",
      teamCount: 4,
      constraints: { 0: [{ day: "Sa", severity: "block" }] },
      gamesPerTeam: 3,
      playingDays: ["Sa", "Su"],
      window: WINDOW,
      venueCount: 2,
      seedGames: [{ homeIdx: 0, awayIdx: 1, iso: "2026-09-06T09:00:00", venueIdx: 0 }],
    };
    const fake = buildDb(spec);
    fake.failTables.add("team_game_constraints");
    const before = fake.db.games.length;
    playthroughs++;
    const res = await generateSchedule(DIVISION_ID, fake.asClient());
    assert(!res.success, "[J] generate succeeded despite a constraints read failure");
    if (!res.success) {
      assert(
        res.error.includes("team scheduling constraints"),
        `[J] fail-closed error doesn't name the cause: ${res.error}`,
      );
    }
    assert(
      fake.db.games.length === before,
      "[J] games table was mutated despite the fail-closed abort",
    );

    playthroughs++;
    const finRes = await finishSchedule(DIVISION_ID, fake.asClient());
    assert(!finRes.success, "[J] finish succeeded despite a constraints read failure");
    assert(
      fake.db.games.length === before,
      "[J] games table was mutated by finish despite the fail-closed abort",
    );
  }

  // P1. Prefer honored when possible (plan path) — team 0 prefers to avoid
  // Saturday mornings, which cover the EARLIEST slots (first-fit would land
  // there without pass-1's skip: this is the planSchedule prefer-mutation
  // detector). Ample slots exist outside the window, so every team-0 game
  // must avoid it and no miss may be reported.
  {
    const spec: ShapeSpec = {
      name: "P1 prefer honored",
      teamCount: 4,
      constraints: {
        0: [{ day: "Sa", start: "09:00", end: "12:00", severity: "prefer" }],
      },
      gamesPerTeam: 3,
      playingDays: ["Sa", "Su"],
      window: WINDOW,
      venueCount: 2,
    };
    const { fake, res } = await runGenerate("P1", spec);
    if (res.success) {
      const t0InWindow = (fake.db.games as unknown as GameRow[]).filter(
        (g) =>
          (g.home_team_id === teamId(0) || g.away_team_id === teamId(0)) &&
          dayCodeOf(g.scheduled_at.substring(0, 10)) === "Sa" &&
          g.scheduled_at.substring(11, 16) >= "09:00" &&
          g.scheduled_at.substring(11, 16) < "12:00",
      );
      assert(
        t0InWindow.length === 0,
        `[P1] ${t0InWindow.length} team-0 games landed inside the prefer window despite ample alternatives`,
      );
      assert(res.preferMissCount === 0, `[P1] preferMissCount ${res.preferMissCount} with ample alternatives`);
      assert(res.unscheduledCount === 0, `[P1] ample shape left ${res.unscheduledCount} unscheduled`);
    }
  }

  // P2. Prefer never starves (plan path) — team 0 prefers to avoid ALL of
  // the only playing day. Its games must still schedule (pass-2 fallback)
  // and preferMissCount must equal its game count exactly (every one of its
  // matchups needed pass 2; no other team has rules).
  {
    const spec: ShapeSpec = {
      name: "P2 prefer never starves",
      teamCount: 4,
      constraints: { 0: [{ day: "Sa", severity: "prefer" }] },
      gamesPerTeam: 2,
      playingDays: ["Sa"],
      window: WINDOW,
      venueCount: 2,
    };
    const { fake, res } = await runGenerate("P2", spec);
    if (res.success) {
      const t0Games = (fake.db.games as unknown as GameRow[]).filter(
        (g) => g.home_team_id === teamId(0) || g.away_team_id === teamId(0),
      );
      assert(t0Games.length > 0, "[P2] all-prefer team was starved — prefer acted like a block");
      assert(
        res.preferMissCount === t0Games.length,
        `[P2] preferMissCount ${res.preferMissCount} != team-0 game count ${t0Games.length}`,
      );
      assert(res.unscheduledCount === 0, `[P2] starvation shape left ${res.unscheduledCount} unscheduled`);
    }
  }

  // PF. Prefer honored on the finish path — seeded deficit, team 0 prefers
  // to avoid Saturday mornings (earliest slots — the finishSchedule
  // prefer-mutation detector), ample alternatives. New fills must avoid the
  // window with zero misses.
  {
    const spec: ShapeSpec = {
      name: "PF finish prefer honored",
      teamCount: 4,
      constraints: {
        0: [{ day: "Sa", start: "09:00", end: "12:00", severity: "prefer" }],
      },
      gamesPerTeam: 4,
      playingDays: ["Sa", "Su"],
      window: WINDOW,
      venueCount: 2,
      seedGames: [
        { homeIdx: 2, awayIdx: 3, iso: "2026-09-05T12:00:00", venueIdx: 0 },
      ],
    };
    const { fake, res } = await runFinish("PF", spec);
    if (res.success) {
      assert(res.gamesCreated > 0, "[PF] finish filled nothing — deficit shape is broken");
      const t0NewInWindow = (fake.db.games as unknown as GameRow[]).filter(
        (g) =>
          g.id !== "seed-0" &&
          (g.home_team_id === teamId(0) || g.away_team_id === teamId(0)) &&
          dayCodeOf(g.scheduled_at.substring(0, 10)) === "Sa" &&
          g.scheduled_at.substring(11, 16) >= "09:00" &&
          g.scheduled_at.substring(11, 16) < "12:00",
      );
      assert(
        t0NewInWindow.length === 0,
        `[PF] finish placed ${t0NewInWindow.length} team-0 games inside the prefer window despite alternatives`,
      );
      assert(res.preferMissCount === 0, `[PF] preferMissCount ${res.preferMissCount} with ample alternatives`);
    }
  }

  // PF2. Prefer never starves on the finish path — all-day prefer on the
  // only playing day, seeded deficit: finish must still fill via pass 2 and
  // report the misses.
  {
    const spec: ShapeSpec = {
      name: "PF2 finish prefer starvation",
      teamCount: 4,
      constraints: { 0: [{ day: "Sa", severity: "prefer" }] },
      gamesPerTeam: 3,
      playingDays: ["Sa"],
      window: WINDOW,
      venueCount: 2,
      seedGames: [
        { homeIdx: 2, awayIdx: 3, iso: "2026-09-05T09:00:00", venueIdx: 0 },
      ],
    };
    const { fake, res } = await runFinish("PF2", spec);
    if (res.success) {
      const t0New = (fake.db.games as unknown as GameRow[]).filter(
        (g) =>
          g.id !== "seed-0" &&
          (g.home_team_id === teamId(0) || g.away_team_id === teamId(0)),
      );
      assert(t0New.length > 0, "[PF2] finish starved the all-prefer team");
      assert(
        res.preferMissCount >= t0New.length,
        `[PF2] preferMissCount ${res.preferMissCount} < team-0 new games ${t0New.length}`,
      );
    }
  }

  // K. Total-failure attribution — a 2-team division where team 0 is fully
  // blocked schedules nothing; the error must name the constraint cause.
  {
    const spec: ShapeSpec = {
      name: "K total failure",
      teamCount: 2,
      constraints: { 0: [{ day: "Sa", severity: "block" }] },
      gamesPerTeam: 2,
      playingDays: ["Sa"],
      window: WINDOW,
    };
    const fake = buildDb(spec);
    playthroughs++;
    const res = await generateSchedule(DIVISION_ID, fake.asClient());
    assert(!res.success, "[K] fully-blocked 2-team division somehow scheduled games");
    if (!res.success) {
      assert(
        res.error.includes("blocked by team scheduling constraints"),
        `[K] total-failure error lost the constraint attribution: ${res.error}`,
      );
    }
  }
}

// ── Randomized shapes (seeded, deterministic) ───────────────────────────────

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

function randomSpec(rand: () => number, idx: number): ShapeSpec {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const chance = (p: number) => rand() < p;
  const pick = <T,>(arr: T[]): T => arr[int(0, arr.length - 1)];

  const dayPool = ["Sa", "Su", "We", "Fr"];
  const playingDays = dayPool.slice(0, int(1, 3));
  const teamCount = int(3, 6);
  const constraints: Record<number, ConstraintSpec[]> = {};
  // grid times for a 90-min interval 09:00–15:00 window
  const starts = ["09:00", "10:30", "12:00", "13:30"];
  for (let ti = 0; ti < teamCount; ti++) {
    if (!chance(0.45)) continue;
    const rules: ConstraintSpec[] = [];
    const ruleCount = int(1, 2);
    for (let ri = 0; ri < ruleCount; ri++) {
      const severity: "block" | "prefer" = chance(0.7) ? "block" : "prefer";
      // bias toward days the division actually plays so rules bite
      const day = chance(0.8) ? pick(playingDays) : pick(dayPool);
      if (chance(0.25)) {
        rules.push({ day, severity });
      } else {
        const s = pick(starts);
        const endMin = timeToMin(s) + int(1, 3) * 90;
        rules.push({ day, start: s, end: minToTime(endMin), severity });
      }
    }
    constraints[ti] = rules;
  }

  return {
    name: `R${idx}`,
    teamCount,
    constraints,
    gamesPerTeam: int(2, 4),
    playingDays,
    window: WINDOW,
    venueCount: int(1, 2),
    maxPerTeamDay: chance(0.3) ? 2 : 1,
    maxPerWeek: int(2, 4),
    interleague: chance(0.25)
      ? { gameCount: 2, homePerTeam: 1, fieldCount: int(1, 2) }
      : undefined,
  };
}

async function randomShapes(): Promise<void> {
  const rand = mulberry32(20260721);
  const RANDOM_SHAPES = 60;
  for (let i = 0; i < RANDOM_SHAPES; i++) {
    const spec = randomSpec(rand, i);
    const fake = buildDb(spec);
    const beforeIds = new Set(fake.db.games.map((g) => g.id as string));
    playthroughs++;
    const res = await generateSchedule(DIVISION_ID, fake.asClient());
    if (!res.success) {
      // Heavily-constrained randoms may legitimately fit nothing — but the
      // failure must be one of the engine's honest messages, never a crash.
      assert(
        res.error.startsWith("Could not fit") || res.error.startsWith("Could not generate"),
        `[R${i}] unexpected failure: ${res.error}`,
      );
      continue;
    }
    checkPlaythrough(`R${i}`, spec, fake, res, beforeIds, "plan");

    // Every third shape: knock out ~a third of the generated games and let
    // finishSchedule (the inline loop copy) refill under the same rules.
    if (i % 3 === 0) {
      const inserted = fake.db.games.filter((g) => !beforeIds.has(g.id as string));
      const removeCount = Math.floor(inserted.length / 3);
      const removeIds = new Set(inserted.slice(0, removeCount).map((g) => g.id as string));
      fake.db.games = fake.db.games.filter((g) => !removeIds.has(g.id as string));
      const finRes = await runFinish(`R${i} finish`, spec, fake);
      void finRes;
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await fixedShapes();
  await randomShapes();

  assert(
    planDeflections > 0,
    "no playthrough ever deflected a blocked candidate in planSchedule — the core invariant ran vacuously for that loop copy",
  );
  assert(
    finishDeflections > 0,
    "no playthrough ever deflected a blocked candidate in finishSchedule's inline copy — the core invariant ran vacuously for that loop copy",
  );
  assert(
    constraintBlockedReports > 0,
    "no playthrough ever reported a constraint-blocked matchup — the distinct-reporting invariant ran vacuously",
  );
  assert(
    preferInWindowGames > 0,
    "no game ever landed inside a 'prefer' window — the prefer-never-blocks invariant ran vacuously",
  );
  assert(
    preferMissTotal > 0,
    "no playthrough ever reported a pass-2 prefer miss — the fallback-pass invariants ran vacuously",
  );
  assert(
    planPreferDeflections > 0,
    "no playthrough ever deflected a preferred-avoid candidate in planSchedule — pass-1's skip ran vacuously for that loop copy",
  );
  assert(
    finishPreferDeflections > 0,
    "no playthrough ever deflected a preferred-avoid candidate in finishSchedule's inline copy — pass-1's skip ran vacuously for that loop copy",
  );

  console.log(
    `team-game-constraints sim: ${playthroughs} playthroughs, ${assertions} assertions, ${failures.length} failures`,
  );
  console.log(
    `  coverage: ${planDeflections} plan-loop deflections, ${finishDeflections} finish-loop deflections, ` +
      `${constraintBlockedReports} constraint-blocked reports, ${preferInWindowGames} games inside prefer windows`,
  );
  console.log(
    `  prefer coverage: ${preferMissTotal} pass-2 misses, ${planPreferDeflections} plan prefer-deflections, ` +
      `${finishPreferDeflections} finish prefer-deflections`,
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

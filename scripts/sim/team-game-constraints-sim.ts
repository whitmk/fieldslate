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
 *
 * Mutation-test procedure (manual, per the harness standard): disable the
 * violatesHardConstraint checks in planSchedule, run — must FAIL; restore;
 * disable them in finishSchedule's inline copy, run — must FAIL; restore,
 * re-verify green. The deflection counters above guarantee both mutants
 * are exercised by the fixtures.
 */

process.env.TZ = "UTC";

import {
  generateSchedule,
  finishSchedule,
  type GenerateScheduleClient,
  type ScheduleResult,
} from "@/lib/schedule/generate-schedule";

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
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) failures.push(msg);
}

// ── In-memory fake Supabase client ──────────────────────────────────────────

type Row = Record<string, unknown>;

type Db = {
  divisions: Row[];
  teams: Row[];
  venues: Row[];
  division_venues: Row[];
  blackout_dates: Row[];
  games: Row[];
  division_interleague_games: Row[];
  interleague_orgs: Row[];
  team_game_constraints: Row[];
};

type DbError = { message: string } | null;

type EmbedNode = {
  alias: string;
  target: string;
  fkHint: string | null;
  children: EmbedNode[];
};

function parseEmbeds(select: string): EmbedNode[] {
  const out: EmbedNode[] = [];
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  for (const raw of parts) {
    const part = raw.trim();
    const open = part.indexOf("(");
    if (open === -1) continue; // scalar column
    if (!part.endsWith(")")) {
      throw new Error(`fake client: unbalanced embed in select: ${part}`);
    }
    const head = part.slice(0, open).trim();
    const inner = part.slice(open + 1, -1);
    const colon = head.indexOf(":");
    const alias = colon === -1 ? head : head.slice(0, colon);
    let target = colon === -1 ? head : head.slice(colon + 1);
    let fkHint: string | null = null;
    const bang = target.indexOf("!");
    if (bang !== -1) {
      fkHint = target.slice(bang + 1);
      target = target.slice(0, bang);
    }
    out.push({ alias, target, fkHint, children: parseEmbeds(inner) });
  }
  return out;
}

type Relation = {
  table: keyof Db;
  match: (parent: Row, child: Row) => boolean;
};

/** relation key: `${parentTable}.${target}` or with `!fk` suffix. Covers
 *  exactly the embeds the generator issues — anything else throws so a new
 *  query shape extends the fake instead of silently returning garbage. */
const RELATIONS: Record<string, Relation> = {
  "games.teams!home_team_id": {
    table: "teams",
    match: (g, t) => t.id === g.home_team_id,
  },
  "games.teams!away_team_id": {
    table: "teams",
    match: (g, t) => g.away_team_id != null && t.id === g.away_team_id,
  },
  "teams.divisions": {
    table: "divisions",
    match: (t, d) => d.id === t.division_id,
  },
  "games.venues": {
    table: "venues",
    match: (g, v) => g.venue_id != null && v.id === g.venue_id,
  },
  // division_venues → venues (the `venue:venues!inner(...)` embed; the
  // engine always pairs it with an eq on venue.availability_configured,
  // which the dotted-filter support below applies post-embed).
  "division_venues.venues": {
    table: "venues",
    match: (dv, v) => v.id === dv.venue_id,
  },
};

/** Parse a PostgREST `.or()` disjunction of `col.op.value` terms — exactly
 *  the two patterns the engine issues (eq/neq plus `is.null`). */
function parseOr(expr: string): (r: Row) => boolean {
  const terms = expr.split(",").map((t) => {
    const [col, op, ...rest] = t.split(".");
    const value = rest.join(".");
    if (op === "eq") return (r: Row) => String(r[col]) === value;
    if (op === "neq") return (r: Row) => String(r[col]) !== value;
    if (op === "is" && value === "null") return (r: Row) => r[col] == null;
    throw new Error(`fake client: unsupported or() term: ${t}`);
  });
  return (r) => terms.some((f) => f(r));
}

class FakeQuery implements PromiseLike<{ data: unknown; error: DbError }> {
  private filters: ((r: Row) => boolean)[] = [];
  private embedFilters: { alias: string; field: string; value: unknown }[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private singleMode = false;
  private embeds: EmbedNode[] = [];

  constructor(
    private fake: FakeClient,
    private table: keyof Db,
    private write?: { kind: "insert" | "delete"; rows?: Row[] },
  ) {}

  select(cols: string): this {
    this.embeds = parseEmbeds(cols);
    return this;
  }

  eq(column: string, value: unknown): this {
    const dot = column.indexOf(".");
    if (dot !== -1) {
      // filter on an embedded relation's column (e.g. venue.availability_configured)
      this.embedFilters.push({
        alias: column.slice(0, dot),
        field: column.slice(dot + 1),
        value,
      });
      return this;
    }
    this.filters.push((r) => r[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }

  or(expr: string): this {
    this.filters.push(parseOr(expr));
    return this;
  }

  not(column: string, op: string, value: unknown): this {
    if (op !== "is" || value !== null) {
      throw new Error(`fake client: unsupported not(${column}, ${op}, ${String(value)})`);
    }
    this.filters.push((r) => r[column] != null);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  single(): this {
    this.singleMode = true;
    return this;
  }

  private resolveEmbeds(parent: Row, nodes: EmbedNode[], table: keyof Db): Row {
    const out: Row = { ...parent };
    for (const node of nodes) {
      const keyed = `${table}.${node.target}${node.fkHint ? "!" + node.fkHint : ""}`;
      const rel = RELATIONS[keyed] ?? RELATIONS[`${table}.${node.target}`];
      if (!rel) throw new Error(`fake client: no relation for ${keyed}`);
      const children = this.fake.db[rel.table].filter((c) => rel.match(parent, c));
      out[node.alias] =
        children.length > 0
          ? this.resolveEmbeds(children[0], node.children, rel.table)
          : null;
    }
    return out;
  }

  private execute(): { data: unknown; error: DbError } {
    // fault injection — exercises the engine's fail-closed constraint read
    if (!this.write && this.fake.failTables.has(this.table)) {
      return { data: null, error: { message: `injected ${this.table} read failure` } };
    }

    if (this.write?.kind === "delete") {
      const keep = this.fake.db[this.table].filter(
        (r) => !this.filters.every((f) => f(r)),
      );
      this.fake.db[this.table] = keep;
      return { data: null, error: null };
    }
    if (this.write?.kind === "insert") {
      for (const row of this.write.rows ?? []) {
        this.fake.db[this.table].push({ id: this.fake.nextId("row"), ...row });
      }
      return { data: null, error: null };
    }

    let rows = this.fake.db[this.table].filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[column] as string | number;
        const bv = b[column] as string | number;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    let projected = rows.map((r) => this.resolveEmbeds(r, this.embeds, this.table));
    for (const ef of this.embedFilters) {
      projected = projected.filter((r) => {
        const embedded = r[ef.alias] as Row | null;
        return embedded != null && embedded[ef.field] === ef.value;
      });
    }
    if (this.singleMode) {
      if (projected.length !== 1) {
        return {
          data: null,
          error: { message: `expected 1 row in ${this.table}, got ${projected.length}` },
        };
      }
      return { data: projected[0], error: null };
    }
    return { data: projected, error: null };
  }

  then<TResult1 = { data: unknown; error: DbError }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: DbError }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

class FakeClient {
  private idCounter = 0;
  failTables = new Set<keyof Db>();

  constructor(public db: Db) {}

  nextId(prefix: string): string {
    return `${prefix}_${++this.idCounter}`;
  }

  from(table: string): {
    select: (cols: string) => FakeQuery;
    insert: (rows: Row[]) => FakeQuery;
    delete: () => FakeQuery;
  } {
    const t = table as keyof Db;
    if (!(t in this.db)) throw new Error(`fake client: unknown table ${table}`);
    return {
      select: (cols: string) => new FakeQuery(this, t).select(cols),
      insert: (rows: Row[]) => new FakeQuery(this, t, { kind: "insert", rows }),
      delete: () => new FakeQuery(this, t, { kind: "delete" }),
    };
  }

  asClient(): GenerateScheduleClient {
    return this as unknown as GenerateScheduleClient;
  }
}

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

  console.log(
    `team-game-constraints sim: ${playthroughs} playthroughs, ${assertions} assertions, ${failures.length} failures`,
  );
  console.log(
    `  coverage: ${planDeflections} plan-loop deflections, ${finishDeflections} finish-loop deflections, ` +
      `${constraintBlockedReports} constraint-blocked reports, ${preferInWindowGames} games inside prefer windows`,
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

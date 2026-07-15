/**
 * Simulation harness for season-wide official auto-assign.
 *
 * Drives the REAL autoAssignSeason orchestration and the REAL per-division
 * engine (autoAssignUmpires) — no mocks of the logic under test — against an
 * in-memory fake of the Supabase client that implements exactly the
 * query-builder subset and PostgREST embeds the engine uses. Fixtures are
 * generated season shapes: multiple divisions with distinct priorities,
 * shared official pools, availability windows, blackout dates, coach links,
 * conflict-of-interest rows, weekly caps, and time grids designed to force
 * scarcity.
 *
 * Run with:  TZ=UTC npx tsx scripts/sim/auto-assign-season-sim.ts
 * (or `npm run sim:officials`). TZ=UTC pins the engine's client-timezone
 * date math (see src/lib/umpires/eligibility.ts) so day/week boundaries are
 * unambiguous in Node; the harness refuses to run in any other zone.
 *
 * Invariants asserted on every playthrough:
 *  - no official double-booked across ANY division in the run
 *  - no assignment on an official's blackout date
 *  - no coach or conflict-of-interest assignment, ever
 *  - weekly caps + availability respected whenever the strict tier filled
 *    everything (fallbackFilled = 0)
 *  - highest-priority division fills exactly what it would running alone;
 *    lower-priority divisions never fill MORE than they would alone
 *  - a second identical run changes zero assignments and fills 0
 *  - every division with skipped slots reports at least one reason
 *  - pre-existing assignments survive untouched
 *  - umpires_per_game = 0 divisions are reported as such and gain no rows
 *  - an injected division error doesn't halt the rest of the sequence
 */

process.env.TZ = "UTC";

import {
  autoAssignUmpires,
  type AutoAssignClient,
} from "@/lib/umpires/auto-assign";
import {
  autoAssignSeason,
  type SeasonAutoAssignResult,
} from "@/lib/umpires/auto-assign-season";
import {
  isWithinAvailability,
  localDateKey,
  weekKey,
  type AvailabilityWindow,
} from "@/lib/umpires/eligibility";
import { gamesOverlap } from "@/lib/umpires/conflicts";
import { padRoleLabels } from "@/lib/utils/official-title";

if (new Date("2026-06-13T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error(
    "This harness must run with TZ=UTC (client-timezone date math would " +
      "shift day/week boundaries). Re-run as: TZ=UTC npx tsx scripts/sim/auto-assign-season-sim.ts",
  );
  process.exit(1);
}

// ── Tiny assertion framework ────────────────────────────────────────────────

let assertions = 0;
let playthroughs = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) failures.push(msg);
}

// ── In-memory fake Supabase client ──────────────────────────────────────────

type Row = Record<string, unknown>;

type Db = {
  leagues: Row[];
  divisions: Row[];
  teams: Row[];
  games: Row[];
  umpires: Row[];
  official_roles: Row[];
  official_conflicts: Row[];
  official_availability: Row[];
  official_blackouts: Row[];
  game_umpires: Row[];
};

type DbError = { message: string } | null;

/** parsed select: scalar columns are ignored (full rows are returned);
 *  embeds are resolved via the relation table below. */
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
  many: boolean;
  match: (parent: Row, child: Row) => boolean;
};

/** relation key: `${parentTable}.${target}` or with `!fk` suffix. Covers
 *  exactly the embeds the engine + orchestrator issue. */
const RELATIONS: Record<string, Relation> = {
  "games.teams!home_team_id": {
    table: "teams",
    many: false,
    match: (g, t) => t.id === g.home_team_id,
  },
  "games.teams!away_team_id": {
    table: "teams",
    many: false,
    match: (g, t) => g.away_team_id != null && t.id === g.away_team_id,
  },
  "teams.divisions": {
    table: "divisions",
    many: false,
    match: (t, d) => d.id === t.division_id,
  },
  "game_umpires.games": {
    table: "games",
    many: false,
    match: (gu, g) => g.id === gu.game_id,
  },
  "umpires.official_conflicts": {
    table: "official_conflicts",
    many: true,
    match: (u, c) => c.umpire_id === u.id,
  },
};

class FakeQuery implements PromiseLike<{ data: unknown; error: DbError }> {
  private filters: ((r: Row) => boolean)[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private singleMode = false;
  private embeds: EmbedNode[] = [];

  constructor(
    private fake: FakeClient,
    private table: keyof Db,
    private write?: { kind: "insert" | "upsert"; rows: Row[]; onConflict?: string; ignoreDuplicates?: boolean },
  ) {}

  select(cols: string): this {
    this.embeds = parseEmbeds(cols);
    return this;
  }

  eq(column: string, value: unknown): this {
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

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  single(): this {
    this.singleMode = true;
    return this;
  }

  private resolveEmbeds(parent: Row, nodes: EmbedNode[]): Row {
    const out: Row = { ...parent };
    for (const node of nodes) {
      const key = `${this.table}.${node.target}${node.fkHint ? "!" + node.fkHint : ""}`;
      const relKey = key in RELATIONS
        ? key
        : `${this.table}.${node.target}`;
      const rel = RELATIONS[relKey];
      if (!rel) throw new Error(`fake client: no relation for ${key}`);
      const children = this.fake.db[rel.table].filter((c) => rel.match(parent, c));
      const project = (child: Row) =>
        new FakeQuery(this.fake, rel.table).projectChild(child, node.children);
      out[node.alias] = rel.many
        ? children.map(project)
        : children.length > 0
          ? project(children[0])
          : null;
    }
    return out;
  }

  /** used for nested embed resolution — same logic, child table context */
  projectChild(row: Row, nodes: EmbedNode[]): Row {
    return this.resolveEmbeds(row, nodes);
  }

  private execute(): { data: unknown; error: DbError } {
    if (this.write) return this.executeWrite();

    // fault injection: division-detail read for a marked division errors,
    // exercising "a division errors mid-sequence, the run continues".
    if (this.table === "divisions" && this.singleMode) {
      const rows = this.fake.db.divisions.filter((r) =>
        this.filters.every((f) => f(r)),
      );
      if (rows.length === 1 && this.fake.failDivisionIds.has(String(rows[0].id))) {
        return { data: null, error: { message: "injected division read failure" } };
      }
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
    const projected = rows.map((r) => this.resolveEmbeds(r, this.embeds));
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

  private executeWrite(): { data: unknown; error: DbError } {
    const { kind, rows, onConflict, ignoreDuplicates } = this.write!;
    if (this.table === "game_umpires") {
      // enforce the real uniques: UNIQUE(game_id, umpire_id), UNIQUE(game_id, role)
      const byUmpire = new Set(
        this.fake.db.game_umpires.map((r) => `${r.game_id}|${r.umpire_id}`),
      );
      const byRole = new Set(
        this.fake.db.game_umpires.map((r) => `${r.game_id}|${r.role}`),
      );
      for (const row of rows) {
        const uKey = `${row.game_id}|${row.umpire_id}`;
        const rKey = `${row.game_id}|${row.role}`;
        if (byUmpire.has(uKey) || byRole.has(rKey)) {
          return {
            data: null,
            error: { message: `duplicate key value violates unique constraint (${uKey} / ${rKey})` },
          };
        }
        byUmpire.add(uKey);
        byRole.add(rKey);
      }
      for (const row of rows) {
        this.fake.db.game_umpires.push({ id: this.fake.nextId("gu"), ...row });
      }
      return { data: null, error: null };
    }
    if (this.table === "official_roles" && kind === "upsert") {
      if (onConflict !== "season_id,name" || !ignoreDuplicates) {
        throw new Error("fake client: unexpected official_roles upsert options");
      }
      for (const row of rows) {
        const exists = this.fake.db.official_roles.some(
          (r) => r.season_id === row.season_id && r.name === row.name,
        );
        if (!exists) {
          this.fake.db.official_roles.push({ id: this.fake.nextId("role"), ...row });
        }
      }
      return { data: null, error: null };
    }
    throw new Error(`fake client: unexpected ${kind} into ${this.table}`);
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
  failDivisionIds = new Set<string>();

  constructor(public db: Db) {}

  nextId(prefix: string): string {
    return `${prefix}_${++this.idCounter}`;
  }

  from(table: string): {
    select: (cols: string) => FakeQuery;
    insert: (rows: Row[]) => FakeQuery;
    upsert: (rows: Row[], opts: { onConflict: string; ignoreDuplicates: boolean }) => FakeQuery;
  } {
    const t = table as keyof Db;
    if (!(t in this.db)) throw new Error(`fake client: unknown table ${table}`);
    return {
      select: (cols: string) => new FakeQuery(this, t).select(cols),
      insert: (rows: Row[]) => new FakeQuery(this, t, { kind: "insert", rows }),
      upsert: (rows: Row[], opts) =>
        new FakeQuery(this, t, { kind: "upsert", rows, ...opts }),
    };
  }

  asClient(): AutoAssignClient {
    return this as unknown as AutoAssignClient;
  }
}

// ── Fixture generation ──────────────────────────────────────────────────────

const SEASON_ID = "season-1";
const SPORT = "baseball";
// Saturday. All times UTC; with TZ=UTC pinned, local == UTC exactly.
const BASE_DATE = Date.UTC(2026, 5, 13, 0, 0, 0);

type DivisionSpec = {
  name: string;
  priority: number;
  umpiresPerGame: number;
  teamCount: number;
  gameCount: number;
  gameDurationMins?: number;
};

type OfficialSpec = {
  name: string;
  maxGamesPerWeek?: number | null;
  /** index into the flattened team list (see buildDb) — the team they coach */
  coachesTeamIdx?: number;
  /** conflict-of-interest team indexes (official_conflicts, 0073) */
  coiTeamIdxs?: number[];
  availability?: AvailabilityWindow[];
  /** blackout dates as YYYY-MM-DD */
  blackouts?: string[];
};

type SeasonSpec = {
  name: string;
  divisions: DivisionSpec[];
  officials: OfficialSpec[];
  seasonRoles?: string[];
  /** pre-seeded manual assignments: division idx, game idx within it,
   *  official idx, role slot idx (canonical padded label) */
  preAssign?: { divIdx: number; gameIdx: number; officialIdx: number; roleIdx: number }[];
};

/**
 * Deterministic time grid shared by ALL divisions so officials genuinely
 * contend: game i of every division lands at the same instant. 4 slots per
 * day (09/11/13/15 UTC), Sat+Sun, then next week — so weekly caps and
 * blackout days both get exercised.
 */
function gameTime(i: number): Date {
  const slot = i % 4;
  const dayInWeek = Math.floor(i / 4) % 2; // 0 = Sat, 1 = Sun
  const week = Math.floor(i / 8);
  return new Date(
    BASE_DATE + (week * 7 + dayInWeek) * 86_400_000 + (9 + slot * 2) * 3_600_000,
  );
}

function buildDb(spec: SeasonSpec): {
  fake: FakeClient;
  teamIdsByDiv: string[][];
  allTeamIds: string[];
  preAssignedIds: string[];
} {
  const db: Db = {
    leagues: [{ id: SEASON_ID, sport: SPORT }],
    divisions: [],
    teams: [],
    games: [],
    umpires: [],
    official_roles: [],
    official_conflicts: [],
    official_availability: [],
    official_blackouts: [],
    game_umpires: [],
  };

  (spec.seasonRoles ?? []).forEach((name, i) => {
    db.official_roles.push({
      id: `seedrole-${i}`,
      season_id: SEASON_ID,
      name,
      sort_order: i,
    });
  });

  const teamIdsByDiv: string[][] = [];
  const allTeamIds: string[] = [];
  spec.divisions.forEach((d, di) => {
    const divId = `div-${di}`;
    db.divisions.push({
      id: divId,
      league_id: SEASON_ID,
      name: d.name,
      priority: d.priority,
      umpires_per_game: d.umpiresPerGame,
      umpire_roles: null,
      settings: d.gameDurationMins != null ? { game_duration: d.gameDurationMins } : {},
    });
    const teamIds: string[] = [];
    for (let ti = 0; ti < d.teamCount; ti++) {
      const teamId = `team-${di}-${ti}`;
      teamIds.push(teamId);
      allTeamIds.push(teamId);
      db.teams.push({ id: teamId, division_id: divId, name: `Team ${di}-${ti}` });
    }
    teamIdsByDiv.push(teamIds);
    for (let gi = 0; gi < d.gameCount; gi++) {
      db.games.push({
        id: `game-${di}-${gi}`,
        scheduled_at: gameTime(gi).toISOString(),
        status: "scheduled",
        home_team_id: teamIds[gi % teamIds.length],
        away_team_id: teamIds[(gi + 1) % teamIds.length],
      });
    }
  });

  spec.officials.forEach((o, oi) => {
    const umpId = `ump-${oi}`;
    db.umpires.push({
      id: umpId,
      season_id: SEASON_ID,
      name: o.name,
      max_games_per_week: o.maxGamesPerWeek ?? null,
      team_id: o.coachesTeamIdx != null ? allTeamIds[o.coachesTeamIdx] : null,
    });
    for (const ti of o.coiTeamIdxs ?? []) {
      db.official_conflicts.push({
        id: `coi-${oi}-${ti}`,
        umpire_id: umpId,
        team_id: allTeamIds[ti],
        relationship: "family",
      });
    }
    for (const w of o.availability ?? []) {
      db.official_availability.push({ umpire_id: umpId, ...w });
    }
    for (const date of o.blackouts ?? []) {
      db.official_blackouts.push({ umpire_id: umpId, date });
    }
  });

  const preAssignedIds: string[] = [];
  (spec.preAssign ?? []).forEach((p, i) => {
    const div = spec.divisions[p.divIdx];
    const roles = padRoleLabels(
      (spec.seasonRoles ?? []).slice(0, div.umpiresPerGame),
      div.umpiresPerGame,
      SPORT,
    );
    const id = `pre-${i}`;
    preAssignedIds.push(id);
    db.game_umpires.push({
      id,
      game_id: `game-${p.divIdx}-${p.gameIdx}`,
      umpire_id: `ump-${p.officialIdx}`,
      role: roles[p.roleIdx],
      role_id: null,
    });
  });

  return { fake: new FakeClient(db), teamIdsByDiv, allTeamIds, preAssignedIds };
}

// ── Invariant checks ────────────────────────────────────────────────────────

function gameDurationOf(db: Db, game: Row): number {
  const div = db.divisions.find(
    (d) => d.id === (db.teams.find((t) => t.id === game.home_team_id)?.division_id),
  );
  const settings = (div?.settings ?? {}) as { game_duration?: number };
  return typeof settings.game_duration === "number" ? settings.game_duration : 90;
}

function checkInvariants(
  label: string,
  spec: SeasonSpec,
  fake: FakeClient,
  result: SeasonAutoAssignResult,
  beforeIds: Set<string>,
  preAssignedIds: string[],
): void {
  const db = fake.db;
  const gameById = new Map(db.games.map((g) => [g.id as string, g]));
  const umpById = new Map(db.umpires.map((u) => [u.id as string, u]));
  const rows = db.game_umpires;
  const newRows = rows.filter((r) => !beforeIds.has(r.id as string));

  const ctx = (msg: string) => `[${label}] ${msg}`;

  // pre-existing assignments untouched
  for (const id of preAssignedIds) {
    assert(
      rows.some((r) => r.id === id),
      ctx(`pre-seeded assignment ${id} disappeared`),
    );
  }

  // per-game caps + uniques
  const byGame = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byGame.get(r.game_id as string) ?? [];
    list.push(r);
    byGame.set(r.game_id as string, list);
  }
  for (const [gameId, list] of byGame) {
    const game = gameById.get(gameId)!;
    const div = db.divisions.find(
      (d) => d.id === db.teams.find((t) => t.id === game.home_team_id)?.division_id,
    )!;
    assert(
      list.length <= (div.umpires_per_game as number),
      ctx(`game ${gameId} has ${list.length} officials, division allows ${div.umpires_per_game}`),
    );
    assert(
      new Set(list.map((r) => r.umpire_id)).size === list.length,
      ctx(`game ${gameId} has the same official twice`),
    );
    assert(
      new Set(list.map((r) => r.role)).size === list.length,
      ctx(`game ${gameId} has the same role twice`),
    );
  }

  // per-official: no time overlap, no blackout, no coach/COI game — across
  // ALL divisions in the run.
  const byUmp = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byUmp.get(r.umpire_id as string) ?? [];
    list.push(r);
    byUmp.set(r.umpire_id as string, list);
  }
  const blackoutsByUmp = new Map<string, Set<string>>();
  for (const b of db.official_blackouts) {
    const set = blackoutsByUmp.get(b.umpire_id as string) ?? new Set<string>();
    set.add(b.date as string);
    blackoutsByUmp.set(b.umpire_id as string, set);
  }
  const coiByUmp = new Map<string, Set<string>>();
  for (const c of db.official_conflicts) {
    const set = coiByUmp.get(c.umpire_id as string) ?? new Set<string>();
    set.add(c.team_id as string);
    coiByUmp.set(c.umpire_id as string, set);
  }

  for (const [umpId, list] of byUmp) {
    const ump = umpById.get(umpId)!;
    const infos = list.map((r) => {
      const g = gameById.get(r.game_id as string)!;
      return {
        id: g.id as string,
        scheduled_at: g.scheduled_at as string,
        duration_minutes: gameDurationOf(db, g),
        home_team_name: "",
        away_team_name: "",
      };
    });
    for (let i = 0; i < infos.length; i++) {
      for (let j = i + 1; j < infos.length; j++) {
        assert(
          !gamesOverlap(infos[i], infos[j]),
          ctx(`official ${umpId} double-booked: ${infos[i].id} overlaps ${infos[j].id}`),
        );
      }
    }
    // Only NEW rows must respect blackouts/coach/COI — pre-seeded manual
    // rows may deliberately violate (manual assignment warns + allows).
    for (const r of list) {
      if (beforeIds.has(r.id as string)) continue;
      const g = gameById.get(r.game_id as string)!;
      const dateKey = localDateKey(new Date(g.scheduled_at as string));
      assert(
        !blackoutsByUmp.get(umpId)?.has(dateKey),
        ctx(`official ${umpId} assigned to ${g.id} on blackout date ${dateKey}`),
      );
      const coached = ump.team_id;
      assert(
        !(coached != null && (coached === g.home_team_id || coached === g.away_team_id)),
        ctx(`official ${umpId} assigned to ${g.id} involving the team they coach`),
      );
      const coi = coiByUmp.get(umpId);
      assert(
        !(coi?.has(g.home_team_id as string) || (g.away_team_id != null && coi?.has(g.away_team_id as string))),
        ctx(`official ${umpId} assigned to ${g.id} despite a conflict of interest`),
      );
    }
  }

  // strict-tier guarantees: when nothing used the fallback tier, every NEW
  // assignment sits inside availability windows and weekly caps hold for
  // every (official, week) that gained an assignment.
  if (result.totalFallbackFilled === 0) {
    const availByUmp = new Map<string, AvailabilityWindow[]>();
    for (const a of db.official_availability) {
      const list = availByUmp.get(a.umpire_id as string) ?? [];
      list.push(a as unknown as AvailabilityWindow);
      availByUmp.set(a.umpire_id as string, list);
    }
    const weekCount = new Map<string, number>();
    const weeksGained = new Set<string>();
    for (const r of rows) {
      const g = gameById.get(r.game_id as string)!;
      const key = `${r.umpire_id}|${weekKey(new Date(g.scheduled_at as string))}`;
      weekCount.set(key, (weekCount.get(key) ?? 0) + 1);
      if (!beforeIds.has(r.id as string)) weeksGained.add(key);
    }
    for (const r of newRows) {
      const g = gameById.get(r.game_id as string)!;
      assert(
        isWithinAvailability(
          availByUmp.get(r.umpire_id as string) ?? [],
          new Date(g.scheduled_at as string),
          gameDurationOf(db, g),
        ),
        ctx(`strict-tier assignment of ${r.umpire_id} to ${g.id} violates availability`),
      );
    }
    for (const key of weeksGained) {
      const umpId = key.split("|")[0];
      const cap = umpById.get(umpId)?.max_games_per_week as number | null;
      if (cap != null && cap > 0) {
        assert(
          (weekCount.get(key) ?? 0) <= cap,
          ctx(`strict-tier week ${key} exceeds cap ${cap}`),
        );
      }
    }
  }

  // result bookkeeping: reported fills match rows actually written; every
  // skipped slot carries at least one reason; zero-slot divisions reported.
  assert(
    result.totalFilled === newRows.length,
    ctx(`totalFilled ${result.totalFilled} != new rows ${newRows.length}`),
  );
  for (const d of result.divisions) {
    if (d.skipped > 0) {
      assert(
        d.skipReasons.length > 0,
        ctx(`division ${d.divisionName} skipped ${d.skipped} slots with no reason reported`),
      );
    }
  }
  spec.divisions.forEach((d, di) => {
    const res = result.divisions.find((r) => r.divisionId === `div-${di}`);
    assert(!!res, ctx(`division div-${di} missing from results`));
    if (!res) return;
    if (d.umpiresPerGame === 0) {
      assert(
        res.status === "no_slots_required",
        ctx(`zero-slot division ${d.name} reported as ${res.status}`),
      );
      assert(
        !newRows.some((r) => (r.game_id as string).startsWith(`game-${di}-`)),
        ctx(`zero-slot division ${d.name} gained assignments`),
      );
    }
  });

  // open-slot accounting: filled + skipped per division must equal the open
  // slots that existed before the run (per-game shortfall vs umpires_per_game).
  spec.divisions.forEach((d, di) => {
    const res = result.divisions.find((r) => r.divisionId === `div-${di}`);
    if (!res || res.status !== "assigned" || d.umpiresPerGame === 0) return;
    let open = 0;
    for (let gi = 0; gi < d.gameCount; gi++) {
      const pre = [...beforeIds].filter((id) =>
        db.game_umpires.some((r) => r.id === id && r.game_id === `game-${di}-${gi}`),
      ).length;
      open += Math.max(0, d.umpiresPerGame - pre);
    }
    assert(
      res.filled + res.skipped === open,
      ctx(`division ${d.name}: filled ${res.filled} + skipped ${res.skipped} != open slots ${open}`),
    );
  });
}

// ── Playthrough drivers ─────────────────────────────────────────────────────

function assignmentKeySet(db: Db): Set<string> {
  return new Set(db.game_umpires.map((r) => `${r.game_id}|${r.umpire_id}|${r.role}`));
}

async function runSeasonPlaythrough(
  label: string,
  spec: SeasonSpec,
  opts: { failDivIdxs?: number[] } = {},
): Promise<void> {
  const { fake, preAssignedIds } = buildDb(spec);
  for (const di of opts.failDivIdxs ?? []) fake.failDivisionIds.add(`div-${di}`);
  const beforeIds = new Set(fake.db.game_umpires.map((r) => r.id as string));

  playthroughs++;
  const result = await autoAssignSeason(SEASON_ID, fake.asClient());
  assert(result.success, `[${label}] season run failed outright: ${result.error}`);
  checkInvariants(label, spec, fake, result, beforeIds, preAssignedIds);

  // division order in results must be ascending priority (name tiebreak)
  const priorities = result.divisions.map((d) => d.priority);
  assert(
    priorities.every((p, i) => i === 0 || priorities[i - 1] <= p),
    `[${label}] results not in ascending priority order`,
  );

  // injected errors: the failed division reports an error, the others still ran
  for (const di of opts.failDivIdxs ?? []) {
    const res = result.divisions.find((d) => d.divisionId === `div-${di}`);
    assert(
      res?.status === "error" && !!res.error,
      `[${label}] fault-injected division div-${di} not reported as error`,
    );
  }
  if ((opts.failDivIdxs ?? []).length > 0) {
    const okDivs = result.divisions.filter(
      (d) => !(opts.failDivIdxs ?? []).some((di) => d.divisionId === `div-${di}`),
    );
    assert(
      okDivs.every((d) => d.status !== "error"),
      `[${label}] a healthy division was dragged into error state`,
    );
  }

  // priority actually confers priority: the highest-priority division must
  // fill exactly what it would running ALONE on fresh fixtures (it runs
  // first on a virgin pool), and lower-priority divisions never fill more
  // than they would alone.
  const ordered = [...spec.divisions.entries()].sort(
    (a, b) => a[1].priority - b[1].priority || a[1].name.localeCompare(b[1].name),
  );
  let seenActive = false;
  for (let rank = 0; rank < ordered.length; rank++) {
    const [di, d] = ordered[rank];
    if (d.umpiresPerGame === 0) continue;
    if ((opts.failDivIdxs ?? []).includes(di)) continue;
    const isFirstActive = !seenActive;
    seenActive = true;
    const seasonRes = result.divisions.find((r) => r.divisionId === `div-${di}`);
    assert(!!seasonRes, `[${label}] division div-${di} missing from season results`);
    if (!seasonRes) continue;
    const { fake: aloneFake } = buildDb(spec);
    playthroughs++;
    const alone = await autoAssignUmpires(`div-${di}`, SEASON_ID, aloneFake.asClient());
    assert(alone.success, `[${label}] alone-run for div-${di} failed: ${alone.error}`);
    if (isFirstActive) {
      assert(
        seasonRes.filled === alone.filled,
        `[${label}] top-priority ${d.name} filled ${seasonRes.filled} in season run vs ${alone.filled} alone`,
      );
    } else {
      assert(
        seasonRes.filled <= alone.filled,
        `[${label}] lower-priority ${d.name} filled MORE in season run (${seasonRes.filled}) than alone (${alone.filled})`,
      );
    }
  }

  // idempotency: a second identical run changes nothing.
  const snapshot = assignmentKeySet(fake.db);
  const rowCount = fake.db.game_umpires.length;
  playthroughs++;
  const second = await autoAssignSeason(SEASON_ID, fake.asClient());
  assert(second.success, `[${label}] second run failed: ${second.error}`);
  assert(
    second.totalFilled === 0,
    `[${label}] second identical run filled ${second.totalFilled} slots`,
  );
  assert(
    fake.db.game_umpires.length === rowCount,
    `[${label}] second run changed row count`,
  );
  const after = assignmentKeySet(fake.db);
  assert(
    after.size === snapshot.size && [...snapshot].every((k) => after.has(k)),
    `[${label}] second run shuffled assignments`,
  );
}

// ── Shapes ──────────────────────────────────────────────────────────────────

const SAT1 = localDateKey(gameTime(0)); // 2026-06-13
const SUN1 = localDateKey(gameTime(4)); // 2026-06-14
const ALL_DAY_WEEKEND: AvailabilityWindow[] = [
  { day_of_week: "Sa", start_time: "08:00:00", end_time: "22:00:00" },
  { day_of_week: "Su", start_time: "08:00:00", end_time: "22:00:00" },
];
const SATURDAY_MORNINGS_ONLY: AvailabilityWindow[] = [
  { day_of_week: "Sa", start_time: "08:00:00", end_time: "13:00:00" },
];

const officials = (n: number, extra: Partial<OfficialSpec> = {}): OfficialSpec[] =>
  Array.from({ length: n }, (_, i) => ({ name: `Official ${i}`, ...extra }));

async function fixedShapes(): Promise<void> {
  // A. Two divisions, ample pool — everything fills, no fallback.
  await runSeasonPlaythrough("A ample 2-div", {
    name: "A",
    divisions: [
      { name: "Majors", priority: 0, umpiresPerGame: 2, teamCount: 4, gameCount: 6 },
      { name: "Minors", priority: 1, umpiresPerGame: 2, teamCount: 4, gameCount: 6 },
    ],
    officials: officials(10),
  });

  // B. Two divisions on an identical time grid, scarce pool — the priority
  // ordering decides who starves.
  await runSeasonPlaythrough("B scarce 2-div", {
    name: "B",
    divisions: [
      { name: "AAA", priority: 0, umpiresPerGame: 2, teamCount: 2, gameCount: 4 },
      { name: "AA", priority: 1, umpiresPerGame: 2, teamCount: 2, gameCount: 4 },
    ],
    officials: officials(3),
  });

  // C. Three divisions with every constraint type in play.
  await runSeasonPlaythrough("C constrained 3-div", {
    name: "C",
    divisions: [
      { name: "Juniors", priority: 0, umpiresPerGame: 2, teamCount: 3, gameCount: 8, gameDurationMins: 120 },
      { name: "Majors", priority: 1, umpiresPerGame: 2, teamCount: 3, gameCount: 8 },
      { name: "Rookies", priority: 2, umpiresPerGame: 1, teamCount: 2, gameCount: 6 },
    ],
    seasonRoles: ["Plate", "Base"],
    officials: [
      { name: "Coach Carter", coachesTeamIdx: 0 },
      { name: "Parent Pat", coiTeamIdxs: [3, 4] },
      { name: "Weekend Wanda", availability: ALL_DAY_WEEKEND },
      { name: "Morning Mo", availability: SATURDAY_MORNINGS_ONLY },
      { name: "Capped Cal", maxGamesPerWeek: 2 },
      { name: "Blackout Bo", blackouts: [SAT1] },
      { name: "Sunday Sam", blackouts: [SUN1] },
    ],
  });

  // D. Five divisions, one requiring zero officials, scarce pool, some
  // manual pre-assignments that must survive.
  await runSeasonPlaythrough("D 5-div zero-slot", {
    name: "D",
    divisions: [
      { name: "D1", priority: 0, umpiresPerGame: 2, teamCount: 2, gameCount: 6 },
      { name: "D2", priority: 1, umpiresPerGame: 1, teamCount: 2, gameCount: 6 },
      { name: "TeeBall", priority: 2, umpiresPerGame: 0, teamCount: 2, gameCount: 4 },
      { name: "D4", priority: 3, umpiresPerGame: 2, teamCount: 2, gameCount: 6 },
      { name: "D5", priority: 4, umpiresPerGame: 1, teamCount: 2, gameCount: 6 },
    ],
    officials: [
      ...officials(4),
      { name: "Capped Kim", maxGamesPerWeek: 1 },
    ],
    preAssign: [
      { divIdx: 0, gameIdx: 0, officialIdx: 0, roleIdx: 0 },
      { divIdx: 3, gameIdx: 2, officialIdx: 1, roleIdx: 1 },
    ],
  });

  // E. A division read fails mid-sequence — the rest of the season still runs.
  await runSeasonPlaythrough(
    "E error mid-sequence",
    {
      name: "E",
      divisions: [
        { name: "First", priority: 0, umpiresPerGame: 1, teamCount: 2, gameCount: 4 },
        { name: "Broken", priority: 1, umpiresPerGame: 1, teamCount: 2, gameCount: 4 },
        { name: "Last", priority: 2, umpiresPerGame: 1, teamCount: 2, gameCount: 4 },
      ],
      officials: officials(6),
    },
    { failDivIdxs: [1] },
  );

  // F. Equal priorities — deterministic name-tiebreak order, still safe.
  await runSeasonPlaythrough("F tied priorities", {
    name: "F",
    divisions: [
      { name: "Zebra", priority: 0, umpiresPerGame: 1, teamCount: 2, gameCount: 4 },
      { name: "Alpha", priority: 0, umpiresPerGame: 1, teamCount: 2, gameCount: 4 },
    ],
    officials: officials(2),
  });
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

function randomSpec(rand: () => number, idx: number): SeasonSpec {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const chance = (p: number) => rand() < p;

  const divCount = int(2, 5);
  const divisions: DivisionSpec[] = [];
  for (let i = 0; i < divCount; i++) {
    divisions.push({
      name: `Div${i}`,
      // occasional ties exercise the name tiebreak
      priority: chance(0.2) ? int(0, 1) : i,
      umpiresPerGame: chance(0.15) ? 0 : int(1, 3),
      teamCount: int(2, 4),
      gameCount: int(4, 12),
      gameDurationMins: chance(0.3) ? 120 : undefined,
    });
  }
  const totalTeams = divisions.reduce((n, d) => n + d.teamCount, 0);
  const maxGames = Math.max(...divisions.map((d) => d.gameCount));
  const gridDates = Array.from(
    new Set(Array.from({ length: maxGames }, (_, i) => localDateKey(gameTime(i)))),
  );

  const officialCount = int(2, 10);
  const specOfficials: OfficialSpec[] = [];
  for (let i = 0; i < officialCount; i++) {
    const o: OfficialSpec = { name: `R${idx}-Official${i}` };
    if (chance(0.3)) o.maxGamesPerWeek = int(1, 3);
    if (chance(0.3)) o.coachesTeamIdx = int(0, totalTeams - 1);
    if (chance(0.25)) o.coiTeamIdxs = [int(0, totalTeams - 1)];
    if (chance(0.3)) {
      o.availability = chance(0.5) ? ALL_DAY_WEEKEND : SATURDAY_MORNINGS_ONLY;
    }
    if (chance(0.3)) {
      o.blackouts = [gridDates[int(0, gridDates.length - 1)]];
    }
    specOfficials.push(o);
  }

  return {
    name: `R${idx}`,
    divisions,
    officials: specOfficials,
    seasonRoles: chance(0.5) ? ["Plate", "Base", "Field"] : undefined,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await fixedShapes();

  const rand = mulberry32(20260714);
  const RANDOM_SHAPES = 60;
  for (let i = 0; i < RANDOM_SHAPES; i++) {
    await runSeasonPlaythrough(`R${i}`, randomSpec(rand, i));
  }

  console.log(
    `auto-assign-season sim: ${playthroughs} playthroughs, ${assertions} assertions, ${failures.length} failures`,
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

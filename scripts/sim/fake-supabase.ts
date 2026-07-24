/**
 * Shared in-memory fake Supabase client for the schedule-generator sims
 * (team-game-constraints-sim.ts, round-order-sim.ts). Implements exactly the
 * query-builder subset and PostgREST embeds the generator issues — anything
 * else throws, so a new engine query shape extends THIS fake instead of a
 * sim silently returning garbage. Extracted verbatim from
 * team-game-constraints-sim.ts on 2026-07-23 so the two harnesses cannot
 * drift; keep it engine-shaped, not fixture-shaped (fixtures stay in each
 * sim's own buildDb).
 */

import type { GenerateScheduleClient } from "@/lib/schedule/generate-schedule";

export type Row = Record<string, unknown>;

export type Db = {
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

export type DbError = { message: string } | null;

/**
 * Targeted read-fault injection.
 *
 * `failTables` (below) fails EVERY read of a table, which is too coarse to
 * prove anything about the generator's individual `games` reads: the engine
 * issues several, so a table-wide fault always trips the FIRST one and every
 * assertion about the later reads passes vacuously. That is precisely the
 * "killed by the wrong assertion" trap. A fault therefore matches on the
 * select string, so a sim can fail exactly the venue-booking read and prove
 * that specific abort.
 */
export type ReadFault = {
  table: keyof Db;
  /** Match only reads whose select string contains this substring. */
  selectIncludes?: string;
  /**
   * Match only reads whose select string is EXACTLY this. Needed when one
   * read's select is a substring of another's: the coach-linked read selects
   * just "scheduled_at", which every other games read also contains, so a
   * substring fault silently retargets to the wrong read and the assertion
   * proves something other than what it claims.
   */
  selectEquals?: string;
  /** Fail only the Nth matching read (1-indexed). Default: every match. */
  nth?: number;
  message?: string;
};

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

export class FakeQuery implements PromiseLike<{ data: unknown; error: DbError }> {
  private filters: ((r: Row) => boolean)[] = [];
  private embedFilters: { alias: string; field: string; value: unknown }[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private singleMode = false;
  private embeds: EmbedNode[] = [];
  private selectCols = "";
  private maybeSingleMode = false;

  constructor(
    private fake: FakeClient,
    private table: keyof Db,
    private write?: { kind: "insert" | "delete"; rows?: Row[] },
  ) {}

  select(cols: string): this {
    this.selectCols = cols;
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

  /** PostgREST ilike — case-insensitive, `%` wildcards. The generator uses it
   *  to resolve a cross-division coach-linked team by name. */
  ilike(column: string, pattern: string): this {
    const rx = new RegExp(
      "^" +
        pattern
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/%/g, ".*") +
        "$",
      "i",
    );
    this.filters.push((r) => typeof r[column] === "string" && rx.test(r[column] as string));
    return this;
  }

  single(): this {
    this.singleMode = true;
    return this;
  }

  /** Zero rows -> {data: null, error: null}; more than one -> error. */
  maybeSingle(): this {
    this.maybeSingleMode = true;
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
    // Targeted fault injection first — it is the precise one, and letting the
    // coarse table-wide fault win would mask which read actually aborted.
    if (!this.write) {
      const fault = this.fake.matchReadFault(this.table, this.selectCols);
      if (fault) {
        return {
          data: null,
          error: { message: fault.message ?? `injected ${this.table} read failure` },
        };
      }
    }

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
    if (this.maybeSingleMode) {
      if (projected.length === 0) return { data: null, error: null };
      if (projected.length > 1) {
        return {
          data: null,
          error: { message: `expected <=1 row in ${this.table}, got ${projected.length}` },
        };
      }
      return { data: projected[0], error: null };
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

export class FakeClient {
  private idCounter = 0;
  failTables = new Set<keyof Db>();
  readFaults: ReadFault[] = [];
  /** Per-fault match counts — a sim FAILS if a fault it installed never fired,
   *  which is what stops an abort assertion from passing vacuously. */
  faultHits: number[] = [];

  constructor(public db: Db) {}

  /** Returns the fault that should fail this read, or null. */
  matchReadFault(table: keyof Db, selectCols: string): ReadFault | null {
    for (let i = 0; i < this.readFaults.length; i++) {
      const f = this.readFaults[i];
      if (f.table !== table) continue;
      if (f.selectEquals != null && selectCols.trim() !== f.selectEquals) continue;
      if (f.selectIncludes && !selectCols.includes(f.selectIncludes)) continue;
      this.faultHits[i] = (this.faultHits[i] ?? 0) + 1;
      if (f.nth != null && this.faultHits[i] !== f.nth) continue;
      return f;
    }
    return null;
  }

  injectReadFault(f: ReadFault): void {
    this.readFaults.push(f);
    this.faultHits.push(0);
  }

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

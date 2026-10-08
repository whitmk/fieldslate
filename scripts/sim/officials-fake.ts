// The in-memory fake Supabase client the officials auto-assign engine runs
// against in the harnesses — lifted VERBATIM out of auto-assign-season-sim.ts
// (2026-10-08) so a second harness (auto-assign-past-sim.ts) can drive the
// real engine without a second fake. The only additions: `export`s and the
// `profiles` table (the engine reads the org's timezone to skip past games).
// It implements exactly the query/embed subset the engine issues and THROWS
// on anything else — extend it, never stub a query in a sim.

import type { AutoAssignClient } from "@/lib/umpires/auto-assign";

// ── In-memory fake Supabase client ──────────────────────────────────────────

export type Row = Record<string, unknown>;

export type Db = {
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
  /** profiles.timezone — the org's "today" (auto-assign skips past games). */
  profiles: Row[];
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

export class FakeClient {
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

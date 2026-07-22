/**
 * Simulation harness for the practice generator's derived-game-day guard.
 *
 * Drives the REAL practice engine — autoAssignPractices — against an in-memory
 * fake of the Supabase client implementing exactly the query-builder subset and
 * PostgREST embeds the engine issues. Fixtures are division shapes with venues
 * (per-day open windows + per-day admin practice-usable flags), pre-seeded
 * games (recurring, one-off, cancelled, pending_interleague), and teams.
 *
 * Run with:  TZ=UTC npx tsx scripts/sim/practice-game-days-sim.ts
 * (or `npm run sim:practice-days`). TZ=UTC pins the engine's client-timezone
 * date math (see src/lib/venues/game-days.ts / eligibility.ts) so day-of-week
 * boundaries are unambiguous in Node; the harness refuses any other zone.
 *
 * The derivation-under-test must read the WALL-CLOCK DATE by substring, never
 * parse the instant — so shape TZ1 seeds games whose UTC instant lands on a
 * DIFFERENT weekday than their wall-clock date (a late game with a shifted
 * offset). Under TZ=UTC the two methods disagree; the harness proves the engine
 * follows the wall-clock (substring) day, both directly on deriveVenueGameDays
 * and end-to-end through a placement deflection.
 *
 * Invariants asserted on every playthrough (INDEPENDENT re-implementations of
 * game-day and availability math — never the shared lib the engine uses, so a
 * lib bug cannot self-verify):
 *  - CORE (game days win): no practice is ever placed on a (field, day-of-week)
 *    that is a derived game day — recurring games in >=2 distinct weeks at that
 *    venue, excluding cancelled + pending_interleague.
 *  - practice-usable: no practice on a day the admin marked practice=false.
 *  - regression: no practice on a day the venue isn't open; no (day, start,
 *    field) double-book; allow_practices=false venues never receive practices.
 *  - threshold: a one-off game (a single week) does NOT make its weekday a game
 *    day — a practice may still land there.
 *  - fail-closed: an injected games read error aborts with success:false and
 *    zero practice rows written.
 *
 * Anti-vacuity counters (the run FAILS if any is zero):
 *  - gameDayDeflections: single-team placements whose first-choice day (by the
 *    engine's day-priority, ignoring only the game-day guard) was a derived
 *    game day yet the placement avoided it — proof the guard actually deflected
 *    a candidate (so disabling `if (gameDays.has(day)) continue;` is
 *    detectable: without it, first-fit lands on the game day and the CORE
 *    assertion fails).
 *  - practiceUsableDeflections: the same for the practice-usable guard (proof
 *    disabling `if (!isPracticeUsable(...)) continue;` is detectable).
 *  - oneOffPlacements: practices placed on a weekday that had a one-off
 *    (single-week) game at that venue — proof the >=2-week threshold isn't
 *    over-blocking (and that lowering it to 1 would be caught).
 *  - gameDayCellsExercised: placements at a field that has >=1 derived game day
 *    which is also open + practice-usable — proof the CORE invariant isn't
 *    running over shapes with no live game-day constraint.
 *  - tzSplitCovered: the TZ1 shape whose instant-weekday != wall-clock-weekday
 *    actually ran (and the two genuinely differ).
 *
 * Mutation-test procedure (manual, per the harness standard): one at a time,
 * in src/lib/practices/auto-assign.ts chooseDays, disable (a) the
 * `if (gameDays.has(day as DayKey)) continue;` line and (b) the
 * `if (!isPracticeUsable(...)) continue;` line; the harness must FAIL for each
 * mutant; restore and re-verify green. The deflection counters above guarantee
 * both mutants are exercised by the fixtures. (Also verified: dropping the
 * >=2-week threshold to >=1 — GAME_DAY_WEEK_THRESHOLD — fails the one-off
 * shapes.)
 */

process.env.TZ = "UTC";

import { autoAssignPractices } from "@/lib/practices/auto-assign";
import { createClient } from "@/lib/supabase/client";
import { deriveVenueGameDays } from "@/lib/venues/game-days";

if (new Date("2026-09-05T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error(
    "This harness must run with TZ=UTC (client-timezone date math would shift " +
      "day boundaries). Re-run as: TZ=UTC npx tsx scripts/sim/practice-game-days-sim.ts",
  );
  process.exit(1);
}

// ── Tiny assertion framework + counters ─────────────────────────────────────

let assertions = 0;
let playthroughs = 0;
let gameDayDeflections = 0;
let practiceUsableDeflections = 0;
let oneOffPlacements = 0;
let gameDayCellsExercised = 0;
let tzSplitCovered = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) failures.push(msg);
}

// ── In-memory fake Supabase client (practices-engine query subset) ──────────

type Row = Record<string, unknown>;

type Db = {
  practice_time_slots: Row[];
  division_venues: Row[];
  venues: Row[];
  teams: Row[];
  team_availability_blocks: Row[];
  games: Row[];
  practice_slots: Row[];
};

type DbError = { message: string } | null;

type EmbedNode = { alias: string; target: string; fkHint: string | null; children: EmbedNode[] };

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
    if (!part.endsWith(")")) throw new Error(`fake client: unbalanced embed: ${part}`);
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

type Relation = { table: keyof Db; match: (parent: Row, child: Row) => boolean };

/** Exactly the embeds the practice engine issues — anything else throws so a
 *  new query shape extends the fake instead of silently returning garbage. */
const RELATIONS: Record<string, Relation> = {
  // division_venues → venues (`venue:venues!inner(...)`), paired with an eq on
  // venue.availability_configured applied post-embed by the dotted filter.
  "division_venues.venues": {
    table: "venues",
    match: (dv, v) => v.id === dv.venue_id,
  },
  // practice_slots → practice_time_slots (`start_time:practice_time_slots(start_time)`)
  "practice_slots.practice_time_slots": {
    table: "practice_time_slots",
    match: (ps, s) => s.id === ps.time_slot_id,
  },
};

class FakeQuery implements PromiseLike<{ data: unknown; error: DbError }> {
  private filters: ((r: Row) => boolean)[] = [];
  private embedFilters: { alias: string; field: string; value: unknown }[] = [];
  private orderBys: { column: string; ascending: boolean }[] = [];
  private embeds: EmbedNode[] = [];

  constructor(
    private fake: FakeClient,
    private table: keyof Db,
    private write?: { kind: "insert"; rows?: Row[] },
  ) {}

  select(cols: string): this {
    this.embeds = parseEmbeds(cols);
    return this;
  }

  eq(column: string, value: unknown): this {
    const dot = column.indexOf(".");
    if (dot !== -1) {
      this.embedFilters.push({ alias: column.slice(0, dot), field: column.slice(dot + 1), value });
      return this;
    }
    this.filters.push((r) => r[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBys.push({ column, ascending: opts?.ascending !== false });
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
        children.length > 0 ? this.resolveEmbeds(children[0], node.children, rel.table) : null;
    }
    return out;
  }

  private execute(): { data: unknown; error: DbError } {
    if (!this.write && this.fake.failTables.has(this.table)) {
      return { data: null, error: { message: `injected ${this.table} read failure` } };
    }
    if (this.write?.kind === "insert") {
      for (const row of this.write.rows ?? []) {
        this.fake.db[this.table].push({ id: this.fake.nextId("row"), ...row });
      }
      return { data: null, error: null };
    }

    let rows = this.fake.db[this.table].filter((r) => this.filters.every((f) => f(r)));
    for (const ob of this.orderBys) {
      rows = [...rows].sort((a, b) => {
        const av = a[ob.column] as string | number;
        const bv = b[ob.column] as string | number;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ob.ascending ? 1 : -1);
      });
    }
    let projected = rows.map((r) => this.resolveEmbeds(r, this.embeds, this.table));
    for (const ef of this.embedFilters) {
      projected = projected.filter((r) => {
        const embedded = r[ef.alias] as Row | null;
        return embedded != null && embedded[ef.field] === ef.value;
      });
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
  } {
    const t = table as keyof Db;
    if (!(t in this.db)) throw new Error(`fake client: unknown table ${table}`);
    return {
      select: (cols: string) => new FakeQuery(this, t).select(cols),
      insert: (rows: Row[]) => new FakeQuery(this, t, { kind: "insert", rows }),
    };
  }

  asClient(): ReturnType<typeof createClient> {
    return this as unknown as ReturnType<typeof createClient>;
  }
}

// ── Fixture builder ─────────────────────────────────────────────────────────

const DIVISION_ID = "div-1";
const LEAGUE_ID = "league-1";
const DAY_ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_INDEX: Record<string, number> = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 0 };
// 2026-09-07 is a Monday — the anchor for isoFor(day, week).
const ANCHOR_MONDAY = "2026-09-07";

/** ISO wall-clock for `day` in week `week` (0-based) from the anchor Monday.
 *  `offset` lets a shape force an instant/wall-clock split (e.g. "-05:00"). */
function isoFor(day: string, week: number, time = "17:00", offset = "+00:00"): string {
  const base = new Date(ANCHOR_MONDAY + "T00:00:00");
  const dow = DAY_INDEX[day];
  const mondayIndex = 0; // anchor is Monday
  const dayDelta = (dow === 0 ? 6 : dow - 1) - mondayIndex; // Mon=0 … Sun=6
  base.setDate(base.getDate() + week * 7 + dayDelta);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T${time}:00${offset}`;
}

type VenueSpec = {
  id: string;
  openDays: string[];
  practiceOff?: string[]; // open but practice=false
  allowPractices?: boolean; // default true
};

type GameSpec = { venueId: string; iso: string; status?: string };

type TeamSpec = {
  id: string;
  practicesPerWeek: number;
  preferredDays?: string[];
  preferredFieldId?: string;
  blocks?: Array<{ day: string; start?: string; end?: string }>;
};

type Shape = {
  name: string;
  venues: VenueSpec[];
  games: GameSpec[];
  teams: TeamSpec[];
  slotDays: string[];
  slotStart?: string;
  slotDuration?: number;
};

function buildDb(shape: Shape): FakeClient {
  const db: Db = {
    practice_time_slots: [],
    division_venues: [],
    venues: [],
    teams: [],
    team_availability_blocks: [],
    games: [],
    practice_slots: [],
  };

  db.practice_time_slots.push({
    id: "slot-1",
    label: "Slot",
    start_time: `${shape.slotStart ?? "17:00"}:00`,
    duration_minutes: shape.slotDuration ?? 90,
    days_of_week: shape.slotDays,
    sort_order: 0,
    division_id: DIVISION_ID,
  });

  for (const v of shape.venues) {
    const availability: Record<string, { start: string; end: string; practice?: boolean }> = {};
    for (const d of v.openDays) {
      availability[d] = { start: "07:00", end: "22:00" };
      if (v.practiceOff?.includes(d)) availability[d].practice = false;
    }
    db.venues.push({
      id: v.id,
      name: v.id,
      availability,
      availability_configured: v.openDays.length > 0,
    });
    db.division_venues.push({
      division_id: DIVISION_ID,
      venue_id: v.id,
      allow_practices: v.allowPractices !== false,
    });
  }

  for (const [gi, g] of shape.games.entries()) {
    db.games.push({
      id: `game-${gi}`,
      venue_id: g.venueId,
      scheduled_at: g.iso,
      status: g.status ?? "scheduled",
    });
  }

  for (const t of shape.teams) {
    db.teams.push({
      id: t.id,
      name: t.id,
      division_id: DIVISION_ID,
      league_id: LEAGUE_ID,
      practices_per_week: t.practicesPerWeek,
      preferred_days: t.preferredDays ?? null,
      preferred_time_id: null,
      preferred_field_id: t.preferredFieldId ?? null,
    });
    for (const [bi, b] of (t.blocks ?? []).entries()) {
      db.team_availability_blocks.push({
        id: `blk-${t.id}-${bi}`,
        team_id: t.id,
        day_of_week: b.day,
        start_time: b.start ? `${b.start}:00` : null,
        end_time: b.end ? `${b.end}:00` : null,
      });
    }
  }

  return new FakeClient(db);
}

// ── Independent math (NOT the shared lib) ───────────────────────────────────

const JS_TO_DAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** day-of-week from the DATE SUBSTRING (wall-clock), independent of the lib. */
function dowOf(iso: string): string {
  return JS_TO_DAY[new Date(iso.substring(0, 10) + "T00:00:00").getDay()];
}

/** Monday-of-week key from the date substring — independent week bucketer. */
function weekOf(iso: string): string {
  const d = new Date(iso.substring(0, 10) + "T00:00:00");
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${mon.getFullYear()}-${mon.getMonth()}-${mon.getDate()}`;
}

const NON_COUNTING = new Set(["cancelled", "pending_interleague"]);

/** Independent per-venue derived game days (>=2 distinct weeks). */
function independentGameDays(shape: Shape): Map<string, Set<string>> {
  const acc = new Map<string, Map<string, Set<string>>>();
  for (const g of shape.games) {
    if (NON_COUNTING.has(g.status ?? "scheduled")) continue;
    const day = dowOf(g.iso);
    const wk = weekOf(g.iso);
    let byDay = acc.get(g.venueId);
    if (!byDay) {
      byDay = new Map();
      acc.set(g.venueId, byDay);
    }
    let weeks = byDay.get(day);
    if (!weeks) {
      weeks = new Set();
      byDay.set(day, weeks);
    }
    weeks.add(wk);
  }
  const out = new Map<string, Set<string>>();
  for (const [vid, byDay] of acc) {
    const days = new Set<string>();
    for (const [day, weeks] of byDay) if (weeks.size >= 2) days.add(day);
    if (days.size > 0) out.set(vid, days);
  }
  return out;
}

/** All weekdays that had at least ONE counting game at the venue (regardless of
 *  threshold) — used to spot one-off (single-week, sub-threshold) days. */
function anyGameDays(shape: Shape): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const g of shape.games) {
    if (NON_COUNTING.has(g.status ?? "scheduled")) continue;
    const day = dowOf(g.iso);
    const set = out.get(g.venueId) ?? new Set<string>();
    set.add(day);
    out.set(g.venueId, set);
  }
  return out;
}

function venueOf(shape: Shape, id: string): VenueSpec {
  return shape.venues.find((v) => v.id === id)!;
}

// ── Playthrough driver + invariant checks ───────────────────────────────────

type PracticeSlotRow = {
  team_id: string;
  time_slot_id: string;
  field_id: string;
  practice_days: string[];
  type: string;
};

async function run(shape: Shape): Promise<FakeClient> {
  const fake = buildDb(shape);
  playthroughs++;
  const res = await autoAssignPractices(DIVISION_ID, fake.asClient());
  assert(res.success, `[${shape.name}] engine returned failure: ${res.success ? "" : res.error}`);

  const placed = fake.db.practice_slots as unknown as PracticeSlotRow[];
  const gameDays = independentGameDays(shape);
  const oneOffCandidate = anyGameDays(shape);
  const takenKeys = new Set<string>();

  for (const ps of placed) {
    const v = venueOf(shape, ps.field_id);
    // allow_practices=false venues must never receive a practice
    assert(
      v.allowPractices !== false,
      `[${shape.name}] practice placed at allow_practices=false venue ${ps.field_id}`,
    );
    const vGameDays = gameDays.get(ps.field_id) ?? new Set<string>();
    for (const day of ps.practice_days) {
      // CORE: never a derived game day
      assert(
        !vGameDays.has(day),
        `[${shape.name}] practice for ${ps.team_id} on ${day} at ${ps.field_id} — that is a derived game day`,
      );
      // practice-usable: never a practice=false day
      assert(
        !(v.practiceOff ?? []).includes(day),
        `[${shape.name}] practice for ${ps.team_id} on ${day} at ${ps.field_id} — day marked practice=false`,
      );
      // venue must be open that day
      assert(
        v.openDays.includes(day),
        `[${shape.name}] practice for ${ps.team_id} on ${day} at ${ps.field_id} — venue closed that day`,
      );
      // no (day, start, field) double-book
      const key = `${day}|${ps.field_id}`;
      assert(!takenKeys.has(key), `[${shape.name}] double-book ${key}`);
      takenKeys.add(key);

      // anti-vacuity: one-off (single-week, sub-threshold) day placement
      if (oneOffCandidate.get(ps.field_id)?.has(day) && !vGameDays.has(day)) {
        oneOffPlacements++;
      }
    }
    // anti-vacuity: this field carries a live game-day constraint that is also
    // open + practice-usable (so the CORE assertion above wasn't vacuous)
    for (const gd of vGameDays) {
      if (v.openDays.includes(gd) && !(v.practiceOff ?? []).includes(gd)) {
        gameDayCellsExercised++;
        break;
      }
    }
  }

  return fake;
}

/** Single-team, single-venue deflection accounting. Replicates the engine's
 *  day-priority (preferred, then default order), applying every filter EXCEPT
 *  the guard under test, to find the day first-fit WOULD have taken. If that
 *  day is a game day / non-practice-usable and the placement avoided it, the
 *  guard deflected a real candidate. */
function accountDeflection(shape: Shape, fake: FakeClient, kind: "game" | "practice"): void {
  assert(shape.teams.length === 1, `[${shape.name}] deflection accounting needs one team`);
  assert(shape.venues.length === 1, `[${shape.name}] deflection accounting needs one venue`);
  const team = shape.teams[0];
  const v = shape.venues[0];
  const slotDays = new Set(shape.slotDays);
  const gameDays = independentGameDays(shape).get(v.id) ?? new Set<string>();
  const preferred = team.preferredDays ?? [];
  const priority =
    preferred.length > 0
      ? [...preferred, ...DAY_ORDER.filter((d) => !preferred.includes(d))]
      : [...DAY_ORDER];

  // The day first-fit takes when the guard-under-test is disabled: first
  // priority day that is in the slot, open, and (for the OTHER guard) valid.
  const firstChoice = priority.find((d) => {
    if (!slotDays.has(d)) return false;
    if (!v.openDays.includes(d)) return false;
    if (kind === "game" && (v.practiceOff ?? []).includes(d)) return false; // other guard still on
    if (kind === "practice" && gameDays.has(d)) return false; // other guard still on
    return true;
  });
  if (!firstChoice) return;

  const isBlockedTarget =
    kind === "game" ? gameDays.has(firstChoice) : (v.practiceOff ?? []).includes(firstChoice);
  if (!isBlockedTarget) return; // first choice wasn't a guarded day — no deflection here

  const placed = fake.db.practice_slots as unknown as PracticeSlotRow[];
  const landedOnFirstChoice = placed.some((ps) => ps.practice_days.includes(firstChoice));
  assert(
    !landedOnFirstChoice,
    `[${shape.name}] practice landed on ${firstChoice}, a guarded day the guard should have deflected`,
  );
  if (kind === "game") gameDayDeflections++;
  else practiceUsableDeflections++;
}

// ── Fixed shapes ─────────────────────────────────────────────────────────────

const ALL_DAYS = [...DAY_ORDER];

async function fixedShapes(): Promise<void> {
  // S1. Baseline — no games, one team, preferred Mo/We → lands on Mo/We.
  {
    const shape: Shape = {
      name: "S1 baseline",
      venues: [{ id: "v", openDays: ALL_DAYS }],
      games: [],
      teams: [{ id: "t0", practicesPerWeek: 2, preferredDays: ["Mo", "We"], preferredFieldId: "v" }],
      slotDays: ALL_DAYS,
    };
    const fake = await run(shape);
    const placed = fake.db.practice_slots as unknown as PracticeSlotRow[];
    assert(placed.length === 1, "[S1] team not placed");
    assert(
      placed[0]?.practice_days.slice().sort().join(",") === "Mo,We",
      `[S1] expected Mo,We got ${placed[0]?.practice_days.join(",")}`,
    );
  }

  // S2. Game-day deflection (game-guard mutation detector) — Monday is a
  // derived game day (games in 2 distinct weeks); team prefers Monday. It must
  // land elsewhere. Without the guard, first-fit takes Monday.
  {
    const shape: Shape = {
      name: "S2 game-day deflection",
      venues: [{ id: "v", openDays: ALL_DAYS }],
      games: [
        { venueId: "v", iso: isoFor("Mo", 0) },
        { venueId: "v", iso: isoFor("Mo", 1) },
      ],
      teams: [{ id: "t0", practicesPerWeek: 1, preferredDays: ["Mo"], preferredFieldId: "v" }],
      slotDays: ALL_DAYS,
    };
    const fake = await run(shape);
    accountDeflection(shape, fake, "game");
    const placed = fake.db.practice_slots as unknown as PracticeSlotRow[];
    assert(placed.length === 1 && !placed[0].practice_days.includes("Mo"), "[S2] should avoid Monday");
  }

  // S3. One-off game is NOT a game day (threshold proof) — a SINGLE Monday game
  // must not block Monday practices.
  {
    const shape: Shape = {
      name: "S3 one-off ignored",
      venues: [{ id: "v", openDays: ALL_DAYS }],
      games: [{ venueId: "v", iso: isoFor("Mo", 0) }],
      teams: [{ id: "t0", practicesPerWeek: 1, preferredDays: ["Mo"], preferredFieldId: "v" }],
      slotDays: ALL_DAYS,
    };
    const fake = await run(shape);
    const placed = fake.db.practice_slots as unknown as PracticeSlotRow[];
    assert(
      placed.length === 1 && placed[0].practice_days.includes("Mo"),
      "[S3] one-off Monday game wrongly blocked Monday practice",
    );
  }

  // S4. Practice-usable deflection (practice-guard mutation detector) — Monday
  // is open but practice=false; team prefers Monday. Must land elsewhere.
  {
    const shape: Shape = {
      name: "S4 practice-usable deflection",
      venues: [{ id: "v", openDays: ALL_DAYS, practiceOff: ["Mo"] }],
      games: [],
      teams: [{ id: "t0", practicesPerWeek: 1, preferredDays: ["Mo"], preferredFieldId: "v" }],
      slotDays: ALL_DAYS,
    };
    const fake = await run(shape);
    accountDeflection(shape, fake, "practice");
    const placed = fake.db.practice_slots as unknown as PracticeSlotRow[];
    assert(placed.length === 1 && !placed[0].practice_days.includes("Mo"), "[S4] should avoid Monday");
  }

  // S5. Cancelled + pending_interleague games don't count — 2 Mondays but both
  // non-counting → Monday is NOT a game day → Monday practice allowed.
  {
    const shape: Shape = {
      name: "S5 non-counting statuses",
      venues: [{ id: "v", openDays: ALL_DAYS }],
      games: [
        { venueId: "v", iso: isoFor("Mo", 0), status: "cancelled" },
        { venueId: "v", iso: isoFor("Mo", 1), status: "pending_interleague" },
      ],
      teams: [{ id: "t0", practicesPerWeek: 1, preferredDays: ["Mo"], preferredFieldId: "v" }],
      slotDays: ALL_DAYS,
    };
    const fake = await run(shape);
    const placed = fake.db.practice_slots as unknown as PracticeSlotRow[];
    assert(
      placed.length === 1 && placed[0].practice_days.includes("Mo"),
      "[S5] cancelled/pending games wrongly blocked Monday",
    );
  }

  // S6. allow_practices=false venue is excluded even though it's the preferred
  // field and open — the team must land on the other venue.
  {
    const shape: Shape = {
      name: "S6 allow_practices gate",
      venues: [
        { id: "vno", openDays: ALL_DAYS, allowPractices: false },
        { id: "vyes", openDays: ALL_DAYS },
      ],
      games: [],
      teams: [{ id: "t0", practicesPerWeek: 1, preferredDays: ["Mo"], preferredFieldId: "vno" }],
      slotDays: ALL_DAYS,
    };
    const fake = await run(shape);
    const placed = fake.db.practice_slots as unknown as PracticeSlotRow[];
    assert(placed.length === 1 && placed[0].field_id === "vyes", "[S6] should skip the disallowed venue");
  }

  // S7. Fail-closed — injected games read error aborts with no writes.
  {
    const shape: Shape = {
      name: "S7 fail closed",
      venues: [{ id: "v", openDays: ALL_DAYS }],
      games: [{ venueId: "v", iso: isoFor("Mo", 0) }],
      teams: [{ id: "t0", practicesPerWeek: 1, preferredDays: ["Mo"], preferredFieldId: "v" }],
      slotDays: ALL_DAYS,
    };
    const fake = buildDb(shape);
    fake.failTables.add("games");
    playthroughs++;
    const res = await autoAssignPractices(DIVISION_ID, fake.asClient());
    assert(!res.success, "[S7] engine succeeded despite a games read failure");
    assert(fake.db.practice_slots.length === 0, "[S7] practice rows written despite fail-closed abort");
  }

  // TZ1. Wall-clock vs instant split (the load-bearing tz proof). Two Monday
  // games at 23:30 with a -05:00 offset: wall-clock date is Monday, but the UTC
  // instant is Tuesday 04:30. Under TZ=UTC a naive `new Date(iso).getDay()`
  // yields Tuesday; the substring convention yields Monday. Prove BOTH that the
  // two methods genuinely disagree AND that deriveVenueGameDays + the engine
  // follow the wall-clock (Monday).
  {
    const lateMon0 = isoFor("Mo", 0, "23:30", "-05:00");
    const lateMon1 = isoFor("Mo", 1, "23:30", "-05:00");
    // the split actually exists in these fixtures:
    const substringDay = dowOf(lateMon0);
    const instantDay = JS_TO_DAY[new Date(lateMon0).getUTCDay()];
    assert(substringDay === "Mo", `[TZ1] substring day expected Mo, got ${substringDay}`);
    assert(
      instantDay !== substringDay,
      `[TZ1] fixture doesn't create a tz split (instant ${instantDay} == wall-clock ${substringDay})`,
    );
    tzSplitCovered++;

    // direct unit proof on the lib: Monday is the derived game day, not Tuesday
    const libDays = deriveVenueGameDays([
      { venue_id: "v", scheduled_at: lateMon0, status: "scheduled" },
      { venue_id: "v", scheduled_at: lateMon1, status: "scheduled" },
    ]);
    assert(libDays.get("v")?.has("Mo") === true, "[TZ1] lib failed to derive Monday from wall-clock date");
    assert(libDays.get("v")?.has("Tu") !== true, "[TZ1] lib wrongly derived Tuesday from the instant");

    // end-to-end: a Monday-preferring team must be deflected off Monday; a
    // Tuesday-preferring team must still get Tuesday (Tuesday is NOT a game day).
    const shapeMon: Shape = {
      name: "TZ1 monday deflect",
      venues: [{ id: "v", openDays: ALL_DAYS }],
      games: [
        { venueId: "v", iso: lateMon0 },
        { venueId: "v", iso: lateMon1 },
      ],
      teams: [{ id: "t0", practicesPerWeek: 1, preferredDays: ["Mo"], preferredFieldId: "v" }],
      slotDays: ALL_DAYS,
    };
    const fakeMon = await run(shapeMon);
    accountDeflection(shapeMon, fakeMon, "game");
    const placedMon = fakeMon.db.practice_slots as unknown as PracticeSlotRow[];
    assert(
      placedMon.length === 1 && !placedMon[0].practice_days.includes("Mo"),
      "[TZ1] Monday practice placed on a wall-clock Monday game day",
    );

    const shapeTue: Shape = {
      name: "TZ1 tuesday allowed",
      venues: [{ id: "v", openDays: ALL_DAYS }],
      games: [
        { venueId: "v", iso: lateMon0 },
        { venueId: "v", iso: lateMon1 },
      ],
      teams: [{ id: "t0", practicesPerWeek: 1, preferredDays: ["Tu"], preferredFieldId: "v" }],
      slotDays: ALL_DAYS,
    };
    const fakeTue = await run(shapeTue);
    const placedTue = fakeTue.db.practice_slots as unknown as PracticeSlotRow[];
    assert(
      placedTue.length === 1 && placedTue[0].practice_days.includes("Tu"),
      "[TZ1] Tuesday wrongly treated as a game day (instant parsing leaked in)",
    );
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

async function randomShapes(): Promise<void> {
  const rand = mulberry32(20260721);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const chance = (p: number) => rand() < p;

  for (let i = 0; i < 60; i++) {
    const venueCount = int(1, 2);
    const venues: VenueSpec[] = [];
    const games: GameSpec[] = [];
    for (let vi = 0; vi < venueCount; vi++) {
      const id = `v${vi}`;
      const openDays = DAY_ORDER.filter(() => chance(0.7));
      if (openDays.length === 0) openDays.push("Sa");
      const practiceOff = openDays.filter(() => chance(0.2));
      // venue 0 is always practice-eligible so the engine always has a target
      // (a shape with zero eligible venues is an honest failure, not a guard
      // bug — we exclude it rather than assert success on it).
      venues.push({ id, openDays, practiceOff, allowPractices: vi === 0 ? true : chance(0.85) });
      // seed games: for some open days, put games in 1..3 weeks (recurring when
      // >=2), plus occasional cancelled/pending noise.
      for (const d of openDays) {
        if (!chance(0.4)) continue;
        const weeks = int(1, 3);
        for (let w = 0; w < weeks; w++) {
          const status = chance(0.15) ? (chance(0.5) ? "cancelled" : "pending_interleague") : "scheduled";
          games.push({ venueId: id, iso: isoFor(d, w), status });
        }
      }
    }
    const teamCount = int(1, 4);
    const teams: TeamSpec[] = [];
    for (let ti = 0; ti < teamCount; ti++) {
      const pref = DAY_ORDER.filter(() => chance(0.35));
      teams.push({
        id: `t${ti}`,
        practicesPerWeek: int(1, 2),
        preferredDays: pref.length ? pref : undefined,
        preferredFieldId: chance(0.5) ? `v${int(0, venueCount - 1)}` : undefined,
      });
    }
    const slotDays = DAY_ORDER.filter(() => chance(0.75));
    if (slotDays.length === 0) slotDays.push("Sa");

    await run({ name: `R${i}`, venues, games, teams, slotDays });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await fixedShapes();
  await randomShapes();

  assert(gameDayDeflections > 0, "no game-day deflection ever occurred — the game-day guard ran vacuously");
  assert(
    practiceUsableDeflections > 0,
    "no practice-usable deflection ever occurred — the practice-usable guard ran vacuously",
  );
  assert(oneOffPlacements > 0, "no one-off-day placement ever occurred — the >=2-week threshold ran vacuously");
  assert(
    gameDayCellsExercised > 0,
    "no placement ever occurred at a field with a live open+usable game day — CORE invariant ran vacuously",
  );
  assert(tzSplitCovered > 0, "the tz wall-clock/instant split shape never ran");

  console.log(
    `practice-game-days sim: ${playthroughs} playthroughs, ${assertions} assertions, ${failures.length} failures`,
  );
  console.log(
    `  coverage: ${gameDayDeflections} game-day deflections, ${practiceUsableDeflections} practice-usable deflections, ` +
      `${oneOffPlacements} one-off placements, ${gameDayCellsExercised} live game-day cells, ${tzSplitCovered} tz-split shapes`,
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

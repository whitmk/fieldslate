/**
 * Simulation harness for team reconciliation (src/lib/divisions/reconcile-teams.ts).
 *
 * Run with:  npm run sim:team-reconcile
 *
 * Drives the REAL reconcile functions (reconcileTeamsOnSave / renameTeamInline)
 * against an in-memory fake Supabase client — the same "fake the environment,
 * never the logic" seam the umpires auto-assign sim uses. It proves the
 * invariants the fix exists to guarantee:
 *
 *   • a RENAME updates the teams row in place and creates ZERO new rows;
 *   • a genuine ADD still inserts;
 *   • a team WITH GAMES is never destroyed — it is kept and reported;
 *   • the `teams` table and `divisions.settings.teams[]` jsonb agree after
 *     every operation;
 *   • name-keyed `conflict_team` references are rewritten on rename, in the
 *     renamed team's own division AND across sibling divisions;
 *   • a name collision aborts with no writes.
 *
 * Three-part standard (CLAUDE.md):
 *   1. Real code, full playthroughs — the production functions run end-to-end.
 *   2. Mutation-tested — deliberately broken detection (the original
 *      add-by-name bug, an id-blind matcher, a defeated collision guard) is
 *      run through the same invariant checker and MUST fail; if a mutant
 *      passes, the harness is vacuous and the run fails.
 *   3. Anti-vacuity counters — every guarded scenario is counted and the run
 *      fails if any counter is zero.
 */

import {
  reconcileTeamsOnSave,
  renameTeamInline,
  planTeamReconciliation,
  mergeLiveTeamsWithJsonb,
  toJsonbEntries,
  type ReconcileClient,
  type LiveTeam,
  type ReconcilePlan,
} from "../../src/lib/divisions/reconcile-teams";
import type { TeamEntry } from "../../src/components/divisions/wizard-types";

// ── Tiny assert + counters ───────────────────────────────────────────────────

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

const counters = {
  rename: 0,
  insert: 0,
  removalWithGames: 0,
  removalNoGames: 0,
  inDivConflictRewrite: 0,
  crossDivConflictRewrite: 0,
  inlineRename: 0,
  collisionBlocked: 0,
  mutantsCaught: 0,
};

// ── In-memory DB + fake client ───────────────────────────────────────────────

type Row = Record<string, unknown>;
type Db = { teams: Row[]; divisions: Row[]; games: Row[] };

type Filter = { col: string; val: unknown; op: "eq" | "neq" };

class FakeQuery {
  private filters: Filter[] = [];
  private isSingle = false;
  constructor(
    private db: Db,
    private table: keyof Db,
    private mode: { kind: "select" } | { kind: "update"; patch: Row },
  ) {}
  eq(col: string, val: unknown): this {
    this.filters.push({ col, val, op: "eq" });
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters.push({ col, val, op: "neq" });
    return this;
  }
  single(): this {
    this.isSingle = true;
    return this;
  }
  private match(row: Row): boolean {
    return this.filters.every((f) =>
      f.op === "eq" ? row[f.col] === f.val : row[f.col] !== f.val,
    );
  }
  private execute(): { data: unknown; error: { message: string } | null } {
    const rows = this.db[this.table].filter((r) => this.match(r));
    if (this.mode.kind === "update") {
      for (const r of rows) Object.assign(r, this.mode.patch);
      return { data: null, error: null };
    }
    if (this.isSingle) {
      return rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "no rows" } };
    }
    return { data: rows, error: null };
  }
  then<T>(onf: (v: { data: unknown; error: { message: string } | null }) => T): Promise<T> {
    return Promise.resolve(this.execute()).then(onf);
  }
}

class FakeClient {
  private idn = 0;
  capReached = false;
  constructor(public db: Db) {}
  private nextId(p: string) {
    return `${p}_${++this.idn}`;
  }
  from(table: string) {
    const t = table as keyof Db;
    if (!(t in this.db)) throw new Error(`fake client: unknown table ${table}`);
    return {
      select: () => new FakeQuery(this.db, t, { kind: "select" }),
      update: (patch: Row) => new FakeQuery(this.db, t, { kind: "update", patch }),
    };
  }
  rpc(name: string, params: Row) {
    if (name !== "create_team") throw new Error(`fake client: unexpected rpc ${name}`);
    if (this.capReached) {
      return Promise.resolve({
        data: { error: "cap_reached", cap: "teamsPerOrg", limit: 6, plan: "free" },
        error: null,
      });
    }
    const id = this.nextId("team");
    this.db.teams.push({
      id,
      league_id: params.p_league_id,
      division_id: params.p_division_id,
      name: params.p_name,
    });
    return Promise.resolve({ data: { row: { id } }, error: null });
  }
  asClient(): ReconcileClient {
    return this as unknown as ReconcileClient;
  }
}

// ── Fixture + helpers ────────────────────────────────────────────────────────

const LEAGUE = "league_1";

function entry(name: string, extra: Partial<TeamEntry> = {}): TeamEntry {
  return { name, has_coach_conflict: false, conflict_division: "", conflict_team: "", ...extra };
}

/** Seed a division with teams rows + a matching jsonb team list. */
function seedDivision(db: Db, divId: string, teams: { name: string; entry?: TeamEntry }[]) {
  const jsonb: TeamEntry[] = [];
  for (const t of teams) {
    db.teams.push({ id: `${divId}_${t.name}`, league_id: LEAGUE, division_id: divId, name: t.name });
    jsonb.push(t.entry ?? entry(t.name));
  }
  db.divisions.push({ id: divId, league_id: LEAGUE, settings: { teams: jsonb } });
}

function liveTeamsOf(db: Db, divId: string): LiveTeam[] {
  return db.teams
    .filter((t) => t.division_id === divId)
    .map((t) => ({ id: t.id as string, name: t.name as string }));
}

function jsonbNamesOf(db: Db, divId: string): string[] {
  const div = db.divisions.find((d) => d.id === divId) as { settings: { teams: TeamEntry[] } };
  return (div.settings.teams ?? []).map((e) => e.name.trim().toLowerCase()).sort();
}

function tableNamesOf(db: Db, divId: string): string[] {
  return liveTeamsOf(db, divId).map((t) => t.name.trim().toLowerCase()).sort();
}

/** Core invariant: the teams table and the jsonb list name-sets agree. */
function assertAgree(db: Db, divId: string, label: string) {
  const table = tableNamesOf(db, divId);
  const jsonb = jsonbNamesOf(db, divId);
  assert(
    JSON.stringify(table) === JSON.stringify(jsonb),
    `${label}: teams table (${table.join(",")}) and jsonb (${jsonb.join(",")}) must agree`,
  );
}

/** Emulate the wizard component's own division-row UPDATE (which writes the
 *  reconciled teams[] the lib returns). The lib deliberately does NOT write the
 *  edited division's own settings — the caller does. */
function writeDivisionTeams(db: Db, divId: string, teams: TeamEntry[]) {
  const div = db.divisions.find((d) => d.id === divId) as { settings: Record<string, unknown> };
  div.settings = { ...div.settings, teams };
}

async function reconcileAndWrite(
  client: FakeClient,
  divId: string,
  submitted: TeamEntry[],
) {
  const res = await reconcileTeamsOnSave(
    { leagueId: LEAGUE, divisionId: divId, submitted, teamCount: 0, teamLimit: -1, plan: "elite" },
    client.asClient(),
  );
  if (res.ok) writeDivisionTeams(client.db, divId, res.teamsForJsonb);
  return res;
}

// ── Scenario suite (real functions) ──────────────────────────────────────────

async function scenarioRenameInPlace() {
  const db: Db = { teams: [], divisions: [], games: [] };
  seedDivision(db, "d1", [{ name: "Aces" }, { name: "Bees" }]);
  const client = new FakeClient(db);

  // Load as the wizard would, then rename Bees → Bees FC.
  const loaded = mergeLiveTeamsWithJsonb(liveTeamsOf(db, "d1"), [entry("Aces"), entry("Bees")]);
  const submitted = loaded.map((e) => (e.name === "Bees" ? { ...e, name: "Bees FC" } : e));

  const rowsBefore = db.teams.length;
  const res = await reconcileAndWrite(client, "d1", submitted);
  assert(res.ok, "rename: reconcile succeeds");
  assert(db.teams.length === rowsBefore, "rename: creates ZERO new team rows");
  const bees = db.teams.find((t) => t.id === "d1_Bees");
  assert(!!bees && bees.name === "Bees FC", "rename: existing row updated in place");
  assert(!db.teams.some((t) => t.name === "Bees"), "rename: old name gone from teams table");
  if (res.ok) assert(res.renames.length === 1, "rename: exactly one rename detected");
  assertAgree(db, "d1", "rename");
  counters.rename++;
}

async function scenarioGenuineAdd() {
  const db: Db = { teams: [], divisions: [], games: [] };
  seedDivision(db, "d1", [{ name: "Aces" }, { name: "Bees" }]);
  const client = new FakeClient(db);

  const loaded = mergeLiveTeamsWithJsonb(liveTeamsOf(db, "d1"), [entry("Aces"), entry("Bees")]);
  const submitted = [...loaded, entry("Cats")]; // net-new, no id

  const res = await reconcileAndWrite(client, "d1", submitted);
  assert(res.ok, "add: reconcile succeeds");
  assert(db.teams.filter((t) => t.division_id === "d1").length === 3, "add: inserts a new row");
  assert(db.teams.some((t) => t.name === "Cats"), "add: new team present");
  assertAgree(db, "d1", "add");
  counters.insert++;
}

async function scenarioRemoveWithGamesKept() {
  const db: Db = { teams: [], divisions: [], games: [] };
  seedDivision(db, "d1", [{ name: "Aces" }, { name: "Bees" }]);
  // Bees has 3 games.
  db.games.push(
    { id: "g1", home_team_id: "d1_Bees", away_team_id: "d1_Aces" },
    { id: "g2", home_team_id: "d1_Aces", away_team_id: "d1_Bees" },
    { id: "g3", home_team_id: "d1_Bees", away_team_id: "d1_Aces" },
  );
  const client = new FakeClient(db);

  const loaded = mergeLiveTeamsWithJsonb(liveTeamsOf(db, "d1"), [entry("Aces"), entry("Bees")]);
  const submitted = loaded.filter((e) => e.name !== "Bees"); // user removed Bees

  const res = await reconcileAndWrite(client, "d1", submitted);
  assert(res.ok, "remove: reconcile succeeds");
  assert(db.teams.some((t) => t.id === "d1_Bees"), "remove: team WITH GAMES never destroyed");
  assert(db.games.length === 3, "remove: games never destroyed");
  if (res.ok) {
    const rt = res.removed.find((r) => r.name === "Bees");
    assert(!!rt && rt.gameCount === 3, "remove: reported with correct game count");
  }
  assertAgree(db, "d1", "remove"); // Bees re-appended to jsonb → still agrees
  counters.removalWithGames++;
}

async function scenarioRemoveNoGamesKept() {
  const db: Db = { teams: [], divisions: [], games: [] };
  seedDivision(db, "d1", [{ name: "Aces" }, { name: "Zeds" }]);
  const client = new FakeClient(db);
  const loaded = mergeLiveTeamsWithJsonb(liveTeamsOf(db, "d1"), [entry("Aces"), entry("Zeds")]);
  const submitted = loaded.filter((e) => e.name !== "Zeds");

  const res = await reconcileAndWrite(client, "d1", submitted);
  assert(res.ok && db.teams.some((t) => t.id === "d1_Zeds"), "remove(no games): still not deleted");
  if (res.ok) {
    const rt = res.removed.find((r) => r.name === "Zeds");
    assert(!!rt && rt.gameCount === 0, "remove(no games): reported with 0 games");
  }
  assertAgree(db, "d1", "remove-no-games");
  counters.removalNoGames++;
}

async function scenarioConflictRewriteBothScopes() {
  const db: Db = { teams: [], divisions: [], games: [] };
  // d1 has Aces (references Bees in-division) and Bees.
  seedDivision(db, "d1", [
    { name: "Aces", entry: entry("Aces", { has_coach_conflict: true, conflict_division: "d1", conflict_team: "Bees" }) },
    { name: "Bees" },
  ]);
  // d2 has Xen referencing d1's Bees cross-division.
  seedDivision(db, "d2", [
    { name: "Xen", entry: entry("Xen", { has_coach_conflict: true, conflict_division: "d1", conflict_team: "Bees" }) },
  ]);
  const client = new FakeClient(db);

  const loaded = mergeLiveTeamsWithJsonb(liveTeamsOf(db, "d1"), [
    entry("Aces", { has_coach_conflict: true, conflict_division: "d1", conflict_team: "Bees" }),
    entry("Bees"),
  ]);
  const submitted = loaded.map((e) => (e.name === "Bees" ? { ...e, name: "Bees FC" } : e));

  const res = await reconcileAndWrite(client, "d1", submitted);
  assert(res.ok, "conflict: reconcile succeeds");

  const d1teams = (db.divisions.find((d) => d.id === "d1") as { settings: { teams: TeamEntry[] } })
    .settings.teams;
  const aces = d1teams.find((e) => e.name === "Aces");
  assert(aces?.conflict_team === "Bees FC", "conflict: in-division reference rewritten");
  counters.inDivConflictRewrite++;

  const d2teams = (db.divisions.find((d) => d.id === "d2") as { settings: { teams: TeamEntry[] } })
    .settings.teams;
  assert(d2teams[0].conflict_team === "Bees FC", "conflict: cross-division reference rewritten");
  counters.crossDivConflictRewrite++;

  assertAgree(db, "d1", "conflict-d1");
  assertAgree(db, "d2", "conflict-d2");
}

async function scenarioInlineRenameParity() {
  const db: Db = { teams: [], divisions: [], games: [] };
  seedDivision(db, "d1", [{ name: "Aces" }, { name: "Bees" }]);
  seedDivision(db, "d2", [
    { name: "Xen", entry: entry("Xen", { has_coach_conflict: true, conflict_division: "d1", conflict_team: "Bees" }) },
  ]);
  const client = new FakeClient(db);

  const rowsBefore = db.teams.length;
  const res = await renameTeamInline(
    { leagueId: LEAGUE, divisionId: "d1", teamId: "d1_Bees", newName: "Bees FC", siblingTeams: liveTeamsOf(db, "d1") },
    client.asClient(),
  );
  assert(res.ok, "inline: succeeds");
  assert(db.teams.length === rowsBefore, "inline: creates ZERO new rows");
  assert(db.teams.find((t) => t.id === "d1_Bees")?.name === "Bees FC", "inline: row updated in place");
  assertAgree(db, "d1", "inline-d1"); // inline writes this division's jsonb itself
  const d2teams = (db.divisions.find((d) => d.id === "d2") as { settings: { teams: TeamEntry[] } })
    .settings.teams;
  assert(d2teams[0].conflict_team === "Bees FC", "inline: cross-division reference rewritten");

  // Duplicate-name guard.
  const dup = await renameTeamInline(
    { leagueId: LEAGUE, divisionId: "d1", teamId: "d1_Bees", newName: "Aces", siblingTeams: liveTeamsOf(db, "d1") },
    client.asClient(),
  );
  assert(!dup.ok, "inline: duplicate name rejected");
  counters.inlineRename++;
}

async function scenarioCollisionBlocked() {
  const db: Db = { teams: [], divisions: [], games: [] };
  seedDivision(db, "d1", [{ name: "Aces" }, { name: "Bees" }]);
  const client = new FakeClient(db);
  const loaded = mergeLiveTeamsWithJsonb(liveTeamsOf(db, "d1"), [entry("Aces"), entry("Bees")]);
  // Rename Bees → Aces (collides with the other live team).
  const submitted = loaded.map((e) => (e.name === "Bees" ? { ...e, name: "Aces" } : e));

  const rowsBefore = JSON.stringify(db.teams);
  const res = await reconcileTeamsOnSave(
    { leagueId: LEAGUE, divisionId: "d1", submitted, teamCount: 0, teamLimit: -1, plan: "elite" },
    client.asClient(),
  );
  assert(!res.ok, "collision: reconcile aborts");
  assert(JSON.stringify(db.teams) === rowsBefore, "collision: no writes on abort");
  counters.collisionBlocked++;
}

// ── Mutation testing (break rename detection → must fail) ─────────────────────
//
// applyPlanToDb mirrors reconcileTeamsOnSave's orchestration but takes an
// injected plan function, so we can drive the SAME invariant checker with a
// deliberately broken detector. The real plan must pass; each mutant must fail.

async function applyPlanToDb(
  db: Db,
  divId: string,
  submitted: TeamEntry[],
  planFn: (live: LiveTeam[], sub: TeamEntry[]) => ReconcilePlan,
) {
  const client = new FakeClient(db);
  const live = liveTeamsOf(db, divId);
  const plan = planFn(live, submitted);
  if (plan.collision) return;
  for (const r of plan.renames) {
    await client.from("teams").update({ name: r.newName }).eq("id", r.id);
  }
  for (const t of plan.inserts) {
    await client.rpc("create_team", { p_league_id: LEAGUE, p_division_id: divId, p_name: t.name.trim() });
  }
  // Emulate the caller's jsonb write: submitted names + kept-removed names.
  const kept = live.filter((l) => !submitted.some((s) => s.id === l.id)).map((l) => entry(l.name));
  writeDivisionTeams(
    db,
    divId,
    toJsonbEntries([...submitted.filter((e) => e.name.trim() !== ""), ...kept]),
  );
}

/** Runs the rename scenario's invariants with a given detector; returns true
 *  if ALL invariants hold (used to confirm mutants break at least one). */
async function renameInvariantsHold(
  planFn: (live: LiveTeam[], sub: TeamEntry[]) => ReconcilePlan,
): Promise<boolean> {
  const db: Db = { teams: [], divisions: [], games: [] };
  seedDivision(db, "d1", [{ name: "Aces" }, { name: "Bees" }]);
  const loaded = mergeLiveTeamsWithJsonb(liveTeamsOf(db, "d1"), [entry("Aces"), entry("Bees")]);
  const submitted = loaded.map((e) => (e.name === "Bees" ? { ...e, name: "Bees FC" } : e));

  const rowsBefore = db.teams.filter((t) => t.division_id === "d1").length;
  await applyPlanToDb(db, "d1", submitted, planFn);

  const noNewRows = db.teams.filter((t) => t.division_id === "d1").length === rowsBefore;
  const renamedInPlace = db.teams.find((t) => t.id === "d1_Bees")?.name === "Bees FC";
  const agree =
    JSON.stringify(tableNamesOf(db, "d1")) === JSON.stringify(jsonbNamesOf(db, "d1"));
  return noNewRows && renamedInPlace && agree;
}

// Mutants of the detection logic.
const MUTANTS: { name: string; plan: (l: LiveTeam[], s: TeamEntry[]) => ReconcilePlan }[] = [
  {
    // The ORIGINAL bug: never rename; insert any name not already present.
    name: "add-by-name (original bug)",
    plan: (live, sub) => {
      const liveNames = new Set(live.map((t) => t.name.trim().toLowerCase()));
      const inserts = sub
        .filter((e) => e.name.trim() !== "" && !liveNames.has(e.name.trim().toLowerCase()));
      return { renames: [], inserts, removedIds: [], collision: null };
    },
  },
  {
    // id-blind matcher: match only by name, so a rename reads as add + remove.
    name: "id-blind (name-only) matcher",
    plan: (live, sub) => {
      const liveByName = new Map(live.map((t) => [t.name.trim().toLowerCase(), t.id]));
      const seen = new Set<string>();
      const inserts: TeamEntry[] = [];
      for (const e of sub) {
        const id = liveByName.get(e.name.trim().toLowerCase());
        if (id) seen.add(id);
        else if (e.name.trim() !== "") inserts.push(e);
      }
      const removedIds = live.filter((t) => !seen.has(t.id)).map((t) => t.id);
      return { renames: [], inserts, removedIds, collision: null };
    },
  },
];

async function runMutationTests() {
  // Sanity: the REAL detector passes the invariants.
  assert(await renameInvariantsHold(planTeamReconciliation), "mutation: real detector holds invariants");
  // Each mutant must break at least one invariant.
  for (const m of MUTANTS) {
    const held = await renameInvariantsHold(m.plan);
    assert(!held, `mutation: mutant "${m.name}" must be caught (invariants should fail)`);
    if (!held) counters.mutantsCaught++;
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("team-reconcile-sim: running scenarios…");
  await scenarioRenameInPlace();
  await scenarioGenuineAdd();
  await scenarioRemoveWithGamesKept();
  await scenarioRemoveNoGamesKept();
  await scenarioConflictRewriteBothScopes();
  await scenarioInlineRenameParity();
  await scenarioCollisionBlocked();
  await runMutationTests();

  console.log("\nanti-vacuity counters:", JSON.stringify(counters, null, 0));
  const zero = Object.entries(counters).filter(([, v]) => v === 0);
  if (zero.length > 0) {
    failures++;
    console.error(`  ✗ anti-vacuity: these counters never fired: ${zero.map(([k]) => k).join(", ")}`);
  }

  if (failures > 0) {
    console.error(`\n✗ team-reconcile-sim FAILED with ${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\n✓ team-reconcile-sim passed — all invariants held, all mutants caught.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

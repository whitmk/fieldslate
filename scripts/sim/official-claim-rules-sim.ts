// Harness for the officials eligibility rule and auto-assign's locked write
// (2026-11-09, officials self-sign-up, migration 0124).
//
// ONE RULE, TWO LANGUAGES, ONE TABLE. The OFFICIAL-BLOCK-TABLE block in
// scripts/sim/official-signup-sim.sql is the only copy of the cases: the SQL
// proof runs it through official_block_reason; this harness parses the SAME
// block and runs it through blockReason (src/lib/umpires/claim-rules.ts).
// Each marker alone on its line, one row per line, never a second copy.
//
// Runs under UTC, Los Angeles and Kiritimati — the rule reads wall-clock
// strings, so every answer must be the same in every zone.
//
// ASSERTIONS
//   T1  every table row: blockReason gives the row's expected reason
//   T2  the table is the one the proof runs: markers once each, ≥ 25 rows,
//       every BlockReason appears as an expected value at least once
//   E1  auto-assign never puts an official in a division outside their list,
//       and fills it with an official whose list includes it (or who has none)
//   E2  an unreadable division list refuses the run, nothing written
//   W1  auto-assign writes through insert_official_assignments ONCE, with the
//       season and every pick (game, official, role, role_id), and never
//       inserts into game_umpires itself
//   W2  rows the database skips are counted as takenMeanwhile and as left
//       open — never as filled
//   W3  a failed write, or a reply that isn't {inserted, skipped[]}, is a
//       failure that reports nothing filled
//   S1  SOURCE (weak by nature): auto-assign picks through blockReason and
//       contains no second copy of the overlap / window / cap checks
// ANTI-VACUITY: rows run, a division refusal, a skipped-meanwhile row, a
// failed write.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blockReason, type BlockReason } from "@/lib/umpires/claim-rules";
import { autoAssignUmpires } from "@/lib/umpires/auto-assign";
import { FakeClient, type Db } from "./officials-fake";

/** auto-assign's writes (0129: it also calls official_bookings to read). */
const inserts = (f: FakeClient) => f.rpcCalls.filter((c) => c.name === "insert_official_assignments");

const ROOT = join(__dirname, "../..");
let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const counters = { rowsRun: 0, divisionRefused: 0, skippedMeanwhile: 0, failedWrite: 0 };

type Cell = string | number | boolean | null;
function parseBlock(src: string, name: string): Cell[][] {
  const lines = src.split("\n");
  const begin = lines.filter((l) => l.trim() === `-- ${name}-TABLE-BEGIN`).length;
  const end = lines.filter((l) => l.trim() === `-- ${name}-TABLE-END`).length;
  if (begin !== 1 || end !== 1) throw new Error(`${name}: expected each marker exactly once, found ${begin}/${end}`);
  const from = lines.findIndex((l) => l.trim() === `-- ${name}-TABLE-BEGIN`);
  const to = lines.findIndex((l) => l.trim() === `-- ${name}-TABLE-END`);
  const rows: Cell[][] = [];
  for (const raw of lines.slice(from + 1, to)) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^\((.*)\),?$/.exec(l);
    if (!m) throw new Error(`${name}: unreadable row: ${l}`);
    rows.push(
      m[1].split(",").map((c) => {
        const v = c.trim();
        if (v === "null") return null;
        if (v === "true") return true;
        if (v === "false") return false;
        if (/^'.*'$/.test(v)) return v.slice(1, -1);
        if (/^-?\d+$/.test(v)) return Number(v);
        throw new Error(`${name}: unreadable cell ${v} in ${l}`);
      }),
    );
  }
  return rows;
}
const list = (s: Cell) => (typeof s === "string" && s !== "" ? s.split("|") : []);

const ALL_REASONS: BlockReason[] = [
  "already_on_game", "division_not_allowed", "blackout", "coach_conflict",
  "conflict_of_interest", "time_conflict", "outside_availability", "over_weekly_limit",
];

// ── The engine fixture: two divisions, one game each, officials with lists ──
const SEASON = "season-1";
const NOW = new Date("2026-10-01T12:00:00Z");
function db(): Db {
  return {
    leagues: [{ id: SEASON, sport: "baseball", owner_id: "org-1" }],
    profiles: [{ id: "org-1", timezone: "America/Los_Angeles" }],
    divisions: [
      { id: "div-maj", league_id: SEASON, name: "Majors", priority: 1, umpires_per_game: 1, umpire_roles: null, settings: { game_duration: 90 } },
      { id: "div-min", league_id: SEASON, name: "Minors", priority: 2, umpires_per_game: 1, umpire_roles: null, settings: { game_duration: 90 } },
    ],
    teams: [
      { id: "t1", division_id: "div-maj", name: "Cubs" }, { id: "t2", division_id: "div-maj", name: "Mets" },
      { id: "t3", division_id: "div-min", name: "Owls" }, { id: "t4", division_id: "div-min", name: "Hawks" },
    ],
    games: [
      { id: "g-maj", scheduled_at: "2026-10-10T09:00:00+00:00", status: "scheduled", home_team_id: "t1", away_team_id: "t2" },
      { id: "g-min", scheduled_at: "2026-10-10T13:00:00+00:00", status: "scheduled", home_team_id: "t3", away_team_id: "t4" },
    ],
    // "Aaron" sorts first and works Minors only; "Zoe" has no list.
    umpires: [
      { id: "u-aaron", season_id: SEASON, name: "Aaron", max_games_per_week: null, team_id: null },
      { id: "u-zoe", season_id: SEASON, name: "Zoe", max_games_per_week: null, team_id: null },
    ],
    official_roles: [{ id: "role-plate", season_id: SEASON, name: "Plate", sort_order: 0 }],
    official_conflicts: [],
    official_availability: [],
    official_blackouts: [],
    official_divisions: [{ umpire_id: "u-aaron", division_id: "div-min" }],
    game_umpires: [],
  };
}

async function main() {
  // ── T: the shared table ─────────────────────────────────────────────────
  const src = readFileSync(join(ROOT, "scripts/sim/official-signup-sim.sql"), "utf8");
  let rows: Cell[][] = [];
  try {
    rows = parseBlock(src, "OFFICIAL-BLOCK");
  } catch (e) {
    ok(false, "[T2]", (e as Error).message);
  }
  for (const r of rows) {
    const [id, onGame, allowed, blackouts, coaches, coi, start, minutes, bookings, windows, cap, expected] = r;
    const got = blockReason({
      onGame: onGame === true,
      divisionAllowed: allowed === true,
      blackouts: list(blackouts),
      coaches: coaches === true,
      conflictOfInterest: coi === true,
      start: String(start),
      minutes: Number(minutes),
      bookings: list(bookings).map((b) => ({ start: b.split("/")[0], minutes: Number(b.split("/")[1]) })),
      windows: list(windows).map((w) => {
        const [day, s, e] = w.split("/");
        return { day_of_week: day, start_time: s, end_time: e };
      }),
      cap: cap === null ? null : Number(cap),
    });
    ok(got === expected, "[T1]", `${id}: want ${expected ?? "null"}, got ${got ?? "null"}`);
    counters.rowsRun++;
  }
  const expectedSet = new Set(rows.map((r) => r[11]));
  ok(rows.length >= 25 && ALL_REASONS.every((x) => expectedSet.has(x)) && expectedSet.has(null), "[T2]",
    `${rows.length} rows; missing: ${ALL_REASONS.filter((x) => !expectedSet.has(x)).join(", ")}`);

  // ── E: divisions in the real engine ─────────────────────────────────────
  {
    const fake = new FakeClient(db());
    const maj = await autoAssignUmpires("div-maj", SEASON, fake.asClient(), NOW);
    const min = await autoAssignUmpires("div-min", SEASON, fake.asClient(), NOW);
    const on = (g: string) => fake.db.game_umpires.filter((r) => r.game_id === g).map((r) => r.umpire_id).join(",");
    ok(maj.success && min.success && on("g-maj") === "u-zoe" && on("g-min") === "u-aaron", "[E1]",
      `Majors → ${on("g-maj")}, Minors → ${on("g-min")}`);
    if (on("g-maj") === "u-zoe") counters.divisionRefused++;
  }
  {
    const only = db();
    only.umpires = [only.umpires[0]]; // Aaron alone: Majors stays open, for a reason
    const fake = new FakeClient(only);
    const res = await autoAssignUmpires("div-maj", SEASON, fake.asClient(), NOW);
    ok(res.success && res.filled === 0 && res.skipped === 1 && res.skipReasons.includes("division_not_allowed"), "[E1]",
      JSON.stringify(res));
  }
  {
    const fake = new FakeClient(db());
    fake.failRead = (table) => table === "official_divisions";
    const res = await autoAssignUmpires("div-maj", SEASON, fake.asClient(), NOW);
    ok(!res.success && (res.error ?? "").includes("divisions") && fake.db.game_umpires.length === 0 && inserts(fake).length === 0,
      "[E2]", JSON.stringify(res));
  }

  // ── W: the locked write ─────────────────────────────────────────────────
  {
    const fake = new FakeClient(db());
    const before = fake.db.game_umpires.length;
    let directInserts = 0;
    const realFrom = fake.from.bind(fake);
    fake.from = ((t: string) => {
      const q = realFrom(t);
      if (t === "game_umpires") {
        const realInsert = q.insert;
        q.insert = (r) => {
          directInserts++;
          return realInsert(r);
        };
      }
      return q;
    }) as typeof fake.from;
    await autoAssignUmpires("div-maj", SEASON, fake.asClient(), NOW);
    const call = inserts(fake)[0];
    const sent = (call?.args.p_rows ?? []) as Record<string, unknown>[];
    ok(inserts(fake).length === 1 && call.name === "insert_official_assignments" && call.args.p_season_id === SEASON &&
       JSON.stringify(sent) === JSON.stringify([{ game_id: "g-maj", umpire_id: "u-zoe", role: "Plate", role_id: "role-plate" }]) &&
       directInserts === 0 && fake.db.game_umpires.length === before + 1,
      "[W1]", JSON.stringify({ calls: fake.rpcCalls, directInserts }));
  }
  {
    const fake = new FakeClient(db());
    fake.rpcOverride = (name, args) => ({
      data: { inserted: 0, skipped: (args.p_rows as Record<string, unknown>[]).map((r) => ({ ...r, reason: "slot_taken" })) },
      error: null,
    });
    const res = await autoAssignUmpires("div-maj", SEASON, fake.asClient(), NOW);
    ok(res.success && res.filled === 0 && res.takenMeanwhile === 1 && res.skipped === 1, "[W2]", JSON.stringify(res));
    if (res.takenMeanwhile === 1) counters.skippedMeanwhile++;
  }
  for (const [label, over] of [
    ["error", { data: null, error: { message: "permission denied" } }],
    ["no skipped list", { data: { inserted: 1 }, error: null }],
    ["null reply", { data: null, error: null }],
  ] as const) {
    const fake = new FakeClient(db());
    fake.rpcOverride = () => over;
    const res = await autoAssignUmpires("div-maj", SEASON, fake.asClient(), NOW);
    ok(!res.success && res.filled === 0 && !!res.error, "[W3]", `${label}: ${JSON.stringify(res)}`);
    if (!res.success) counters.failedWrite++;
  }

  // ── S: wiring ───────────────────────────────────────────────────────────
  {
    const engine = readFileSync(join(ROOT, "src/lib/umpires/auto-assign.ts"), "utf8");
    ok(engine.includes("blockReason({") && !engine.includes("gamesOverlap") && !engine.includes("isWithinAvailability(") &&
       !/from\("game_umpires"\)\s*\.insert/.test(engine), "[S1]",
      "auto-assign must pick through blockReason and write only through the rpc");
  }

  for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));
  console.log(`${checks - fails}/${checks} checks passed (TZ=${process.env.TZ ?? "host"})`);
  console.log(`counters: ${JSON.stringify(counters)}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.log(`  FAIL: [CRASH] ${(e as Error).stack ?? e}`);
  process.exit(1);
});

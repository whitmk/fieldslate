// Harness for "an officials check whose read fails REFUSES, never passes"
// (2026-11-06). Drives the REAL code — src/lib/umpires/conflicts.ts (the
// manual-assignment checks and their wording) and src/lib/umpires/auto-assign.ts
// (the engine) — against the shared in-memory fake (officials-fake.ts), with
// one read failed at a time through FakeClient.failRead.
//
// Why: every one of these reads used to discard its error. The manual
// double-booking and blackout checks then read as "no conflict" and saved;
// auto-assign read a failed availability list as "no windows = available
// anytime", a failed bookings list as "everyone is free", a failed blackout
// list as "no blackouts", and a failed read of the division's assignments as
// "every slot is open".
//
// TZ=UTC is mandatory, same as the other officials harnesses.
//
// ASSERTIONS
//   B0  the fixture, with nothing failing, fills a slot (so every refusal
//       below is a run that WOULD have written)
//   A1–A8  each auto-assign read failing alone → success false, the error
//       names that read, and nothing is written:
//       A1 season (leagues)          A5 the officials' other games
//       A2 official roles            A6 availability
//       A3 teams                     A7 blackout dates
//       A4 games                     A8 the division's current assignments
//   M1  the manual conflict read failing → { ok: false }
//   M2  the manual blackout read failing → { ok: false }
//   M3  a real overlapping booking is still found (ok, conflict set)
//   M4  a real blackout is still found (ok, blackout set)
//   M5  a clean official → ok, nothing found, on both checks
//   W1  unreadable conflict check → "Couldn't check {name}'s other games…"
//   W2  unreadable blackout check → "Couldn't check {name}'s blackout dates…"
//   W3  a real conflict keeps its old sentence; W4 a real blackout too
//   W5  clean → null (the save goes ahead)
//   S1  UmpireSlots words its refusal through assignmentPrecheckMessage and
//       never reads .conflict / .blackout itself (source grep — weak by
//       nature, stated)
// ANTI-VACUITY: baseline filled, auto refusals, manual refusals, real
// conflict found, real blackout found.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:umpire-reads:mutants).
//   MR1  manual conflict read error discarded           → [M1]
//   MR2  manual blackout read error discarded           → [M2]
//   MR3  wording ignores an unreadable conflict check    → [W1]
//   MR4  wording ignores an unreadable blackout check    → [W2]
//   MA1–MA8  each auto-assign read's error check removed → [A1]…[A8]

process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoAssignUmpires } from "@/lib/umpires/auto-assign";
import {
  assignmentPrecheckMessage,
  findUmpireBlackout,
  findUmpireConflict,
  type GameTimeInfo,
} from "@/lib/umpires/conflicts";
import { FakeClient, type Db } from "./officials-fake";

if (new Date("2026-10-10T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error("Run with TZ=UTC: TZ=UTC npx tsx scripts/sim/umpire-reads-failclosed-sim.ts");
  process.exit(1);
}

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const counters = {
  baselineFilled: 0,
  autoRefusals: 0,
  manualRefusals: 0,
  realConflictFound: 0,
  realBlackoutFound: 0,
};

const NOW = new Date("2026-10-01T12:00:00Z");
const SEASON = "season-1";
const ORG = "org-1";

function buildDb(): Db {
  return {
    leagues: [{ id: SEASON, sport: "baseball", owner_id: ORG }],
    profiles: [{ id: ORG, timezone: "America/Los_Angeles" }],
    divisions: [{
      id: "div-0", league_id: SEASON, name: "Minors", priority: 1,
      umpires_per_game: 1, umpire_roles: null, settings: { game_duration: 90 },
    }],
    teams: [
      { id: "t-a", division_id: "div-0", name: "Cubs" },
      { id: "t-b", division_id: "div-0", name: "Mets" },
    ],
    games: [
      // The game to staff, and a second game 30 minutes later that "Busy"
      // already works — so Busy overlaps the first.
      { id: "g-1", scheduled_at: "2026-10-10T17:00:00.000Z", status: "scheduled", home_team_id: "t-a", away_team_id: "t-b" },
      { id: "g-2", scheduled_at: "2026-10-10T17:30:00.000Z", status: "scheduled", home_team_id: "t-b", away_team_id: "t-a" },
    ],
    umpires: [
      { id: "u-busy", season_id: SEASON, name: "Busy", max_games_per_week: null, team_id: null },
      { id: "u-out", season_id: SEASON, name: "Out", max_games_per_week: null, team_id: null },
      { id: "u-free", season_id: SEASON, name: "Free", max_games_per_week: null, team_id: null },
    ],
    official_roles: [{ id: "role-1", season_id: SEASON, name: "Plate", sort_order: 0 }],
    official_conflicts: [],
    // "Free" is only available Mondays: a failed availability read would make
    // him look available, which is exactly the harm A6 guards.
    official_availability: [
      { id: "av-1", umpire_id: "u-free", day_of_week: 1, start_time: "09:00", end_time: "21:00" },
    ],
    official_blackouts: [{ id: "bo-1", umpire_id: "u-out", date: "2026-10-10", note: "away" }],
    game_umpires: [{ id: "pre-1", game_id: "g-2", umpire_id: "u-busy", role: "Plate", role_id: "role-1" }],
  };
}

const CANDIDATE: GameTimeInfo = {
  id: "g-1",
  scheduled_at: "2026-10-10T17:00:00.000Z",
  duration_minutes: 90,
  home_team_name: "Cubs",
  away_team_name: "Mets",
};

type Fault = { tag: string; what: string; fail: (table: string, select: string) => boolean };

const AUTO_FAULTS: Fault[] = [
  { tag: "A1", what: "this season", fail: (t) => t === "leagues" },
  { tag: "A2", what: "this season's official roles", fail: (t, s) => t === "official_roles" && s === "id, name" },
  { tag: "A3", what: "this division's teams", fail: (t) => t === "teams" },
  { tag: "A4", what: "this division's games", fail: (t) => t === "games" },
  { tag: "A5", what: "the officials' other games", fail: (t, s) => t === "game_umpires" && s.includes("game:games(") },
  { tag: "A6", what: "the officials' availability", fail: (t) => t === "official_availability" },
  { tag: "A7", what: "the officials' blackout dates", fail: (t) => t === "official_blackouts" },
  { tag: "A8", what: "this division's current assignments", fail: (t, s) => t === "game_umpires" && s === "id, game_id, umpire_id, role" },
];

async function section(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    ok(false, `[CRASH-${name}]`, (e as Error).stack ?? String(e));
  }
}

async function main() {
  // ── B: baseline ───────────────────────────────────────────────────────────
  await section("B", async () => {
    // With Busy (overlap), Out (blackout) and Free (Mondays only) all
    // ineligible, the baseline needs one more official who is genuinely free.
    const db = buildDb();
    db.umpires.push({ id: "u-ok", season_id: SEASON, name: "Okay", max_games_per_week: null, team_id: null });
    const fake = new FakeClient(db);
    const res = await autoAssignUmpires("div-0", SEASON, fake.asClient(), NOW);
    const onG1 = fake.db.game_umpires.filter((r) => r.game_id === "g-1");
    ok(res.success && res.filled === 1 && onG1.length === 1 && onG1[0].umpire_id === "u-ok", "[B0]",
      `baseline must staff g-1 with Okay: success ${res.success}, filled ${res.filled}, ${JSON.stringify(onG1)}`);
    if (res.filled > 0) counters.baselineFilled++;
  });

  // ── A: each auto-assign read failing alone ────────────────────────────────
  for (const f of AUTO_FAULTS) {
    await section(f.tag, async () => {
      const db = buildDb();
      db.umpires.push({ id: "u-ok", season_id: SEASON, name: "Okay", max_games_per_week: null, team_id: null });
      const fake = new FakeClient(db);
      fake.failRead = f.fail;
      const before = fake.db.game_umpires.length;
      const res = await autoAssignUmpires("div-0", SEASON, fake.asClient(), NOW);
      const added = fake.db.game_umpires.length - before;
      ok(!res.success && (res.error ?? "").includes(`Couldn't read ${f.what},`) && added === 0, `[${f.tag}]`,
        `a failed read of ${f.what} must refuse: success ${res.success}, error ${JSON.stringify(res.error)}, rows added ${added}`);
      if (!res.success) counters.autoRefusals++;
    });
  }

  // ── M: the manual checks ──────────────────────────────────────────────────
  await section("M", async () => {
    const failConflicts = new FakeClient(buildDb());
    failConflicts.failRead = (t) => t === "game_umpires";
    const c1 = await findUmpireConflict("u-busy", CANDIDATE, failConflicts.asClient());
    ok(c1.ok === false, "[M1]", `a failed bookings read must be "couldn't check": ${JSON.stringify(c1)}`);
    if (!c1.ok) counters.manualRefusals++;

    const failBlackouts = new FakeClient(buildDb());
    failBlackouts.failRead = (t) => t === "official_blackouts";
    const b1 = await findUmpireBlackout("u-out", CANDIDATE.scheduled_at, failBlackouts.asClient());
    ok(b1.ok === false, "[M2]", `a failed blackouts read must be "couldn't check": ${JSON.stringify(b1)}`);
    if (!b1.ok) counters.manualRefusals++;

    const clean = new FakeClient(buildDb());
    const c2 = await findUmpireConflict("u-busy", CANDIDATE, clean.asClient());
    ok(c2.ok === true && c2.conflict?.id === "g-2", "[M3]", `Busy's overlap must be found: ${JSON.stringify(c2)}`);
    if (c2.ok && c2.conflict) counters.realConflictFound++;

    const b2 = await findUmpireBlackout("u-out", CANDIDATE.scheduled_at, clean.asClient());
    ok(b2.ok === true && b2.blackout?.date === "2026-10-10", "[M4]", `Out's blackout must be found: ${JSON.stringify(b2)}`);
    if (b2.ok && b2.blackout) counters.realBlackoutFound++;

    const c3 = await findUmpireConflict("u-free", CANDIDATE, clean.asClient());
    const b3 = await findUmpireBlackout("u-free", CANDIDATE.scheduled_at, clean.asClient());
    ok(c3.ok === true && c3.conflict === null && b3.ok === true && b3.blackout === null, "[M5]",
      `a clean official finds nothing: ${JSON.stringify(c3)} ${JSON.stringify(b3)}`);
  });

  // ── W: the wording ────────────────────────────────────────────────────────
  await section("W", () => {
    const conflict: GameTimeInfo = { ...CANDIDATE, id: "g-2", scheduled_at: "2026-10-10T17:30:00.000Z" };
    const w1 = assignmentPrecheckMessage("Busy", { ok: false }, { ok: true, blackout: null });
    ok(w1 === "Couldn't check Busy's other games, so nothing was saved. Try again.", "[W1]", String(w1));
    const w2 = assignmentPrecheckMessage("Out", { ok: true, conflict: null }, { ok: false });
    ok(w2 === "Couldn't check Out's blackout dates, so nothing was saved. Try again.", "[W2]", String(w2));
    const w3 = assignmentPrecheckMessage("Busy", { ok: true, conflict }, { ok: true, blackout: null });
    ok(w3 === "Busy is already assigned to Cubs vs Mets at Oct 10, 5:30 PM.", "[W3]", String(w3));
    const w4 = assignmentPrecheckMessage("Out", { ok: true, conflict: null }, { ok: true, blackout: { date: "2026-10-10", note: "away" } });
    ok(w4 === "Out has a blackout date on Oct 10 (away).", "[W4]", String(w4));
    const w5 = assignmentPrecheckMessage("Free", { ok: true, conflict: null }, { ok: true, blackout: null });
    ok(w5 === null, "[W5]", String(w5));
  });

  // ── S: wiring ─────────────────────────────────────────────────────────────
  await section("S", () => {
    const src = readFileSync(join(__dirname, "../../src/components/umpires/umpire-slots.tsx"), "utf8");
    ok(src.includes("assignmentPrecheckMessage(umpName, conflictCheck, blackoutCheck)")
      && !/conflictCheck\.(conflict|ok)|blackoutCheck\.(blackout|ok)/.test(src), "[S1]",
      "UmpireSlots must word its refusal through assignmentPrecheckMessage only");
  });

  for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));
  console.log(`${checks - fails}/${checks} checks passed`);
  console.log(`counters: ${JSON.stringify(counters)}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.log(`  FAIL: [CRASH] ${(e as Error).stack ?? e}`);
  process.exit(1);
});

// Harness for "auto-assign never staffs a past game" (2026-10-08). Drives the
// REAL engine (src/lib/umpires/auto-assign.ts) against the shared in-memory
// fake (officials-fake.ts) — the officials season harness
// (auto-assign-season-sim.ts) covers every other invariant and runs its
// fixtures with "now" BEFORE the season, so this rule needs its own.
//
// TZ=UTC is mandatory, same as the officials harness (the engine's
// availability / week math is client-local; that is not what this proves).
//
// THE FIXTURE. "Now" is 2026-10-10 05:30Z — still FRIDAY Oct 9 in Los Angeles
// (the league's timezone) but already Saturday Oct 10 in UTC. One division,
// one official per game:
//   g-past   Tue Oct 6 (scheduled)         — past, already staffed
//   g-past2  Wed Oct 7 (scheduled)         — past, NOBODY on it: without the
//                                            rule it would be staffed
//   g-today  Fri Oct 9 (today in LA)       — must be staffed; a UTC "today"
//                                            would call it past
//   g-future Sat Oct 10                    — must be staffed
// Officials: "Capped" (1 game a week) already works g-past, earlier THIS week;
// "Free" has no cap. Capped sorts first by name and ties on load for the second
// slot, so only the weekly cap keeps him off this week's games — which proves a
// skipped past game still counts toward the cap.
//
// ASSERTIONS
//   P1  nothing is assigned to either past game (the unstaffed one is the
//       real test — the staffed one is full regardless)
//   P2  the game TODAY in the league's timezone is staffed, and exactly the
//       two past games were skipped
//   P3  the capped official gets nothing else this week (past games still count)
//   P4  the future game is staffed
//   P5  an unreadable timezone FAILS CLOSED: success false, said so, nothing written
//   P6  the past game's existing assignment is untouched
// ANTI-VACUITY: past skipped, today staffed, future staffed, fail-closed run.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:auto-assign-past:mutants).
// First pass (2026-10-08): AP2 died at [P1], not [P2] — P1 also checked the
// skip COUNT, which the UTC mutant changes. And AP1 was caught only because of
// that count: the one past game was already staffed, so a missing filter left
// no visible row. Fixed by adding g-past2 (past, unstaffed) as P1's real test
// and moving the exact count into P2.
//   AP1  the past-game filter removed                           → [P1]
//   AP2  "today" computed in UTC, not the league's timezone     → [P2]
//   AP3  past games dropped from bookings / weekly load too     → [P3]
//   AP4  an unreadable timezone falls back to the UTC date      → [P5]

process.env.TZ = "UTC";

import { autoAssignUmpires } from "@/lib/umpires/auto-assign";
import { FakeClient, type Db } from "./officials-fake";

if (new Date("2026-10-10T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error("Run with TZ=UTC: TZ=UTC npx tsx scripts/sim/auto-assign-past-sim.ts");
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

const counters = { pastSkipped: 0, todayStaffed: 0, futureStaffed: 0, failClosedRun: 0 };

const NOW = new Date("2026-10-10T05:30:00Z");
const SEASON = "season-1";
const ORG = "org-1";

function buildDb(withProfile: boolean): Db {
  return {
    leagues: [{ id: SEASON, sport: "baseball", owner_id: ORG }],
    profiles: withProfile ? [{ id: ORG, timezone: "America/Los_Angeles" }] : [],
    divisions: [{
      id: "div-0", league_id: SEASON, name: "Minors", priority: 1,
      umpires_per_game: 1, umpire_roles: null, settings: { game_duration: 90 },
    }],
    teams: [
      { id: "t-a", division_id: "div-0", name: "Cubs" },
      { id: "t-b", division_id: "div-0", name: "Mets" },
    ],
    games: [
      { id: "g-past", scheduled_at: "2026-10-06T18:00:00.000Z", status: "scheduled", home_team_id: "t-a", away_team_id: "t-b" },
      { id: "g-past2", scheduled_at: "2026-10-07T18:00:00.000Z", status: "scheduled", home_team_id: "t-b", away_team_id: "t-a" },
      { id: "g-today", scheduled_at: "2026-10-09T18:00:00.000Z", status: "scheduled", home_team_id: "t-b", away_team_id: "t-a" },
      { id: "g-future", scheduled_at: "2026-10-10T18:00:00.000Z", status: "scheduled", home_team_id: "t-a", away_team_id: "t-b" },
    ],
    umpires: [
      { id: "u-capped", season_id: SEASON, name: "Capped", max_games_per_week: 1, team_id: null },
      { id: "u-free", season_id: SEASON, name: "Free", max_games_per_week: null, team_id: null },
    ],
    official_roles: [],
    official_conflicts: [],
    official_availability: [],
    official_blackouts: [],
    game_umpires: [{ id: "pre-0", game_id: "g-past", umpire_id: "u-capped", role: "Umpire", role_id: null }],
  };
}

async function main() {
  // ── Normal run ──────────────────────────────────────────────────────────────
  const fake = new FakeClient(buildDb(true));
  const res = await autoAssignUmpires("div-0", SEASON, fake.asClient(), NOW);
  const rows = fake.db.game_umpires as { id: string; game_id: string; umpire_id: string }[];
  const on = (gameId: string) => rows.filter((r) => r.game_id === gameId);

  ok(res.success, "[P0]", `the run must succeed: ${res.error ?? ""}`);
  ok(on("g-past").length === 1 && on("g-past2").length === 0, "[P1]",
    `nothing new on the past games (rows ${on("g-past").length}, ${on("g-past2").length})`);
  if (res.pastGamesSkipped > 0) counters.pastSkipped++;
  ok(on("g-today").length === 1 && res.pastGamesSkipped === 2, "[P2]",
    `the game today in Los Angeles must be staffed (rows ${on("g-today").length}); pastGamesSkipped ${res.pastGamesSkipped}, expected 2`);
  if (on("g-today").length === 1) counters.todayStaffed++;
  ok(!rows.some((r) => r.umpire_id === "u-capped" && r.game_id !== "g-past"), "[P3]",
    `the capped official already worked this week: ${JSON.stringify(rows.filter((r) => r.umpire_id === "u-capped"))}`);
  ok(on("g-future").length === 1, "[P4]", `the future game must be staffed (rows ${on("g-future").length})`);
  if (on("g-future").length === 1) counters.futureStaffed++;
  ok(rows.some((r) => r.id === "pre-0" && r.game_id === "g-past" && r.umpire_id === "u-capped"), "[P6]",
    "the past game's existing assignment must be untouched");

  // ── Unreadable timezone ─────────────────────────────────────────────────────
  const blind = new FakeClient(buildDb(false));
  const before = blind.db.game_umpires.length;
  const r2 = await autoAssignUmpires("div-0", SEASON, blind.asClient(), NOW);
  ok(!r2.success && (r2.error ?? "").includes("timezone") && blind.db.game_umpires.length === before, "[P5]",
    `must fail closed: success ${r2.success}, error ${r2.error}, rows ${blind.db.game_umpires.length - before} added`);
  if (!r2.success) counters.failClosedRun++;

  for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));
  console.log(`${checks - fails}/${checks} checks passed`);
  console.log(`counters: ${JSON.stringify(counters)}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.log(`  FAIL: [CRASH] ${(e as Error).stack ?? e}`);
  process.exit(1);
});

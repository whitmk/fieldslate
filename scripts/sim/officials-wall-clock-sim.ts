// Harness for "officials checks read game times as wall-clock" (2026-11-09,
// fix/officials-wall-clock). Game times are stored as the league's wall-clock
// with a +00 suffix ("2026-10-10T09:00:00+00:00" is a 9:00 AM game). Until
// this fix the officials checks parsed the instant and read it in the HOST's
// zone: from a Pacific browser a 9:00 AM Saturday was checked as 2:00 AM, so a
// morning window (Sa 08:00–12:00) accepted a 3:00 PM game and an evening
// window never matched an evening game. Every officials harness ran pinned to
// TZ=UTC, where the two readings agree, so nothing saw it.
//
// RUN UNDER THREE ZONES (npm run sim:officials-wall-clock): UTC, Los Angeles,
// Kiritimati (UTC+14). Every expected value is a LITERAL, so an answer that
// moves with the host zone fails instead of agreeing with itself. The
// fixtures sit where the zones disagree: a Saturday 3:00 PM game reads as a
// morning in Los Angeles; a Sunday 11:30 PM game is already Monday in
// Kiritimati; a Monday 12:30 AM game is still Sunday in Los Angeles.
//
// ASSERTIONS
//   H1  gameDayCode — weekday of the stored date (Sat; Sun 23:30; Mon 00:30)
//   H2  gameStartMinutes — minutes of the stored time (+00 and bare forms)
//   H3  gameDateKey — date of the stored time across the zone edges
//   H4  gameWeekKey — Mon–Sun week of the stored time across the zone edges
//   H5  isWithinAvailability — morning and evening windows, literal answers
//   A1  the REAL engine staffs a 9:00 AM Saturday with the morning-only official
//   A2  …and leaves a 3:00 PM Saturday OPEN (outside every window)
//   A3  …and staffs a 5:30 PM Monday with the evening-only official
//   A4  a blackout on Sun Oct 11 keeps the official off Sun Oct 11 11:30 PM
//   A5  …but not off Mon Oct 12 12:30 AM (a different day)
//   A6  a 1-a-week cap allows Sun 10:00 PM and Mon 1:00 AM (different weeks)
//   M1  findUmpireBlackout (the manual save check) finds Sun 11:30 PM's blackout
//   M2  …and finds none for Mon 12:30 AM
//   M3  formatConflictTime names the stored time ("Oct 10, 9:00 AM")
//   M4  SOURCE (weak by nature): the manual picker reads the stored string —
//       gameDateKey(game.scheduled_at), isWithinAvailability(…, game.scheduled_at, …)
//       — and never builds a Date from it
//   S1  SOURCE (weak by nature): no officials file that handles scheduled_at
//       (other than eligibility.ts, which H pins) calls getHours / getMinutes /
//       getDay / getDate
// ANTI-VACUITY: a slot left open for availability, the evening game staffed,
// a blackout refusal, a cap allowed across the week line, a manual blackout
// found.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:officials-wall-clock:mutants, three zones). In UTC every
// mutant here PASSES — that is the bug's signature — so each dies in Los
// Angeles or Kiritimati (except WC10, a source check, which dies everywhere).
// Run 1 (2026-11-09): 8/10 at their own line; WC1 and WC2 died FIRST at [S1],
// the source scan, in UTC — S1 then scanned eligibility.ts too, so it fired
// before H1/H5 could fail in Los Angeles. A harness ordering fault: S1 now
// leaves eligibility.ts to the literal H checks.
//   WC1  availability minutes from the host-zone instant     → [H5]
//   WC2  weekday from the host-zone instant                  → [H1]
//   WC3  game date from the host-zone instant                → [H3]
//   WC4  week from the host-zone instant                     → [H4]
//   WC5  auto-assign availability on the host-zone time      → [A1]
//   WC6  auto-assign blackout date from the instant          → [A5]
//   WC7  auto-assign weekly-cap week from the instant        → [A6]
//   WC8  manual blackout check queries the instant's date    → [M2]
//   WC9  conflict sentence formats the host-zone time        → [M3]
//   WC10 manual picker builds a Date from the game time      → [M4]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { autoAssignUmpires } from "@/lib/umpires/auto-assign";
import {
  gameDateKey,
  gameDayCode,
  gameStartMinutes,
  gameWeekKey,
  isWithinAvailability,
  type AvailabilityWindow,
} from "@/lib/umpires/eligibility";
import { findUmpireBlackout, formatConflictTime } from "@/lib/umpires/conflicts";
import { FakeClient, type Db } from "./officials-fake";

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
const eq = (tag: string, got: unknown, want: unknown, what: string) =>
  ok(got === want, tag, `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const counters = {
  openForAvailability: 0,
  eveningStaffed: 0,
  blackoutRefused: 0,
  capAcrossWeekLine: 0,
  manualBlackoutFound: 0,
};

// Stored forms, exactly as the database returns them (and one bare form, as
// the pickers write them).
const SAT_0900 = "2026-10-10T09:00:00+00:00";
const SAT_1500 = "2026-10-10T15:00:00+00:00";
const SUN_2330 = "2026-10-11T23:30:00+00:00";
const MON_0030 = "2026-10-12T00:30:00+00:00";
const MON_1730 = "2026-10-12T17:30:00+00:00";
const SUN_2200 = "2026-10-11T22:00:00+00:00";
const MON_0100 = "2026-10-12T01:00:00+00:00";

const MORNING: AvailabilityWindow[] = [{ day_of_week: "Sa", start_time: "08:00:00", end_time: "12:00:00" }];
const EVENING: AvailabilityWindow[] = [{ day_of_week: "Mo", start_time: "17:00:00", end_time: "20:00:00" }];

// "Now" before every fixture game (auto-assign skips past games).
const NOW = new Date("2026-10-01T12:00:00Z");
const SEASON = "season-1";
const ORG = "org-1";

function db(games: { id: string; at: string }[], umpires: Db["umpires"], extra: Partial<Db> = {}): Db {
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
    games: games.map((g, i) => ({
      id: g.id, scheduled_at: g.at, status: "scheduled",
      home_team_id: i % 2 ? "t-b" : "t-a", away_team_id: i % 2 ? "t-a" : "t-b",
    })),
    umpires,
    official_roles: [],
    official_conflicts: [],
    official_availability: [],
    official_blackouts: [],
    game_umpires: [],
    ...extra,
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(n)) out.push(rel);
  }
  return out;
}

async function main() {
  // ── H: the helpers, literal answers ───────────────────────────────────────
  eq("[H1]", gameDayCode(SAT_0900), "Sa", "Saturday 9:00 AM");
  eq("[H1]", gameDayCode(SUN_2330), "Su", "Sunday 11:30 PM");
  eq("[H1]", gameDayCode(MON_0030), "Mo", "Monday 12:30 AM");
  eq("[H2]", gameStartMinutes(SAT_0900), 540, "9:00 AM");
  eq("[H2]", gameStartMinutes("2026-10-10T15:30:00"), 930, "bare 3:30 PM");
  eq("[H3]", gameDateKey(SUN_2330), "2026-10-11", "Sunday 11:30 PM date");
  eq("[H3]", gameDateKey(MON_0030), "2026-10-12", "Monday 12:30 AM date");
  eq("[H4]", gameWeekKey(SUN_2330), "2026-10-05", "Sunday 11:30 PM week");
  eq("[H4]", gameWeekKey(MON_0030), "2026-10-12", "Monday 12:30 AM week");
  eq("[H5]", isWithinAvailability(MORNING, SAT_0900, 90), true, "9:00 AM Sat in Sa 8–12");
  eq("[H5]", isWithinAvailability(MORNING, SAT_1500, 90), false, "3:00 PM Sat in Sa 8–12");
  eq("[H5]", isWithinAvailability(EVENING, MON_1730, 90), true, "5:30 PM Mon in Mo 5–8 PM");
  eq("[H5]", isWithinAvailability(EVENING, MON_0030, 90), false, "12:30 AM Mon in Mo 5–8 PM");

  // ── A: the real engine ───────────────────────────────────────────────────
  {
    const fake = new FakeClient(db(
      [{ id: "g-sat9", at: SAT_0900 }, { id: "g-sat15", at: SAT_1500 }, { id: "g-mon1730", at: MON_1730 }],
      [
        { id: "u-morning", season_id: SEASON, name: "Morning", max_games_per_week: null, team_id: null },
        { id: "u-evening", season_id: SEASON, name: "Evening", max_games_per_week: null, team_id: null },
      ],
      {
        official_availability: [
          ...MORNING.map((w) => ({ umpire_id: "u-morning", ...w })),
          ...EVENING.map((w) => ({ umpire_id: "u-evening", ...w })),
        ],
      },
    ));
    const res = await autoAssignUmpires("div-0", SEASON, fake.asClient(), NOW);
    const rows = fake.db.game_umpires as { game_id: string; umpire_id: string }[];
    const who = (g: string) => rows.filter((r) => r.game_id === g).map((r) => r.umpire_id).join(",");
    ok(res.success, "[A0]", `availability run must succeed: ${res.error ?? ""}`);
    eq("[A1]", who("g-sat9"), "u-morning", "Saturday 9:00 AM");
    eq("[A2]", who("g-sat15"), "", "Saturday 3:00 PM");
    if (who("g-sat15") === "" && res.skipReasons.includes("outside_availability")) counters.openForAvailability++;
    eq("[A3]", who("g-mon1730"), "u-evening", "Monday 5:30 PM");
    if (who("g-mon1730") === "u-evening") counters.eveningStaffed++;
  }
  {
    const fake = new FakeClient(db(
      [{ id: "g-sun2330", at: SUN_2330 }, { id: "g-mon0030", at: MON_0030 }],
      [{ id: "u-solo", season_id: SEASON, name: "Solo", max_games_per_week: null, team_id: null }],
      { official_blackouts: [{ umpire_id: "u-solo", date: "2026-10-11", note: null }] },
    ));
    const res = await autoAssignUmpires("div-0", SEASON, fake.asClient(), NOW);
    const rows = fake.db.game_umpires as { game_id: string }[];
    ok(res.success, "[A0]", `blackout run must succeed: ${res.error ?? ""}`);
    const sun = rows.filter((r) => r.game_id === "g-sun2330").length;
    const mon = rows.filter((r) => r.game_id === "g-mon0030").length;
    eq("[A4]", sun, 0, "Sunday 11:30 PM on a Sunday blackout");
    if (sun === 0 && res.skipReasons.includes("blackout")) counters.blackoutRefused++;
    eq("[A5]", mon, 1, "Monday 12:30 AM, the day after the blackout");
  }
  {
    const fake = new FakeClient(db(
      [{ id: "g-sun2200", at: SUN_2200 }, { id: "g-mon0100", at: MON_0100 }],
      [{ id: "u-capped", season_id: SEASON, name: "Capped", max_games_per_week: 1, team_id: null }],
    ));
    const res = await autoAssignUmpires("div-0", SEASON, fake.asClient(), NOW);
    const rows = fake.db.game_umpires as { umpire_id: string }[];
    ok(res.success, "[A0]", `cap run must succeed: ${res.error ?? ""}`);
    eq("[A6]", rows.filter((r) => r.umpire_id === "u-capped").length, 2,
      "Sunday 10:00 PM and Monday 1:00 AM are in different weeks");
    if (rows.length === 2) counters.capAcrossWeekLine++;
  }

  // ── M: the manual path ───────────────────────────────────────────────────
  {
    const fake = new FakeClient(db([], [], {
      official_blackouts: [{ umpire_id: "u-solo", date: "2026-10-11", note: "Away" }],
    }));
    const sun = await findUmpireBlackout("u-solo", SUN_2330, fake.asClient());
    ok(sun.ok && sun.blackout?.date === "2026-10-11", "[M1]",
      `Sunday 11:30 PM must hit the Sunday blackout: ${JSON.stringify(sun)}`);
    if (sun.ok && sun.blackout) counters.manualBlackoutFound++;
    const mon = await findUmpireBlackout("u-solo", MON_0030, fake.asClient());
    ok(mon.ok && mon.blackout === null, "[M2]",
      `Monday 12:30 AM must not hit the Sunday blackout: ${JSON.stringify(mon)}`);
  }
  eq("[M3]", formatConflictTime(SAT_0900), "Oct 10, 9:00 AM", "the conflict sentence's time");
  {
    const src = readFileSync(join(ROOT, "src/components/umpires/umpire-slots.tsx"), "utf8");
    ok(src.includes("gameDateKey(game.scheduled_at)") &&
       /isWithinAvailability\(\s*windows,\s*game\.scheduled_at,/.test(src) &&
       !/new Date\(\s*game\.scheduled_at\s*\)/.test(src), "[M4]",
      "umpire-slots.tsx must read the stored string, never new Date(game.scheduled_at)");
  }
  {
    const files = [...walk("src/lib/umpires"), ...walk("src/components/umpires")];
    // Only files that handle game times: official-profile-sections.tsx reads
    // the browser's "today" for certificate expiry, which is not a game time.
    // eligibility.ts is left out: its helpers are pinned by the literal H
    // checks, which must be what catches them (see the MUTATION LOG).
    const bad = files.filter((f) => {
      if (f === "src/lib/umpires/eligibility.ts") return false;
      const src = readFileSync(join(ROOT, f), "utf8");
      return src.includes("scheduled_at") && /\.get(Hours|Minutes|Day|Date)\(\)/.test(src);
    });
    ok(bad.length === 0, "[S1]", `local-zone getters in officials code: ${bad.join(", ")}`);
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

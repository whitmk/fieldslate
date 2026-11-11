// sim:official-busy — one rule for "is this official busy?" (0129, 2026-11-10).
// Drives the REAL src/lib/umpires/conflicts.ts (fetchOfficialBookings,
// findUmpireConflict, the wording) and src/lib/umpires/auto-assign.ts against
// the shared in-memory fake (officials-fake.ts), whose official_bookings is
// the database's answer; and reads 0129 and the caller files for the rest.
//
//   R  THE RULE: 0129's official_game_busy is a blocklist of exactly
//      cancelled + postponed (a null status busy); the fake's copy equals it
//      [FK1]; official_slot_problem in 0129 is 0124's body with ONLY its
//      bookings filter swapped; official_bookings filters through the rule
//      and checks owner/admin by role
//   B  BEHAVIOUR, per caller that can be driven: the manual save check [B1]
//      (a rained-out or postponed overlap is not a conflict; scheduled,
//      reschedule_pending and completed are); auto-assign [B2] (an official
//      whose only overlap is postponed is assigned; scheduled blocks)
//   F  FAILS CLOSED: an rpc error [FC1] or a malformed reply [FC2] is
//      "couldn't read", never an empty list; the manual save refuses [FC3];
//      the picker refuses an official whose bookings weren't read [FC4]; both
//      roster readers show the read error instead of slots [FC5, FC6];
//      record-played says "couldn't check" [FC7] (FC4–FC7 are source checks
//      — the readers live in components; weak by nature, stated)
//   S  ONE READ: no file reads game_umpires → games for bookings any more,
//      and no officials caller tests a game's status for busy-ness — the
//      division panel [S1], the game detail modal [S2], record-played [S3],
//      auto-assign [S4], everywhere [S5] (source checks)
//
// Runs under UTC, Los Angeles and Kiritimati.
//
// MUTATION LOG (npm run sim:official-busy:mutants, 12 mutants × 3 zones):
//   2026-11-10 run 1 — 12/12 killed at their own tag; source restored green.
//   Re-aimed in other passes for 0129 (all killed at their own tag):
//   umpire-reads MR1 → findUmpireConflict's refusal [M1], MA5 → auto-assign's
//   refusal of official_bookings [A5]; auto-assign-past AP3 → the busy-list
//   line [P3].
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { autoAssignUmpires } from "../../src/lib/umpires/auto-assign";
import {
  assignmentPrecheckMessage,
  fetchOfficialBookings,
  findUmpireConflict,
  parseOfficialBookings,
  type GameTimeInfo,
} from "../../src/lib/umpires/conflicts";
import { FAKE_NOT_BUSY, FakeClient, type Db } from "./officials-fake";

const ROOT = join(__dirname, "../..");
const failures: string[] = [];
let checks = 0;
const counters = { notBusyStatuses: 0, busyStatuses: 0, postponedAssigned: 0, failClosed: 0, filesScanned: 0 };

function ok(cond: boolean, tag: string, msg: string, detail?: string) {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${msg}${detail ? `\n      ${detail}` : ""}`);
}
function eq(actual: unknown, expected: unknown, tag: string, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, tag, msg, `expected ${e}\n      got      ${a}`);
}
async function section(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    failures.push(`FAIL: [CRASH-${name}] ${(e as Error).stack ?? e}`);
  }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** prosrc of a function in a migration file (the text between its $$s). */
function body(sql: string, name: string): string {
  const i = sql.indexOf(`create or replace function public.${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const open = sql.indexOf("$$", i);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(open + 2, close);
}

const NOW = new Date("2026-10-01T12:00:00Z");
const SEASON = "season-1";
const ORG = "org-1";

function db(otherStatus: string): Db {
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
      // The game to staff, and another game 30 minutes later that the only
      // official already works — its status decides whether they're busy.
      { id: "g-1", scheduled_at: "2026-10-10T17:00:00.000Z", status: "scheduled", home_team_id: "t-a", away_team_id: "t-b" },
      { id: "g-2", scheduled_at: "2026-10-10T17:30:00.000Z", status: otherStatus, home_team_id: "t-b", away_team_id: "t-a" },
    ],
    umpires: [{ id: "u-1", season_id: SEASON, name: "Sam", max_games_per_week: null, team_id: null }],
    official_roles: [{ id: "role-1", season_id: SEASON, name: "Plate", sort_order: 0 }],
    official_conflicts: [],
    official_availability: [],
    official_blackouts: [],
    game_umpires: [{ id: "pre-1", game_id: "g-2", umpire_id: "u-1", role: "Plate", role_id: "role-1" }],
  };
}

const CANDIDATE: GameTimeInfo = {
  id: "g-1", scheduled_at: "2026-10-10T17:00:00.000Z", duration_minutes: 90, home_team_name: "Cubs", away_team_name: "Mets",
};

async function main() {
  // ── R — the rule ───────────────────────────────────────────────────────
  await section("R", () => {
    const m129 = read("supabase/migrations/0129_official_busy_rule.sql");
    const rule = body(m129, "official_game_busy");
    const list = /p_status is null or p_status not in \(([^)]*)\)/.exec(rule);
    ok(list !== null, "R1", "the rule is a blocklist: null is busy, then `not in (…)`", rule.trim());
    const sqlList = list ? [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort() : [];
    eq(sqlList, ["cancelled", "postponed"], "R1", "exactly cancelled and postponed are not busy");
    eq([...FAKE_NOT_BUSY].sort(), sqlList, "FK1", "the fake's copy of the rule equals the migration's");

    const m124 = read("supabase/migrations/0124_officials_signup.sql");
    const old = body(m124, "official_slot_problem");
    const now = body(m129, "official_slot_problem");
    const swapped = old.replace("and g2.status <> 'cancelled'),", "and public.official_game_busy(g2.status)),");
    ok(swapped !== old && now === swapped, "R2", "0129's official_slot_problem is 0124's with only the bookings filter swapped");

    const b = body(m129, "official_bookings");
    ok(/and public\.official_game_busy\(g\.status\)/.test(b) && !/'cancelled'/.test(b), "R3",
      "official_bookings keeps busy games through the rule, and names no status itself");
    ok(/m\.role in \('owner', 'admin'\)/.test(b) && /auth\.uid\(\)/.test(b), "R4", "official_bookings checks owner/admin by role");
  });

  // ── B — behaviour, per caller ──────────────────────────────────────────
  await section("B", async () => {
    for (const [status, busy] of [
      ["cancelled", false], ["postponed", false],
      ["scheduled", true], ["reschedule_pending", true], ["completed", true], ["zz_new_status", true],
    ] as const) {
      const fake = new FakeClient(db(status));
      const c = await findUmpireConflict("u-1", SEASON, CANDIDATE, fake.asClient());
      ok(c.ok === true && (c.conflict !== null) === busy, "B1",
        `the manual save check: an overlapping ${status} game is ${busy ? "a conflict" : "not a conflict"}`, JSON.stringify(c));
      if (busy) counters.busyStatuses++;
      else counters.notBusyStatuses++;
    }

    const post = new FakeClient(db("postponed"));
    const r1 = await autoAssignUmpires("div-0", SEASON, post.asClient(), NOW);
    const staffed = post.db.game_umpires.some((g) => g.game_id === "g-1" && g.umpire_id === "u-1");
    ok(r1.success && staffed, "B2", "auto-assign: an official whose only overlap is postponed is assigned", JSON.stringify(r1));
    if (staffed) counters.postponedAssigned++;
    const sched = new FakeClient(db("scheduled"));
    const r2 = await autoAssignUmpires("div-0", SEASON, sched.asClient(), NOW);
    ok(r2.success && !sched.db.game_umpires.some((g) => g.game_id === "g-1"), "B2",
      "auto-assign: a scheduled overlap still blocks", JSON.stringify(r2));
  });

  // ── F — fails closed ───────────────────────────────────────────────────
  await section("F", async () => {
    const failing = new FakeClient(db("scheduled"));
    failing.failRead = (t, s) => t === "official_bookings" && s === "rpc";
    const r = await fetchOfficialBookings(SEASON, ["u-1"], failing.asClient());
    ok(r.ok === false, "FC1", "an rpc error is \"couldn't read\", never an empty list", JSON.stringify(r));
    if (!r.ok) counters.failClosed++;

    eq([parseOfficialBookings(null), parseOfficialBookings({}), parseOfficialBookings([{ umpire_id: "u-1" }])], [null, null, null], "FC2",
      "a reply that isn't a list of well-formed rows is null");
    eq(parseOfficialBookings([]), [], "FC2", "an empty list is a real (empty) answer");

    const c = await findUmpireConflict("u-1", SEASON, CANDIDATE, failing.asClient());
    const words = assignmentPrecheckMessage("Sam", c, { ok: true, blackout: null });
    ok(c.ok === false && words === "Couldn't check Sam's other games, so nothing was saved. Try again.", "FC3",
      "the manual save refuses when the bookings can't be read", JSON.stringify({ c, words }));

    const slots = read("src/components/umpires/umpire-slots.tsx");
    ok(/if \(!u\.bookings\) \{\s*return \{ u, disabled: true, rank: 2, suffix: ` — \$\{BOOKINGS_UNREAD_SUFFIX\}` \};/.test(slots),
      "FC4", "the picker refuses an official whose bookings weren't read");
    const panel = read("src/components/divisions/division-schedule-panel.tsx");
    ok(panel.includes("setOfficialsReadFailed(!!(seasonRolesErr || umpiresErr || assignsErr) || !bookings.ok);"), "FC5",
      "the division panel shows the read error when the bookings can't be read");
    const detail = read("src/components/umpires/game-detail-modal.tsx");
    ok(/if \(!bookings\.ok\) \{\s*if \(!cancelled\) \{\s*setError\(OFFICIALS_READ_FAILED\);/.test(detail), "FC6",
      "the game detail modal shows the read error when the bookings can't be read");
    const rp = read("src/components/schedule/record-played-modal.tsx");
    ok(rp.includes("bookings: busy && busy.ok ? busy.byUmpire.get(u.id) ?? [] : null,"), "FC7",
      "record-played says \"couldn't check\" when the bookings can't be read");
  });

  // ── S — one read ───────────────────────────────────────────────────────
  await section("S", () => {
    const EMBED = /booking_rows|game_umpires\s*\(\s*game\s*:\s*games/;
    const panel = read("src/components/divisions/division-schedule-panel.tsx");
    ok(!EMBED.test(panel) && panel.includes("fetchOfficialBookings(leagueId,"), "S1", "the division panel reads bookings only through official_bookings");
    const detail = read("src/components/umpires/game-detail-modal.tsx");
    ok(!EMBED.test(detail) && detail.includes("fetchOfficialBookings(game.league_id,"), "S2", "the game detail modal reads bookings only through official_bookings");
    const rp = read("src/components/schedule/record-played-modal.tsx");
    ok(!EMBED.test(rp) && rp.includes("fetchOfficialBookings(game.league_id,"), "S3", "record-played reads bookings only through official_bookings");
    const auto = read("src/lib/umpires/auto-assign.ts");
    ok(!/game:games\(/.test(auto) && !/status !== "cancelled"/.test(auto) && auto.includes("fetchOfficialBookings(seasonId, umpireIds, supabase),"),
      "S4", "auto-assign reads bookings only through official_bookings and tests no status");

    const bad: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(join(ROOT, d))) {
        const p = join(d, n);
        if (statSync(join(ROOT, p)).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) {
          counters.filesScanned++;
          if (EMBED.test(read(p))) bad.push(p);
        }
      }
    };
    walk("src");
    eq(bad, [], "S5", "no file reads game_umpires → games as an official's bookings");
  });

  for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);

  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(`\n${failures.length} failure(s) of ${checks} checks`);
    process.exit(1);
  }
  console.log(`sim:official-busy — ${checks} checks pass (TZ=${process.env.TZ ?? "host"}); counters ${JSON.stringify(counters)}`);
}

main().catch((e) => {
  console.log(`FAIL: [CRASH-main] ${(e as Error).stack ?? e}`);
  process.exit(1);
});

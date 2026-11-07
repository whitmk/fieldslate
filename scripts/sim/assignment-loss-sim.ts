/**
 * Harness: the confirm screens say how many official assignments a regenerate
 * or a delete will remove (2026-11-06). WARN ONLY — nothing here changes what
 * an operation does.
 *
 * Drives the REAL code: src/lib/schedule/regenerate-removal.ts and
 * src/lib/umpires/assignment-loss.ts, against the shared generator fake
 * (fake-supabase.ts), and — for the regenerate — the REAL generateSchedule on
 * the same fixture, so the predicted deletions are checked against what the
 * generator actually deletes.
 *
 * Run: npm run sim:assignment-loss   (TZ=UTC mandatory, like the generator sims)
 *
 * FIXTURE (one division, four teams, the regenerate-pending-guard shapes):
 *   own-1        scheduled, ordinary         → deleted   (2 assignments)
 *   IL-untouched pending, untouched           → deleted   (1)
 *   IL-request   pending, request row only    → deleted WITHOUT the row (1),
 *                                               kept WITH it
 *   IL-counter   pending, partner countered   → kept      (1)
 *   IL-accepted  scheduled interleague        → kept      (1)
 *   other-league a team-0 game in ANOTHER season → kept  (1) — the league filter
 * Expected count, by hand: without the request row 2+1+1 = 4; with it 3.
 *
 * ASSERTIONS
 *   R1  predicted removal ids == the games generateSchedule actually deleted
 *   R2  the regenerate count is the hand-written number (4, then 3)
 *   R3  the count equals the assignments on the games that actually went
 *   F1–F5 each read failing (division, teams, games, requests, assignments)
 *       → the confirm says "couldn't count", never a number
 *   C1  a count over more ids than one chunk sums every chunk
 *   C2  a failed LATER chunk fails the whole count (no partial sum)
 *   D1  division delete: every game naming a division team, home OR away
 *   D2  season delete: every game of the season, none from another
 *   W1–W6 the sentences
 *   S1–S5 the season delete modal's own counts: real numbers when every read
 *       succeeds; an errored read (S2), a count-less reply (S3) or the
 *       interleague read alone (S4) → "couldn't count", never 0; S5 the
 *       modal renders it (source grep — weak by nature)
 * ANTI-VACUITY: a protected game kept, an ordinary game deleted, a fault
 * fired, a multi-chunk count.
 *
 * SECTION ORDER IS LOAD-BEARING: R, W, C, F, D. The F runs read the wording
 * (W) and depend on the chunked count (C), so W and C run first — otherwise
 * AL7 would die at F1 and AL4 at F5 instead of at their own assertion.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 * Criterion: killed only if the assertion written for it fails FIRST
 * (npm run sim:assignment-loss:mutants).
 *   AL1 protection ignored (protected games counted)       → [R1]
 *   AL2 request rows never read                            → [R1] (with-row run)
 *   AL3 a failed games read counted as zero games          → [F3]
 *   AL4 a failed chunk skipped instead of failing          → [C2]
 *   AL5 division count reads home games only               → [D1]
 *   AL6 zero assignments worded as a line                  → [W3]
 *   AL7 couldn't-count worded as zero (no line)            → [W2]
 *   AL8 season counts ignore a read's error                → [S2]
 *   AL9 season counts accept a reply with no count         → [S3]
 *   AL10 season counts skip the interleague read           → [S4]
 *   AL11 the modal's couldn't-count branch removed         → [S5]
 */

process.env.TZ = "UTC";

import { generateSchedule } from "../../src/lib/schedule/generate-schedule";
import {
  lossCount,
  regenerateAssignmentLoss,
  regenerateRemovalIds,
  type RegenerateCandidateGame,
} from "../../src/lib/schedule/regenerate-removal";
import {
  ASSIGNMENT_COUNT_CHUNK,
  assignmentLossLine,
  countAssignmentsForSeason,
  countAssignmentsForTeams,
  countAssignmentsOnGames,
} from "../../src/lib/umpires/assignment-loss";
import { FakeClient, type Db, type Row } from "./fake-supabase";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seasonDeleteCountsFrom } from "../../src/lib/seasons/delete-counts";

if (new Date("2026-03-07T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error("Run with TZ=UTC: npm run sim:assignment-loss");
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

const counters = { protectedKept: 0, ordinaryDeleted: 0, faultFired: 0, multiChunk: 0 };

const LEAGUE_ID = "league-1";
const OTHER_LEAGUE = "league-2";
const DIVISION_ID = "div-1";
const VENUE_ID = "venue-0";
const ORG_ID = "org-1";
const TEAM_COUNT = 4;
const SATURDAYS = ["2026-03-07", "2026-03-14", "2026-03-21", "2026-03-28"];
const teamId = (i: number) => `team-${i}`;

function buildDb(withRequestRow: boolean): FakeClient {
  const settings = {
    games_per_team: 2,
    max_games_per_week: 1,
    max_games_per_team_per_day: 1,
    playing_days: ["Sa"],
    earliest_start: "09:00",
    latest_start: "10:00",
    game_duration: 60,
    buffer_minutes: 0,
    max_games_per_field_per_day: 12,
    bye_weeks: 0,
    auto_rotate: true,
    teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({
      name: `Team ${i}`,
      has_coach_conflict: false,
      conflict_division: "",
      conflict_team: "",
    })),
  };
  const allDays: Record<string, { start: string; end: string }> = {};
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) allDays[d] = { start: "07:00", end: "22:00" };

  const db: Db = {
    divisions: [{
      id: DIVISION_ID, league_id: LEAGUE_ID, name: "Majors",
      start_date: SATURDAYS[0], end_date: SATURDAYS[3],
      intra_division_games_per_team: 2, settings,
    }],
    teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({
      id: teamId(i), league_id: LEAGUE_ID, division_id: DIVISION_ID, name: `Team ${i}`,
    })),
    venues: [{ id: VENUE_ID, name: "Field 0", availability: allDays, availability_configured: true }],
    division_venues: [{ division_id: DIVISION_ID, venue_id: VENUE_ID, allow_games: true }],
    blackout_dates: [],
    games: [],
    division_interleague_games: [],
    interleague_orgs: [{ id: ORG_ID, name: "Riverside YB", field_count: 1 }],
    team_game_constraints: [],
    interleague_reschedule_requests: [],
    game_umpires: [],
  };
  const game = (r: Partial<Row> & { id: string; scheduled_at: string; status: string }): Row => ({
    league_id: LEAGUE_ID, home_team_id: teamId(0), away_team_id: null, interleague_org_id: ORG_ID,
    venue_id: VENUE_ID, is_away: false, external_team_name: null, proposed_scheduled_at: null, ...r,
  });
  db.games.push(
    game({ id: "own-1", scheduled_at: `${SATURDAYS[2]}T10:00:00`, status: "scheduled", interleague_org_id: null, away_team_id: teamId(1) }),
    game({ id: "IL-untouched", scheduled_at: `${SATURDAYS[0]}T10:00:00`, status: "pending_interleague", home_team_id: teamId(1) }),
    game({ id: "IL-request", scheduled_at: `${SATURDAYS[2]}T09:00:00`, status: "pending_interleague", home_team_id: teamId(2) }),
    game({ id: "IL-counter", scheduled_at: `${SATURDAYS[0]}T09:00:00`, status: "pending_interleague", external_team_name: "Riverside Reds" }),
    game({ id: "IL-accepted", scheduled_at: `${SATURDAYS[1]}T10:00:00`, status: "scheduled", home_team_id: teamId(2) }),
    game({ id: "other-league", league_id: OTHER_LEAGUE, scheduled_at: `${SATURDAYS[3]}T10:00:00`, status: "scheduled", interleague_org_id: null, away_team_id: teamId(3) }),
  );
  const assign = (gameId: string, n: number) => {
    for (let i = 0; i < n; i++) db.game_umpires!.push({ id: `gu-${gameId}-${i}`, game_id: gameId, umpire_id: `u-${i}`, role: `R${i}` });
  };
  assign("own-1", 2);
  assign("IL-untouched", 1);
  assign("IL-request", 1);
  assign("IL-counter", 1);
  assign("IL-accepted", 1);
  assign("other-league", 1);
  if (withRequestRow) {
    db.interleague_reschedule_requests!.push({
      id: "req-1", game_id: "IL-request", token: "tok-1", requested_by_user_id: "user-1",
      proposed_scheduled_at: `${SATURDAYS[2]}T11:00:00`, status: "pending",
    });
  }
  return new FakeClient(db);
}

async function section(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    ok(false, `[CRASH-${name}]`, (e as Error).stack ?? String(e));
  }
}

async function main() {
  // ── R: the regenerate prediction vs the real generator ──────────────────────
  for (const [withRow, expected] of [[false, 4], [true, 3]] as const) {
    await section(`R-${withRow}`, async () => {
      const fake = buildDb(withRow);
      const loss = await regenerateAssignmentLoss(DIVISION_ID, fake.asClient());
      if ("failed" in loss) {
        ok(false, "[R1]", `the count read failed: ${JSON.stringify(loss)}`);
        return;
      }
      const before = new Set(fake.db.games.map((g) => String(g.id)));
      const assignmentsBefore = [...fake.db.game_umpires!];
      const res = await generateSchedule(DIVISION_ID, fake.asClient());
      const after = new Set(fake.db.games.map((g) => String(g.id)));
      const deleted = [...before].filter((id) => !after.has(id)).sort();
      const predicted = [...loss.games].sort();
      ok(res.success && JSON.stringify(predicted) === JSON.stringify(deleted), "[R1]",
        `withRow ${withRow}: predicted ${JSON.stringify(predicted)}, generator deleted ${JSON.stringify(deleted)} (success ${res.success} ${"error" in res ? res.error : ""})`);
      if (!deleted.includes("IL-counter") && after.has("IL-counter")) counters.protectedKept++;
      if (deleted.includes("own-1")) counters.ordinaryDeleted++;
      ok(loss.assignments.ok && loss.assignments.count === expected, "[R2]",
        `withRow ${withRow}: expected ${expected}, got ${JSON.stringify(loss.assignments)}`);
      const onDeleted = assignmentsBefore.filter((a) => deleted.includes(String(a.game_id))).length;
      ok(loss.assignments.ok && loss.assignments.count === onDeleted, "[R3]",
        `count ${JSON.stringify(loss.assignments)} vs ${onDeleted} on the games that went`);
    });
  }

  // The pure rule on its own, so R1's failure has a narrower twin.
  await section("R-pure", () => {
    const games = buildDb(false).db.games as unknown as RegenerateCandidateGame[];
    const ids = regenerateRemovalIds(games, LEAGUE_ID, new Set([0, 1, 2, 3].map(teamId)), new Set()).sort();
    ok(JSON.stringify(ids) === JSON.stringify(["IL-request", "IL-untouched", "own-1"]), "[R1-pure]", JSON.stringify(ids));
  });

  // ── W: the sentences ────────────────────────────────────────────────────────
  await section("W", () => {
    ok(assignmentLossLine("pending", "Baseball") === "Counting umpire assignments…", "[W1]");
    ok(assignmentLossLine({ ok: false }, "Soccer") === "Couldn't count how many referee assignments this removes.", "[W2]");
    ok(assignmentLossLine({ ok: true, count: 0 }, "Baseball") === null, "[W3]");
    ok(assignmentLossLine({ ok: true, count: 1 }, "Baseball") === "This removes 1 umpire assignment.", "[W4]");
    ok(assignmentLossLine({ ok: true, count: 4 }, "Softball") === "This removes 4 umpire assignments.", "[W5]");
    ok(assignmentLossLine({ ok: true, count: 2 }, null) === "This removes 2 official assignments.", "[W6]");
  });

  // ── C: chunking ─────────────────────────────────────────────────────────────
  await section("C", async () => {
    const n = ASSIGNMENT_COUNT_CHUNK * 2 + 7;
    const ids = Array.from({ length: n }, (_, i) => `g${i}`);
    const fake = buildDb(false);
    fake.db.game_umpires = ids.map((g, i) => ({ id: `x${i}`, game_id: g, umpire_id: "u", role: "R" }));
    const all = await countAssignmentsOnGames(fake.asClient() as never, ids);
    ok(all.ok && all.count === n, "[C1]", JSON.stringify(all));
    if (n > ASSIGNMENT_COUNT_CHUNK) counters.multiChunk++;
    const faulty = buildDb(false);
    faulty.db.game_umpires = fake.db.game_umpires;
    faulty.injectReadFault({ table: "game_umpires", nth: 2 });
    const part = await countAssignmentsOnGames(faulty.asClient() as never, ids);
    ok(part.ok === false, "[C2]", `a failed second chunk must fail the count: ${JSON.stringify(part)}`);
  });

  // ── F: every read fails closed into "couldn't count" ────────────────────────
  const COULDNT = "Couldn't count how many umpire assignments this removes.";
  const faults: { tag: string; table: keyof Db; selectEquals?: string }[] = [
    { tag: "F1", table: "divisions", selectEquals: "id, league_id" },
    { tag: "F2", table: "teams", selectEquals: "id" },
    { tag: "F3", table: "games" },
    { tag: "F4", table: "interleague_reschedule_requests" },
    { tag: "F5", table: "game_umpires" },
  ];
  for (const f of faults) {
    await section(f.tag, async () => {
      const fake = buildDb(true);
      fake.injectReadFault({ table: f.table, selectEquals: f.selectEquals });
      const loss = await regenerateAssignmentLoss(DIVISION_ID, fake.asClient());
      const line = assignmentLossLine(lossCount(loss), "Baseball");
      ok(line === COULDNT, `[${f.tag}]`, `a failed ${f.table} read must say couldn't count: ${JSON.stringify(line)}`);
      if ((fake.faultHits[0] ?? 0) > 0) counters.faultFired++;
    });
  }

  // ── D: division and season delete scopes ────────────────────────────────────
  await section("D", async () => {
    const fake = buildDb(false);
    // An AWAY-only game for a division team: home team outside the division.
    fake.db.games.push({ id: "away-only", league_id: LEAGUE_ID, home_team_id: "team-x", away_team_id: teamId(3), status: "scheduled", interleague_org_id: null, scheduled_at: `${SATURDAYS[1]}T09:00:00` });
    fake.db.game_umpires!.push({ id: "gu-away", game_id: "away-only", umpire_id: "u-9", role: "R" });
    const div = await countAssignmentsForTeams(fake.asClient() as never, [0, 1, 2, 3].map(teamId));
    // Every game but none: all 7 games name a division team; all 8 assignments.
    ok(div.ok && div.count === 8, "[D1]", `division delete: expected 8 (home or away), got ${JSON.stringify(div)}`);
    const season = await countAssignmentsForSeason(fake.asClient() as never, LEAGUE_ID);
    // league-1 games: all but other-league → 8 − 1 = 7.
    ok(season.ok && season.count === 7, "[D2]", `season delete: expected 7, got ${JSON.stringify(season)}`);
  });

  // ── S: the season delete modal's OWN counts — a failed read is never 0 ─────
  await section("S", () => {
    const good = { count: 3, error: null };
    const base = { divisions: good, teams: good, games: good, officials: good, interleague: { count: 0, error: null } };
    const all = seasonDeleteCountsFrom(base);
    ok(all.ok && all.divisions === 3 && all.games === 3 && all.interleague === 0, "[S1]", JSON.stringify(all));
    const keys = ["divisions", "teams", "games", "officials"] as const;
    const errored = keys.map((k) => seasonDeleteCountsFrom({ ...base, [k]: { count: null, error: { message: "x" } } }));
    ok(errored.every((r) => r.ok === false), "[S2]", `an errored read must make the counts unknown: ${JSON.stringify(errored)}`);
    if (errored.some((r) => !r.ok)) counters.faultFired++;
    // A reply with no error AND no count (what an error-less failure looks like).
    const noCount = seasonDeleteCountsFrom({ ...base, games: { count: null, error: null } });
    ok(noCount.ok === false, "[S3]", `a reply without a count must be unknown: ${JSON.stringify(noCount)}`);
    // The interleague read alone failing — its warning is the loudest line.
    const il = seasonDeleteCountsFrom({ ...base, interleague: { count: null, error: { message: "x" } } });
    ok(il.ok === false, "[S4]", `a failed interleague count must be unknown: ${JSON.stringify(il)}`);
    // Wiring (source grep — weak by nature): the modal renders the failed state.
    const src = readFileSync(join(__dirname, "../../src/components/seasons/archive-modals.tsx"), "utf8");
    ok(src.includes(") : !counts.ok ? (") && src.includes("{SEASON_COUNTS_FAILED}")
      && src.includes("{SEASON_INTERLEAGUE_UNKNOWN}") && !/count \?\? 0/.test(src), "[S5]",
      "the season delete modal must render SEASON_COUNTS_FAILED / SEASON_INTERLEAGUE_UNKNOWN and never default a count to 0");
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

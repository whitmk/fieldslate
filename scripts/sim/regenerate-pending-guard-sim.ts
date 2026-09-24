/**
 * Simulation harness: a regenerate must not silently destroy a live
 * interleague negotiation.
 *
 * WHY THIS EXISTS
 * ---------------
 * The regenerate DELETE preserved games that are `scheduled` AND interleague.
 * A game in `pending_interleague` was NOT preserved, so regenerating a division
 * deleted it — and if the partner had countered or a host proposal was
 * outstanding, the `interleague_reschedule_requests` row CASCADED away with it.
 * The partner's respond link then showed "This link is no longer active … reach
 * out to the league admin", who by then had no record of it either. No email to
 * either side. The same clause also deleted an ACCEPTED game sitting in
 * `reschedule_pending`, contradicting 0079's rule.
 *
 * WHAT THIS PROVES
 *   A — a protected game SURVIVES the regenerate, and an untouched pending
 *       game is still cleared (the guard is not just "keep everything")
 *   B — the admin is TOLD, by name, which games were kept and why
 *   C — fail closed: if the request read errors, nothing is deleted at all
 *   D — THE SLOT HAZARD. A preserved game keeps its slot, so the pre-loads must
 *       stop subtracting it. If the two predicate copies drift the generator
 *       places a new game ON TOP of the game it just decided to protect, and
 *       nothing errors. This is the assertion mutant M4 exists for.
 *   E — the predicate's truth table, directly
 *
 * Run: npm run sim:regenerate-pending-guard   (TZ=UTC mandatory)
 *
 * MUTATION LOG (2026-09-23) — each applied to the REAL source, run, reverted:
 *   M1  isProtectedInterleagueGame returns false for a pending game with a
 *       request row (the original bug). Dies at [A-protected-survives].
 *   M2  The request read's error is swallowed (`reqErr` ignored). Dies at
 *       [C-fail-closed-abort] and [C-fail-closed-intact].
 *   M3  The delete drops `.not("id","in",…)` while the TS predicate still
 *       protects — SQL-side drift. Dies at [A-protected-survives].
 *   M4  willBeClearedByRegenerate ignores `protectedIds` while the delete still
 *       protects — TS-side drift, the subtle direction. The game survives, so
 *       A and B stay GREEN; the pre-loads treat its slot as free and the
 *       generator double-books it. Dies at [D-no-double-book] ALONE.
 *
 * M3 SURVIVED THE FIRST PASS, AND THE REASON IS WORTH KEEPING. It deleted the
 * protected rows, so the D block dereferenced a row that no longer existed and
 * the process CRASHED — printing a stack trace and none of the four
 * [A-protected-survives] failures it had already recorded. A tally read from
 * that run would have said "no assertion caught it" when four had. Two fixes,
 * both load-bearing: the D block skips rows A has already reported missing, and
 * main() has a rejection handler that prints the collected failures and adds
 * [CRASH]. A thrown error is not a pass and not a clean kill.
 */

import { generateSchedule, isProtectedInterleagueGame } from "../../src/lib/schedule/generate-schedule";
import { preservedSummary } from "../../src/lib/schedule/preserved-games";
import { FakeClient, type Db, type Row } from "./fake-supabase";
import { readFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.TZ !== "UTC") {
  console.error("Run with TZ=UTC (npm run sim:regenerate-pending-guard). Aborting.");
  process.exit(1);
}

const failures: string[] = [];
let assertions = 0;
function ok(label: string, cond: boolean, detail = "") {
  assertions++;
  if (!cond) failures.push(`[${label}] ${detail}`);
}
function eq(label: string, actual: unknown, expected: unknown, detail = "") {
  assertions++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `[${label}] expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${detail ? ` — ${detail}` : ""}`,
    );
  }
}

// ── Anti-vacuity counters. A zero fails the run. ────────────────────────────
const seen = {
  protectedSurvived: 0,     // a protected game was still there afterwards
  unprotectedDeleted: 0,    // an untouched pending game WAS deleted
  summaryRendered: 0,       // preservedSummary produced a sentence
  slotHazardChecked: 0,     // the double-book check had a preserved slot to test
  failClosedProven: 0,      // a read fault aborted the run with nothing deleted
  truthTableRows: 0,        // rows cross-checked against the SQL guard's table
};

const LEAGUE_ID = "league-1";
const DIVISION_ID = "div-1";
const VENUE_ID = "venue-0";
const ORG_ID = "org-1";
const TEAM_COUNT = 4;
const GAMES_PER_TEAM = 2;
const SATURDAYS = ["2026-03-07", "2026-03-14", "2026-03-21", "2026-03-28"];
const teamId = (i: number) => `team-${i}`;

/** The interleague rows every fixture carries, one per protection case. */
type SeedOpts = { withRequestRow?: boolean };

function buildDb(o: SeedOpts = {}): FakeClient {
  const settings = {
    games_per_team: GAMES_PER_TEAM,
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
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
    allDays[d] = { start: "07:00", end: "22:00" };
  }

  const db: Db = {
    divisions: [
      {
        id: DIVISION_ID,
        league_id: LEAGUE_ID,
        name: "Majors",
        start_date: SATURDAYS[0],
        end_date: SATURDAYS[SATURDAYS.length - 1],
        intra_division_games_per_team: GAMES_PER_TEAM,
        settings,
      },
    ],
    teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({
      id: teamId(i),
      league_id: LEAGUE_ID,
      division_id: DIVISION_ID,
      name: `Team ${i}`,
    })),
    venues: [
      { id: VENUE_ID, name: "Field 0", availability: allDays, availability_configured: true },
    ],
    division_venues: [{ division_id: DIVISION_ID, venue_id: VENUE_ID, allow_games: true }],
    blackout_dates: [],
    games: [],
    division_interleague_games: [],
    interleague_orgs: [{ id: ORG_ID, name: "Riverside YB", field_count: 1 }],
    team_game_constraints: [],
    interleague_reschedule_requests: [],
  };

  const game = (r: Partial<Row> & { id: string; scheduled_at: string; status: string }): Row => ({
    league_id: LEAGUE_ID,
    home_team_id: teamId(0),
    away_team_id: null,
    interleague_org_id: ORG_ID,
    venue_id: VENUE_ID,
    is_away: false,
    external_team_name: null,
    proposed_scheduled_at: null,
    ...r,
  });

  // ── The five interleague states, all on the SAME division ────────────────
  // Protected:
  //   IL-counter   pending + the partner countered (external_team_name)
  //   IL-proposed  pending + the partner's proposed time is on the row
  //   IL-request   pending + a reschedule request row (only when seeded)
  //   IL-resched   ACCEPTED, change outstanding (reschedule_pending)
  // Not protected:
  //   IL-untouched pending, nobody has touched it → still deletable
  // Already preserved before this change:
  //   IL-accepted  scheduled + interleague
  db.games.push(
    game({ id: "IL-counter", scheduled_at: `${SATURDAYS[0]}T09:00:00`, status: "pending_interleague", external_team_name: "Riverside Reds" }),
    game({ id: "IL-proposed", scheduled_at: `${SATURDAYS[1]}T09:00:00`, status: "pending_interleague", proposed_scheduled_at: `${SATURDAYS[1]}T11:00:00`, home_team_id: teamId(1) }),
    game({ id: "IL-request", scheduled_at: `${SATURDAYS[2]}T09:00:00`, status: "pending_interleague", home_team_id: teamId(2) }),
    game({ id: "IL-resched", scheduled_at: `${SATURDAYS[3]}T09:00:00`, status: "reschedule_pending", home_team_id: teamId(3) }),
    game({ id: "IL-untouched", scheduled_at: `${SATURDAYS[0]}T10:00:00`, status: "pending_interleague", home_team_id: teamId(1) }),
    game({ id: "IL-accepted", scheduled_at: `${SATURDAYS[1]}T10:00:00`, status: "scheduled", home_team_id: teamId(2) }),
    // The division's own previous schedule — ordinary rows the delete clears.
    game({ id: "own-1", scheduled_at: `${SATURDAYS[2]}T10:00:00`, status: "scheduled", interleague_org_id: null, away_team_id: teamId(1) }),
  );

  if (o.withRequestRow) {
    db.interleague_reschedule_requests!.push({
      id: "req-1",
      game_id: "IL-request",
      token: "tok-1",
      requested_by_user_id: "user-1",
      proposed_scheduled_at: `${SATURDAYS[2]}T11:00:00`,
      status: "pending",
    });
  }

  return new FakeClient(db);
}

const ids = (fake: FakeClient) => new Set(fake.db.games.map((g) => String(g.id)));

async function main() {
  // ══ A + B + D. A regenerate with live negotiations present ═════════════════
  {
    const fake = buildDb({ withRequestRow: true });
    const before = ids(fake);
    ok("A-setup", before.has("IL-request"), "fixture seeded the request-bearing game");

    const res = await generateSchedule(DIVISION_ID, fake.asClient());
    ok("A-success", res.success, res.success ? "" : `generator failed: ${res.error}`);
    if (!res.success) throw new Error("cannot continue: " + res.error);

    const after = ids(fake);
    for (const id of ["IL-counter", "IL-proposed", "IL-request", "IL-resched", "IL-accepted"]) {
      const survived = after.has(id);
      ok("A-protected-survives", survived, `${id} was deleted by the regenerate`);
      if (survived) seen.protectedSurvived++;
    }
    ok("A-untouched-cleared", !after.has("IL-untouched"), "an untouched pending game must still be cleared");
    if (!after.has("IL-untouched")) seen.unprotectedDeleted++;
    ok("A-own-cleared", !after.has("own-1"), "the division's own old game must be cleared");

    // ── B. What the admin is told ──────────────────────────────────────────
    eq("B-count", res.preservedGames.length, 4, "four games should be preserved");
    const reasons = res.preservedGames.map((p) => p.reason).sort();
    eq("B-reasons", reasons, ["accepted_reschedule_pending", "live_negotiation", "live_negotiation", "live_negotiation"]);
    const sentence = preservedSummary(res.preservedGames);
    ok("B-sentence", !!sentence, "a sentence must be produced");
    if (sentence) {
      seen.summaryRendered++;
      ok("B-names-opponent", sentence.includes("Riverside"), `sentence must name the other league: ${sentence}`);
      ok("B-says-why", sentence.includes("mid-negotiation") && sentence.includes("outstanding"),
        `sentence must say why each kind was kept: ${sentence}`);
      ok("B-plain-english", !sentence.includes("pending_interleague") && !sentence.includes("interleague_org_id"),
        `sentence must not leak column names: ${sentence}`);
    }

    // ── D. THE SLOT HAZARD ─────────────────────────────────────────────────
    // Every preserved game holds a (venue, datetime). No newly created game may
    // land on one. Under M4 the pre-loads subtract the preserved rows, the walk
    // believes those slots are free, and this is the only assertion that notices.
    // Rows that no longer exist are already reported by A; skipping them here
    // keeps a deletion mutant dying at ITS assertion instead of crashing this
    // block before any failure is printed (M3 did exactly that on the first
    // mutation pass).
    const preservedSlots = new Set(
      res.preservedGames
        .map((p) => fake.db.games.find((g) => g.id === p.id))
        .filter((row): row is NonNullable<typeof row> => !!row)
        .map((row) => `${row.venue_id}|${String(row.scheduled_at).substring(0, 19)}`),
    );
    ok("D-setup", preservedSlots.size > 0, "there must be preserved slots to test");
    let collisions = 0;
    for (const g of fake.db.games) {
      if (res.preservedGames.some((p) => p.id === g.id)) continue;
      const key = `${g.venue_id}|${String(g.scheduled_at).substring(0, 19)}`;
      if (preservedSlots.has(key)) collisions++;
      seen.slotHazardChecked++;
    }
    eq("D-no-double-book", collisions, 0, "a new game was placed on top of a PRESERVED interleague game");
  }

  // ══ C. Fail closed on the request read ═════════════════════════════════════
  {
    const fake = buildDb({ withRequestRow: true });
    const before = JSON.stringify(fake.db.games);
    fake.injectReadFault({
      table: "interleague_reschedule_requests",
      selectIncludes: "game_id",
      message: "connection reset",
    });

    const res = await generateSchedule(DIVISION_ID, fake.asClient());
    ok("C-fail-closed-abort", !res.success, "an unreadable request table must abort the regenerate");
    if (!res.success) {
      ok("C-error-plain", /mid-negotiation|negotiation/i.test(res.error) && /nothing was changed/i.test(res.error),
        `the error must say what could not be checked and that nothing changed: ${res.error}`);
    }
    eq("C-fail-closed-intact", JSON.stringify(fake.db.games), before,
      "NOTHING may be deleted when the protection check could not run");
    if (!res.success && JSON.stringify(fake.db.games) === before) seen.failClosedProven++;
  }

  // ══ A2. Without the request row, that same game is deletable ═══════════════
  // Proves the guard keys off real partner involvement rather than "pending".
  {
    const fake = buildDb({ withRequestRow: false });
    const res = await generateSchedule(DIVISION_ID, fake.asClient());
    ok("A2-success", res.success, res.success ? "" : `generator failed: ${res.error}`);
    if (res.success) {
      const after = ids(fake);
      ok("A2-no-request-cleared", !after.has("IL-request"),
        "a pending game with NO counter, NO proposal and NO request row is still cleared");
      if (!after.has("IL-request")) seen.unprotectedDeleted++;
      eq("A2-count", res.preservedGames.length, 3, "only the three genuinely-touched games are kept");
    }
  }

  // ══ X. CROSS-CHECK AGAINST THE SQL GUARD'S TRUTH TABLE ═════════════════════
//
// The same rows are guarded by TWO doors: this regenerate delete (TypeScript,
// isProtectedInterleagueGame) and the single-game delete RPC (SQL,
// public.is_protected_interleague_game, migration 0093). Neither definition can
// be derived from the other, so BOTH are asserted against ONE written table —
// the one inside scripts/sim/delete-game-negotiation-sim.sql. That harness runs
// it through the SQL function; this block parses it out of that same file and
// runs it through the TypeScript one.
//
// WEAK IN ONE SPECIFIC WAY: this parses TEXT. Measured, not assumed — what it
// actually tolerates and what it rejects:
//   TOLERATED  whitespace and line breaks inside the rows (the row pattern is
//              whitespace-agnostic, so re-indenting or reflowing is fine).
//   REJECTED   a missing/renamed/duplicated marker line (X-markers, X-order),
//              a changed column count or literal style (X-parsed sees too few
//              rows), and of course a genuine disagreement (X-agrees).
// The trade buys exactly ONE written copy of the table instead of a third
// artifact that can drift on its own. Every rejection is a FAILURE, never a
// skip, so tidying that file cannot silently switch this check off. If you do
// change the row format, change this parser in the same commit.
{
  const sqlPath = join(__dirname, "delete-game-negotiation-sim.sql");
  let sql = "";
  try {
    sql = readFileSync(sqlPath, "utf8");
  } catch {
    ok("X-file", false, "could not read delete-game-negotiation-sim.sql");
  }
  // MARKERS ARE MATCHED AS WHOLE LINES, AND THERE MUST BE EXACTLY ONE OF EACH.
  // indexOf() on the raw text was the first version and it was wrong twice
  // over: the file's header discusses the markers by name in prose, and an
  // earlier draft carried a SECOND, commented copy of the table. With a
  // renamed end marker, indexOf then paired the header's BEGIN with the
  // table's END and happily parsed 22 rows across both copies — a broken file
  // that passed. Counting whole-line markers makes both of those loud.
  const lines = sql.split("\n");
  const beginLines = lines.filter((l) => l.trim() === "-- TRUTH-TABLE-BEGIN").length;
  const endLines = lines.filter((l) => l.trim() === "-- TRUTH-TABLE-END").length;
  ok(
    "X-markers",
    beginLines === 1 && endLines === 1,
    `expected exactly one TRUTH-TABLE-BEGIN and one TRUTH-TABLE-END line, found ${beginLines} and ${endLines}`,
  );
  const bi = lines.findIndex((l) => l.trim() === "-- TRUTH-TABLE-BEGIN");
  const ei = lines.findIndex((l) => l.trim() === "-- TRUTH-TABLE-END");
  ok("X-order", bi >= 0 && ei > bi, "the END marker must follow the BEGIN marker");
  const block =
    beginLines === 1 && endLines === 1 && ei > bi ? lines.slice(bi + 1, ei).join("\n") : "";
  const ROW =
    /\(\s*'([a-z_]+)'\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/g;
  const rows = [...block.matchAll(ROW)].map((m) => ({
    status: m[1]!,
    isInterleague: m[2] === "true",
    hasExternalTeamName: m[3] === "true",
    hasProposedScheduledAt: m[4] === "true",
    hasRequest: m[5] === "true",
    expected: m[6] === "true",
  }));

  ok("X-parsed", rows.length >= 10, `expected the full table, parsed ${rows.length} row(s)`);
  if (rows.length >= 10) seen.truthTableRows += rows.length;

  let mismatches = 0;
  for (const r of rows) {
    const actual = isProtectedInterleagueGame({
      status: r.status,
      interleague_org_id: r.isInterleague ? ORG_ID : null,
      external_team_name: r.hasExternalTeamName ? "Rockies" : null,
      proposed_scheduled_at: r.hasProposedScheduledAt ? "2026-10-18T13:00:00+00" : null,
      hasRescheduleRequest: r.hasRequest,
    });
    if (actual !== r.expected) {
      mismatches++;
      ok(
        "X-agrees",
        false,
        `TS predicate disagrees with the SQL guard's table: status=${r.status} il=${r.isInterleague} ext=${r.hasExternalTeamName} prop=${r.hasProposedScheduledAt} req=${r.hasRequest} → expected ${r.expected}, got ${actual}`,
      );
    }
  }
  ok("X-agrees", mismatches === 0, "the two definitions of 'protected' agree on every row");
  // Both sides must have SEEN a protected and an unprotected row, or agreement
  // is agreement about nothing.
  ok(
    "X-both-outcomes",
    rows.some((r) => r.expected) && rows.some((r) => !r.expected),
    "the table must contain both protected and unprotected rows",
  );
}

// ══ E. The predicate's truth table ═════════════════════════════════════════
  {
    const base = {
      status: "pending_interleague",
      interleague_org_id: ORG_ID,
      external_team_name: null,
      proposed_scheduled_at: null,
      hasRescheduleRequest: false,
    };
    ok("E-untouched", !isProtectedInterleagueGame(base), "untouched pending is NOT protected");
    ok("E-counter", isProtectedInterleagueGame({ ...base, external_team_name: "Reds" }), "a counter protects");
    ok("E-proposed", isProtectedInterleagueGame({ ...base, proposed_scheduled_at: "2026-03-07T11:00:00" }), "a proposed time protects");
    ok("E-request", isProtectedInterleagueGame({ ...base, hasRescheduleRequest: true }), "a request row protects");
    ok("E-resched", isProtectedInterleagueGame({ ...base, status: "reschedule_pending" }), "accepted + reschedule_pending protects (0079)");
    ok("E-scheduled", !isProtectedInterleagueGame({ ...base, status: "scheduled" }),
      "an accepted game is not this predicate's business — the status clause already preserves it");
    ok("E-not-interleague", !isProtectedInterleagueGame({ ...base, interleague_org_id: null, hasRescheduleRequest: true }),
      "a non-interleague game is never protected here");
    ok("E-cancelled", !isProtectedInterleagueGame({ ...base, status: "cancelled", hasRescheduleRequest: true }),
      "a cancelled game is not protected");
  }

}

function report() {
  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`regenerate pending-guard sim: ${assertions} assertions`);
  console.log(
    "coverage " +
      Object.entries(seen)
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );
  for (const [k, v] of Object.entries(seen)) {
    if (v === 0) failures.push(`[COUNTER] ${k} never fired — an assertion passed vacuously`);
  }
  if (failures.length) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error("  " + f);
    process.exit(1);
  }
  console.log("ALL PASS");
}

// A THROWN ERROR IS NOT A PASS AND NOT A CLEAN KILL. Without this, a mutant
// that makes the run crash mid-way prints a stack trace and none of the
// assertions that already failed — which reads as "no assertion caught it".
main().then(report, (err) => {
  failures.push(`[CRASH] the run threw: ${err instanceof Error ? err.message : String(err)}`);
  report();
});

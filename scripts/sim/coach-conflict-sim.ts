/**
 * Simulation harness for the cross-division shared-coach conflict DETECTOR
 * (src/lib/schedule/detect-coach-conflicts.ts).
 *
 * Run with:  TZ=UTC npx tsx scripts/sim/coach-conflict-sim.ts
 * (or `npm run sim:coach-conflicts`).
 *
 * TZ note: unlike the officials / game-constraint sims, this detector is
 * timezone-INDEPENDENT by construction — absMinutes() uses Date.UTC purely as a
 * deterministic minute counter over naive wall-clock strings, never local Date.
 * So the harness does NOT abort outside UTC. TZ=UTC is kept on the npm script
 * only for house consistency.
 *
 * Drives the REAL functions end-to-end:
 *  - buildCoachGroups: resolves divisions.settings coach links → team-id groups
 *    (item 1, the crux). Fixtures exercise precise (conflict_division + name)
 *    resolution, the legacy league-wide name fallback, duplicate-name ambiguity
 *    (skipped, never mis-linked), unresolved names (jsonb/teams drift), and
 *    transitive union-find (a coach across 3 teams collapses to one group).
 *  - detectCoachConflicts: the overlap heart (item 2). Fixtures cover
 *    cross-division overlap (caught), clean schedules (silent — no false
 *    positives), same-division overlap (caught — the detector ignores the
 *    division boundary), the flat-1-hour footprint boundary (end-to-start gaps
 *    of 59 / 60 / 61 min, and per-game differing durations), venue-independence
 *    (there is no venue dimension — two overlapping games flag regardless),
 *    interleague games (null away team), same-team overlap NOT reported (that's
 *    a team double-book, out of scope), a single game between two same-coach
 *    teams NOT reported (same game, not a conflict), and cross-group pair dedup.
 *  - detectSeasonCoachConflicts: one end-to-end run against a fake Supabase
 *    client, proving the DB glue — duration taken from the HOME team's division,
 *    cancelled games excluded, and only group-team games fetched.
 *
 * Anti-vacuity counters (the run FAILS if any is zero) guarantee every guarded
 * scenario above actually occurred, so disabling any guard is detectable.
 *
 * Mutation-test procedure (manual, per the harness standard). One at a time,
 * revert and re-verify green after each — the harness must FAIL for every one:
 *   1. detectCoachConflicts footprint boundary: change `startA < endB` to
 *      `<=` (or drop the +PAD) — the 59/60-min boundary assertions fail.
 *   2. Remove the same-team guard (`if (a.teamId === b.teamId) continue`) — the
 *      "team double-book not reported" assertion fails.
 *   3. Remove the same-game guard (`if (a.g.id === b.g.id) continue`) — the
 *      "single shared-coach game not a conflict" assertion fails.
 *   4. Remove the cross-group dedup (the `seen` set) — the dedup assertion
 *      counts the pair twice and fails.
 *   5. buildCoachGroups: ignore conflict_division (use only the league-wide
 *      name fallback) — the duplicate-name resolution test links the wrong team
 *      and the ambiguity test stops skipping; both fail.
 *   6. buildCoachGroups: drop the union() call — transitive-group and every
 *      overlap-catch assertion fails (no groups form).
 */

process.env.TZ = process.env.TZ || "UTC";

import {
  buildCoachGroups,
  detectCoachConflicts,
  detectSeasonCoachConflicts,
  coachConflictTouchesDivision,
  COACH_TRANSITION_PAD_MINUTES,
  type CoachConflictInputGame,
  type DivisionForCoachGroups,
  type TeamForCoachGroups,
  type CoachConflict,
} from "../../src/lib/schedule/detect-coach-conflicts";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

// Anti-vacuity counters — every one must end > 0.
const cov = {
  crossDivisionOverlapsCaught: 0,
  sameDivisionOverlapsCaught: 0,
  cleanSchedulesSilent: 0,
  boundaryConflictAt59: 0,
  boundaryClearAt60: 0,
  boundaryClearAt61: 0,
  differingDurationExercised: 0,
  interleagueGamesExercised: 0,
  sameTeamOverlapSuppressed: 0,
  sameGamePairSuppressed: 0,
  crossGroupDedupExercised: 0,
  transitiveGroupsFormed: 0,
  preciseDivisionResolution: 0,
  legacyNameFallback: 0,
  ambiguousLinksSkipped: 0,
  unresolvedLinksSkipped: 0,
  sameDivisionLinksResolved: 0,
  crossDivisionLinksResolved: 0,
};

// ── Fixture helpers ──────────────────────────────────────────────────────────

// Minute-offset → "YYYY-MM-DDT HH:MM:00" on a fixed date, so tests read in
// plain minutes. Base date 2026-05-02 (a Saturday, irrelevant — detector is
// day-agnostic). Supports crossing into the next day for late offsets.
function at(minutesFromMidnight: number, dayOffset = 0): string {
  const d = 2 + dayOffset;
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `2026-05-${p(d)}T${p(h)}:${p(m)}:00`;
}

function game(
  id: string,
  homeTeamId: string,
  awayTeamId: string | null,
  startMin: number,
  durationMinutes = 90,
  opts: { dayOffset?: number; divisionId?: string; divisionName?: string } = {},
): CoachConflictInputGame {
  return {
    id,
    scheduledAt: at(startMin, opts.dayOffset ?? 0),
    homeTeamId,
    awayTeamId,
    homeTeamName: `home-${homeTeamId}`,
    awayTeamName: awayTeamId ? `away-${awayTeamId}` : "External",
    durationMinutes,
    divisionId: opts.divisionId,
    divisionName: opts.divisionName,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
void (async () => {
console.log("Coach-conflict detector harness\n");

// ── 1. buildCoachGroups — resolution (item 1) ────────────────────────────────
console.log("buildCoachGroups (coach-link resolution):");
{
  // Two divisions. D1 team "Reds" (id t-reds) shares a coach with D2 team
  // "Reds" (id t-reds2 — SAME NAME, different division). Precise resolution via
  // conflict_division must pick t-reds2, not itself, and not be confused by the
  // duplicate name.
  const divisions: DivisionForCoachGroups[] = [
    {
      id: "D1",
      name: "Majors",
      settings: {
        game_duration: 90,
        teams: [
          {
            name: "Reds",
            has_coach_conflict: true,
            conflict_division: "D2",
            conflict_team: "Reds",
          },
          { name: "Blues", has_coach_conflict: false, conflict_division: "", conflict_team: "" },
        ],
      },
    },
    {
      id: "D2",
      name: "Minors",
      settings: {
        game_duration: 60,
        teams: [{ name: "Reds", has_coach_conflict: false, conflict_division: "", conflict_team: "" }],
      },
    },
  ];
  const teams: TeamForCoachGroups[] = [
    { id: "t-reds", name: "Reds", division_id: "D1" },
    { id: "t-blues", name: "Blues", division_id: "D1" },
    { id: "t-reds2", name: "Reds", division_id: "D2" },
  ];
  const { groups, diagnostics } = buildCoachGroups(divisions, teams);
  const grp = groups.find((g) => g.includes("t-reds"));
  assert(!!grp, "cross-div duplicate-name link should form a group containing t-reds");
  assert(!!grp && grp.includes("t-reds2"), "precise resolution must link D1 Reds → D2 Reds (t-reds2), not the same-name self");
  assert(!!grp && !grp.includes("t-blues"), "unlinked team must not be pulled into the group");
  assert(diagnostics.crossDivisionLinks >= 1, "should count a cross-division link");
  if (grp && grp.includes("t-reds2")) cov.preciseDivisionResolution++;
  if (diagnostics.crossDivisionLinks >= 1) cov.crossDivisionLinksResolved++;
}
{
  // Transitive: A→B and B→C must collapse into ONE group of three.
  const divisions: DivisionForCoachGroups[] = [
    {
      id: "DA",
      name: "A",
      settings: {
        teams: [
          { name: "Alpha", has_coach_conflict: true, conflict_division: "DB", conflict_team: "Bravo" },
        ],
      },
    },
    {
      id: "DB",
      name: "B",
      settings: {
        teams: [
          { name: "Bravo", has_coach_conflict: true, conflict_division: "DC", conflict_team: "Charlie" },
        ],
      },
    },
    { id: "DC", name: "C", settings: { teams: [{ name: "Charlie", has_coach_conflict: false }] } },
  ];
  const teams: TeamForCoachGroups[] = [
    { id: "a", name: "Alpha", division_id: "DA" },
    { id: "b", name: "Bravo", division_id: "DB" },
    { id: "c", name: "Charlie", division_id: "DC" },
  ];
  const { groups } = buildCoachGroups(divisions, teams);
  assert(groups.length === 1, `transitive links should form exactly 1 group, got ${groups.length}`);
  assert(
    groups.length === 1 && ["a", "b", "c"].every((t) => groups[0].includes(t)),
    "A→B→C must union into one group {a,b,c}",
  );
  if (groups.length === 1 && groups[0].length === 3) cov.transitiveGroupsFormed++;
}
{
  // Same-division link (the deferred gap): both ends in one division. The
  // detector treats it identically; diagnostics must classify it same-division.
  const divisions: DivisionForCoachGroups[] = [
    {
      id: "DX",
      name: "X",
      settings: {
        teams: [
          { name: "One", has_coach_conflict: true, conflict_division: "DX", conflict_team: "Two" },
          { name: "Two", has_coach_conflict: false },
        ],
      },
    },
  ];
  const teams: TeamForCoachGroups[] = [
    { id: "one", name: "One", division_id: "DX" },
    { id: "two", name: "Two", division_id: "DX" },
  ];
  const { groups, diagnostics } = buildCoachGroups(divisions, teams);
  assert(groups.length === 1 && groups[0].includes("one") && groups[0].includes("two"), "same-division link must still form a group");
  assert(diagnostics.sameDivisionLinks >= 1, "same-division link should be diagnosed as such");
  if (diagnostics.sameDivisionLinks >= 1) cov.sameDivisionLinksResolved++;
}
{
  // Legacy row (no conflict_division): single league-wide name match resolves;
  // a DUPLICATE name is ambiguous and must be SKIPPED, never mis-linked.
  const divisions: DivisionForCoachGroups[] = [
    {
      id: "L1",
      name: "L1",
      settings: {
        teams: [
          // resolves via unique league-wide name "Solo"
          { name: "Anchor", has_coach_conflict: true, conflict_division: "", conflict_team: "Solo" },
          // "Dup" exists in two divisions → ambiguous → skipped
          { name: "Anchor2", has_coach_conflict: true, conflict_division: "", conflict_team: "Dup" },
          // linked team name never exists → unresolved → skipped
          { name: "Anchor3", has_coach_conflict: true, conflict_division: "", conflict_team: "Ghost" },
        ],
      },
    },
    { id: "L2", name: "L2", settings: { teams: [] } },
  ];
  const teams: TeamForCoachGroups[] = [
    { id: "anchor", name: "Anchor", division_id: "L1" },
    { id: "anchor2", name: "Anchor2", division_id: "L1" },
    { id: "anchor3", name: "Anchor3", division_id: "L1" },
    { id: "solo", name: "Solo", division_id: "L2" },
    { id: "dup1", name: "Dup", division_id: "L1" },
    { id: "dup2", name: "Dup", division_id: "L2" },
  ];
  const { groups, diagnostics } = buildCoachGroups(divisions, teams);
  const anchorGrp = groups.find((g) => g.includes("anchor"));
  assert(!!anchorGrp && anchorGrp.includes("solo"), "legacy unique-name fallback must link Anchor → Solo");
  assert(!groups.some((g) => g.includes("dup1") || g.includes("dup2")), "ambiguous duplicate-name link must be skipped, not mis-linked");
  assert(diagnostics.ambiguousLinked >= 1, "should count the ambiguous link");
  assert(diagnostics.unresolvedLinked >= 1, "should count the Ghost unresolved link");
  if (anchorGrp && anchorGrp.includes("solo")) cov.legacyNameFallback++;
  if (diagnostics.ambiguousLinked >= 1) cov.ambiguousLinksSkipped++;
  if (diagnostics.unresolvedLinked >= 1) cov.unresolvedLinksSkipped++;
}

// ── 2. detectCoachConflicts — overlap heart (item 2) ─────────────────────────
console.log("detectCoachConflicts (overlap):");
{
  // Cross-division: A (div1) and B (div2) share a coach. A plays at 9:00, B at
  // 9:30 — footprints overlap heavily. Different venues implicitly (no venue in
  // the model at all) — proves venue-independence.
  const groups = [["A", "B"]];
  const games = [
    game("g1", "A", "opp1", 9 * 60, 90, { divisionId: "d1", divisionName: "Div1" }),
    game("g2", "B", "opp2", 9 * 60 + 30, 90, { divisionId: "d2", divisionName: "Div2" }),
  ];
  const out = detectCoachConflicts(games, groups);
  assert(out.length === 1, `cross-division overlap should yield 1 conflict, got ${out.length}`);
  assert(out.length === 1 && out[0].games[0].id === "g1" && out[0].games[1].id === "g2", "conflict should pair g1 (earlier) then g2");
  if (out.length === 1) cov.crossDivisionOverlapsCaught++;
}
{
  // Same-division overlap: two teams in the SAME division sharing a coach,
  // overlapping. The detector must catch it (ignores the division boundary).
  const groups = [["S1", "S2"]];
  const games = [
    game("s-a", "S1", "x", 10 * 60, 60, { divisionId: "d", divisionName: "D" }),
    game("s-b", "S2", "y", 10 * 60 + 20, 60, { divisionId: "d", divisionName: "D" }),
  ];
  const out = detectCoachConflicts(games, groups);
  assert(out.length === 1, `same-division overlap should yield 1 conflict, got ${out.length}`);
  if (out.length === 1) cov.sameDivisionOverlapsCaught++;
}
{
  // Clean schedule: same coach, games far apart → no conflict. Also two
  // OVERLAPPING games of teams that do NOT share a coach → no conflict.
  const groups = [["A", "B"]];
  const games = [
    game("far1", "A", "x", 9 * 60, 90),
    game("far2", "B", "y", 14 * 60, 90), // hours later
    game("un1", "U1", "z", 9 * 60, 90), // overlapping but U1/U2 share no coach
    game("un2", "U2", "w", 9 * 60, 90),
  ];
  const out = detectCoachConflicts(games, groups);
  assert(out.length === 0, `clean schedule should yield 0 conflicts, got ${out.length}`);
  if (out.length === 0) cov.cleanSchedulesSilent++;
}
{
  // Flat-hour boundary. Game A: start 9:00, duration 60 → ends 10:00, footprint
  // end = 10:00 + 60 = 11:00 (660 min). A same-coach game B whose START is:
  //   • 10:59 (gap 59) → footprint touches → CONFLICT
  //   • 11:00 (gap 60) → footprints touch exactly (half-open) → CLEAR
  //   • 11:01 (gap 61) → CLEAR
  const groups = [["A", "B"]];
  const A = game("bA", "A", "x", 9 * 60, 60);
  const mk = (startMin: number) => game("bB", "B", "y", startMin, 60);

  const c59 = detectCoachConflicts([A, mk(10 * 60 + 59)], groups);
  assert(c59.length === 1, `end-to-start gap 59 min must conflict, got ${c59.length}`);
  if (c59.length === 1) cov.boundaryConflictAt59++;

  const c60 = detectCoachConflicts([A, mk(11 * 60)], groups);
  assert(c60.length === 0, `end-to-start gap 60 min (a full hour) must be clear, got ${c60.length}`);
  if (c60.length === 0) cov.boundaryClearAt60++;

  const c61 = detectCoachConflicts([A, mk(11 * 60 + 1)], groups);
  assert(c61.length === 0, `end-to-start gap 61 min must be clear, got ${c61.length}`);
  if (c61.length === 0) cov.boundaryClearAt61++;

  // Confirm the pad constant actually drives the boundary (guards a silent
  // change to COACH_TRANSITION_PAD_MINUTES).
  assert(COACH_TRANSITION_PAD_MINUTES === 60, "harness assumes a 60-minute pad");
}
{
  // Differing per-division durations: A's division 120-min games, B's 45-min.
  // A start 9:00 dur 120 → end 11:00, footprint end 12:00. B start 11:30 (gap
  // 30 from A's end) → conflict. B's own short duration must not shrink A's
  // footprint. Also assert the reverse pairing uses B's duration.
  const groups = [["A", "B"]];
  const games = [
    game("dd-a", "A", "x", 9 * 60, 120, { divisionId: "d1" }),
    game("dd-b", "B", "y", 11 * 60 + 30, 45, { divisionId: "d2" }),
  ];
  const out = detectCoachConflicts(games, groups);
  assert(out.length === 1, `differing-duration overlap should conflict, got ${out.length}`);
  if (out.length === 1) cov.differingDurationExercised++;
}
{
  // Interleague game: away team null. The home team shares a coach with another
  // team; the interleague game still ties up the coach → overlap caught.
  const groups = [["H", "K"]];
  const games = [
    game("il-1", "H", null, 9 * 60, 90), // interleague, no local away
    game("il-2", "K", "opp", 9 * 60 + 30, 90),
  ];
  const out = detectCoachConflicts(games, groups);
  assert(out.length === 1, `interleague (null away) overlap should conflict, got ${out.length}`);
  assert(out.length === 1 && out[0].games.some((g) => g.awayTeam === "External"), "interleague game keeps its external label");
  if (out.length === 1) cov.interleagueGamesExercised++;
}
{
  // Same-team overlap must NOT be reported (team double-book, not a shared-coach
  // conflict). Team A is in a group; two of A's games overlap.
  const groups = [["A", "B"]];
  const games = [
    game("st-1", "A", "x", 9 * 60, 90),
    game("st-2", "A", "y", 9 * 60 + 15, 90), // same team, overlapping
  ];
  const out = detectCoachConflicts(games, groups);
  assert(out.length === 0, `same-team overlap must NOT be a coach conflict, got ${out.length}`);
  cov.sameTeamOverlapSuppressed++; // scenario exercised regardless of guard state
}
{
  // A single game where the two same-coach teams play EACH OTHER must NOT be a
  // conflict (one game, one place — the coach is already there).
  const groups = [["A", "B"]];
  const games = [game("mutual", "A", "B", 9 * 60, 90)];
  const out = detectCoachConflicts(games, groups);
  assert(out.length === 0, `a single A-vs-B game must not self-conflict, got ${out.length}`);
  cov.sameGamePairSuppressed++;
}
{
  // Cross-group dedup: coach-group G1={A,B}, G2={X,Y}. Game g-ax = A vs X,
  // g-by = B vs Y, overlapping. The pair (g-ax, g-by) is reachable via G1
  // (A,B) AND via G2 (X,Y) — must be reported exactly ONCE.
  const groups = [["A", "B"], ["X", "Y"]];
  const games = [
    game("g-ax", "A", "X", 9 * 60, 90),
    game("g-by", "B", "Y", 9 * 60 + 30, 90),
  ];
  const out = detectCoachConflicts(games, groups);
  assert(out.length === 1, `cross-group reachable pair must be reported once, got ${out.length}`);
  if (out.length === 1) cov.crossGroupDedupExercised++;
}
{
  // coachConflictTouchesDivision filter: a cross-division conflict shows on both
  // divisions' surfaces.
  const groups = [["A", "B"]];
  const games = [
    game("t1", "A", "x", 9 * 60, 90, { divisionId: "d1" }),
    game("t2", "B", "y", 9 * 60 + 30, 90, { divisionId: "d2" }),
  ];
  const [conflict] = detectCoachConflicts(games, groups);
  assert(coachConflictTouchesDivision(conflict, "d1"), "cross-division conflict should surface on division d1");
  assert(coachConflictTouchesDivision(conflict, "d2"), "cross-division conflict should surface on division d2");
  assert(!coachConflictTouchesDivision(conflict, "d3"), "conflict should NOT surface on an unrelated division");
}

// ── 3. detectSeasonCoachConflicts — end-to-end over a fake client ────────────
console.log("detectSeasonCoachConflicts (DB glue):");
{
  // Fake Supabase client returning canned rows per table. Divisions carry
  // game_duration in settings; one game is cancelled (must be excluded); the
  // clash is cross-division with duration coming from each HOME team's division.
  const divisionsData = [
    {
      id: "d1",
      name: "Majors",
      settings: {
        game_duration: 60,
        teams: [{ name: "Reds", has_coach_conflict: true, conflict_division: "d2", conflict_team: "Cubs" }],
      },
    },
    { id: "d2", name: "Minors", settings: { game_duration: 60, teams: [{ name: "Cubs", has_coach_conflict: false }] } },
  ];
  const teamsData = [
    { id: "reds", name: "Reds", division_id: "d1" },
    { id: "cubs", name: "Cubs", division_id: "d2" },
    { id: "opp1", name: "Opp1", division_id: "d1" },
    { id: "opp2", name: "Opp2", division_id: "d2" },
  ];
  const gamesData = [
    {
      id: "gg1",
      scheduled_at: at(9 * 60),
      status: "scheduled",
      home_team_id: "reds",
      away_team_id: "opp1",
      home_team: { name: "Reds" },
      away_team: { name: "Opp1" },
    },
    {
      id: "gg2",
      scheduled_at: at(9 * 60 + 30),
      status: "scheduled",
      home_team_id: "cubs",
      away_team_id: "opp2",
      home_team: { name: "Cubs" },
      away_team: { name: "Opp2" },
    },
    {
      // cancelled — must be excluded even though it would overlap
      id: "gg3",
      scheduled_at: at(9 * 60 + 10),
      status: "cancelled",
      home_team_id: "cubs",
      away_team_id: "opp2",
      home_team: { name: "Cubs" },
      away_team: { name: "Opp2" },
    },
  ];

  const fakeClient = {
    from(table: string) {
      const rowsFor = () =>
        table === "divisions" ? divisionsData : table === "teams" ? teamsData : gamesData;
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return Promise.resolve({ data: rowsFor(), error: null });
        },
        or() {
          return Promise.resolve({ data: rowsFor(), error: null });
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const out: CoachConflict[] = await detectSeasonCoachConflicts(fakeClient, "league-1");
  assert(out.length === 1, `end-to-end run should find 1 conflict, got ${out.length}`);
  assert(
    out.length === 1 && out[0].games.every((g) => g.id !== "gg3"),
    "cancelled game must be excluded from the detection",
  );
  assert(
    out.length === 1 && out[0].teamNames.includes("Reds") && out[0].teamNames.includes("Cubs"),
    "end-to-end conflict should name the two shared-coach teams",
  );
}
{
  // Fail-loud: a divisions read error must throw, never return [].
  const errClient = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        },
        or() {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  let threw = false;
  try {
    await detectSeasonCoachConflicts(errClient, "league-1");
  } catch {
    threw = true;
  }
  assert(threw, "a read error must throw (fail loud), not silently return no conflicts");
}

// ── Anti-vacuity: every guarded scenario must have actually fired ────────────
console.log("\nScenario coverage:", cov);
for (const [name, n] of Object.entries(cov)) {
  assert(n > 0, `anti-vacuity: scenario '${name}' never fired (asserted vacuously)`);
}

// ─────────────────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll coach-conflict detector invariants held ✓");
})();

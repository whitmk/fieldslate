// Per-week bye-line check — drives the REAL byeTeamsByWeek / teamIsOccupiedThisWeek.
//
// Non-negotiable fixtures (see the feature spec):
//   F1  A week with BOTH a cancelled game and a real bye. The cancelled team is
//       NOT on bye (awaiting a makeup, not free); the idle team IS. Mutation:
//       make the occupancy predicate EXCLUDE cancelled → F1's cancelled-team
//       assertion must fail.
//   F2  A game whose UTC INSTANT lands on a different weekday/week than its
//       wall-clock date, right at a week boundary. Wall-clock must win: it
//       buckets into the week its date substring names, never the instant's.
//   F3  A division with an even team count and every team playing → the week
//       yields an EMPTY bye list (the panel then renders no line).
//
// Plus supporting checks: pending_interleague DOES occupy (a pending invite may
// yet be accepted → "might be playing" is not free), interleague away games
// (home set, away null) DO occupy their home team, byes are name-sorted, and
// weeks with zero rows never appear. The rule is status-blind: a team is on bye
// for a week only if it has ZERO rows of ANY status that week.
//
// TZ=UTC is mandatory (npm script sets it) so the "instant vs wall-clock"
// fixture is meaningful on the test host regardless of its local zone.

import {
  byeTeamsByWeek,
  teamIsOccupiedThisWeek,
  type ByeGameInput,
  type ByeTeamInput,
} from "../../src/lib/venues/game-days";

if (process.env.TZ !== "UTC") {
  console.error("Run with TZ=UTC (npm run sim:bye-line). Aborting.");
  process.exit(1);
}

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

function game(
  p: Partial<ByeGameInput> & { scheduled_at: string },
): ByeGameInput {
  return {
    status: "scheduled",
    home_team_id: null,
    away_team_id: null,
    ...p,
  };
}

// Roster of four teams (even) — used across fixtures.
const teams: ByeTeamInput[] = [
  { id: "A", name: "Angels" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Cubs" },
  { id: "D", name: "Dodgers" },
];

// ── F1: cancelled game + real bye in the same week ──────────────────────────
// Week of Mon 2026-10-19 (Sat 10-24). Angels vs Bears is a real game; Cubs vs
// Dodgers was RAINED OUT (cancelled). Nobody is idle here, so add a second week
// to expose a true bye separately — but F1's point is: within a week that has a
// cancelled game, the cancelled team is NOT on bye.
//   Week 10-19: Angels & Bears play (scheduled); Cubs & Dodgers cancelled.
//   Expectation: bye list is EMPTY (all four have a row — cancelled counts).
{
  console.log("F1: cancelled counts as occupied (no false bye)");
  const games: ByeGameInput[] = [
    game({ scheduled_at: "2026-10-24T09:00:00+00:00", home_team_id: "A", away_team_id: "B", status: "scheduled" }),
    game({ scheduled_at: "2026-10-24T11:00:00+00:00", home_team_id: "C", away_team_id: "D", status: "cancelled" }),
  ];
  const byes = byeTeamsByWeek(games, teams).get("2026-10-19") ?? [];
  assert(!byes.includes("Cubs"), "cancelled team (Cubs) is NOT on bye");
  assert(!byes.includes("Dodgers"), "cancelled team (Dodgers) is NOT on bye");
  assert(byes.length === 0, "no team on bye this week (all have a row)");
}

// ── F1b: a genuine bye alongside a cancelled game ───────────────────────────
// Same week: Angels vs Bears (scheduled), Cubs vs Dodgers CANCELLED means Cubs
// & Dodgers are NOT free. To show a real bye we need a team with no row at all.
// Use a 3-team-in-a-week shape: only Angels & Bears & Cubs appear; Dodgers has
// nothing → Dodgers on bye; Cubs' only game is cancelled → Cubs NOT on bye.
{
  console.log("F1b: cancelled team excluded from bye, idle team included");
  const games: ByeGameInput[] = [
    game({ scheduled_at: "2026-10-24T09:00:00+00:00", home_team_id: "A", away_team_id: "B", status: "scheduled" }),
    // Cubs' only appearance this week is a rained-out game.
    game({ scheduled_at: "2026-10-25T11:00:00+00:00", home_team_id: "C", away_team_id: null, status: "cancelled" }),
    // Dodgers: no row this week at all → genuine bye.
  ];
  const byes = byeTeamsByWeek(games, teams).get("2026-10-19") ?? [];
  assert(byes.includes("Dodgers"), "idle team (Dodgers) IS on bye");
  assert(!byes.includes("Cubs"), "team with only a cancelled game is NOT on bye");
  assert(byes.length === 1 && byes[0] === "Dodgers", "exactly Dodgers on bye");
}

// ── F2: wall-clock wins over the instant ACROSS a week boundary ─────────────
// "2026-10-25T23:30:00-07:00" is a SUNDAY 23:30 local — the last day of the week
// starting Mon 2026-10-19. As a UTC INSTANT it is Monday 2026-10-26T06:30Z, the
// FIRST day of the NEXT week (Mon 2026-10-26). So the two conventions land in
// different weeks: parsing the instant would file this game one week late. The
// house convention (date substring only) must keep it in the 2026-10-19 week.
{
  console.log("F2: week bucketing uses wall-clock date, never the instant");
  const games: ByeGameInput[] = [
    game({ scheduled_at: "2026-10-25T23:30:00-07:00", home_team_id: "A", away_team_id: "B" }),
  ];
  const map = byeTeamsByWeek(games, teams);
  assert(map.has("2026-10-19"), "game buckets into its wall-clock week (2026-10-19)");
  assert(!map.has("2026-10-26"), "game did NOT roll into the next week via the instant");
  const byes = map.get("2026-10-19") ?? [];
  assert(
    byes.length === 2 && byes.includes("Cubs") && byes.includes("Dodgers"),
    "only the two non-playing teams are on bye that week",
  );
}

// ── F3: even roster, everyone plays → empty bye list (no line) ──────────────
{
  console.log("F3: full week (even roster, all play) yields no byes");
  const games: ByeGameInput[] = [
    game({ scheduled_at: "2026-10-24T09:00:00+00:00", home_team_id: "A", away_team_id: "B" }),
    game({ scheduled_at: "2026-10-24T11:00:00+00:00", home_team_id: "C", away_team_id: "D" }),
  ];
  const byes = byeTeamsByWeek(games, teams).get("2026-10-19");
  assert(byes !== undefined, "week appears (it has games)");
  assert((byes ?? []).length === 0, "bye list is empty → panel renders no line");
}

// ── Supporting: interleague away game occupies its home team ────────────────
{
  console.log("interleague away game (home set, away null) occupies home team");
  const games: ByeGameInput[] = [
    game({
      scheduled_at: "2026-10-24T10:00:00+00:00",
      home_team_id: "A",
      away_team_id: null,
      status: "scheduled",
    }),
  ];
  const byes = byeTeamsByWeek(games, teams).get("2026-10-19") ?? [];
  assert(!byes.includes("Angels"), "away-playing team (Angels) is NOT on bye");
  assert(byes.length === 3, "the other three are on bye");
}

// ── Supporting: pending_interleague OCCUPIES (decision reversed) ────────────
// A pending invite may yet be accepted, so a team whose only row that week is
// pending_interleague is NOT free — moving a game onto it is unsafe. "Might be
// playing" must never read as bye.
{
  console.log("pending_interleague proposal OCCUPIES the team (not on bye)");
  const games: ByeGameInput[] = [
    game({
      scheduled_at: "2026-10-24T10:00:00+00:00",
      home_team_id: "A",
      away_team_id: null,
      status: "pending_interleague",
    }),
  ];
  const byes = byeTeamsByWeek(games, teams).get("2026-10-19") ?? [];
  assert(!byes.includes("Angels"), "team with a pending invite is NOT on bye");
  assert(
    byes.length === 3 && !byes.includes("Angels"),
    "the other three are on bye; Angels is occupied",
  );
}

// ── Supporting: byes are name-sorted; empty weeks never appear ──────────────
{
  console.log("byes name-sorted; weeks with no rows are absent");
  const games: ByeGameInput[] = [
    // Only Dodgers plays this week → Angels, Bears, Cubs on bye (sorted).
    game({ scheduled_at: "2026-10-24T09:00:00+00:00", home_team_id: "D", away_team_id: null }),
  ];
  const map = byeTeamsByWeek(games, teams);
  const byes = map.get("2026-10-19") ?? [];
  assert(
    JSON.stringify(byes) === JSON.stringify(["Angels", "Bears", "Cubs"]),
    "bye names sorted A→Z",
  );
  assert(map.size === 1, "only the one game-bearing week is present");
}

// ── Mutation guard: prove teamIsOccupiedThisWeek is what F1 depends on ───────
// This mirrors the mandated mutation ("make the helper exclude cancelled") by
// reimplementing byeTeamsByWeek with the WRONG predicate and asserting F1's
// cancelled-team assertion would then fail. This documents the kill in-file so
// the drift hazard can't be silently reintroduced. (The production predicate is
// asserted directly below it.)
{
  console.log("mutation: excluding cancelled would break F1 (documented kill)");
  const mutantOccupied = (status: string) =>
    status !== "pending_interleague" && status !== "cancelled"; // WRONG
  const games: ByeGameInput[] = [
    { scheduled_at: "2026-10-24T09:00:00+00:00", status: "scheduled", home_team_id: "A", away_team_id: "B" },
    { scheduled_at: "2026-10-25T11:00:00+00:00", status: "cancelled", home_team_id: "C", away_team_id: null },
  ];
  // Recompute byes under the mutant predicate.
  const occupied = new Set<string>();
  for (const g of games) {
    if (!mutantOccupied(g.status)) continue;
    if (g.home_team_id) occupied.add(g.home_team_id);
    if (g.away_team_id) occupied.add(g.away_team_id);
  }
  const mutantByes = teams.filter((t) => !occupied.has(t.id)).map((t) => t.name);
  assert(
    mutantByes.includes("Cubs"),
    "under the mutant, Cubs WRONGLY reads as on bye (kill confirmed)",
  );
  // And the real predicate occupies for EVERY status — it ignores status by
  // design (any row means the team might be playing → not free).
  assert(
    teamIsOccupiedThisWeek("cancelled") === true,
    "production teamIsOccupiedThisWeek('cancelled') === true",
  );
  assert(
    teamIsOccupiedThisWeek("pending_interleague") === true,
    "production teamIsOccupiedThisWeek('pending_interleague') === true",
  );
  assert(
    teamIsOccupiedThisWeek("scheduled") === true,
    "production teamIsOccupiedThisWeek('scheduled') === true",
  );
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll checks passed.");

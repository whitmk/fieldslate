// Harness for the Schedule page's Location filter
// (src/lib/schedule/location-filter.ts).
//
// WHY IT EXISTS. Every way this filter can be wrong renders a believable page:
// - the location not applied to the query → Monroe shows every complex's games;
// - the Venue dropdown not narrowed → Westside's fields offered under Monroe;
// - the week grid's rows not narrowed → Westside's fields render as EMPTY rows
//   under Monroe, which reads as "free this week" (the misread that matters);
// - a venue outside the location ANDed in → an always-empty list under a
//   perfectly valid location.
// None of these throw.
//
// Drives the REAL functions. The query scope runs through the shared in-memory
// fake client (scripts/sim/fake-supabase.ts) so `.in` / `.eq` actually filter
// rows; the location's venue-id read runs through it too.
//
// ANTI-VACUITY: the run FAILS if the fixture never exercised a location with
// several venues, a venue with no location, an away game (null venue_id)
// under a location, a venue outside the selected location, and an eligible
// empty field of another location in week mode.
//
// ── MUTATION LOG (2026-09-24) ──────────────────────────────────────────────
// Criterion: a mutant is killed only if the assertion WRITTEN FOR IT fails
// first (see CLAUDE.md, "killed by the RIGHT assertion"). Each applied to the
// real source, run, then reverted with `git checkout`.
//   LM1  applyVenueScope skips the location `.in`         → killed at [Q1]
//   LM2  venueOptionsForLocation returns every venue       → killed at [O3]
//   LM3  narrowWeekVenues ignores locationVenueIds         → killed at [W1]
//        (games filtered, rows not: another complex's fields render empty)
//   LM4  effectiveVenueForLocation passes the venue through → killed at [E2]
//   LM5  fetchLocationVenueIds swallows its error, returns [] → killed at [F2]
// RESULT: 5/5 killed, each FIRST at its own assertion. LM3 is the one that
// matters most: [Q1] stays GREEN (the games are correctly Monroe's) while
// [W1] fails alone — exactly the "filtered games, unfiltered empty rows"
// misread, caught by the line written for it.
//
// KNOWN GAP, stated: this drives the lib, not the page. A page that stopped
// CALLING applyVenueScope / narrowWeekVenues would pass here. The wiring is two
// call sites in schedule/page.tsx; keep them calling these functions rather
// than inlining a copy, which is the only thing that makes this harness count.

import { FakeClient, type Db, type Row } from "./fake-supabase";
import {
  applyVenueScope,
  effectiveVenueForLocation,
  fetchLocationVenueIds,
  locationOptionsFromVenues,
  narrowWeekVenues,
  venueOptionsForLocation,
  type VenueOption,
  type VenueScope,
} from "@/lib/schedule/location-filter";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eqSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

// ── Fixture (shaped on SRALL - Fall 2026) ───────────────────────────────────
const ORG = "org_1";
const OTHER_ORG = "org_2";
const MONROE = "loc_monroe";
const WESTSIDE = "loc_westside";
const POLLEY = "loc_polley";
const OTHER_ORG_LOC = "loc_other";

const venueRows: Row[] = [
  { id: "v_andrews", owner_id: ORG, location_id: MONROE, name: "Andrews" },
  { id: "v_memorial", owner_id: ORG, location_id: MONROE, name: "Memorial" },
  { id: "v_rca", owner_id: ORG, location_id: MONROE, name: "RCA" },
  { id: "v_perry", owner_id: ORG, location_id: WESTSIDE, name: "Perry" },
  { id: "v_minors", owner_id: ORG, location_id: WESTSIDE, name: "Minors" },
  { id: "v_polley", owner_id: ORG, location_id: POLLEY, name: "Polley" },
  { id: "v_oracle", owner_id: ORG, location_id: null, name: "Oracle" },
  // Monroe field with NO game this season: must still be in the location's
  // id set (authoritative read), and must not appear as a venue option.
  { id: "v_monroe_unused", owner_id: ORG, location_id: MONROE, name: "Unused" },
  // Another org's venue in a location of the same shape — never ours.
  { id: "v_foreign", owner_id: OTHER_ORG, location_id: OTHER_ORG_LOC, name: "X" },
];

const gameRows: Row[] = [
  { id: "g1", venue_id: "v_andrews" },
  { id: "g2", venue_id: "v_memorial" },
  { id: "g3", venue_id: "v_rca" },
  { id: "g4", venue_id: "v_andrews" },
  { id: "g5", venue_id: "v_perry" },
  { id: "g6", venue_id: "v_minors" },
  { id: "g7", venue_id: "v_polley" },
  { id: "g8", venue_id: "v_oracle" },
  { id: "g9", venue_id: null }, // interleague away game
];

// Venue options as the page derives them (venues with a game this season).
const locName: Record<string, string> = {
  [MONROE]: "SRALL Monroe Complex",
  [WESTSIDE]: "Westside",
  [POLLEY]: "Polley Field @ Ives Park (SLL)",
};
const optionVenueIds = new Set(
  gameRows.map((g) => g.venue_id).filter((v): v is string => !!v),
);
const venueOptions: VenueOption[] = venueRows
  .filter((v) => optionVenueIds.has(v.id as string))
  .map((v) => ({
    id: v.id as string,
    name: v.name as string,
    location: v.location_id
      ? { id: v.location_id as string, name: locName[v.location_id as string] }
      : null,
  }));

function makeClient(): FakeClient {
  const db: Db = {
    divisions: [],
    teams: [],
    venues: venueRows.map((r) => ({ ...r })),
    division_venues: [],
    blackout_dates: [],
    games: gameRows.map((r) => ({ ...r })),
    division_interleague_games: [],
    interleague_orgs: [],
    team_game_constraints: [],
  };
  return new FakeClient(db);
}
const asSupabase = (c: FakeClient) =>
  c as unknown as SupabaseClient<Database>;

type Q = {
  eq(c: string, v: string): Q;
  in(c: string, v: string[]): Q;
} & PromiseLike<{ data: unknown; error: unknown }>;

async function gamesUnder(scope: VenueScope): Promise<string[]> {
  const c = makeClient();
  const q = c.from("games").select("id, venue_id") as unknown as Q;
  const { data } = await applyVenueScope(q, scope);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

// ── Counters ────────────────────────────────────────────────────────────────
const counters = {
  multiVenueLocation: 0,
  venueWithoutLocation: 0,
  awayGameUnderLocation: 0,
  venueOutsideLocation: 0,
  otherLocationEmptyRow: 0,
};

async function main() {
  console.log("\nlocation-filter sim");

  // ── [F] The authoritative venue-id read ───────────────────────────────────
  const monroeIds = await fetchLocationVenueIds(
    asSupabase(makeClient()),
    ORG,
    MONROE,
  );
  ok(
    eqSet(monroeIds, ["v_andrews", "v_memorial", "v_rca", "v_monroe_unused"]),
    "[F1] Monroe's venue ids come from venues, including a field with no game",
    JSON.stringify(monroeIds),
  );
  if (monroeIds.length > 1) counters.multiVenueLocation++;
  {
    const c = makeClient();
    c.failTables.add("venues");
    let threw = false;
    try {
      await fetchLocationVenueIds(asSupabase(c), ORG, MONROE);
    } catch {
      threw = true;
    }
    ok(threw, "[F2] a failed venue read THROWS (never an empty id list)");
  }
  const foreign = await fetchLocationVenueIds(
    asSupabase(makeClient()),
    ORG,
    OTHER_ORG_LOC,
  );
  ok(foreign.length === 0, "[F3] another org's location yields none of its venues");

  // ── [O] Option derivation ─────────────────────────────────────────────────
  const locs = locationOptionsFromVenues(venueOptions);
  ok(
    eqSet(locs.map((l) => l.id), [MONROE, WESTSIDE, POLLEY]),
    "[O1] one location option per located venue's location, deduped",
    JSON.stringify(locs),
  );
  ok(
    locs.map((l) => l.name).join("|") ===
      [...locs.map((l) => l.name)].sort((a, b) => a.localeCompare(b)).join("|"),
    "[O2] location options sorted by name",
  );
  if (venueOptions.some((v) => v.location === null)) {
    counters.venueWithoutLocation++;
  }
  ok(
    !locs.some((l) => l.name === "" || l.id === ""),
    "[O2b] no 'Unassigned' option for venues with no location",
  );
  const monroeVenueOpts = venueOptionsForLocation(venueOptions, MONROE);
  ok(
    eqSet(monroeVenueOpts.map((v) => v.id), ["v_andrews", "v_memorial", "v_rca"]),
    "[O3] Venue dropdown under Monroe lists only Monroe's venues",
    JSON.stringify(monroeVenueOpts.map((v) => v.id)),
  );
  ok(
    venueOptionsForLocation(venueOptions, "") === venueOptions,
    "[O4] no location → the venue options unchanged",
  );
  ok(
    !venueOptionsForLocation(venueOptions, MONROE).some((v) => v.location === null),
    "[O5] a venue with no location is excluded under a location",
  );
  ok(
    locationOptionsFromVenues(
      venueOptions.filter((v) => v.location === null),
    ).length === 0,
    "[O6] a season with no located venues yields no location options (dropdown hides)",
  );

  // ── [E] Cascade reconciliation ────────────────────────────────────────────
  ok(
    effectiveVenueForLocation("v_andrews", monroeIds) === "v_andrews",
    "[E1] a venue inside the location is kept",
  );
  if (!monroeIds.includes("v_perry")) counters.venueOutsideLocation++;
  ok(
    effectiveVenueForLocation("v_perry", monroeIds) === "",
    "[E2] a venue outside the location is dropped (effectiveTeamId pattern)",
  );
  ok(
    effectiveVenueForLocation("v_perry", null) === "v_perry",
    "[E3] no location → the venue passes through untouched",
  );
  ok(effectiveVenueForLocation("", monroeIds) === "", "[E4] no venue → none");

  // ── [Q] The games query ───────────────────────────────────────────────────
  const monroeGames = await gamesUnder({
    venueId: "",
    locationVenueIds: monroeIds,
  });
  ok(
    eqSet(monroeGames, ["g1", "g2", "g3", "g4"]),
    "[Q1] Monroe returns exactly Monroe's games",
    JSON.stringify(monroeGames),
  );
  if (gameRows.some((g) => g.venue_id === null)) counters.awayGameUnderLocation++;
  ok(!monroeGames.includes("g9"), "[Q2] away game (null venue) excluded under a location");
  ok(!monroeGames.includes("g8"), "[Q3] location-less venue's game excluded under a location");
  const all = await gamesUnder({ venueId: "", locationVenueIds: null });
  ok(all.length === gameRows.length, "[Q4] no filters → every game");
  const andrews = await gamesUnder({
    venueId: "v_andrews",
    locationVenueIds: monroeIds,
  });
  ok(eqSet(andrews, ["g1", "g4"]), "[Q5] location + venue inside it → that venue's games");
  const reconciled = await gamesUnder({
    venueId: effectiveVenueForLocation("v_perry", monroeIds),
    locationVenueIds: monroeIds,
  });
  ok(
    eqSet(reconciled, ["g1", "g2", "g3", "g4"]),
    "[Q6] mismatched venue under Monroe → all of Monroe, not an empty list",
    JSON.stringify(reconciled),
  );
  const emptyLoc = await gamesUnder({ venueId: "", locationVenueIds: [] });
  ok(emptyLoc.length === 0, "[Q7] a location with no venues matches nothing, never everything");
  const venueOnly = await gamesUnder({ venueId: "v_oracle", locationVenueIds: null });
  ok(eqSet(venueOnly, ["g8"]), "[Q8] venue filter alone unchanged");

  // ── [W] Week-by-field rows ────────────────────────────────────────────────
  const eligible = [
    { venueId: "v_andrews", name: "Andrews", locationName: "Monroe" },
    { venueId: "v_memorial", name: "Memorial", locationName: "Monroe" },
    { venueId: "v_monroe_unused", name: "Unused", locationName: "Monroe" },
    { venueId: "v_perry", name: "Perry", locationName: "Westside" },
    { venueId: "v_minors", name: "Minors", locationName: "Westside" },
    { venueId: "v_oracle", name: "Oracle", locationName: null },
  ];
  counters.otherLocationEmptyRow += eligible.filter(
    (r) => !monroeIds.includes(r.venueId),
  ).length;
  const monroeRows = narrowWeekVenues(eligible, {
    venueId: "",
    locationVenueIds: monroeIds,
  });
  ok(
    eqSet(monroeRows.map((r) => r.venueId), ["v_andrews", "v_memorial", "v_monroe_unused"]),
    "[W1] under Monroe, week rows are Monroe's fields only — no other complex's empty rows",
    JSON.stringify(monroeRows.map((r) => r.venueId)),
  );
  ok(
    monroeRows.some((r) => r.venueId === "v_monroe_unused"),
    "[W2] Monroe's own unused field keeps its empty row (capacity signal)",
  );
  ok(
    eqSet(
      narrowWeekVenues(eligible, { venueId: "v_perry", locationVenueIds: null }).map(
        (r) => r.venueId,
      ),
      ["v_perry"],
    ),
    "[W3] venue filter alone still narrows to one row (unchanged behavior)",
  );
  ok(
    narrowWeekVenues(eligible, { venueId: "", locationVenueIds: null }).length ===
      eligible.length,
    "[W4] no filters → every eligible row",
  );

  // ── Anti-vacuity ──────────────────────────────────────────────────────────
  for (const [name, n] of Object.entries(counters)) {
    ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  }
  console.log("  counters:", JSON.stringify(counters));

  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

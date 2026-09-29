// Mutation pass for games-export-sim.ts — see mutant-runner.ts for the rules
// (real source, always restored, FIRST failure must be the mutant's own).
import { runMutants, type Mutant } from "./mutant-runner";

const NORMALIZE = "src/lib/schedule/export-games.ts";
const GENERIC = "src/lib/schedule/generic-games-export.ts";
const FETCH = "src/lib/schedule/sports-connect-export.ts";

const MUTANTS: Mutant[] = [
  {
    id: "GE1", what: "pending filter removed (only cancelled excluded)", file: NORMALIZE,
    find: "(g) => countsAsScheduledGame(g.status) || (keepCancelled",
    replace: '(g) => g.status !== "cancelled" || (keepCancelled',
    expect: "P1",
  },
  {
    id: "GE2", what: "partner name blanked (away_team only, the old code)", file: NORMALIZE,
    find: 'g.external_team_name?.trim() || (g.away_team?.name ?? "TBD")',
    replace: 'g.away_team?.name ?? ""',
    expect: "I1",
  },
  {
    id: "GE3", what: "is_away swap removed", file: NORMALIZE,
    find: "g.is_away ? [partner, ourTeam] : [ourTeam, partner]",
    replace: "[ourTeam, partner]",
    expect: "I2",
  },
  {
    id: "GE4", what: "partner's field not offered on away games", file: NORMALIZE,
    find: 'partnerFieldName: g.is_away ? g.proposed_venue_name?.trim() ?? "" : "",',
    replace: 'partnerFieldName: "",',
    expect: "I3",
  },
  {
    id: "GE5", what: "generic builder filters on its own (drift)", file: GENERIC,
    find: "normalizeExportGames(games).map((r) =>",
    replace: 'normalizeExportGames(games.filter((g) => g.status !== "completed")).map((r) =>',
    expect: "EQ1",
  },
  {
    id: "GE6", what: "games read error swallowed, empty list returned", file: FETCH,
    find: "    if (error) return { ok: false, error: error.message };\n    return { ok: true, games: (data ?? [])",
    replace: "    if (error) return { ok: true, games: [] };\n    return { ok: true, games: (data ?? [])",
    expect: "E2",
  },
  {
    id: "GE7", what: "generic builder throws (crash reporting)", file: GENERIC,
    find: "r.venueName || r.partnerFieldName,",
    replace: "(r as unknown as { venue: { name: string } }).venue.name,",
    expect: "CRASH-P",
  },
  {
    id: "GE8", what: "keepCancelled defaults ON (cancelled games reach the CSVs)", file: NORMALIZE,
    find: "const keepCancelled = options.keepCancelled === true;",
    replace: "const keepCancelled = options.keepCancelled !== false;",
    expect: "EQ3",
  },
  {
    id: "GE9", what: "keepCancelled lets pending games through", file: NORMALIZE,
    find: '(keepCancelled && g.status === "cancelled")',
    replace: "keepCancelled",
    expect: "K3",
  },
  {
    id: "GE10", what: "kept cancelled games are not flagged", file: NORMALIZE,
    find: 'cancelled: g.status === "cancelled",',
    replace: "cancelled: false,",
    expect: "K2",
  },
];

runMutants({ sim: "scripts/sim/games-export-sim.ts", mutants: MUTANTS });

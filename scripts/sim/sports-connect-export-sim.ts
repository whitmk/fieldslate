// Sports Connect CSV builder check — drives the REAL buildSportsConnectCsv.
// Exact-row assertions: header, CRLF, SortOrder tiebreaks, Monday-start
// RoundNo weeks (same-weekend grouping, gap-week skip), is_away swap,
// comma quoting, M/D/YYYY, EndTime math incl. midnight wrap, blank Field,
// and the fail-loud refusal on every invalid game_duration shape.
import {
  buildSportsConnectCsv,
  fetchSportsConnectGames,
  SPORTS_CONNECT_HEADER,
  type SportsConnectFetchClient,
  type SportsConnectGame,
} from "../../src/lib/schedule/sports-connect-export";

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

function g(p: Partial<SportsConnectGame> & { id: string; scheduled_at: string }): SportsConnectGame {
  return {
    status: "scheduled",
    is_away: false,
    external_team_name: null,
    proposed_venue_name: null,
    home_team: { name: "Home" },
    away_team: { name: "Away" },
    venue: { name: "Park" },
    ...p,
  };
}

// Week math sanity: 2026-10-24 is a Saturday, 10-25 a Sunday (same weekend),
// 10-31 next Saturday, 11-14 skips a week (gap week 11-02..11-08 has no game).
const games: SportsConnectGame[] = [
  g({ id: "b", scheduled_at: "2026-10-24T09:00:00+00:00", home_team: { name: "Reds" }, away_team: { name: "Blues" } }),
  g({ id: "a", scheduled_at: "2026-10-24T09:00:00+00:00", home_team: { name: "Cubs" }, away_team: { name: "Mets" } }),
  g({ id: "c", scheduled_at: "2026-10-25T13:05:00+00:00", home_team: { name: "Reds, The" }, away_team: { name: "Cubs" } }),
  g({ id: "d", scheduled_at: "2026-10-31T23:00:00+00:00" }),
  g({ id: "e", scheduled_at: "2026-11-14T08:00:00+00:00" }),
  g({ id: "f", scheduled_at: "2026-10-24T11:00:00+00:00", status: "cancelled" }),
  g({ id: "h", scheduled_at: "2026-10-24T12:00:00+00:00", status: "pending_interleague" }),
  g({
    id: "i", scheduled_at: "2026-11-14T10:00:00+00:00", is_away: true,
    external_team_name: "Westside Wolves", away_team: null,
    home_team: { name: "Our Team" },
    venue: null, proposed_venue_name: "Cat Park",
  }),
  // Home game with a stale counter-proposal venue — the fallback is gated on
  // is_away, so Location must stay blank here.
  g({
    id: "j", scheduled_at: "2026-11-14T12:00:00+00:00",
    venue: null, proposed_venue_name: "Should Not Appear",
  }),
];

const res = buildSportsConnectCsv(games, 90, "Majors");
if (!res.ok) throw new Error("expected ok, got: " + res.error);
const lines = res.csv.split("\r\n");

console.log("--- CSV output ---");
console.log(res.csv);
console.log("------------------");

assert(lines[0] === SPORTS_CONNECT_HEADER, "header exact");
assert(res.csv.endsWith("\r\n"), "trailing CRLF");
assert(!res.csv.includes("\n") || res.csv.split("\n").every((l, i, arr) => i === arr.length - 1 || l.endsWith("\r")), "CRLF only");
assert(res.rowCount === 7, `7 counting rows (got ${res.rowCount})`);
assert(lines.length === 9, "header + 7 rows + trailing empty");

// Row 1: same-time tiebreak by home name → Cubs before Reds; SortOrder 1..N
assert(lines[1] === "1,1,Cubs,Mets,10/24/2026,09:00,10:30,Park,", `row1 (got: ${lines[1]})`);
assert(lines[2] === "2,1,Reds,Blues,10/24/2026,09:00,10:30,Park,", `row2 (got: ${lines[2]})`);
// Sunday same weekend → still round 1 (Monday-start weeks); comma name quoted
assert(lines[3] === '3,1,"Reds, The",Cubs,10/25/2026,13:05,14:35,Park,', `row3 quoted comma (got: ${lines[3]})`);
// Next Saturday → round 2; 23:00 + 90 wraps past midnight → 00:30
assert(lines[4] === "4,2,Home,Away,10/31/2026,23:00,00:30,Park,", `row4 midnight wrap (got: ${lines[4]})`);
// Gap week skipped → 11/14 is round 3, not 4. Date has no leading zeros (11/14 has none; row3 tests M/D via 10/25... use row5 8am)
assert(lines[5] === "5,3,Home,Away,11/14/2026,08:00,09:30,Park,", `row5 gap week → round 3 (got: ${lines[5]})`);
// is_away interleague: partner is HomeTeam, our team AwayTeam, and Location
// falls back to proposed_venue_name (venue_id is NULL on away rows)
assert(lines[6] === "6,3,Westside Wolves,Our Team,11/14/2026,10:00,11:30,Cat Park,", `row6 is_away swap + venue fallback (got: ${lines[6]})`);
// Home game with proposed_venue_name but no venue → fallback gated off, blank
assert(lines[7] === "7,3,Home,Away,11/14/2026,12:00,13:30,,", `row7 fallback gated on is_away (got: ${lines[7]})`);

// Long-season round ordering: week keys are zero-padded ISO dates of each
// week's Monday, so lexicographic sort is chronological — proven here past
// week 9 (round 10 must follow round 9, not round 1). Eleven consecutive
// Saturdays, 2026-03-07 .. 2026-05-16.
const saturdays = [
  "2026-03-07", "2026-03-14", "2026-03-21", "2026-03-28", "2026-04-04",
  "2026-04-11", "2026-04-18", "2026-04-25", "2026-05-02", "2026-05-09",
  "2026-05-16",
];
const longRes = buildSportsConnectCsv(
  saturdays.map((d, i) => g({ id: `w${i}`, scheduled_at: `${d}T09:00:00+00:00` })),
  90,
  "Long",
);
if (!longRes.ok) throw new Error("longRes not ok");
const longRounds = longRes.csv.split("\r\n").slice(1, 12).map((l) => l.split(",")[1]);
assert(
  longRounds.join(",") === "1,2,3,4,5,6,7,8,9,10,11",
  `11-week season rounds in order (got: ${longRounds.join(",")})`,
);

// No-leading-zero date: 2026-09-05 → 9/5/2026
const res2 = buildSportsConnectCsv([g({ id: "z", scheduled_at: "2026-09-05T09:00:00+00:00" })], 60, "X");
if (!res2.ok) throw new Error("res2 not ok");
assert(res2.csv.split("\r\n")[1].includes(",9/5/2026,"), "M/D/YYYY no leading zeros");

// Fail-loud on bad duration
for (const bad of [0, -5, undefined, null, "abc"]) {
  const r = buildSportsConnectCsv(games, bad, "Rookies");
  assert(!r.ok && r.error.includes("Rookies"), `duration ${String(bad)} → refused, names division`);
}

// Field always empty — every data row ends with the trailing comma
for (const line of lines.slice(1, 8)) {
  assert(line.endsWith(","), `Field column blank: ${line}`);
}

// ── Two surfaces, one output ─────────────────────────────────────────────────
// The picker modal and the /dashboard/export page both call the REAL
// fetchSportsConnectGames + buildSportsConnectCsv and download without a BOM.
// Drive that exact path here (fake client returning the fixture rows) and
// prove it is byte-identical to calling the builder directly — the shared
// fetch must hand rows through unmodified.
function fakeSupabase(rows: SportsConnectGame[]): SportsConnectFetchClient {
  return {
    from(table: string) {
      return {
        select() {
          if (table === "teams") {
            return { eq: async () => ({ data: [{ id: "t1" }], error: null }) };
          }
          return {
            in() {
              return { order: async () => ({ data: rows, error: null }) };
            },
          };
        },
      };
    },
  } as unknown as SportsConnectFetchClient;
}

(async () => {
  const fetched = await fetchSportsConnectGames(fakeSupabase(games), "d1");
  if (!fetched.ok) throw new Error("shared fetch errored: " + fetched.error);
  const viaFetch = buildSportsConnectCsv(fetched.games, 90, "Majors");
  if (!viaFetch.ok) throw new Error("viaFetch not ok");
  assert(
    viaFetch.csv === res.csv,
    "fetch-path CSV byte-identical to direct builder call",
  );

  if (failures) {
    console.error(`\n${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
})();

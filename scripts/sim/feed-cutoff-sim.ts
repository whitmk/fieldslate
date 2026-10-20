// The TypeScript side of 0112's "last day" rule. Parses the ONE case table out
// of scripts/sim/feed-cutoff-sim.sql (between the LASTDAY-TABLE-BEGIN / -END
// lines — the SQL proof runs the same rows through season_last_day) and runs
// every row through seasonLastDay. Change either rule alone and its side goes
// red. Also: the 7-day grace (feedsServeOn), date arithmetic across month and
// year ends, the editor's wording, and that 0112 really changes all five
// functions and nothing else in them.
//
// ASSERTIONS
//   XC1  the table parses: both markers once, 10+ rows, every row well formed
//   LD   every row: seasonLastDay(end, games, playoffs) === expected
//   G1   feedsServeOn: last+7 served, last+8 not, null never cut off
//   G2   addDays across a month end, a year end and a leap day
//   W1   the editor note names both the end date and the last game
//   M1   0112 holds the five functions, each with season_last_day(...) + 7
//        and no "end_date + 7" left; the helper is revoked from every role
// COUNTERS: rows run, rows where a regular game extends the day, rows where a
// playoff game does, a null-end row.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, feedsServeOn, seasonLastDay } from "@/lib/seasons/archive-decision";
import { END_DATE_NOTE } from "@/lib/seasons/end-date";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
let passes = 0;
function check(tag: string, ok: boolean, detail: string) {
  if (ok) passes++;
  else {
    failures++;
    console.log(`FAIL: [${tag}] ${detail}`);
  }
}
const counters = { rows: 0, gameExtends: 0, playoffExtends: 0, nullEnd: 0 };

// ── XC1 + LD: the shared table ──────────────────────────────────────────────
const sql = read("scripts/sim/feed-cutoff-sim.sql");
const lines = sql.split("\n");
const begin = lines.filter((l) => l.trim() === "-- LASTDAY-TABLE-BEGIN").length;
const end = lines.filter((l) => l.trim() === "-- LASTDAY-TABLE-END").length;
check("XC1", begin === 1 && end === 1, `markers: BEGIN ×${begin}, END ×${end} (each must appear exactly once)`);
const from = lines.findIndex((l) => l.trim() === "-- LASTDAY-TABLE-BEGIN");
const to = lines.findIndex((l) => l.trim() === "-- LASTDAY-TABLE-END");
const block = from >= 0 && to > from ? lines.slice(from + 1, to) : [];
const ROW = /^\s*\('([A-Z0-9]+)', (NULL|'\d{4}-\d{2}-\d{2}'), '\{([^}]*)\}', '\{([^}]*)\}', (NULL|'\d{4}-\d{2}-\d{2}')\),?\s*$/;
const unq = (v: string) => (v === "NULL" ? null : v.slice(1, -1));
const list = (v: string) => (v === "" ? [] : v.split(",").map((x) => (x === "NULL" ? null : x)));
for (const line of block) {
  if (!line.trim()) continue;
  const m = ROW.exec(line);
  check("XC1", !!m, `a table row didn't parse: ${line}`);
  if (!m) continue;
  const [, id, endRaw, gamesRaw, playoffsRaw, expectRaw] = m;
  const endDate = unq(endRaw);
  const games = list(gamesRaw).filter((d): d is string => d !== null).map((d) => `${d}T03:30:00+00:00`);
  const playoffs = list(playoffsRaw);
  const expect = unq(expectRaw);
  const got = seasonLastDay(endDate, games, playoffs);
  counters.rows++;
  if (endDate === null) counters.nullEnd++;
  if (endDate && expect && expect > endDate) {
    const gameMax = games.map((g) => g.slice(0, 10)).sort().pop() ?? "";
    if (gameMax === expect) counters.gameExtends++;
    else counters.playoffExtends++;
  }
  check(`LD-${id}`, got === expect, `case ${id}: got ${got}, expected ${expect}`);
}
check("XC1", counters.rows >= 10, `only ${counters.rows} rows ran`);

// ── G1 / G2: the grace and the date arithmetic ──────────────────────────────
check("G1", feedsServeOn("2026-10-25", "2026-11-01") === true, "last day + 7 must still be served");
check("G1", feedsServeOn("2026-10-25", "2026-11-02") === false, "last day + 8 must be cut off");
check("G1", feedsServeOn("2026-10-25", "2026-10-25") === true, "the last day itself is served");
check("G1", feedsServeOn(null, "2099-01-01") === true, "no last day is never cut off");
check("G2", addDays("2026-10-28", 7) === "2026-11-04", addDays("2026-10-28", 7));
check("G2", addDays("2026-12-29", 7) === "2027-01-05", addDays("2026-12-29", 7));
check("G2", addDays("2028-02-25", 7) === "2028-03-03", addDays("2028-02-25", 7));

// ── W1: the editor's note ───────────────────────────────────────────────────
check("W1", END_DATE_NOTE.includes("7 days after the end date or the season’s last game, whichever is later"), END_DATE_NOTE);

// ── M1: the migration changes all five and only the cut-off ─────────────────
const mig = read("supabase/migrations/0112_feed_cutoff_last_day.sql");
const fns: [string, string][] = [
  ["get_team_calendar_by_token", "public.season_last_day(v_league_id) + 7"],
  ["get_league_schedule_by_token", "public.season_last_day(l.id) + 7"],
  ["delete_playoff_bracket", "public.season_last_day(v_league.id) + 7"],
  ["replace_playoff_games", "public.season_last_day(v_league.id) + 7"],
  ["clear_playoff_result", "public.season_last_day(v_league.id) + 7"],
];
for (const [fn, uses] of fns) {
  const at = mig.indexOf(`create or replace function public.${fn}(`);
  check("M1", at >= 0, `0112 doesn't re-create ${fn}`);
  if (at < 0) continue;
  const bodyEnd = mig.indexOf("\n$$;", mig.indexOf("as $$", at));
  const body = mig.slice(at, bodyEnd);
  check("M1", body.includes(uses), `${fn} doesn't cut off at ${uses}`);
  check("M1", !body.includes("end_date + 7"), `${fn} still has an end_date + 7`);
}
check("M1", (mig.match(/public\.season_last_day\(v_league\.id\) \+ 7/g) ?? []).length === 4,
  "the three bracket functions must use the helper exactly 4 times (replace has two)");
check("M1", /revoke execute on function public\.season_last_day\(uuid\)\s+from public, anon, authenticated, service_role, dashboard_readonly;/.test(mig),
  "season_last_day must be revoked from every role");
check("M1", !/grant execute on function public\.season_last_day/.test(mig), "season_last_day must be granted to no role");

for (const [k, v] of Object.entries(counters)) check("V", v > 0, `anti-vacuity counter ${k} is 0`);
console.log(`\n${passes} checks passed, ${failures} failed.`);
console.log(`counters: ${JSON.stringify(counters)}`);
process.exit(failures ? 1 : 0);

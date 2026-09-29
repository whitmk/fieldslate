// Games CSV exports — drives the REAL generic builder, the REAL Sports Connect
// builder, the REAL shared fetch and the REAL shared normalizeExportGames.
//
// What it proves:
//   P   pending interleague games (unanswered AND counter-proposed) are in
//       neither file.
//   I   interleague rows: partner name on a home game; swap + partner's field
//       on an away game; blank field when unknown; "TBD" when unnamed.
//   EQ  the generic CSV and the Sports Connect CSV contain the SAME games.
//   ST  every status, one by one, in both files.
//   F   the generic format is unchanged (header, quoting, date, time, CRLF).
//   D   DIFFERENTIAL: for ordinary games the new generic builder is
//       byte-identical to a frozen copy of the pre-change code.
//   E   a failed read produces NO csv — generic and Sports Connect.
//   S   source wiring (grep-level, weak by nature — stated).
//
// A section that THROWS is recorded as a [CRASH-…] failure and the run goes
// on, so collected failures are always printed. A thrown error is not a pass
// and not a clean kill.
//
// Anti-vacuity counters at the end: a zero counter fails the run.
//
// MUTATION LOG (2026-09-29) — `npm run sim:games-export:mutants` applies each
// mutant to the REAL source, runs this file, restores the source, and requires
// the FIRST failing assertion to be the mutant's own:
//   GE1 pending filter removed (only cancelled excluded)      → [P1]
//   GE2 partner name blanked (away_team only, the old code)   → [I1]
//   GE3 is_away swap removed                                  → [I2]
//   GE4 partner's field not offered on away games             → [I3]
//   GE5 generic builder filters on its own (drift)            → [EQ1]
//   GE6 games read error swallowed, empty list returned       → [E2]
//   GE7 generic builder throws                                → [CRASH-P]
//       (proves failures are still printed when a mutant crashes)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeExportGames, type ExportGame } from "../../src/lib/schedule/export-games";
import {
  buildGenericGamesCsv,
  exportGenericGamesCsv,
} from "../../src/lib/schedule/generic-games-export";
import {
  buildSportsConnectCsv,
  fetchSportsConnectGames,
  type SportsConnectFetchClient,
} from "../../src/lib/schedule/sports-connect-export";

const failures: string[] = [];
function assert(cond: boolean, tag: string, label: string) {
  if (cond) console.log(`  ok: [${tag}] ${label}`);
  else {
    failures.push(`[${tag}] ${label}`);
    console.error(`  FAIL: [${tag}] ${label}`);
  }
}
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`[CRASH-${name}] section threw: ${msg}`);
    console.error(`  FAIL: [CRASH-${name}] section threw: ${msg}`);
  }
}
const counters: Record<string, number> = {};
function count(name: string, n = 1) {
  counters[name] = (counters[name] ?? 0) + n;
}

// ── Fixtures (test names only) ───────────────────────────────────────────────
function g(p: Partial<ExportGame> & { id: string; scheduled_at: string }): ExportGame {
  return {
    status: "scheduled",
    is_away: false,
    external_team_name: null,
    proposed_venue_name: null,
    home_team: { name: "Home" },
    away_team: { name: "Away" },
    venue: { name: "QA-Memorial", location: null },
    ...p,
  };
}
const at = (d: string, t: string) => `${d}T${t}:00+00:00`;

const FIXTURES: ExportGame[] = [
  g({ id: "n1", scheduled_at: at("2026-10-03", "09:00"), home_team: { name: "QA Tigers" }, away_team: { name: "QA Bears" } }),
  g({ id: "n2", scheduled_at: at("2026-10-03", "11:30"), home_team: { name: "QA Hawks" }, away_team: { name: "QA Owls" },
      venue: { name: "Field 2", location: { name: "QA Park" } } }),
  // interleague HOME, accepted
  g({ id: "ih", scheduled_at: at("2026-10-10", "13:00"), home_team: { name: "QA Lions" }, away_team: null,
      external_team_name: "Riverside Reds" }),
  // interleague AWAY, accepted, field known
  g({ id: "ia1", scheduled_at: at("2026-10-10", "15:30"), home_team: { name: "QA Wolves" }, away_team: null,
      is_away: true, external_team_name: "Riverside Blues", venue: null, proposed_venue_name: "Riverside Field 1" }),
  // interleague AWAY, accepted, field unknown
  g({ id: "ia2", scheduled_at: at("2026-10-11", "10:00"), home_team: { name: "QA Foxes" }, away_team: null,
      is_away: true, external_team_name: "Riverside Greens", venue: null }),
  // interleague AWAY, partner team unnamed (legacy rows) → TBD
  g({ id: "it", scheduled_at: at("2026-10-11", "12:00"), home_team: { name: "QA Otters" }, away_team: null,
      is_away: true, venue: null }),
  // pending, no response
  g({ id: "p1", scheduled_at: at("2026-10-17", "09:00"), status: "pending_interleague",
      home_team: { name: "QA Pending-A" }, away_team: null }),
  // pending, partner counter-proposed
  g({ id: "p2", scheduled_at: at("2026-10-17", "11:00"), status: "pending_interleague",
      home_team: { name: "QA Pending-B" }, away_team: null,
      external_team_name: "Riverside Golds", proposed_venue_name: "Riverside Field 9" }),
  // rained out — the rainout flow sets status `cancelled`
  g({ id: "ro", scheduled_at: at("2026-10-17", "13:00"), status: "cancelled",
      home_team: { name: "QA Rained" }, away_team: { name: "QA Out" } }),
  // accepted interleague game with a change outstanding
  g({ id: "rp", scheduled_at: at("2026-10-18", "09:00"), status: "reschedule_pending",
      home_team: { name: "QA Resched" }, away_team: null, external_team_name: "Riverside Silvers" }),
  g({ id: "c", scheduled_at: at("2026-10-18", "11:00"), status: "completed",
      home_team: { name: "QA Done-Home" }, away_team: { name: "QA Done-Away" } }),
  g({ id: "x", scheduled_at: at("2026-10-18", "13:00"), status: "cancelled",
      home_team: { name: "QA Cancelled" }, away_team: { name: "QA Called-Off" } }),
  // any other status counts
  g({ id: "pp", scheduled_at: at("2026-10-24", "09:00"), status: "postponed",
      home_team: { name: "QA Postponed" }, away_team: { name: "QA Later" } }),
  // HOME game carrying a stale counter-proposal field and no venue → blank
  g({ id: "st", scheduled_at: at("2026-10-24", "11:00"),
      home_team: { name: "QA Stale" }, away_team: { name: "QA Venue" },
      venue: null, proposed_venue_name: "Should Not Appear" }),
];

const INCLUDED = ["n1", "n2", "ih", "ia1", "ia2", "it", "rp", "c", "pp", "st"];
const EXCLUDED = ["p1", "p2", "ro", "x"];

// ── CSV reading ──────────────────────────────────────────────────────────────
function parseCsv(csv: string): string[][] {
  return csv
    .split("\r\n")
    .filter((l) => l.length > 0)
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    });
}
function to24h(t12: string): string {
  const [hm, ap] = t12.split(" ");
  const [h, m] = hm.split(":").map(Number);
  const h24 = (h % 12) + (ap === "PM" ? 12 : 0);
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const plainDate = (d: string) => d.split("/").map((n) => String(parseInt(n, 10))).join("/");

type Row = { home: string; away: string; date: string; time: string; place: string; field?: string };
function genericRows(csv: string): Row[] {
  return parseCsv(csv).slice(1).map((c) => ({
    home: c[0], away: c[1], date: plainDate(c[2]), time: to24h(c[3]), place: c[4],
  }));
}
function scRows(csv: string): Row[] {
  return parseCsv(csv).slice(1).map((c) => ({
    home: c[2], away: c[3], date: plainDate(c[4]), time: c[5], place: c[7], field: c[8],
  }));
}
const key = (r: Row) => `${r.home} | ${r.away} | ${r.date} | ${r.time}`;
const has = (rows: Row[], team: string) => rows.some((r) => r.home === team || r.away === team);
const rowFor = (rows: Row[], team: string) => rows.find((r) => r.home === team || r.away === team);

// ── Frozen copy of the PRE-CHANGE generic CSV (export-picker-modal.tsx at
//    db59f63). Used for the differential and the "before" sample only. The old
//    fetch filtered `cancelled` in the query; mirrored here in memory. ────────
function legacyGenericCsv(games: ExportGame[], divisionName: string): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const d = (iso: string) => {
    const [y, m, day] = iso.substring(0, 10).split("-");
    return `${m}/${day}/${y}`;
  };
  const t = (iso: string) => {
    const [hs, ms] = iso.substring(11, 16).split(":");
    const h = parseInt(hs, 10);
    return `${(h % 12 || 12).toString().padStart(2, "0")}:${ms} ${h >= 12 ? "PM" : "AM"}`;
  };
  const header = ["Home Team", "Away Team", "Date", "Start Time", "Location/Field Name", "Division Name"]
    .map(esc).join(",");
  const rows = games
    .filter((x) => x.status !== "cancelled")
    .map((x) =>
      [x.home_team?.name ?? "", x.away_team?.name ?? "", d(x.scheduled_at), t(x.scheduled_at),
       x.venue?.name ?? "", divisionName].map(esc).join(","));
  return [header, ...rows].join("\r\n");
}

// ── Fake client for the shared fetch ─────────────────────────────────────────
type Fault = "none" | "teams" | "games" | "games_partial" | "reject";
function fakeSupabase(rows: ExportGame[], fault: Fault): SportsConnectFetchClient {
  return {
    from(table: string) {
      if (fault === "reject") throw new Error("network down");
      return {
        select() {
          if (table === "teams") {
            return {
              eq: async () =>
                fault === "teams"
                  ? { data: null, error: { message: "teams read failed" } }
                  : { data: [{ id: "t1" }], error: null },
            };
          }
          return {
            in() {
              return {
                order: async () => {
                  if (fault === "games") return { data: null, error: { message: "games read failed" } };
                  if (fault === "games_partial")
                    return { data: rows.slice(0, 2), error: { message: "games read failed midway" } };
                  return { data: rows, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SportsConnectFetchClient;
}

async function main() {
  let generic: Row[] = [];
  let sc: Row[] = [];
  let genericCsv = "";
  let scCsv = "";

  section("P", () => {
    genericCsv = buildGenericGamesCsv(FIXTURES, "QA-Minors").csv;
    const scRes = buildSportsConnectCsv(FIXTURES, 105, "QA-Minors");
    if (!scRes.ok) throw new Error("Sports Connect builder refused: " + scRes.error);
    scCsv = scRes.csv;
    generic = genericRows(genericCsv);
    sc = scRows(scCsv);

    assert(!has(generic, "QA Pending-A"), "P1", "generic: pending with no response is NOT exported");
    assert(!has(generic, "QA Pending-B"), "P2", "generic: pending with a counter-proposal is NOT exported");
    assert(!has(generic, "Riverside Golds"), "P3", "generic: the countering partner's name appears nowhere");
    assert(!has(sc, "QA Pending-A") && !has(sc, "QA Pending-B"), "P4", "Sports Connect: neither pending game is exported");
    if (!has(generic, "QA Pending-A")) count("pending_unanswered_excluded");
    if (!has(generic, "QA Pending-B")) count("pending_countered_excluded");
  });

  section("I", () => {
    const ih = rowFor(generic, "QA Lions");
    assert(ih?.home === "QA Lions" && ih?.away === "Riverside Reds", "I1",
      `generic: interleague home → partner in Away Team (got: ${ih ? key(ih) : "no row"})`);
    const ia1 = rowFor(generic, "QA Wolves");
    assert(ia1?.home === "Riverside Blues" && ia1?.away === "QA Wolves", "I2",
      `generic: interleague away → partner is Home, we are Away (got: ${ia1 ? key(ia1) : "no row"})`);
    assert(ia1?.place === "Riverside Field 1", "I3",
      `generic: interleague away → partner's field as location (got: "${ia1?.place}")`);
    const ia2 = rowFor(generic, "QA Foxes");
    assert(ia2?.home === "Riverside Greens" && ia2?.place === "", "I4",
      `generic: away, field unknown → blank location (got: "${ia2?.place}")`);
    const it = rowFor(generic, "QA Otters");
    assert(it?.home === "TBD" && it?.away === "QA Otters", "I5",
      `generic: away, partner unnamed → "TBD" as Home (got: ${it ? key(it) : "no row"})`);
    const st = rowFor(generic, "QA Stale");
    assert(st?.place === "", "I6",
      `generic: a HOME game never shows a counter-proposal field (got: "${st?.place}")`);
    const n2 = rowFor(generic, "QA Hawks");
    assert(n2?.place === "Field 2", "I7",
      `generic: a venue with a park keeps the bare venue name, as before (got: "${n2?.place}")`);
    const rp = rowFor(generic, "QA Resched");
    assert(rp?.away === "Riverside Silvers", "I8",
      `generic: reschedule_pending interleague game names the partner (got: "${rp?.away}")`);
    if (ih) count("interleague_home_row");
    if (ia1?.place) count("away_field_known");
    if (ia2 && ia2.place === "") count("away_field_unknown");
    if (it?.home === "TBD") count("tbd_partner");
  });

  section("EQ", () => {
    const a = generic.map(key).sort();
    const b = sc.map(key).sort();
    assert(JSON.stringify(a) === JSON.stringify(b), "EQ1",
      `generic and Sports Connect contain the same games, same sides, same times\n      generic only: ${JSON.stringify(a.filter((k) => !b.includes(k)))}\n      SC only:      ${JSON.stringify(b.filter((k) => !a.includes(k)))}`);
    assert(JSON.stringify(generic.map(key)) === JSON.stringify(sc.map(key)), "EQ2",
      "…and in the same order");
    const ids = normalizeExportGames(FIXTURES).map((r) => r.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify([...INCLUDED].sort()), "EQ3",
      `the shared selection is exactly the expected games (got: ${ids.join(",")})`);
    assert(generic.length === INCLUDED.length && sc.length === INCLUDED.length, "EQ4",
      `both files have ${INCLUDED.length} rows (generic ${generic.length}, SC ${sc.length})`);
    // Sports Connect splits park/field; the generic column is the venue
    // itself — its Field when there is a park, its Location otherwise.
    const places =
      generic.map((r) => r.place).join("|") === sc.map((r) => r.field || r.place).join("|");
    assert(places, "EQ5", "locations agree row by row (allowing the Sports Connect park/field split)");
    count("rows_compared", generic.length);
  });

  section("ST", () => {
    const team: Record<string, string> = {
      n1: "QA Tigers", ih: "QA Lions", ia1: "QA Wolves", rp: "QA Resched", c: "QA Done-Home",
      pp: "QA Postponed", ro: "QA Rained", x: "QA Cancelled", p1: "QA Pending-A", p2: "QA Pending-B",
    };
    const label: Record<string, string> = {
      n1: "scheduled", ih: "scheduled interleague home", ia1: "scheduled interleague away",
      rp: "reschedule_pending", c: "completed", pp: "postponed (any other status)",
      ro: "rained out (cancelled)", x: "cancelled", p1: "pending, no response", p2: "pending, countered",
    };
    for (const id of Object.keys(team)) {
      const want = INCLUDED.includes(id);
      if (!want && !EXCLUDED.includes(id)) throw new Error(`fixture ${id} is in neither list`);
      assert(has(generic, team[id]) === want && has(sc, team[id]) === want, `ST-${id}`,
        `${label[id]} → ${want ? "in" : "NOT in"} both files`);
      count(want ? "status_included" : "status_excluded");
    }
  });

  section("F", () => {
    const lines = genericCsv.split("\r\n");
    assert(lines[0] === '"Home Team","Away Team","Date","Start Time","Location/Field Name","Division Name"',
      "F1", "header names and quoting unchanged");
    assert(lines[1] === '"QA Tigers","QA Bears","10/03/2026","09:00 AM","QA-Memorial","QA-Minors"',
      "F2", `MM/DD/YYYY, 12-hour time, every value quoted (got: ${lines[1]})`);
    assert(lines[4] === '"Riverside Blues","QA Wolves","10/10/2026","03:30 PM","Riverside Field 1","QA-Minors"',
      "F3", `afternoon time + away row (got: ${lines[4]})`);
    assert(!genericCsv.endsWith("\r\n") && !genericCsv.replace(/\r\n/g, "").includes("\n"),
      "F4", "CRLF between lines, no trailing newline");
    const quoted = buildGenericGamesCsv(
      [g({ id: "q", scheduled_at: at("2026-10-03", "12:05"), home_team: { name: 'The "A" Team' }, away_team: { name: "Reds, The" } })],
      "QA-Minors").csv.split("\r\n")[1];
    assert(quoted === '"The ""A"" Team","Reds, The","10/03/2026","12:05 PM","QA-Memorial","QA-Minors"',
      "F5", `embedded quote doubled, comma kept inside quotes, noon is 12 PM (got: ${quoted})`);
    assert(!genericCsv.startsWith("﻿"), "F6", "the builder adds no BOM (the modal adds it at download)");
  });

  section("D", () => {
    const ordinary = FIXTURES.filter((x) => ["n1", "n2", "c", "pp", "x", "ro"].includes(x.id));
    const before = legacyGenericCsv(ordinary, "QA-Minors");
    const after = buildGenericGamesCsv(ordinary, "QA-Minors").csv;
    assert(before === after, "D1",
      "ordinary games: new generic CSV is byte-identical to the pre-change code");
    assert(before.split("\r\n").length === 5, "D2", "differential compared header + 4 rows (2 cancelled dropped by both)");
    const beforeAll = legacyGenericCsv(FIXTURES, "QA-Minors");
    assert(beforeAll !== genericCsv, "D3", "with interleague and pending games present, the output DID change");
    count("differential_rows", before.split("\r\n").length - 1);
    if (process.env.SHOW_SAMPLES) {
      console.log("\n--- BEFORE (pre-change code) ---\n" + beforeAll);
      console.log("\n--- AFTER (generic) ---\n" + genericCsv);
      console.log("\n--- Sports Connect, same fixtures ---\n" + scCsv);
    }
  });

  console.log("\n── E");
  try {
    const okRes = await exportGenericGamesCsv(fakeSupabase(FIXTURES, "none"), "d1", "QA-Minors");
    assert(okRes.ok && okRes.csv === genericCsv && okRes.rowCount === INCLUDED.length, "E0",
      "a clean read produces the same CSV as the builder");
    if (okRes.ok) count("clean_read_produced_file");
    const faults: [Fault, string, string][] = [
      ["teams", "E1", "teams read error"],
      ["games", "E2", "games read error"],
      ["games_partial", "E3", "games read error arriving WITH partial rows"],
      ["reject", "E4", "rejected request (throws)"],
    ];
    for (const [fault, tag, what] of faults) {
      const r = await exportGenericGamesCsv(fakeSupabase(FIXTURES, fault), "d1", "QA-Minors");
      assert(!r.ok && !("csv" in r) && r.error.length > 0, tag,
        `generic: ${what} → error, and NO csv to download`);
      const f = await fetchSportsConnectGames(fakeSupabase(FIXTURES, fault), "d1");
      assert(!f.ok && !("games" in f), `${tag}-sc`,
        `Sports Connect fetch: ${what} → error, no games handed to the builder`);
      if (!r.ok) count("read_error_refused");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`[CRASH-E] section threw: ${msg}`);
    console.error(`  FAIL: [CRASH-E] section threw: ${msg}`);
  }

  section("S", () => {
    const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
    const modal = read("src/components/divisions/export-picker-modal.tsx");
    const genericSrc = read("src/lib/schedule/generic-games-export.ts");
    const scSrc = read("src/lib/schedule/sports-connect-export.ts");
    const page = read("src/components/export/sportsconnect-exporter.tsx");
    assert(!modal.includes(".from("), "S1", "the modal reads no table itself");
    assert(modal.includes("exportGenericGamesCsv(") && !/csvEscape|fmtCsv/.test(modal), "S2",
      "the modal calls the shared generic export and formats no row itself");
    assert(/if \(!result\.ok\) \{\s*setExportError\([\s\S]*?\} else \{\s*triggerDownload\(result\.csv, `\$\{base\}-games-/.test(modal),
      "S3", "the modal downloads the generic file only in the success branch, and shows an error otherwise");
    assert(/triggerDownload\(\[?bom|bom = true/.test(modal) && modal.includes('bom ? "﻿" + csv : csv'), "S4",
      "the generic download still carries the BOM");
    for (const [name, src] of [["generic", genericSrc], ["Sports Connect", scSrc]] as const) {
      const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
      assert(code.includes("normalizeExportGames(") &&
        !/countsAsScheduledGame\(|\.external_team_name|\.is_away|\.status\b/.test(code),
        `S5-${name === "generic" ? "g" : "sc"}`,
        `${name} builder selects and resolves nothing itself — it calls normalizeExportGames`);
    }
    assert(/if \(!fetched\.ok\) \{[\s\S]*?return;/.test(page) && /if \(!fetched\.ok\) \{[\s\S]*?return;/.test(modal),
      "S6", "both Sports Connect surfaces stop before building when the read failed");
  });

  console.log("\n── counters");
  const required = [
    "pending_unanswered_excluded", "pending_countered_excluded", "interleague_home_row",
    "away_field_known", "away_field_unknown", "tbd_partner", "rows_compared",
    "status_included", "status_excluded", "differential_rows",
    "clean_read_produced_file", "read_error_refused",
  ];
  for (const c of required) {
    const n = counters[c] ?? 0;
    assert(n > 0, `V-${c}`, `counter ${c} = ${n}`);
  }
}

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`[CRASH-main] ${msg}`);
    console.error(`  FAIL: [CRASH-main] ${msg}`);
  })
  .finally(() => {
    if (failures.length) {
      console.error(`\n${failures.length} FAILURE(S):`);
      for (const f of failures) console.error(`  - ${f.split("\n")[0]}`);
      process.exit(1);
    }
    console.log("\nAll checks passed.");
  });

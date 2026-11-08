// Harness for the snack shack's printed documents:
//   - the FULL-SCHEDULE print region (src/components/snack-shack/snack-shack-print-region.tsx)
//   - the PRINT-ALL TEAM SCHEDULES document (teamSchedulesDocument, src/lib/snack-shack/print.ts)
//
// WHY THIS EXISTS: the cash person is about to appear on the full-schedule
// print (decided 2026-11-07) and the volunteer build will later need a "print
// unchanged" proof. Both prints were lifted verbatim out of
// snack-shack-page-client.tsx, and their output for fixed fixtures was
// captured in scripts/sim/fixtures/snack-print/ from that extraction commit —
// checked byte-identical to the inline originals before recording.
//
// RECORD=1 rewrites the goldens. Legitimate ONLY on the capture commit. If a
// golden fails later, the print changed — fix the print, do not re-record
// without Whit's decision.
//
// CASH COLUMN (2026-11-07): the full-schedule print gains a "Cash / questions"
// column (blank when a shift has none). G1 compares the print with that
// column taken out against the PRE-CHANGE golden, so it proves the column is
// the only thing that moved; C0–C2 pin the column itself. The print-all
// document (G3) and the empty print (G2) stay byte-identical.
//
// HEADCOUNT (0119, 2026-11-07): the full-schedule print shows "N people" after
// the time ONLY when the shift's effective count (its own, else the season's)
// is above 1. H1 pins the rule in headcount.ts, H2/H3 the print, H4 fences
// the team prints and both emails. G1 also takes the headcount out before
// comparing, so the golden still proves nothing else moved.
//
// FIXTURES: a long team name, an 80-character cash name (the limit), a day with
// four shifts, an unassigned shift, a manual shift, a shift carrying a NOTE
// (which must never print), HTML-special characters, and an empty season.

import * as React from "react";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;

if (process.env.TZ !== "UTC") {
  console.error("Run with TZ=UTC (npm run sim:snack-print).");
  process.exit(2);
}

const DIR = join(__dirname, "fixtures", "snack-print");
const RECORD = process.env.RECORD === "1";
const failures: string[] = [];
let checks = 0;
function ok(cond: boolean, tag: string, msg: string, detail?: string) {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${msg}${detail ? `\n      ${detail}` : ""}`);
}

const NOTE = "Float is in the office safe";
const CASH_LONG = "Alexandria Montgomery-Fitzgerald of the Concessions Committee (Treasurer) Three!"; // 80 chars = CASH_NAME_MAX_CHARS (checked in F0)
const TEAM_LONG = "RVLL Royals — Minors Division Blue";

export type Fixture = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  team_name: string | null;
  assigned_team_id: string | null;
  is_recurring: boolean;
  notes: string | null;
  cash_person_id: string | null;
  cash_person: { name: string } | null;
  people_needed: number | null;
};

export const FIXTURE_BLOCKS: Fixture[] = [
  { id: "b1", date: "2026-10-03", start_time: "08:30:00", end_time: "10:30:00", team_name: "Expos", assigned_team_id: "t-expos", is_recurring: true, notes: null, cash_person_id: "c-pat", cash_person: { name: "Pat Lee" }, people_needed: 3 },
  { id: "b2", date: "2026-10-03", start_time: "10:30:00", end_time: "12:30:00", team_name: TEAM_LONG, assigned_team_id: "t-royals", is_recurring: true, notes: NOTE, cash_person_id: "c-long", cash_person: { name: CASH_LONG }, people_needed: null },
  { id: "b3", date: "2026-10-03", start_time: "12:30:00", end_time: "14:30:00", team_name: null, assigned_team_id: null, is_recurring: true, notes: null, cash_person_id: null, cash_person: null, people_needed: null },
  { id: "b4", date: "2026-10-03", start_time: "14:30:00", end_time: "16:15:00", team_name: "Mets & <Friends>", assigned_team_id: "t-mets", is_recurring: true, notes: NOTE, cash_person_id: null, cash_person: null, people_needed: null },
  { id: "b5", date: "2026-10-10", start_time: "09:00:00", end_time: "11:00:00", team_name: "Expos", assigned_team_id: "t-expos", is_recurring: false, notes: null, cash_person_id: "c-pat", cash_person: { name: "Pat Lee" }, people_needed: null },
  { id: "b6", date: "2026-10-17", start_time: "17:30:00", end_time: "00:00:00", team_name: TEAM_LONG, assigned_team_id: "t-royals", is_recurring: true, notes: null, cash_person_id: null, cash_person: null, people_needed: null },
];
const SEASON = "Test League · Fall 2026";

function golden(name: string, actual: string, tag: string) {
  const path = join(DIR, name);
  if (RECORD) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  ok(existsSync(path), tag, `golden ${name} exists`);
  if (!existsSync(path)) return;
  const want = readFileSync(path, "utf8");
  ok(actual === want, tag, `${name} is byte-identical to its golden`, actual === want ? undefined : firstDiff(want, actual));
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `first difference at ${i}: golden …${JSON.stringify(a.slice(Math.max(0, i - 40), i + 60))} vs now …${JSON.stringify(b.slice(Math.max(0, i - 40), i + 60))}`;
}

async function main() {
  const { SnackShackPrintRegion } = await import("@/components/snack-shack/snack-shack-print-region");
  const { teamSchedulesDocument } = await import("@/lib/snack-shack/print");

  const { CASH_NAME_MAX_CHARS } = await import("@/lib/snack-shack/shift-notes");
  ok(CASH_LONG.length === CASH_NAME_MAX_CHARS, "F0", `the long cash name fixture is exactly the ${CASH_NAME_MAX_CHARS}-character limit`, String(CASH_LONG.length));

  // ── G: goldens ──────────────────────────────────────────────────────────
  const full = renderToStaticMarkup(<SnackShackPrintRegion seasonLabel={SEASON} blocks={FIXTURE_BLOCKS} peoplePerShift={1} />);
  const empty = renderToStaticMarkup(<SnackShackPrintRegion seasonLabel={SEASON} blocks={[]} />);
  // ── C: the cash column (2026-11-07) — header "Cash / questions", the cash
  // person's name, a BLANK cell when there is none. Checked first so a wrong
  // cell dies here, before the golden comparison.
  const rows = [...full.matchAll(/<tr><td>[^]*?<\/tr>/g)].map((m) => m[0]);
  const lastCell = (r: string) => (r.match(/<td>([^<]*)<\/td><\/tr>$/) ?? [])[1];
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  ok(full.includes("<th>Assigned Team</th><th>Cash / questions</th></tr>"), "C0", "the full print has a \"Cash / questions\" column after Assigned Team");
  ok(rows.length === FIXTURE_BLOCKS.length, "C0", "one row per shift", String(rows.length));
  ok(FIXTURE_BLOCKS.every((b, i) => !b.cash_person || lastCell(rows[i] ?? "") === esc(b.cash_person.name)), "C1", "a shift with a cash person prints that name, whole, in the cash column",
    rows.map(lastCell).join(" | "));
  ok(FIXTURE_BLOCKS.every((b, i) => b.cash_person || lastCell(rows[i] ?? "") === ""), "C2", "a shift with no cash person prints a blank cell", rows.map(lastCell).join(" | "));

  // ── H: the headcount (0119) ─────────────────────────────────────────────
  const hc = await import("@/lib/snack-shack/headcount");
  ok(hc.effectivePeople({ people_needed: 3 }, 1) === 3 && hc.effectivePeople({ people_needed: null }, 4) === 4
     && hc.effectivePeople({ people_needed: 1 }, 4) === 1 && hc.effectivePeople({}, 0) === 1,
     "H1", "effective count = the shift's own number, else the season's (an unusable season number reads as 1)");
  ok(hc.headcountPrintLine({ people_needed: null }, 1) === "" && hc.headcountPrintLine({ people_needed: 2 }, 1) === "2 people"
     && hc.headcountPrintLine({ people_needed: 1 }, 5) === "" && hc.peopleLabel(1) === "1 person",
     "H1", "the print line is \"N people\" only above 1");
  const mig = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "0119_snack_shack_headcount.sql"), "utf8");
  ok(hc.PEOPLE_MIN === 1 && hc.PEOPLE_MAX === 20 && (mig.match(/between 1 and 20/g) ?? []).length === 2
     && hc.PEOPLE_OPTIONS.length === 20 && hc.PEOPLE_OPTIONS[0] === 1 && hc.PEOPLE_OPTIONS[19] === 20,
     "H1", "the 1–20 bounds match 0119's two CHECKs");
  const timeCell = (r: string) => (r.match(/^<tr><td>[^<]*<\/td><td>(.*?)<\/td>/) ?? [])[1] ?? "";
  ok(timeCell(rows[0] ?? "").endsWith(" · 3 people") && rows.slice(1).every((r) => !/people|person/.test(r)),
     "H2", "season at 1: only the shift needing 3 shows \"3 people\", after its time", rows.map(timeCell).join(" | "));
  const two = FIXTURE_BLOCKS.map((b) => (b.id === "b3" ? { ...b, people_needed: 1 } : b));
  const full2 = renderToStaticMarkup(<SnackShackPrintRegion seasonLabel={SEASON} blocks={two} peoplePerShift={2} />);
  const rows2 = [...full2.matchAll(/<tr><td>[^]*?<\/tr>/g)].map((m) => m[0]);
  ok(two.every((b, i) => {
       const t = timeCell(rows2[i] ?? "");
       return b.id === "b1" ? t.endsWith(" · 3 people") : b.id === "b3" ? !/people|person/.test(t) : t.endsWith(" · 2 people");
     }),
     "H3", "season at 2: every shift shows \"2 people\" except its own 3, and one set to 1 shows nothing", rows2.map(timeCell).join(" | "));
  const src = (...p: string[]) => readFileSync(join(__dirname, "..", "..", "src", ...p), "utf8");
  const outbound: [string, string][] = [
    ["full-schedule email route", src("app", "api", "snack-shack", "[id]", "email", "route.ts")],
    ["team email route", src("app", "api", "snack-shack", "team", "[teamId]", "email", "route.ts")],
    ["teams page snack shack button", src("components", "teams", "team-snack-shack-button.tsx")],
    ["print-all team document", src("lib", "snack-shack", "print.ts")],
  ];
  for (const [name, text] of outbound) {
    ok(!/people_needed|people_per_shift|headcount|peoplePerShift/.test(text), "H4", `${name} never shows a headcount`);
  }

  // G1 — ONLY the intended changes: take the cash header, each row's last
  // cell and the headcount out, and what remains is the golden recorded
  // before the change.
  const withoutCash = full.replace("<th>Cash / questions</th>", "").replace(/<td>[^<]*<\/td><\/tr>/g, "</tr>").replace(/ · \d+ people/g, "");
  golden("full-schedule.html", withoutCash, "G1");
  golden("full-schedule-empty.html", empty, "G2");

  const teams = ["t-expos", "t-royals", "t-mets"].map((id) => {
    const bl = FIXTURE_BLOCKS.filter((b) => b.assigned_team_id === id);
    return { id, name: bl[0].team_name as string, blocks: bl.map((b) => ({ date: b.date, start_time: b.start_time, end_time: b.end_time })) };
  });
  const doc = teamSchedulesDocument(teams, SEASON);
  golden("team-schedules.html", doc, "G3");

  // ── N: a note never prints ──────────────────────────────────────────────
  ok(!full.includes(NOTE) && !doc.includes(NOTE), "N1", "no shift note appears on either print");

  // ── R: the page's shift read is complete-or-throw (source wiring — weak by
  // nature, stated). The full print and its "N shifts" header are built from
  // this read, so a short list must never reach the page.
  const page = readFileSync(join(__dirname, "..", "..", "src", "app", "(dashboard)", "dashboard", "snack-shack", "page.tsx"), "utf8");
  const blocksAt = page.indexOf('.from("snack_shack_blocks")');
  const readSlice = blocksAt > 0 ? page.slice(Math.max(0, blocksAt - 200), page.indexOf(".range(from, to)", blocksAt) + 20) : "";
  ok(readSlice.includes('fetchAllRows<') && readSlice.includes('exactCount ? { count: "exact" } : undefined') && readSlice.includes('.order("id"') && !readSlice.includes(".limit("),
    "R1", "the page's shift read goes through fetchAllRows with an exact count and an id tiebreak, and no .limit");
  ok(/if \(cashRes\.error\) throw /.test(page), "R2", "a failed cash-people read fails the page's read");
  const errAt = page.indexOf("if (readError) {");
  const clientAt = page.indexOf("<SnackShackPageClient");
  ok(errAt > 0 && clientAt > errAt && page.startsWith("if (readError) {\n    return (", errAt) && page.slice(errAt, clientAt).includes("Couldn&apos;t load the snack shack shifts."), "R3", "a failed read returns the error card before the page client (and its print) can render");

  if (RECORD) {
    console.log(`RECORDED goldens in ${DIR}`);
    return;
  }
  report();
}

function report() {
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(`\nsim:snack-print — ${failures.length} FAILED of ${checks} checks`);
    process.exit(1);
  }
  console.log(`sim:snack-print — all ${checks} checks passed`);
}

main().catch((e) => {
  if (failures.length) console.log(failures.join("\n"));
  console.error(e);
  process.exit(1);
});

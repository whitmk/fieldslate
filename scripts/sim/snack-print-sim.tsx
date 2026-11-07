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
};

export const FIXTURE_BLOCKS: Fixture[] = [
  { id: "b1", date: "2026-10-03", start_time: "08:30:00", end_time: "10:30:00", team_name: "Expos", assigned_team_id: "t-expos", is_recurring: true, notes: null, cash_person_id: "c-pat", cash_person: { name: "Pat Lee" } },
  { id: "b2", date: "2026-10-03", start_time: "10:30:00", end_time: "12:30:00", team_name: TEAM_LONG, assigned_team_id: "t-royals", is_recurring: true, notes: NOTE, cash_person_id: "c-long", cash_person: { name: CASH_LONG } },
  { id: "b3", date: "2026-10-03", start_time: "12:30:00", end_time: "14:30:00", team_name: null, assigned_team_id: null, is_recurring: true, notes: null, cash_person_id: null, cash_person: null },
  { id: "b4", date: "2026-10-03", start_time: "14:30:00", end_time: "16:15:00", team_name: "Mets & <Friends>", assigned_team_id: "t-mets", is_recurring: true, notes: NOTE, cash_person_id: null, cash_person: null },
  { id: "b5", date: "2026-10-10", start_time: "09:00:00", end_time: "11:00:00", team_name: "Expos", assigned_team_id: "t-expos", is_recurring: false, notes: null, cash_person_id: "c-pat", cash_person: { name: "Pat Lee" } },
  { id: "b6", date: "2026-10-17", start_time: "17:30:00", end_time: "00:00:00", team_name: TEAM_LONG, assigned_team_id: "t-royals", is_recurring: true, notes: null, cash_person_id: null, cash_person: null },
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
  const full = renderToStaticMarkup(<SnackShackPrintRegion seasonLabel={SEASON} blocks={FIXTURE_BLOCKS} />);
  const empty = renderToStaticMarkup(<SnackShackPrintRegion seasonLabel={SEASON} blocks={[]} />);
  golden("full-schedule.html", full, "G1");
  golden("full-schedule-empty.html", empty, "G2");

  const teams = ["t-expos", "t-royals", "t-mets"].map((id) => {
    const bl = FIXTURE_BLOCKS.filter((b) => b.assigned_team_id === id);
    return { id, name: bl[0].team_name as string, blocks: bl.map((b) => ({ date: b.date, start_time: b.start_time, end_time: b.end_time })) };
  });
  const doc = teamSchedulesDocument(teams, SEASON);
  golden("team-schedules.html", doc, "G3");

  // ── N: a note never prints ──────────────────────────────────────────────
  ok(!full.includes(NOTE) && !doc.includes(NOTE), "N1", "no shift note appears on either print");

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

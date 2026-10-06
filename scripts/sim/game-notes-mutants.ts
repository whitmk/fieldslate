// Mutation pass for the OUTBOUND part of game-notes-sim.ts (0104 additions —
// the snack shack paths). Applied to the REAL source, restored byte-for-byte,
// killed only if the FIRST failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const PAGE = "src/components/snack-shack/snack-shack-page-client.tsx";
const TEAM_ROUTE = "src/app/api/snack-shack/team/[teamId]/email/route.ts";
const SERVER_PAGE = "src/app/(dashboard)/dashboard/snack-shack/page.tsx";

const MUTANTS: Mutant[] = [
  {
    id: "GM8", what: "the full-schedule print region renders the note", file: PAGE,
    find: "                  <td>{b.team_name ?? \"—\"}</td>",
    replace: "                  <td>{b.team_name ?? \"—\"} {b.notes}</td>",
    expect: "O1-snack-print",
  },
  {
    id: "GM9", what: "the team email route selects notes", file: TEAM_ROUTE,
    find: "      \"date, start_time, end_time, snack_shack_settings(leagues(name, season))\",",
    replace: "      \"date, start_time, end_time, notes, snack_shack_settings(leagues(name, season))\",",
    expect: "O1-snack",
  },
  {
    id: "GM10", what: "the print-all template renders the cash person", file: PAGE,
    find: "              `<tr><td>${esc(fmtDate(b.date))}</td><td>${esc(fmtTime(b.start_time))} – ${esc(fmtTime(b.end_time))}</td></tr>`,",
    replace: "              `<tr><td>${esc(fmtDate(b.date))}</td><td>${esc(fmtTime(b.start_time))} – ${esc(fmtTime(b.end_time))}</td><td>${esc(b.cash_person?.name ?? \"\")}</td></tr>`,",
    expect: "O1-snack-print-all",
  },
  {
    id: "GM11", what: "the Snack Shack page select drops the internal fields", file: SERVER_PAGE,
    find: ", team:teams(name), ${SHIFT_NOTE_SELECT_FIELDS}`)",
    replace: ", team:teams(name)`)",
    expect: "O3-snack",
  },
];

runMutants({ sim: "scripts/sim/game-notes-sim.ts", timezones: ["UTC"], mutants: MUTANTS });

// Mutation pass for the OUTBOUND part of game-notes-sim.ts (0104 additions —
// the snack shack paths). Applied to the REAL source, restored byte-for-byte,
// killed only if the FIRST failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const TEAM_ROUTE = "src/app/api/snack-shack/team/[teamId]/email/route.ts";
const SERVER_PAGE = "src/app/(dashboard)/dashboard/snack-shack/page.tsx";
const FULL_ROUTE = "src/app/api/snack-shack/[id]/email/route.ts";
const REGION = "src/components/snack-shack/snack-shack-print-region.tsx";
const PRINT_LIB = "src/lib/snack-shack/print.ts";

const MUTANTS: Mutant[] = [
  {
    id: "GM8", what: "the full-schedule print region renders the note", file: REGION,
    find: "                    <td>{teamWithPeople(b.team_name, people)}</td>",
    replace: "                    <td>{teamWithPeople(b.team_name, people)} {b.notes}</td>",
    expect: "O1-snack-print",
  },
  {
    id: "GM9", what: "the team email route selects notes", file: TEAM_ROUTE,
    find: "      \"date, start_time, end_time, snack_shack_settings(leagues(name, season))\",",
    replace: "      \"date, start_time, end_time, notes, snack_shack_settings(leagues(name, season))\",",
    expect: "O1-snack",
  },
  {
    id: "GM10", what: "the print-all document renders the cash person", file: PRINT_LIB,
    find: "            `<tr><td>${esc(fmtPrintDate(b.date))}</td><td>${esc(fmtPrintTime(b.start_time))} – ${esc(fmtPrintTime(b.end_time))}</td></tr>`,",
    replace: "            `<tr><td>${esc(fmtPrintDate(b.date))}</td><td>${esc(fmtPrintTime(b.start_time))} – ${esc(fmtPrintTime(b.end_time))}</td><td>${esc((b as { cash_person?: { name: string } }).cash_person?.name ?? \"\")}</td></tr>`,",
    expect: "O1-snack-print-all",
  },
  {
    id: "GM11", what: "the Snack Shack page select drops the internal fields", file: SERVER_PAGE,
    find: ", team:teams(name), ${SHIFT_NOTE_SELECT_FIELDS}`, exactCount",
    replace: ", team:teams(name)`, exactCount",
    expect: "O3-snack",
  },
  {
    id: "GM12", what: "(0105) the public schedule card renders the game's note",
    file: "src/components/public-schedule/public-schedule-client.tsx",
    find: "      <div className={`mt-1 font-semibold ${row.struck ? \"line-through\" : \"text-gray-900\"}`}>{row.matchup}</div>",
    replace: "      <div className={`mt-1 font-semibold ${row.struck ? \"line-through\" : \"text-gray-900\"}`}>{row.matchup} {(row as { notes?: string }).notes}</div>",
    expect: "O1-public",
  },
  {
    // Must target the LATEST migration defining the reader — O1-public-reader
    // reads only that one (moved from 0105 to 0114, 2026-10-20).
    id: "GM13", what: "(0114) the public reader emits the game's note",
    file: "supabase/migrations/0114_playoff_series.sql",
    find: "                     'status',              g.status,",
    replace: "                     'status',              g.status, 'notes', g.notes,",
    expect: "O1-public-reader",
  },
  {
    id: "GM14", what: "(0114) the public reader emits a playoff score beside the if_needed flag",
    file: "supabase/migrations/0114_playoff_series.sql",
    find: "                     'if_needed',      public.playoff_if_needed(",
    replace: "                     'home_score', pg.home_score,\n                     'if_needed',      public.playoff_if_needed(",
    expect: "O1-public-reader",
  },
  {
    // 0116 — the public BRACKET reader: scores only behind public_scores.
    id: "GM15", what: "(0116) the bracket reader sends a score whatever the setting",
    file: "supabase/migrations/0116_public_bracket.sql",
    find: "'home_score',     case when po.public_scores then pg.home_score else null end,",
    replace: "'home_score',     pg.home_score,",
    expect: "O1-bracket-reader",
  },
  {
    id: "GM16", what: "(0116) the bracket reader emits the seeding list",
    file: "supabase/migrations/0116_public_bracket.sql",
    find: "           'show_scores',   po.public_scores,",
    replace: "           'show_scores',   po.public_scores,\n           'seeding',       po.seeding,",
    expect: "O1-bracket-reader",
  },
  {
    id: "GM17", what: "(2026-11-07) the full-schedule email selects the cash person", file: FULL_ROUTE,
    find: "    .select(\"date, start_time, end_time, team:teams(name)\")",
    replace: "    .select(\"date, start_time, end_time, team:teams(name), cash_person:snack_shack_cash_people(name)\")",
    expect: "O1-snack-cash-full",
  },
  {
    id: "GM18", what: "(2026-11-07) the team email selects the cash person", file: TEAM_ROUTE,
    find: "      \"date, start_time, end_time, snack_shack_settings(leagues(name, season))\",",
    replace: "      \"date, start_time, end_time, cash_person_id, snack_shack_settings(leagues(name, season))\",",
    expect: "O1-snack-cash-team",
  },
  {
    id: "GM19", what: "(2026-11-07) the full print renders the cash name directly, not through cashPrintLine", file: REGION,
    find: "                  <td>{cashPrintLine(b)}</td>",
    replace: "                  <td>{b.cash_person?.name ?? \"\"}</td>",
    expect: "O1-snack-print",
  },
  {
    id: "GM20", what: "(2026-11-07) cashPrintLine also returns the shift's note", file: PRINT_LIB,
    find: "  return b.cash_person?.name?.trim() ?? \"\";",
    replace: "  return `${b.cash_person?.name?.trim() ?? \"\"} ${(b as { notes?: string }).notes ?? \"\"}`.trim();",
    expect: "O1-snack-print-cash-helper",
  },
  {
    id: "GM21", what: "(2026-11-07) the full print drops the cash column's value", file: REGION,
    find: "                  <td>{cashPrintLine(b)}</td>",
    replace: "                  <td></td>",
    expect: "O1-snack-print-cash",
  },
];

runMutants({ sim: "scripts/sim/game-notes-sim.ts", timezones: ["UTC"], mutants: MUTANTS });

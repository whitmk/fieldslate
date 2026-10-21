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
];

runMutants({ sim: "scripts/sim/game-notes-sim.ts", timezones: ["UTC"], mutants: MUTANTS });

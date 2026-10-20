// Mutation pass for public-schedule-sim.ts. Each mutant is applied to the REAL
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
//
// The SQL-side mutants (unlocked division shown, pending interleague shown,
// the note emitted, any park counted home, a new token on re-enable) live in
// scripts/sim/public-schedule-sim.sql; the page-file note leak is GM12 in
// game-notes-mutants.ts.
import { runMutants, type Mutant } from "./mutant-runner";

const CLASSIFY = "src/lib/public-schedule/classify.ts";
const VIEW = "src/lib/public-schedule/view.ts";
const LINKS = "src/lib/public-schedule/links.ts";
const ICS = "src/lib/public-schedule/league-ics.ts";

const MUTANTS: Mutant[] = [
  {
    id: "PM1", what: "Home misclassified: any park counts as a home park", file: CLASSIFY,
    find: `if (venue) return venue.home_park === true ? "home" : "away";`,
    replace: `if (venue) return venue.location ? "home" : "away";`,
    expect: "H2",
  },
  {
    id: "PM2", what: "pending interleague games become rows", file: VIEW,
    find: `    if (g.status === "pending_interleague") continue;`,
    replace: `    if (g.status === "never-a-status") continue;`,
    expect: "R-pending",
  },
  {
    id: "PM3", what: "the error path is edge-cached like an answer", file: LINKS,
    find: `    return { status: 503, headers: { ...base, "Cache-Control": CACHE_NEVER, "Retry-After": "60" } };`,
    replace: `    return { status: 503, headers: { ...base, "Cache-Control": CACHE_READER_ANSWER, "Retry-After": "60" } };`,
    expect: "C1",
  },
  {
    id: "PM4", what: "feed titles are not host-first", file: ICS,
    find: "return g.interleague && g.is_away === true ? `${partner} vs ${ours}` : `${ours} vs ${partner}`;",
    replace: "return `${ours} vs ${partner}`;",
    expect: "I1",
  },
  {
    id: "PM5", what: "a filtered print does not say it is filtered", file: VIEW,
    find: "  if (divisionName) return `${divisionName} only`;",
    replace: "  if (divisionName) return \"All divisions\";",
    expect: "F2",
  },
  {
    id: "PM6", what: "open playoff slot names the wrong feeder", file: VIEW,
    // Re-keyed 2026-10-19: the positional arithmetic this used to flip was
    // removed in 5b5b418 (the page now calls the shared emptySlotLabel), which
    // left PM6 stale from 2026-10-13. The page's own remaining step is mapping
    // its side onto the shared rule, so that is what flips now.
    find: `  return emptySlotLabel(asRow(game), side, bracket.map(asRow), game.format);`,
    replace: `  return emptySlotLabel(asRow(game), side === "home" ? "away" : "home", bracket.map(asRow), game.format);`,
    expect: "P1",
  },
  {
    id: "PM7", what: "card lines out of order (division line before the address)", file: VIEW,
    find: "  const lines = [row.fieldLabel];\n  if (row.address) lines.push(row.address);\n  const tail = [row.divisionName, row.endTime ? `until ${fmtTime(row.endTime)}` : \"\"].filter(Boolean).join(\" · \");\n  if (tail) lines.push(tail);",
    replace: "  const lines = [row.fieldLabel];\n  const tail = [row.divisionName, row.endTime ? `until ${fmtTime(row.endTime)}` : \"\"].filter(Boolean).join(\" · \");\n  if (tail) lines.push(tail);\n  if (row.address) lines.push(row.address);",
    expect: "K1",
  },
];

runMutants({
  sim: "scripts/sim/public-schedule-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});
// 2026-10-19 — PM6 had been STALE since 2026-10-13 (5b5b418 removed its target
// text) and the pass reported "1 PROBLEM" on main for six days. Re-keyed to the
// page's mapping of its side onto emptySlotLabel; run: 7/7 KILLED at their own
// assertion (PM6 → [P1]), source restored, green after.

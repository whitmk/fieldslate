// Mutation pass for sim:snack-print. Applied to the REAL source, restored
// byte-for-byte, killed only if the FIRST failing assertion is the one
// written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const SERVER_PAGE = "src/app/(dashboard)/dashboard/snack-shack/page.tsx";
const PRINT_LIB = "src/lib/snack-shack/print.ts";
const REGION = "src/components/snack-shack/snack-shack-print-region.tsx";
const HEADCOUNT = "src/lib/snack-shack/headcount.ts";
const FULL_ROUTE = "src/app/api/snack-shack/[id]/email/route.ts";

const MUTANTS: Mutant[] = [
  {
    id: "SP1", what: "the shift read loses its id tiebreak", file: SERVER_PAGE,
    find: "            .order(\"id\", { ascending: true })\n",
    replace: "",
    expect: "R1",
  },
  {
    id: "SP2", what: "a failed cash-people read is ignored", file: SERVER_PAGE,
    find: "      if (cashRes.error) throw new Error(`Could not read the cash people: ${cashRes.error.message}`);\n",
    replace: "",
    expect: "R2",
  },
  {
    id: "SP3", what: "a failed read still renders the page client", file: SERVER_PAGE,
    find: "  if (readError) {\n    return (",
    replace: "  if (readError) {\n    void (",
    expect: "R3",
  },
  {
    id: "SP4", what: "a shift with no cash person prints a dash, not a blank cell", file: PRINT_LIB,
    find: "  return b.cash_person?.name?.trim() ?? \"\";\n",
    replace: "  return b.cash_person?.name?.trim() ?? \"—\";\n",
    expect: "C2",
  },
  {
    id: "SP5", what: "a long cash name is cut to 40 characters", file: PRINT_LIB,
    find: "  return b.cash_person?.name?.trim() ?? \"\";\n",
    replace: "  return b.cash_person?.name?.trim().slice(0, 40) ?? \"\";\n",
    expect: "C1",
  },
  {
    id: "SP6", what: "the cash column change also rewords an unassigned shift", file: REGION,
    find: "                  <td>{b.team_name ?? \"—\"}</td>\n",
    replace: "                  <td>{b.team_name ?? \"Unassigned\"}</td>\n",
    expect: "G1",
  },
  {
    id: "SP7", what: "the print-all team document gains a cash column", file: PRINT_LIB,
    find: "  <table><thead><tr><th>Date</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>",
    replace: "  <table><thead><tr><th>Date</th><th>Time</th><th>Cash / questions</th></tr></thead><tbody>${rows}</tbody></table>",
    expect: "G3",
  },
  // 0119 — the headcount.
  {
    id: "SP8", what: "a count of 1 is printed (\"1 person\" on every shift)", file: HEADCOUNT,
    find: "  return n > 1 ? peopleLabel(n) : \"\";\n",
    replace: "  return n >= 1 ? peopleLabel(n) : \"\";\n",
    expect: "H1",
  },
  {
    id: "SP9", what: "a shift's own number is ignored (the season's always wins)", file: HEADCOUNT,
    find: "  return own != null && isValidPeople(Number(own)) ? Number(own) : seasonPeople(seasonDefault);\n",
    replace: "  return seasonPeople(seasonDefault);\n",
    expect: "H1",
  },
  {
    id: "SP10", what: "the print region adds the headcount whether or not it is above 1", file: REGION,
    find: "                      {people ? ` · ${people}` : null}\n",
    replace: "                      {` · ${people || \"1 person\"}`}\n",
    expect: "H2",
  },
  {
    id: "SP11", what: "the full-schedule email selects the headcount", file: FULL_ROUTE,
    find: " .select(\"date, start_time, end_time, team:teams(name)\")",
    replace: " .select(\"date, start_time, end_time, people_needed, team:teams(name)\")",
    expect: "H4",
  },
];

runMutants({ sim: "scripts/sim/snack-print-sim.tsx", timezones: ["UTC"], mutants: MUTANTS });

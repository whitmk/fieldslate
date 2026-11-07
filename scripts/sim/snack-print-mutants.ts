// Mutation pass for sim:snack-print. Applied to the REAL source, restored
// byte-for-byte, killed only if the FIRST failing assertion is the one
// written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const SERVER_PAGE = "src/app/(dashboard)/dashboard/snack-shack/page.tsx";

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
];

runMutants({ sim: "scripts/sim/snack-print-sim.tsx", timezones: ["UTC"], mutants: MUTANTS });

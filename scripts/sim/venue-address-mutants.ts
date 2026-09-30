// Mutation pass for venue-address-sim.ts — see mutant-runner.ts for the rules.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/venues/address.ts";
const EDITOR = "src/components/venues/venue-edit-form.tsx";

const MUTANTS: Mutant[] = [
  {
    id: "VM1", what: "trimming removed", file: LIB,
    find: '.replace(/\\s+/g, " ").trim();',
    replace: '.replace(/\\s+/g, " ");',
    expect: "N1",
  },
  {
    id: "VM2", what: 'blank saved as "" instead of null', file: LIB,
    find: "return v.length === 0 ? null : v;",
    replace: "return v;",
    expect: "N3",
  },
  {
    id: "VM3", what: "park fallback removed", file: LIB,
    find: "return normalizeAddress(venue.address) ?? normalizeAddress(location?.address) ?? null;",
    replace: "return normalizeAddress(venue.address) ?? null;",
    expect: "E2",
  },
  {
    id: "VM4", what: "the shared editor's payload drops address", file: EDITOR,
    find: "        address: normalizeAddress(address),\n",
    replace: "",
    expect: "S1",
  },
];

runMutants({ sim: "scripts/sim/venue-address-sim.ts", mutants: MUTANTS });

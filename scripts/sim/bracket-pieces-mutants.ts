// Mutation pass for bracket-pieces-sim.ts. Each mutant is applied to the REAL
// source, the sim runs, the source is restored and verified byte-for-byte,
// and the mutant counts as killed only if the FIRST failing assertion is the
// one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const PIECES = "src/components/playoffs/bracket-pieces.tsx";
const SERIES = "src/components/playoffs/series-card.tsx";

const MUTANTS: Mutant[] = [
  {
    id: "BPC1", what: "the admin card's wording changes", file: PIECES,
    find: "const UNDATED_ADMIN = \"No date yet\";",
    replace: "const UNDATED_ADMIN = \"Date not set\";",
    expect: "G",
  },
  {
    id: "BPC2", what: "a card without callbacks still gets its action row", file: PIECES,
    find: "        {onEnterResult && onEdit && (",
    replace: "        {(",
    expect: "P",
  },
  {
    id: "BPC3", what: "a list row without callbacks still offers Move", file: PIECES,
    find: "      {onEdit && showMove && (",
    replace: "      {showMove && (",
    expect: "P",
  },
  {
    id: "BPC4", what: "a series card without callbacks still gets its action row", file: SERIES,
    find: "        {onResult && onEditResult && onMove && (",
    replace: "        {(",
    expect: "P",
  },
  {
    id: "BPC5", what: "the pieces import the daylight pieces", file: PIECES,
    find: 'import type { ReactNode } from "react";',
    replace: 'import type { ReactNode } from "react";\nimport { DaylightChip as _D } from "@/components/daylight/daylight-pieces";\nvoid _D;',
    expect: "F",
  },
  {
    id: "BPC6", what: "the series card reads data", file: SERIES,
    find: 'import type { ReactNode } from "react";',
    replace: 'import type { ReactNode } from "react";\nimport { createClient as _c } from "@/lib/supabase/client";\nvoid _c;',
    expect: "F",
  },
  {
    id: "BPC7", what: "the list row drops the admin's chip", file: PIECES,
    find: "        {chip && (\n          <div className=\"mt-1\">",
    replace: "        {false && chip && (\n          <div className=\"mt-1\">",
    expect: "G",
  },
  {
    id: "BPC8", what: "a series group's height ignores a flagged card", file: PIECES,
    find: "flagged: !!chipOf?.(series[i])",
    replace: "flagged: false",
    expect: "G",
  },
];

runMutants({
  sim: "scripts/sim/bracket-pieces-sim.ts",
  timezones: ["UTC"],
  mutants: MUTANTS,
});

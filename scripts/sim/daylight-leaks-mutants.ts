// Mutation pass for daylight-leaks-sim.ts. Each mutant plants a leak (or
// breaks the wiring) in the REAL source; the sim must fail FIRST at the
// assertion written for it. The runner restores every file byte-for-byte.
import { runMutants, type Mutant } from "./mutant-runner";

const MUTANTS: Mutant[] = [
  {
    id: "LK1", what: "the schedule print region renders a game's daylight flag", file: "src/components/schedule/schedule-print-region.tsx",
    find: "                  <td>{venueLabel(g)}</td>",
    replace: "                  <td>{venueLabel(g)}{g.daylight && <span> {g.daylight.minutes}</span>}</td>",
    expect: "W1",
  },
  {
    id: "LK2", what: "the public league schedule imports the daylight chip", file: "src/components/public-schedule/public-schedule-client.tsx",
    find: 'import { useCallback, useEffect, useMemo, useState } from "react";',
    replace: 'import { useCallback, useEffect, useMemo, useState } from "react";\nimport { DaylightChip } from "@/components/daylight/daylight-pieces";',
    expect: "F1",
  },
  {
    // Targets the LATEST migration that defines the reader: D1 reads only the
    // latest body of each token function, so a mutant in a superseded file
    // proves nothing (LK3 pointed at 0105 and survived once 0112 redefined
    // the reader — found 2026-10-20). Move it with every new definition.
    id: "LK3", what: "(0114) the public reader emits a field's lights", file: "supabase/migrations/0114_playoff_series.sql",
    find: "                     'status',              g.status,",
    replace: "                     'status',              g.status, 'has_lights', v.has_lights,",
    expect: "D1",
  },
  {
    id: "LK4", what: "the print region gets the Daylight-filtered list", file: "src/app/(dashboard)/dashboard/schedule/page.tsx",
    find: "<SchedulePrintRegion games={games} ",
    replace: "<SchedulePrintRegion games={shownGames} ",
    expect: "P1",
  },
  {
    id: "LK5", what: "the division panel's print region reads the flag", file: "src/components/divisions/division-schedule-panel.tsx",
    find: "                      <td>{opponentName(game)}</td>",
    replace: "                      <td>{opponentName(game)}{dl.flag ? \" *\" : \"\"}</td>",
    expect: "W2",
  },
  {
    id: "LK6", what: "a surface hand-writes its own daylight sentence", file: "src/components/schedule/schedule-calendar.tsx",
    find: "                    <DaylightChip flag={pill.data.daylight} />",
    replace: "                    <span>{pill.data.daylight.minutes} min after sunset</span>",
    expect: "S1",
  },
  {
    id: "LK7", what: "an admin surface stops rendering the shared pieces (feature silently gone)", file: "src/components/schedule/add-game-modal.tsx",
    find: 'import { DaylightPickNotice } from "@/components/daylight/daylight-pieces";',
    replace: 'import { DaylightPickNotice } from "@/components/daylight/daylight-pieces-copy";',
    expect: "S2",
  },
  {
    id: "LK8", what: "the daylight notice is re-added to Record where it was played", file: "src/components/schedule/record-played-modal.tsx",
    find: 'import { useDayOccupancy } from "@/components/divisions/use-day-occupancy";',
    replace: 'import { useDayOccupancy } from "@/components/divisions/use-day-occupancy";\nimport { DaylightPickNotice } from "@/components/daylight/daylight-pieces";',
    expect: "N1",
  },
];

runMutants({
  sim: "scripts/sim/daylight-leaks-sim.ts",
  timezones: ["UTC"],
  mutants: MUTANTS,
});

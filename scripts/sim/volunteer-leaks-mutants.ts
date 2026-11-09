// Mutation pass for volunteer-leaks-sim.ts. Each mutant plants a leak (or
// breaks the wiring) in the REAL source; the sim must fail FIRST at the
// assertion written for it. The runner restores every file byte-for-byte.
import { runMutants, type Mutant } from "./mutant-runner";

const MUTANTS: Mutant[] = [
  {
    id: "VL1", what: "the public league schedule imports the volunteer words", file: "src/components/public-schedule/public-schedule-client.tsx",
    find: 'import { useCallback, useEffect, useMemo, useState } from "react";',
    replace: 'import { useCallback, useEffect, useMemo, useState } from "react";\nimport * as VW from "../../lib/volunteers/words";\nvoid VW;',
    expect: "F1",
  },
  {
    id: "VL2", what: "the export rules embed a game's sign-ups", file: "src/lib/schedule/export-games.ts",
    find: "// Which games an export contains, and who is home — the ONE place both CSV\n",
    replace: "export const SIGNUPS_EMBED = \"volunteer_claims(status)\";\n// Which games an export contains, and who is home — the ONE place both CSV\n",
    expect: "W1",
  },
  {
    id: "VL3", what: "the volunteer Settings card writes the activity log", file: "src/components/settings/volunteers-card.tsx",
    find: 'import * as W from "@/lib/volunteers/words";',
    replace: 'import * as W from "@/lib/volunteers/words";\nimport { logActivity } from "@/lib/activity-log";\nvoid logActivity;',
    expect: "A1",
  },
  {
    id: "VL4", what: "(0121) saving a role logs to the activity log", file: "supabase/migrations/0121_volunteer_game_roles.sql",
    find: "    raise exception 'name_taken' using errcode = 'P0001';",
    replace: "    insert into public.activity_log (owner_id, message) values (v_owner, 'role clash'); raise exception 'name_taken' using errcode = 'P0001';",
    expect: "A1",
  },
  {
    id: "VL5", what: "(0116) the public bracket reader counts a game's sign-ups", file: "supabase/migrations/0116_public_bracket.sql",
    find: "    return jsonb_build_object('status', 'plan');",
    replace: "    return jsonb_build_object('status', 'plan', 'signups', (select count(*) from public.volunteer_claims));",
    expect: "D1",
  },
  {
    id: "VL6", what: "(0121) the public sign-up page names who took a spot", file: "supabase/migrations/0121_volunteer_game_roles.sql",
    find: "               'spots', sp.spots, 'taken', least(sp.taken, sp.spots))",
    replace: "               'spots', sp.spots, 'taken', least(sp.taken, sp.spots), 'who', (select max(v.last_name) from public.volunteers v))",
    expect: "V1",
  },
  {
    id: "VL7", what: "the outbox drain stops using the volunteer drain (wiring)", file: "src/app/api/volunteers/outbox/drain/route.ts",
    find: 'import { drainOutbox } from "@/lib/volunteers/outbox-drain";',
    replace: 'import { drainOutbox } from "../../../../../lib/volunteers/outbox-drain";',
    expect: "S1",
  },
];

runMutants({
  sim: "scripts/sim/volunteer-leaks-sim.ts",
  mutants: MUTANTS,
});

// MUTATION LOG: see the run recorded below.

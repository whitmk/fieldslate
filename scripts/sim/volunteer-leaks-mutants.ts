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
    // Re-targeted 2026-11-09: 0122 redefines save_volunteer_role, so a
    // mutant in 0121's body no longer reaches the latest definition the
    // fence reads (it SURVIVED — a stale mutant on main since 0122).
    id: "VL4", what: "(0122) saving a role logs to the activity log", file: "supabase/migrations/0122_volunteer_snack_shack.sql",
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
    // Re-targeted 2026-11-09 for the same reason (0122 redefines the page).
    id: "VL6", what: "(0122) the public sign-up page names who took a spot", file: "supabase/migrations/0122_volunteer_snack_shack.sql",
    find: "               'spots', sp.spots, 'taken', least(sp.taken, sp.spots))",
    replace: "               'spots', sp.spots, 'taken', least(sp.taken, sp.spots), 'who', (select max(v.last_name) from public.volunteers v))",
    expect: "V1",
  },
  {
    id: "VL7", what: "the outbox drain stops using the volunteer drain (wiring)", file: "src/app/api/volunteers/outbox/drain/route.ts",
    find: 'import { runVolunteerDrain } from "@/lib/volunteers/drain-runner";',
    replace: 'import { runVolunteerDrain } from "../../../../../lib/volunteers/drain-runner";',
    expect: "S1",
  },
  {
    id: "VL8", what: "(0123) auto-assign reads the tracker rules", file: "src/lib/umpires/auto-assign.ts",
    find: "import { createClient } from \"@/lib/supabase/client\";",
    replace: "import { createClient } from \"@/lib/supabase/client\";\nimport { familyStatus } from \"@/lib/volunteers/tracker\";\nvoid familyStatus;",
    expect: "U1",
  },
  {
    id: "VL9", what: "(0123) the paid toggle skips no-show officials", file: "supabase/migrations/0062_officials_schema_expansion.sql",
    find: "  set paid = not paid\n  where id = p_assignment_id\n",
    replace: "  set paid = not paid\n  where id = p_assignment_id\n    and not exists (select 1 from public.volunteer_official_no_shows n where n.game_umpire_id = p_assignment_id)\n",
    expect: "U1",
  },
  {
    id: "VL10", what: "(2026-11-09) the shared email module imports the volunteer code", file: "src/lib/outbound-email/outbox-drain.ts",
    find: "import { bareFromAddress, leagueFromHeader, safeReplyTo, scrubError, isEmailShape } from \"./headers\";",
    replace: "import { bareFromAddress, leagueFromHeader, safeReplyTo, scrubError, isEmailShape } from \"./headers\";\nimport \"@/lib/volunteers/words\";",
    expect: "U1",
  },
  {
    id: "VL11", what: "(2026-11-09) the officials sign-up page reads the volunteer words", file: "src/lib/officials-signup/page.ts",
    find: "import * as W from \"./words\";",
    replace: "import * as W from \"./words\";\nimport \"@/lib/volunteers/words\";",
    expect: "U1",
  },
];

runMutants({
  sim: "scripts/sim/volunteer-leaks-sim.ts",
  mutants: MUTANTS,
});

// MUTATION LOG: see the run recorded below.

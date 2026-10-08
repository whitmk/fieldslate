// Mutation pass for supabase-no-store-sim.ts — see mutant-runner.ts.
import { runMutants, type Mutant } from "./mutant-runner";

const HELPER = "src/lib/supabase/no-store.ts";

const MUTANTS: Mutant[] = [
  {
    id: "NSM1", what: "no-store removed from the helper's fetch", file: HELPER,
    find: 'fetch(input, { ...init, cache: "no-store" });',
    replace: "fetch(input, init);",
    expect: "NS3",
  },
  {
    id: "NSM2", what: "helper no longer hands its fetch to supabase-js", file: HELPER,
    find: "    global: { fetch: noStoreFetch },\n",
    replace: "",
    expect: "NS4",
  },
  {
    id: "NSM3", what: "public schedule reader builds its own client again", file: "src/lib/public-schedule/read.ts",
    find: 'import { createNoStoreClient } from "@/lib/supabase/no-store";',
    replace: 'import { createClient as createNoStoreClient } from "@supabase/supabase-js";',
    expect: "NS1",
  },
  {
    id: "NSM4", what: "data route loses its fetchCache guard", file: "src/app/s/[token]/data/route.ts",
    find: 'export const fetchCache = "force-no-store";\n',
    replace: "",
    expect: "NS5",
  },
  {
    id: "NSM5", what: "admin client builds its own client again", file: "src/lib/supabase/admin.ts",
    find: 'import { createNoStoreClient } from "./no-store";',
    replace: 'import { createClient as createNoStoreClient } from "@supabase/supabase-js";',
    expect: "NS1",
  },
];

runMutants({ sim: "scripts/sim/supabase-no-store-sim.ts", mutants: MUTANTS });

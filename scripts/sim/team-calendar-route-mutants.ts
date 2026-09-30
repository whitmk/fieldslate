// Mutation pass for team-calendar-route-sim.ts — see mutant-runner.ts.
import { runMutants, type Mutant } from "./mutant-runner";

const LINKS = "src/lib/calendar/links.ts";

const MUTANTS: Mutant[] = [
  {
    id: "RM1", what: "unlocked maps to 200", file: LINKS,
    find: "        httpStatus: 503,\n        retryAfterSeconds: 3600,",
    replace: "        httpStatus: 200,\n        retryAfterSeconds: 3600,",
    expect: "M-unlocked",
  },
  {
    id: "RM2", what: "Cache-Control becomes public", file: LINKS,
    find: '"Cache-Control": "private, no-store",',
    replace: '"Cache-Control": "public, max-age=3600",',
    expect: "H1",
  },
  {
    id: "RM3", what: "URLs built on the bare domain", file: LINKS,
    find: "const https = `${SITE_URL}${calendarFeedPath(token)}`;",
    replace: "const https = `https://thefieldslate.com${calendarFeedPath(token)}`;",
    expect: "U1",
  },
  {
    id: "RM4", what: "webcal twin keeps the https scheme", file: LINKS,
    find: 'webcal: https.replace(/^https:\\/\\//, "webcal://")',
    replace: "webcal: https",
    expect: "U2",
  },
  {
    id: "RM5", what: "coach message drops the help link", file: LINKS,
    find: "    `Step-by-step instructions: ${calendarHelpUrl()}`,\n",
    replace: "",
    expect: "C1",
  },
  {
    id: "RM6", what: "token parsing accepts uppercase hex", file: LINKS,
    find: "const TOKEN_RE = /^[0-9a-f]{64}$/;",
    replace: "const TOKEN_RE = /^[0-9a-fA-F]{64}$/;",
    expect: "T1",
  },
  {
    id: "RM7", what: "Retry-After removed from the temporary refusal", file: LINKS,
    find: "        retryAfterSeconds: 3600,\n",
    replace: "",
    expect: "M-retry",
  },
];

runMutants({ sim: "scripts/sim/team-calendar-route-sim.ts", mutants: MUTANTS });

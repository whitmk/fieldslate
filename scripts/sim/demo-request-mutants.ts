// Mutation pass for demo-request-sim.ts — see mutant-runner.ts for the rules.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/forms/demo-request.ts";

const MUTANTS: Mutant[] = [
  { id: "DM1", what: "trimming removed", file: LIB,
    find: 'return typeof v === "string" ? v.trim() : "";', replace: 'return typeof v === "string" ? v : "";', expect: "V1" },
  { id: "DM2", what: "email accepted without an @", file: LIB,
    find: "if (!EMAIL_RE.test(email))", replace: "if (!email)", expect: "V5" },
  { id: "DM3", what: "length caps not enforced", file: LIB,
    find: "if (typeof v === \"string\" && v.length > DEMO_LIMITS[key]) {", replace: "if (false) {", expect: "V8-name" },
  { id: "DM4", what: "subject drops the sport", file: LIB,
    find: "return `Demo request — ${d.league_name} (${d.sport})`;", replace: "return `Demo request — ${d.league_name}`;", expect: "E1" },
  { id: "DM5", what: "interleague moved to the bottom of the email", file: LIB,
    find: '  sport: "Sport",\n  plays_interleague: "Plays other leagues (interleague)",\n', replace: '  sport: "Sport",\n', expect: "E2-plays_interleague" },
  { id: "DM6", what: "blank optionals printed as empty instead of —", file: LIB,
    find: 'return v == null || v === "" ? BLANK : v;', replace: 'return v == null || v === "" ? "" : v;', expect: "E4" },
  { id: "DM7", what: "HTML not escaped in the html body", file: LIB,
    find: "        : escapeHtml(v).replace(/\\n/g, \"<br>\");", replace: "        : v.replace(/\\n/g, \"<br>\");", expect: "E5" },
  { id: "DM8", what: "a role off the list falls back to Other instead of refusing", file: LIB,
    find: "if (!role) return { ok: false, error: \"Please choose your role.\" };", replace: "", expect: "V4-role" },
];

runMutants({ sim: "scripts/sim/demo-request-sim.ts", mutants: MUTANTS });

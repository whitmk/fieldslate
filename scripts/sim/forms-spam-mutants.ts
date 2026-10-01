// Mutation pass for forms-spam-sim.ts — see mutant-runner.ts for the rules.
import { runMutants, type Mutant } from "./mutant-runner";

const SPAM = "src/lib/forms/spam.ts";
const CONTACT = "src/app/api/contact/route.ts";

const MUTANTS: Mutant[] = [
  { id: "SM1", what: "whitespace counts as a honeypot hit", file: SPAM,
    find: 'typeof v === "string" ? v.trim().length > 0 : v != null', replace: 'typeof v === "string" ? v.length > 0 : v != null', expect: "H2" },
  { id: "SM2", what: "last x-forwarded-for hop used instead of the first", file: SPAM,
    find: 'xff?.split(",")[0]?.trim()', replace: 'xff?.split(",").pop()?.trim()', expect: "A1" },
  { id: "SM3", what: "off-by-one: one fewer submission allowed", file: SPAM,
    find: "if (recent.length >= RATE_LIMIT_MAX) {", replace: "if (recent.length >= RATE_LIMIT_MAX - 1) {", expect: "R1" },
  { id: "SM4", what: "a refusal is recorded as a submission (window extends)", file: SPAM,
    find: "    hits.set(address, recent);\n    return true;", replace: "    recent.push(now);\n    hits.set(address, recent);\n    return true;", expect: "R6" },
  { id: "SM5", what: "window never slides", file: SPAM,
    find: ".filter((t) => t > since)", replace: ".filter(() => true)", expect: "R5" },
  { id: "SM6", what: "contact route sends before the honeypot check", file: CONTACT,
    find: "  if (isHoneypotFilled(body)) {\n    return NextResponse.json({ ok: true });\n  }\n", replace: "", expect: "S2" },
];

runMutants({ sim: "scripts/sim/forms-spam-sim.ts", mutants: MUTANTS });

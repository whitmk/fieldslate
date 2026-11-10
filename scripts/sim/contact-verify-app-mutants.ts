// Mutation pass for contact-verify-app-sim.ts (2026-11-09). Each mutant is
// applied to the REAL source, the sim runs under three zones, the source is
// restored and verified byte-for-byte, and the mutant counts as killed only
// if the FIRST failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const RULES = "src/lib/contact-verify/rules.ts";
const CONFIRM = "src/app/api/contact-verify/confirm/[token]/route.ts";

const MUTANTS: Mutant[] = [
  { id: "CA1", what: "a pending reply without its daily count is read as whole", file: RULES,
    find: "!str(p.email) || typeof p.expired !== \"boolean\" || typeof p.sends_left_today !== \"number\") {",
    replace: "!str(p.email) || typeof p.expired !== \"boolean\") {", expect: "S1" },
  { id: "CA2", what: "Resend allowed inside the minute", file: RULES,
    find: "  if (p.resendAfter && Date.parse(p.resendAfter) > nowMs) return \"You can send another link in a minute.\";\n",
    replace: "", expect: "S2" },
  { id: "CA3", what: "saving the address already in use is allowed", file: RULES,
    find: "  if (state?.contactEmail && state.contactEmail.toLowerCase() === d) return false;\n",
    replace: "", expect: "S3" },
  { id: "CA4", what: "the league check is skipped", file: RULES,
    find: "  if ((await deps.currentOrgId(userId)) !== b.orgId) return { status: 409, body: { error: \"switched_league\" } };\n",
    replace: "", expect: "S4" },
  { id: "CA5", what: "the email goes to the address in the request, not take's", file: RULES,
    find: "  const sent = await deps.send(t.email, mail);",
    replace: "  const sent = await deps.send(b.email ?? t.email, mail);", expect: "S4" },
  { id: "CA6", what: "take runs after begin refused", file: RULES,
    find: "  if (begun.error) return { status: 400, body: { error: errorKey(begun.error.message) } };\n",
    replace: "", expect: "S4" },
  { id: "CA7", what: "the league name is not escaped in the email", file: RULES,
    find: "  const html = `<p>Someone at ${esc(league)} entered",
    replace: "  const html = `<p>Someone at ${league} entered", expect: "S5" },
  { id: "CA8", what: "a reply the page doesn't know reads as \"not working\"", file: RULES,
    find: "  if (r.status === \"unknown\") return GONE;\n  return LOAD_FAILED;",
    replace: "  return GONE;", expect: "S6" },
  { id: "CA9", what: "an unknown route error shown raw-ish as a refusal", file: RULES,
    find: "  return hit ? ERROR_LINES[hit] : SOMETHING_WRONG;",
    replace: "  return hit ? ERROR_LINES[hit] : ERROR_LINES.not_sent;", expect: "S7" },
  { id: "CA10", what: "opening the link (GET) confirms it", file: CONFIRM,
    find: "  return call(\"contact_verify_peek\", params.token);",
    replace: "  return call(\"contact_verify_confirm\", params.token);", expect: "F1" },
];

runMutants({
  sim: "scripts/sim/contact-verify-app-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

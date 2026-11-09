// Mutation pass for volunteer-signup-page-sim.ts — one mutant per rule, each
// must fail FIRST at its own assertion (mutant-runner.ts restores every file).
import { runMutants, type Mutant } from "./mutant-runner";

const SP = "src/lib/volunteers/signup-page.ts";
const PS = "src/lib/volunteers/public-server.ts";
const MUTANTS: Mutant[] = [
  {
    id: "SP1", what: "a malformed reply reads as an empty page", file: SP,
    find: "    return { kind: \"error\" };\n  }\n  return {\n    kind: \"ok\",",
    replace: "  }\n  return {\n    kind: \"ok\",",
    expect: "P1",
  },
  {
    id: "SP2", what: "a full spot still offers Sign up", file: SP,
    find: "  if (open === 0) return { kind: \"taken\" };\n",
    replace: "",
    expect: "P2",
  },
  {
    id: "SP3", what: "the division chip ignored", file: SP,
    find: "    if (chips.divisionId && s.division_id !== chips.divisionId) continue;\n",
    replace: "",
    expect: "P3",
  },
  {
    id: "SP4", what: "the 18+ box not required", file: SP,
    find: "  if (!f.adult) return W.PUB_NEED_ADULT;\n",
    replace: "",
    expect: "P4",
  },
  {
    id: "SP5", what: "overlap treated as a refusal (no second chance)", file: SP,
    find: "    case \"overlap_confirm_needed\":\n      return { kind: \"overlap\" };\n",
    replace: "",
    expect: "P5",
  },
  {
    id: "SP6", what: "no salt still configured", file: PS,
    find: "  if (!turnstileSecret || !hashSalt || hashSalt.length < 16) return null;",
    replace: "  if (!turnstileSecret) return null;",
    expect: "Q1",
  },
  {
    id: "SP7", what: "adult not shape-checked", file: PS,
    find: "  if (typeof b.adult !== \"boolean\" || (b.confirmOverlap !== undefined && typeof b.confirmOverlap !== \"boolean\")) return null;",
    replace: "  if (b.confirmOverlap !== undefined && typeof b.confirmOverlap !== \"boolean\") return null;",
    expect: "Q2",
  },
  {
    id: "SP8", what: "Turnstile success taken as truthy", file: PS,
    find: "    return json.success === true;",
    replace: "    return !!json.success;",
    expect: "Q3",
  },
  {
    id: "SP9", what: "hashes unsalted", file: PS,
    find: "  return createHash(\"sha256\").update(`${salt}|${value}`).digest(\"hex\");",
    replace: "  return createHash(\"sha256\").update(value).digest(\"hex\");",
    expect: "Q4",
  },
  {
    id: "SP10", what: "the claim reaches the database before Turnstile", file: "src/app/api/volunteers/signup/[token]/claim/route.ts",
    find: "  if (!(await verifyTurnstile(config.turnstileSecret, body.turnstileToken, ip, fetch))) {\n    return NextResponse.json({ status: \"captcha\" }, { headers: NO_STORE });\n  }\n",
    replace: "",
    expect: "W1",
  },
];

runMutants({
  sim: "scripts/sim/volunteer-signup-page-sim.ts",
  mutants: MUTANTS,
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
});

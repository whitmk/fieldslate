// Mutation pass for sim:volunteer-email. Applied to the REAL source, restored
// byte-for-byte, killed only if the FIRST failing assertion is the one
// written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const HEADERS = "src/lib/volunteers/email-headers.ts";
const DRAIN = "src/lib/volunteers/outbox-drain.ts";
const EMAIL = "src/lib/email.ts";
const ROUTE = "src/app/api/volunteers/outbox/drain/route.ts";

const MUTANTS: Mutant[] = [
  {
    id: "VE1", what: "control characters are not stripped from the league name (CR/LF header injection)", file: HEADERS,
    find: "    .replace(/[\\p{Cc}\\u2028\\u2029\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/gu, \" \")\n",
    replace: "",
    expect: "H2",
  },
  {
    id: "VE2", what: "quotes and angle brackets are kept in the display name", file: HEADERS,
    find: "    .replace(/[\"\\\\<>]/g, \"\")\n",
    replace: "",
    expect: "H3",
  },
  {
    id: "VE3", what: "the display name is not length-capped", file: HEADERS,
    find: "  const cut = Array.from(cleaned).slice(0, NAME_MAX).join(\"\").trim();\n",
    replace: "  const cut = cleaned;\n",
    expect: "H7",
  },
  {
    id: "VE4", what: "a comma is allowed in an address (two recipients in one reply-to)", file: HEADERS,
    find: "  /^[^@\\s\\p{Cc}<>\"(),;:\\\\]+@[^@\\s\\p{Cc}<>\"(),;:\\\\]+\\.[^@\\s\\p{Cc}<>\"(),;:\\\\]+$/u;",
    replace: "  /^[^@\\s\\p{Cc}<>\"();:\\\\]+@[^@\\s\\p{Cc}<>\"();:\\\\]+\\.[^@\\s\\p{Cc}<>\"();:\\\\]+$/u;",
    expect: "R2",
  },
  {
    id: "VE5", what: "the log error keeps the address", file: HEADERS,
    find: "    .replace(/[^\\s@<>\"]+@[^\\s@<>\"]+/g, \"[address]\")\n",
    replace: "",
    expect: "E1",
  },
  {
    id: "VE6", what: "the idempotency key never reaches Resend", file: EMAIL,
    find: "    requestOptions: options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,\n",
    replace: "    requestOptions: undefined,\n",
    expect: "Q2",
  },
  {
    id: "VE7", what: "the volunteer From is ignored (every email from FieldSlate's default)", file: EMAIL,
    find: "      from: options.from ?? defaultFrom,\n",
    replace: "      from: defaultFrom,\n",
    expect: "Q1",
  },
  {
    id: "VE8", what: "a 4xx refusal is retried", file: DRAIN,
    find: "  return status === 429 || status >= 500;\n",
    replace: "  return status >= 400;\n",
    expect: "D3",
  },
  {
    id: "VE9", what: "a 5xx is final, not retried", file: DRAIN,
    find: "  return status === 429 || status >= 500;\n",
    replace: "  return status === 429;\n",
    expect: "D2",
  },
  {
    id: "VE10", what: "a thrown send is final", file: DRAIN,
    find: "      await finish(row, false, null, scrubError(e), true);\n",
    replace: "      await finish(row, false, null, scrubError(e), false);\n",
    expect: "D4",
  },
  {
    id: "VE11", what: "a row with no template is sent anyway (with an empty body)", file: DRAIN,
    find: "    if (!rendered) {\n      await finish(row, false, null, \"unknown_kind\", false);\n      continue;\n    }\n",
    replace: "",
    expect: "D5",
  },
  {
    id: "VE12", what: "the drain stops at the first failed finish", file: DRAIN,
    find: "  for (const row of rows) {\n",
    replace: "  for (const row of rows) {\n    if (summary.finishErrors) break;\n",
    expect: "D6",
  },
  {
    id: "VE13", what: "no gap between sends", file: DRAIN,
    find: "    if (sentBefore) await deps.sleep(gapMs);\n",
    replace: "",
    expect: "D7",
  },
  {
    id: "VE14", what: "rows are taken even with no usable From address", file: DRAIN,
    find: "  if (!fromAddress) {\n",
    replace: "  if (!fromAddress && false) {\n",
    expect: "D9",
  },
  {
    id: "VE15", what: "the reply-to is not checked before sending", file: DRAIN,
    find: "    const replyTo = safeReplyTo(row.replyTo);\n    if (!replyTo) {\n",
    replace: "    const replyTo = row.replyTo ?? \"\";\n    if (false) {\n",
    expect: "D5",
  },
  {
    id: "VE16", what: "the route runs with CRON_SECRET unset", file: ROUTE,
    find: "  if (!secret) {\n    return NextResponse.json({ error: \"CRON_SECRET is not configured.\" }, { status: 503, headers: NO_STORE });\n  }\n",
    replace: "",
    expect: "S1",
  },
  {
    id: "VE17", what: "the card shows for an org with the switch off", file: "src/lib/volunteers/settings-card.ts",
    find: "  if (r.feature !== true) return null;\n",
    replace: "",
    expect: "C1",
  },
  {
    id: "VE18", what: "the link can be turned on with no saved contact", file: "src/lib/volunteers/settings-card.ts",
    find: "  return state.savedContact ? null : LINK_NEEDS_CONTACT;\n",
    replace: "  return null;\n",
    expect: "C2",
  },
  {
    id: "VE19", what: "an unknown refusal is shown raw", file: "src/lib/volunteers/words.ts",
    find: "  return \"Couldn't save. Nothing changed — please try again.\";\n",
    replace: "  return m || \"Couldn't save. Nothing changed — please try again.\";\n",
    expect: "C3",
  },
  {
    id: "VE20", what: "a failed read still renders the card", file: "src/lib/volunteers/feature-state.ts",
    find: "    console.error(`[${where}] volunteer feature read failed:`, error.message);\n    return null;\n",
    replace: "    console.error(`[${where}] volunteer feature read failed:`, error.message);\n    return { elite: false, settings: null };\n",
    expect: "S6",
  },
];

runMutants({ sim: "scripts/sim/volunteer-email-sim.ts", timezones: [undefined], mutants: MUTANTS });

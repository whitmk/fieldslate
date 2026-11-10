// Mutation pass for sim:outbox-quota (0128). Applied to the REAL source,
// restored byte-for-byte, killed only if the FIRST failing assertion is the
// one written for it. The three Whit asked for (2026-11-10): a quota stop
// uses no attempts (QM1, QM5), a permanent error is not retried (QM4), and
// the banner data never reaches a public route (QM8, QM9).
import { runMutants, type Mutant } from "./mutant-runner";

const DRAIN = "src/lib/outbound-email/outbox-drain.ts";
const EMAIL = "src/lib/email.ts";
const PROBLEMS = "src/lib/outbound-email/problems.ts";

const MUTANTS: Mutant[] = [
  {
    id: "QM1", what: "a daily quota stop is retried like a failure (burns attempts)", file: DRAIN,
    find: "  if (r.name === \"daily_quota_exceeded\") return \"quota_daily\";\n",
    replace: "  if (r.name === \"daily_quota_exceeded\") return \"retry\";\n",
    expect: "O1",
  },
  {
    id: "QM2", what: "the run goes on sending after a quota stop", file: DRAIN,
    find: "    summary.stopped = outcome;\n    break;\n",
    replace: "    summary.stopped = outcome;\n    continue;\n",
    expect: "QD1",
  },
  {
    id: "QM3", what: "a daily hold is due now instead of the next UTC midnight", file: DRAIN,
    find: "    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));\n",
    replace: "    const d = now;\n",
    expect: "H1",
  },
  {
    id: "QM4", what: "a permanent 4xx is retried", file: DRAIN,
    find: "  if (status >= 500 || !Number.isFinite(status)) return \"retry\";\n  return \"fail\";\n",
    replace: "  return \"retry\";\n",
    expect: "O3",
  },
  {
    id: "QM5", what: "a quota stop finishes the row as a retry (uses an attempt) instead of holding it", file: DRAIN,
    find: "    for (const rest of rows.slice(i)) await hold(rest, outcome, until);\n",
    replace: "    for (const rest of rows.slice(i)) await finish(rest, false, null, outcome, true);\n",
    expect: "QD1",
  },
  {
    id: "QM6", what: "sendEmail drops Resend's status (every error reads as 500 again)", file: EMAIL,
    find: "    providerStatus: typeof e.statusCode === \"number\" ? e.statusCode : null,\n",
    replace: "    providerStatus: null,\n",
    expect: "O5",
  },
  {
    id: "QM7", what: "sendEmail changes the status our routes return", file: EMAIL,
    find: "    status: 500,\n    error: typeof e.message === \"string\" ? e.message : \"Failed to send email.\",\n",
    replace: "    status: typeof e.statusCode === \"number\" ? e.statusCode : 500,\n    error: typeof e.message === \"string\" ? e.message : \"Failed to send email.\",\n",
    expect: "O5",
  },
  {
    id: "QM8", what: "the public sign-up page imports the email-problems words", file: "src/app/v/[token]/page.tsx",
    find: "import { PUB_TITLE } from \"@/lib/volunteers/words\";\n",
    replace: "import { PUB_TITLE } from \"@/lib/volunteers/words\";\nimport { PROBLEMS_HELP as _leak } from \"@/lib/outbound-email/problems\";\nvoid _leak;\n",
    expect: "F1",
  },
  {
    id: "QM9", what: "the public sign-up data route calls the problems function", file: "src/app/api/volunteers/signup/[token]/route.ts",
    find: "import { createAdminClient } from \"@/lib/supabase/admin\";\n",
    replace: "import { createAdminClient } from \"@/lib/supabase/admin\";\nconst _leak = \"volunteer_email_problems\";\nvoid _leak;\n",
    expect: "F1",
  },
  {
    id: "QM10", what: "the problems functions are granted to anon", file: "supabase/migrations/0128_outbox_quota_hold.sql",
    find: "grant execute on function public.volunteer_email_problems(uuid)                          to authenticated;\n",
    replace: "grant execute on function public.volunteer_email_problems(uuid)                          to authenticated;\ngrant execute on function public.volunteer_email_problems(uuid) to anon;\n",
    expect: "F2",
  },
  {
    id: "QM11", what: "a provider message is shown on the banner", file: PROBLEMS,
    find: "    default:\n      return \"Couldn't be sent\";\n",
    replace: "    default:\n      return error ?? \"Couldn't be sent\";\n",
    expect: "W2",
  },
  {
    id: "QM12", what: "the waiting time is shown in UTC, not the league's timezone", file: PROBLEMS,
    find: "    return d.toLocaleTimeString(\"en-US\", { timeZone: timezone, hour: \"numeric\", minute: \"2-digit\" });\n",
    replace: "    return d.toLocaleTimeString(\"en-US\", { timeZone: \"UTC\", hour: \"numeric\", minute: \"2-digit\" });\n",
    expect: "W1",
  },
];

runMutants({ sim: "scripts/sim/outbox-quota-sim.ts", timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"], mutants: MUTANTS });

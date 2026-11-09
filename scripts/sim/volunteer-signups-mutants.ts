// Mutation pass for volunteer-signups-sim.ts — one mutant per rule, each must
// fail FIRST at its own assertion (mutant-runner.ts restores every file).
import { runMutants, type Mutant } from "./mutant-runner";

const SS = "src/lib/volunteers/signups-screen.ts";
const MUTANTS: Mutant[] = [
  {
    id: "VS1", what: "noon shown as AM", file: SS,
    find: "  const t = `${h % 12 === 0 ? 12 : h % 12}:${m[5]} ${h < 12 ? \"AM\" : \"PM\"}`;",
    replace: "  const t = `${h % 12 === 0 ? 12 : h % 12}:${m[5]} ${h <= 12 ? \"AM\" : \"PM\"}`;",
    expect: "S1",
  },
  {
    id: "VS2", what: "canceled sign-ups fill spots", file: SS,
    find: "    if (c.status !== \"active\" || !c.game_id || !c.role_id) continue;",
    replace: "    if (!c.game_id || !c.role_id) continue;",
    expect: "S2",
  },
  {
    id: "VS3", what: "the role's lead ignored", file: SS,
    find: "      const start = spotStartWall(g.scheduledAt, role.leadMinutes ?? 0) ?? g.scheduledAt.slice(0, 16);",
    replace: "      const start = g.scheduledAt.slice(0, 16);",
    expect: "S2",
  },
  {
    id: "VS4", what: "\"Open only\" shows filled spots", file: SS,
    find: "      (f.show === \"all\" || (f.show === \"open\" ? r.claim === null : r.claim !== null)),",
    replace: "      (f.show === \"all\" || (f.show === \"open\" ? true : r.claim !== null)),",
    expect: "S3",
  },
  {
    id: "VS5", what: "today's started spots offered for no-show", file: SS,
    find: "    past: rows.filter((r) => r.claim !== null && r.start.slice(0, 10) < today).reverse(),",
    replace: "    past: rows.filter((r) => r.claim !== null && r.start < nowWall).reverse(),",
    expect: "S4",
  },
  {
    id: "VS10", what: "today's started spots drop off the list (the old rule)", file: SS,
    find: "    upcoming: rows.filter((r) => r.start.slice(0, 10) >= today),",
    replace: "    upcoming: rows.filter((r) => r.start >= nowWall),",
    expect: "S4",
  },
  {
    id: "VS11", what: "started spots not tagged", file: SS,
    find: "  return row.start < nowWall ? STARTED_TAG : null;",
    replace: "  return null;",
    expect: "S4",
  },
  {
    id: "VS12", what: "the banner says sent when only some were reminded", file: SS,
    find: "  const sentOn = dates.every((d) => d !== null) ? (dates as string[]).sort()[0] : null;",
    replace: "  const sentOn = dates.some((d) => d !== null) ? (dates.filter(Boolean) as string[]).sort()[0] : null;",
    expect: "R1",
  },
  {
    id: "VS13", what: "a started spot offered a reminder", file: SS,
    find: "  return row.claim !== null && row.start >= nowWall;",
    replace: "  return row.claim !== null;",
    expect: "R1",
  },
  {
    id: "VS14", what: "nothing queued reads as sent", file: SS,
    find: "  if (q === 0) return { ok: false, line: W.REMIND_FAILED + (s > 0 ? W.REMIND_SKIPPED(s) : \"\") };\n",
    replace: "",
    expect: "R4",
  },
  {
    id: "VS15", what: "reminded date from the raw UTC timestamp", file: SS,
    find: "  return c.last_reminded_on ? W.REMINDED_ON(shortDate(c.last_reminded_on)) : null;",
    replace: "  return c.last_reminded_on ? W.REMINDED_ON(shortDate((c as { last_reminded_at?: string }).last_reminded_at ?? \"\")) : null;",
    expect: "R5",
  },
  {
    id: "VS6", what: "lost sign-ups not grouped by day", file: SS,
    find: "    const k = `${name}|${day}`;",
    replace: "    const k = `${name}|${day}|${c.claim_id}`;",
    expect: "S5",
  },
  {
    id: "VS7", what: "CSV formula cells left live", file: SS,
    find: "  const safe = /^[=+\\-@\\t\\r]/.test(v) ? `'${v}` : v;",
    replace: "  const safe = v;",
    expect: "S6",
  },
  {
    id: "VS8", what: "overlap refusal shown as the generic error", file: SS,
    find: "    case \"overlap_confirm_needed\": return \"This email already has a spot at an overlapping time.\";\n",
    replace: "",
    expect: "S7",
  },
  {
    id: "VS9", what: "a malformed sign-up read renders an empty list", file: "src/app/(dashboard)/dashboard/volunteers/signups/page.tsx",
    find: "    throw new Error(signups.error?.message ?? \"malformed sign-up reply\");",
    replace: "    reply!.claims = [];",
    expect: "W1",
  },
];

runMutants({
  sim: "scripts/sim/volunteer-signups-sim.ts",
  mutants: MUTANTS,
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
});

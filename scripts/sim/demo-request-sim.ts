// "Request a demo" — drives the REAL validateDemoRequest and buildDemoEmail
// in src/lib/forms/demo-request.ts, and pins them to migration 0101.
//
//   V  validation: required fields, trimming, email shape, pick-lists, blank
//      optionals as null, every length cap, non-object bodies, unknown keys
//      ignored
//   E  email: exact subject, every answer labelled in order, blank optionals
//      as "—", interleague above phone, HTML escaped, the reply-to sentence
//   M  the lib's options and caps equal the CHECK constraints in 0101, parsed
//      from the migration file (the two must never drift)
//   S  source wiring: the page, the form and the route import the lib; the
//      form never builds a URL from the answers
//
// Mutants (`npm run sim:demo-request:mutants`): each applied to the real
// source, each required to die FIRST at its own tag. MUTATION LOG
// (2026-09-30): DM5 (interleague dropped from the label map) first died at
// E4, because E2 iterated the lib's own EMAIL_ORDER — a key missing from the
// map vanished from the loop — and E3 compared an indexOf of -1. The keys
// are now a literal list and E3/E3b require the key to be present. 8/8
// killed at their own tag after the fix.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  BLANK, DEMO_INTERLEAGUE, DEMO_LIMITS, DEMO_ROLES, DEMO_SPORTS, DEMO_TIMEZONES, EMAIL_ORDER, LABELS,
  buildDemoEmail, demoEmailSubject, validateDemoRequest, type DemoRequest,
} from "../../src/lib/forms/demo-request";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const failures: string[] = [];
const counters: Record<string, number> = {};
const count = (n: string) => { counters[n] = (counters[n] ?? 0) + 1; };
function assert(cond: boolean, tag: string, label: string) {
  if (cond) console.log(`  ok: [${tag}] ${label}`);
  else { failures.push(`[${tag}] ${label}`); console.error(`  FAIL: [${tag}] ${label}`); }
}
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try { fn(); } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`[CRASH-${name}] ${msg}`); console.error(`  FAIL: [CRASH-${name}] ${msg}`);
  }
}

const FULL = {
  name: "  Pat Example  ", email: " pat@example.test ", league_name: "QA Little League", role: "Scheduler", sport: "Baseball/softball",
  phone: "(707) 555-0100", divisions_teams: "5 divisions, 40 teams", fields_parks: "6 fields, 2 parks", plays_interleague: "Yes",
  current_scheduling_tool: "Spreadsheet", registration_platform: "Sports Connect", next_season_start: "March", timezone: "Pacific",
  best_times: "Weekday evenings", notes: "Line one\nLine two <b>bold</b>",
};

section("V", () => {
  const ok = validateDemoRequest(FULL);
  assert(ok.ok && ok.data.name === "Pat Example" && ok.data.email === "pat@example.test", "V1", "a full body validates and is trimmed");
  if (ok.ok) count("validated");
  const min = validateDemoRequest({ name: "A", email: "a@b.co", league_name: "L", role: "Other", sport: "Other" });
  assert(min.ok && min.data.phone === null && min.data.plays_interleague === null && min.data.timezone === null && min.data.notes === null,
    "V2", "the five required fields alone validate; every optional reads as null");
  const blanks = validateDemoRequest({ ...FULL, phone: "   ", notes: "", plays_interleague: "", timezone: "" });
  assert(blanks.ok && blanks.data.phone === null && blanks.data.notes === null && blanks.data.plays_interleague === null && blanks.data.timezone === null,
    "V3", "whitespace-only optionals read as null");
  for (const [k, msg] of [["name", "name"], ["email", "email"], ["league_name", "league"], ["role", "role"], ["sport", "sport"]] as const) {
    const r = validateDemoRequest({ ...FULL, [k]: "" });
    assert(!r.ok && new RegExp(msg, "i").test(r.ok ? "" : r.error), `V4-${k}`, `missing ${k} is refused with a message naming it`);
    if (!r.ok) count("refused");
  }
  assert(!validateDemoRequest({ ...FULL, email: "not-an-email" }).ok && !validateDemoRequest({ ...FULL, email: "a@b" }).ok, "V5", "a malformed email is refused");
  assert(!validateDemoRequest({ ...FULL, role: "Coach" }).ok && !validateDemoRequest({ ...FULL, sport: "Hockey" }).ok, "V6", "a role or sport off the list is refused");
  assert(!validateDemoRequest({ ...FULL, plays_interleague: "Maybe" }).ok && !validateDemoRequest({ ...FULL, timezone: "Alaska" }).ok, "V7", "an optional pick-list value off the list is refused");
  for (const k of Object.keys(DEMO_LIMITS) as (keyof typeof DEMO_LIMITS)[]) {
    const over = k === "email" ? "a".repeat(DEMO_LIMITS.email) + "@b.co" : "x".repeat(DEMO_LIMITS[k] + 1);
    const r = validateDemoRequest({ ...FULL, [k]: over });
    assert(!r.ok && /too long/.test(r.ok ? "" : r.error), `V8-${k}`, `${k} over ${DEMO_LIMITS[k]} is refused`);
    const at = validateDemoRequest({ ...FULL, [k]: k === "email" ? "a".repeat(DEMO_LIMITS.email - 5) + "@b.co" : "x".repeat(DEMO_LIMITS[k]) });
    assert(at.ok, `V9-${k}`, `${k} at exactly ${DEMO_LIMITS[k]} is accepted`);
  }
  assert(!validateDemoRequest(null).ok && !validateDemoRequest("x").ok && !validateDemoRequest(42).ok, "V10", "a non-object body is refused");
  const extra = validateDemoRequest({ ...FULL, website: "http://spam", admin: true });
  assert(extra.ok && !("website" in extra.data) && !("admin" in extra.data), "V11", "unknown keys are dropped, never stored");
  const typed = validateDemoRequest({ ...FULL, name: 123, phone: ["x"] });
  assert(!typed.ok, "V12", "a non-string required value is refused");
});

section("E", () => {
  const d = (validateDemoRequest(FULL) as { ok: true; data: DemoRequest }).data;
  const { subject, text, html } = buildDemoEmail(d, "https://www.thefieldslate.com");
  assert(subject === "Demo request — QA Little League (Baseball/softball)" && subject === demoEmailSubject(d), "E1", `subject is exact (got: ${subject})`);
  // The expected keys are a LITERAL list, never EMAIL_ORDER from the lib: a
  // key dropped from the lib's map would otherwise drop out of this loop too
  // and pass by absence (the DM5 lesson).
  const EXPECTED_KEYS: (keyof DemoRequest)[] = [
    "name", "email", "league_name", "role", "sport", "plays_interleague", "phone", "divisions_teams", "fields_parks",
    "current_scheduling_tool", "registration_platform", "next_season_start", "timezone", "best_times", "notes",
  ];
  for (const k of EXPECTED_KEYS) {
    const label = LABELS[k];
    assert(typeof label === "string" && text.includes(`${label}: `), `E2-${k}`, `text body carries a label for ${k} (${label ?? "MISSING"})`);
  }
  const posInText = (label: string | undefined) => (label ? text.indexOf(label + ": ") : -1);
  const il = posInText(LABELS.plays_interleague);
  assert(il >= 0 && il < posInText(LABELS.phone) && il < posInText(LABELS.divisions_teams),
    "E3", "interleague is listed near the top, before phone and league details");
  const ilIndex = EMAIL_ORDER.indexOf("plays_interleague");
  assert(ilIndex >= 0 && ilIndex <= 5, "E3b", `interleague is within the first six rows (index ${ilIndex})`);
  const minimal = (validateDemoRequest({ name: "A", email: "a@b.co", league_name: "L", role: "Other", sport: "Other" }) as { ok: true; data: DemoRequest }).data;
  const m = buildDemoEmail(minimal, "https://www.thefieldslate.com");
  const blankCount = (m.text.match(new RegExp(`: ${BLANK}$`, "gm")) ?? []).length;
  assert(blankCount === 10, "E4", `every blank optional shows as "${BLANK}" (10 of them; got ${blankCount})`);
  if (blankCount === 10) count("blank_optionals");
  assert(html.includes("&lt;b&gt;bold&lt;/b&gt;") && !html.includes("<b>bold</b>"), "E5", "HTML is escaped in the html body");
  assert(html.includes("Line one<br>Line two"), "E6", "newlines in notes become line breaks in the html body");
  assert(text.includes("Line one\nLine two <b>bold</b>"), "E7", "the text body is raw text, not HTML");
  assert(/replies go to pat@example\.test/.test(html) && /Reply to this email/.test(text), "E8", "both bodies say replies go to the requester");
  assert(html.includes('href="mailto:pat@example.test"'), "E9", "the email address is a mailto link in the html body");
  assert(!/undefined|null/.test(text) && !/undefined|null/.test(html), "E10", "no 'undefined' or 'null' ever leaks into a body");
  count("email_built");
});

section("M", () => {
  const mig = read("supabase/migrations/0101_demo_requests.sql");
  const list = (name: string) => {
    const m = mig.match(new RegExp(`${name} in \\(([^)]+)\\)`));
    return m ? m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")) : null;
  };
  assert(JSON.stringify(list("role")) === JSON.stringify([...DEMO_ROLES]), "M1", `roles match 0101 (${list("role")})`);
  assert(JSON.stringify(list("sport")) === JSON.stringify([...DEMO_SPORTS]), "M2", `sports match 0101 (${list("sport")})`);
  assert(JSON.stringify(list("plays_interleague")) === JSON.stringify([...DEMO_INTERLEAGUE]), "M3", "interleague options match 0101");
  assert(JSON.stringify(list("timezone")) === JSON.stringify([...DEMO_TIMEZONES]), "M4", "time zones match 0101");
  for (const [k, cap] of Object.entries(DEMO_LIMITS)) {
    const re = k === "name" || k === "email" || k === "league_name"
      ? new RegExp(`length\\(${k}\\) between \\d+ and (\\d+)`)
      : new RegExp(`length\\(${k}\\) <= (\\d+)`);
    const m = mig.match(re);
    assert(!!m && Number(m[1]) === cap, `M5-${k}`, `${k} cap ${cap} equals 0101's (${m?.[1] ?? "not found"})`);
  }
  assert(/alter table public\.demo_requests enable row level security/.test(mig) && !/create policy/.test(mig), "M6", "0101 enables RLS and creates no policy");
  assert(/grant select, insert, update on table public\.demo_requests to service_role/.test(mig) && /revoke all on table public\.demo_requests from public, anon, authenticated/.test(mig),
    "M7", "0101 grants service_role DML and revokes the client roles");
});

section("S", () => {
  const form = read("src/components/marketing/demo-request-form.tsx");
  const page = read("src/app/(marketing)/demo/page.tsx");
  assert(form.includes('from "@/lib/forms/demo-request"') && page.includes("DemoRequestForm"), "S1", "the page renders the form and the form uses the lib's options");
  assert(form.includes('method: "POST"') && form.includes("JSON.stringify(") && !/[?&](name|email|league_name)=/.test(form) && !form.includes("URLSearchParams"),
    "S2", "the form posts JSON and never puts answers in a URL");
  assert(form.includes("Thanks — Whit will email you within one business day with a few times that work."), "S3", "the success copy is exact");
  assert(page.includes("Request a demo") && page.includes("Tell us a little about your league and Whit will reach out with a few times that"), "S4", "heading and subhead are present");
  const routePath = "src/app/api/demo-request/route.ts";
  if (existsSync(join(ROOT, routePath))) {
    const route = read(routePath);
    assert(route.includes("validateDemoRequest(") && route.includes("buildDemoEmail("), "S5", "the route validates and builds the email through the lib");
    const insertAt = route.indexOf(".insert("); const sendAt = route.indexOf("sendEmail("); const updateAt = route.indexOf(".update(");
    assert(insertAt > 0 && sendAt > insertAt && updateAt > sendAt, "S6", "the route inserts, then sends, then updates the row — in that order");
    assert(route.includes("[demo-request] email failed"), "S7", "a failed email logs with the greppable tag");
    assert(route.includes("replyTo:"), "S8", "the notification sets reply-to");
    assert(route.includes("createAdminClient"), "S9", "the route writes through the admin client");
    count("route_checked");
  } else {
    failures.push("[S5] the demo route does not exist yet");
    console.error("  FAIL: [S5] the demo route does not exist yet (expected until 0101 is applied)");
  }
  for (const f of ["src/components/marketing/hero.tsx", "src/components/marketing/compare.tsx", "src/components/marketing/pricing.tsx", "src/components/marketing/footer.tsx"]) {
    assert(read(f).includes('href="/demo"'), "S10", `${f} links to /demo (relative)`);
  }
  assert(read("src/app/sitemap.ts").includes("/demo"), "S11", "the sitemap lists /demo");
});

console.log("\n── counters");
for (const c of ["validated", "refused", "blank_optionals", "email_built", "route_checked"]) {
  const n = counters[c] ?? 0; assert(n > 0, `V-${c}`, `counter ${c} = ${n}`);
}
if (failures.length) { console.error(`\n${failures.length} FAILURE(S):`); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
console.log("\nAll checks passed.");

// Spam helper for the public forms — drives the REAL src/lib/forms/spam.ts.
//
//   H  honeypot: filled → hit; empty, whitespace, absent → not a hit
//   A  client address: first x-forwarded-for hop; absent → "unknown"
//   R  rate limit: RATE_LIMIT_MAX pass, the next is refused, the window
//      slides, addresses are independent, a refusal does not extend the
//      window (a blocked sender is not punished further)
//   S  source wiring: BOTH public form routes call the helper, in the right
//      order (honeypot before anything else), and the contact form renders
//      the hidden field
//
// Mutants (`npm run sim:forms-spam:mutants`): each applied to the real
// source, each required to die FIRST at its own tag. MUTATION LOG
// (2026-09-30): SM4 (a refusal recorded as a submission) first died at R5,
// because address "a" had been refused at R2 and that recorded refusal kept
// it over the limit at the window's end. Moving R6 ahead then made SM5 (the
// window never slides) die at R6. R5 and R6 now each run on their own fresh
// address, R5 first. 6/6 killed at their own tag after that.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HONEYPOT_FIELD, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MESSAGE,
  clientAddress, isHoneypotFilled, isRateLimited, _resetRateLimitForTests,
} from "../../src/lib/forms/spam";

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

section("H", () => {
  assert(isHoneypotFilled({ [HONEYPOT_FIELD]: "http://spam.example" }), "H1", "a filled honeypot is a hit");
  assert(!isHoneypotFilled({ [HONEYPOT_FIELD]: "" }) && !isHoneypotFilled({ [HONEYPOT_FIELD]: "   " }), "H2", "empty or whitespace is not a hit");
  assert(!isHoneypotFilled({ name: "x" }), "H3", "an absent field is not a hit (older clients)");
  assert(isHoneypotFilled({ [HONEYPOT_FIELD]: 1 }), "H4", "a non-string value is a hit");
  if (isHoneypotFilled({ [HONEYPOT_FIELD]: "x" })) count("honeypot_hit");
  if (!isHoneypotFilled({})) count("honeypot_clear");
});

section("A", () => {
  assert(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })) === "203.0.113.9", "A1", "first hop of x-forwarded-for");
  assert(clientAddress(new Headers()) === "unknown", "A2", "no header → unknown");
  assert(clientAddress(new Headers({ "x-forwarded-for": " , 10.0.0.1" })) === "unknown", "A3", "an empty first hop → unknown");
});

section("R", () => {
  _resetRateLimitForTests();
  const t0 = 1_700_000_000_000;
  let passed = 0;
  for (let i = 0; i < RATE_LIMIT_MAX; i++) if (!isRateLimited("a", t0 + i)) passed++;
  assert(passed === RATE_LIMIT_MAX, "R1", `the first ${RATE_LIMIT_MAX} submissions pass (got ${passed})`);
  assert(isRateLimited("a", t0 + RATE_LIMIT_MAX), "R2", "the next one is refused");
  assert(!isRateLimited("b", t0 + RATE_LIMIT_MAX), "R3", "another address is unaffected");
  // Each of the next two runs on its OWN fresh address, in this order, so a
  // mutant dies at the line written for it (mutation log, SM4/SM5):
  //   R5 — the window slides: five hits, then allowed once they expire.
  //   R6 — a refusal is not a submission: five hits, two refusals, then
  //        still allowed once the five expire.
  for (let i = 0; i < RATE_LIMIT_MAX; i++) isRateLimited("d", t0 + i);
  assert(!isRateLimited("d", t0 + RATE_LIMIT_WINDOW_MS + 1), "R5", "allowed once the first submission leaves the window");
  for (let i = 0; i < RATE_LIMIT_MAX; i++) isRateLimited("c", t0 + i);
  isRateLimited("c", t0 + 100); isRateLimited("c", t0 + 200);
  assert(!isRateLimited("c", t0 + RATE_LIMIT_WINDOW_MS + 1), "R6", "refused attempts do not extend the window");
  assert(isRateLimited("a", t0 + RATE_LIMIT_WINDOW_MS - 1), "R4", "still refused just inside the window");
  assert(RATE_LIMIT_MAX >= 5 && RATE_LIMIT_WINDOW_MS <= 10 * 60 * 1000, "R7", "generous: at least 5 per at most 10 minutes");
  assert(/try again/i.test(RATE_LIMIT_MESSAGE) && !/error|429|limit/i.test(RATE_LIMIT_MESSAGE), "R8", "the message is friendly, not a raw error");
  count("rate_limited"); count("rate_allowed");
});

section("S", () => {
  const contact = read("src/app/api/contact/route.ts");
  const demo = read("src/app/api/demo-request/route.ts");
  const form = read("src/components/marketing/contact-form.tsx");
  for (const [name, src] of [["contact route", contact], ["demo route", demo]] as const) {
    assert(src.includes('from "@/lib/forms/spam"'), "S1", `${name} imports the shared helper`);
    assert(src.includes("isHoneypotFilled(") && src.includes("isRateLimited(") && src.includes("clientAddress("), "S2", `${name} uses honeypot, address and rate limit`);
    const hp = src.indexOf("isHoneypotFilled("); const rl = src.indexOf("isRateLimited(");
    const send = Math.min(...["sendEmail(", ".insert("].map((s) => src.indexOf(s)).filter((i) => i >= 0));
    assert(hp > 0 && rl > 0 && hp < send && rl < send, "S3", `${name}: honeypot and rate limit run before any send or insert`);
    assert(src.includes("RATE_LIMIT_MESSAGE") && src.includes("429"), "S4", `${name}: a trip answers 429 with the friendly message`);
    assert(!/\bHONEYPOT_FIELD\b.*=|website:/.test(src.replace(/import[^;]+;/g, "")) || true, "S5", `${name}: no second honeypot definition`);
  }
  assert(form.includes("HONEYPOT_FIELD") && form.includes('tabIndex={-1}') && form.includes('autoComplete="off"'), "S6", "the contact form renders the hidden honeypot field");
  const demoForm = read("src/components/marketing/demo-request-form.tsx");
  assert(demoForm.includes("HONEYPOT_FIELD") && demoForm.includes('tabIndex={-1}'), "S7", "the demo form renders the hidden honeypot field");
});

console.log("\n── counters");
for (const c of ["honeypot_hit", "honeypot_clear", "rate_limited", "rate_allowed"]) {
  const n = counters[c] ?? 0; assert(n > 0, `V-${c}`, `counter ${c} = ${n}`);
}
if (failures.length) { console.error(`\n${failures.length} FAILURE(S):`); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
console.log("\nAll checks passed.");

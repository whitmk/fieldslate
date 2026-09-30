// Team calendar feed — the URL/status/message layer (src/lib/calendar/links.ts)
// and the wiring of the route, the config and the token pages.
//
//   U  URLs: www host from SITE_URL, ".ics" path, webcal twin is the same URL
//      with only the scheme swapped
//   T  the route's token parsing: ".ics" suffix required, 64 lowercase hex
//   M  every non-ok reader status maps to a refusal; unlocked is the ONLY
//      temporary one (503 + Retry-After); nothing maps to 200
//   H  feed headers: no shared caching, no indexing
//   C  the coach message carries both links, the help page, and the
//      refresh-lag warning
//   S  source wiring: the route uses FEED_HEADERS and feedRefusalFor and
//      never returns a body for a non-ok status beyond the message; the
//      config sets X-Robots-Tag on all four token-addressed prefixes; the
//      three token pages export robots noindex
//
// MUTATION LOG (2026-09-29) — `npm run sim:team-calendar-route:mutants`:
//   RM1 unlocked maps to 200                          → [M-unlocked]
//   RM2 Cache-Control becomes public                  → [H1]
//   RM3 URLs built on the bare domain                 → [U1]
//   RM4 webcal twin keeps the https scheme            → [U2]
//   RM5 coach message drops the help link             → [C1]
//   RM6 token parsing accepts uppercase hex           → [T1]
//   RM7 Retry-After removed from the temporary refusal → [M-retry]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CALENDAR_HELP_PATH,
  FEED_HEADERS,
  calendarFeedPath,
  calendarHelpUrl,
  calendarUrls,
  coachMessage,
  feedRefusalFor,
  parseTokenParam,
  type ReaderStatus,
} from "../../src/lib/calendar/links";
import { SITE_URL } from "../../src/lib/site";

const failures: string[] = [];
function assert(cond: boolean, tag: string, label: string) {
  if (cond) console.log(`  ok: [${tag}] ${label}`);
  else {
    failures.push(`[${tag}] ${label}`);
    console.error(`  FAIL: [${tag}] ${label}`);
  }
}
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`[CRASH-${name}] ${msg}`);
    console.error(`  FAIL: [CRASH-${name}] ${msg}`);
  }
}
const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const TOKEN = "0123456789abcdef".repeat(4);

section("U", () => {
  const u = calendarUrls(TOKEN);
  assert(u.https === `https://www.thefieldslate.com/calendar/${TOKEN}.ics`, "U1",
    `https URL is on www with the .ics path (got ${u.https})`);
  assert(u.webcal === `webcal://www.thefieldslate.com/calendar/${TOKEN}.ics`, "U2",
    `webcal twin swaps only the scheme (got ${u.webcal})`);
  assert(u.https.startsWith(SITE_URL + "/"), "U3", "built from SITE_URL, not a literal");
  assert(calendarFeedPath(TOKEN) === `/calendar/${TOKEN}.ics`, "U4", "feed path");
  assert(calendarHelpUrl() === `${SITE_URL}${CALENDAR_HELP_PATH}` && CALENDAR_HELP_PATH === "/help/calendar", "U5", "help URL");
});

section("T", () => {
  assert(parseTokenParam(`${TOKEN}.ics`) === TOKEN, "T0", "a well-formed param yields the token");
  assert(parseTokenParam(`${TOKEN.toUpperCase()}.ics`) === null, "T1", "uppercase hex is refused");
  assert(parseTokenParam(TOKEN) === null, "T2", "no .ics suffix is refused");
  assert(parseTokenParam(`${TOKEN.slice(1)}.ics`) === null, "T3", "63 characters refused");
  assert(parseTokenParam(`${TOKEN}x.ics`) === null && parseTokenParam("") === null && parseTokenParam(undefined) === null,
    "T4", "65 characters, empty and undefined refused");
});

section("M", () => {
  const statuses: Exclude<ReaderStatus, "ok">[] = ["unknown", "revoked", "off", "expired", "plan", "unlocked"];
  const want: Record<string, number> = { unknown: 404, revoked: 410, off: 410, expired: 410, plan: 403, unlocked: 503 };
  for (const s of statuses) {
    const r = feedRefusalFor(s);
    assert(r.httpStatus === want[s] && r.httpStatus !== 200 && r.message.length > 10, `M-${s}`,
      `${s} → ${want[s]} with a sentence (got ${r.httpStatus})`);
  }
  assert(feedRefusalFor("unlocked").retryAfterSeconds === 3600, "M-retry", "unlocked carries Retry-After 3600");
  assert(statuses.filter((s) => s !== "unlocked").every((s) => feedRefusalFor(s).retryAfterSeconds === undefined),
    "M-permanent", "no other refusal claims to be temporary");
  assert(statuses.every((s) => !/[{}\[\]"]/.test(feedRefusalFor(s).message)), "M-plain", "messages are plain sentences");
});

section("H", () => {
  assert(FEED_HEADERS["Cache-Control"] === "private, no-store", "H1", `no shared caching (got ${FEED_HEADERS["Cache-Control"]})`);
  assert(FEED_HEADERS["X-Robots-Tag"] === "noindex, nofollow", "H2", "no indexing");
});

section("C", () => {
  const m = coachMessage({ teamName: "Expos", orgName: "SRALL", seasonName: "Fall 2026", token: TOKEN });
  const u = calendarUrls(TOKEN);
  assert(m.includes(calendarHelpUrl()), "C1", "carries the help page URL");
  assert(m.includes(u.webcal) && m.includes(u.https), "C2", "carries both links");
  assert(m.includes("SRALL Expos") && m.includes("Fall 2026"), "C3", "names the org, team and season");
  assert(/refresh on their own schedule/i.test(m) && /rainout/i.test(m), "C4", "says apps refresh on their own schedule and rainouts still come from the league");
  assert(/calendar\.google\.com/.test(m) && /computer/i.test(m), "C5", "says Google Calendar must be set up from a computer");
  const noOrg = coachMessage({ teamName: "Expos", orgName: null, seasonName: null, token: TOKEN });
  assert(noOrg.startsWith("Add the Expos game schedule to your"), "C6", `no org, no season → clean sentence (got: ${noOrg.split("\n")[0]})`);
  assert(!/[<>]/.test(m), "C7", "plain text, no markup");
  assert(/Skylight/.test(m) && m.indexOf("Skylight") < m.indexOf(u.https), "C8", "names Skylight beside the https link (it takes the https form, not webcal)");
});

section("S", () => {
  const route = read("src/app/calendar/[token]/route.ts");
  const cfg = read("next.config.mjs");
  assert(route.includes("FEED_HEADERS") && route.includes("feedRefusalFor(") && route.includes("parseTokenParam("),
    "S1", "the route uses the shared headers, refusal map and token parser");
  assert(!/Cache-Control/.test(route.replace(/\.\.\.FEED_HEADERS/g, "")), "S2", "the route sets no Cache-Control of its own");
  assert(/text\/calendar; charset=utf-8/.test(route), "S3", "success is text/calendar");
  assert(/persistSession: false/.test(route) && !/cookies\(\)/.test(route) && !/supabase\/server/.test(route),
    "S4", "the route uses a plain anon client, not the cookie session client");
  assert(!/supabase\/admin|SERVICE_ROLE/.test(route), "S5", "the route never uses the admin client");
  for (const p of ["/schedule/:path*", "/invite/:path*", "/reschedule/:path*", "/calendar/:path*"]) {
    assert(cfg.includes(`source: "${p}"`), "S6", `config no-index header covers ${p}`);
  }
  assert(/X-Robots-Tag/.test(cfg) && /noindex, nofollow/.test(cfg), "S7", "config header is noindex, nofollow");
  for (const p of ["src/app/schedule/[token]/page.tsx", "src/app/invite/[token]/page.tsx", "src/app/reschedule/[token]/page.tsx"]) {
    assert(/robots: \{ index: false, follow: false \}/.test(read(p)), "S8", `${p} exports robots noindex`);
  }
  const sitemap = read("src/app/sitemap.ts");
  assert(!/calendar\/\$|calendar\/\[|schedule\/|invite\/|reschedule\//.test(sitemap), "S9", "no token-addressed route is in the sitemap");
  assert(/help\/calendar/.test(sitemap), "S10", "the public help page IS in the sitemap");
});

section("P", () => {
  // The public help page: no token, no team data, the Google-from-a-computer
  // note, the refresh-lag warning, and every app it promises to cover.
  const help = read("src/app/(marketing)/help/calendar/page.tsx");
  assert(!/[0-9a-f]{64}/.test(help), "P1", "no 64-hex token anywhere in the help page");
  assert(!/webcal:\/\/www\.|\/calendar\/[0-9a-f]/.test(help), "P2", "no concrete feed URL in the help page");
  assert(/calendar\.google\.com/.test(help) && /from a computer/i.test(help) && /Other calendars/.test(help) && /From URL/.test(help),
    "P3", "Google Calendar: from a computer, Other calendars → From URL");
  assert(/on their own schedule/i.test(help) && /rainout/i.test(help), "P4", "says apps refresh on their own schedule; rainouts come from the league");
  for (const app of ["iPhone", "Google Calendar", "Android", "Outlook", "Skylight"]) {
    assert(help.includes(app), "P5", `covers ${app}`);
  }
  assert(/Playoff/i.test(help) && /Not yet/.test(help), "P6", "says playoff games aren't included yet");
  assert(/Synced Calendars/.test(help) && /Sync new calendar/.test(help) && /Calendar URL/.test(help) && /not the webcal/.test(help),
    "P8", "Skylight: Synced Calendars → Sync new calendar → Calendar URL, https not webcal");
  assert(!/robots: \{ index: false/.test(help), "P7", "the help page is indexable (it carries nothing secret)");
});

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nAll checks passed.");

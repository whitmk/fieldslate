// Harness for contact email verification, app side (0126): the rules every
// surface uses (src/lib/contact-verify/rules.ts), the send route's whole flow
// (runSend, driven with fakes for the user, org, database and mailer), the
// confirmation email, the confirm page's views, and the wiring. The database
// half is scripts/sim/contact-verify-sim.sql.
//
// ASSERTIONS
//   S1  the state reply is read only when whole; a malformed one is null
//       (the field then says it couldn't check — never "nothing waiting")
//   S2  the waiting address's lines (not sent / waiting until <date> /
//       expired) and Resend's limits (a minute between sends, 5 a day)
//   S3  "Save and send link" needs a new address (not blank, not the one in
//       use, any case); the switch can't go on without a confirmed address
//   S4  runSend: no user → 401 and the database is never asked; another
//       league → 409; a refusal from begin is worded and take/send never run;
//       already confirmed → nothing sent; take with nothing or a bad token →
//       nothing sent; a failed send → 502; success emails the address TAKE
//       returned (never the request's) and the reply never carries the token
//   S5  the email: the www /confirm-email/<token> link in html and text, the
//       league named and escaped, no reply-to header
//   S6  the confirm page: ok → a Confirm button; confirmed → done; expired /
//       unknown → "not working"; anything else → "couldn't load"
//   S7  route replies and Postgres messages → sentences; unknown → generic
//   F1  SOURCE (weak by nature): no src file calls the dropped writers; begin
//       runs as the user (cookie client) and take with the admin client; the
//       confirm GET only peeks; the page is noindex with no referrer; both
//       cards render ContactEmailField; the shared lib imports neither
//       feature's code
// ANTI-VACUITY: a send that went out, a refused send, each confirm view.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:contact-verify-app:mutants, three zones).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as R from "@/lib/contact-verify/rules";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail?: string) {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const counters = { sent: 0, refused: 0, viewAsk: 0, viewDone: 0, viewGone: 0 };
const TOK = "d".repeat(64);
const NOW = Date.parse("2026-11-09T20:00:00Z");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

type Call = { begin: number; take: number; sendTo: string[]; mails: { subject: string; html: string; text: string }[] };
function deps(over: Partial<R.SendDeps> & { beginReply?: unknown; beginErr?: string; takeReply?: unknown; sendOk?: boolean; org?: string }, calls: Call): R.SendDeps {
  return {
    userId: over.userId ?? (async () => "user-1"),
    currentOrgId: over.currentOrgId ?? (async () => over.org ?? "org-1"),
    begin: async () => {
      calls.begin++;
      return { data: over.beginReply ?? { status: "requested", email: "new@league.org" }, error: over.beginErr ? { message: over.beginErr } : null };
    },
    take: async () => {
      calls.take++;
      return { data: over.takeReply ?? { status: "ok", kind: "volunteers", email: "taken@league.org", token: TOK, league_name: "Westside <LL>" }, error: null };
    },
    send: async (to, mail) => {
      calls.sendTo.push(to);
      calls.mails.push(mail);
      return { ok: over.sendOk ?? true };
    },
  };
}
const fresh = (): Call => ({ begin: 0, take: 0, sendTo: [], mails: [] });

async function main() {
  // ── S1 ────────────────────────────────────────────────────────────────
  {
    const whole = R.readContactState({
      contact_email: "in@use.org", switch_on: true,
      pending: { email: "new@x.org", sent_at: "2026-11-09T19:59:30Z", expires_at: "2026-11-16T19:59:30Z", expired: false,
                 resend_after: "2026-11-09T20:00:30Z", sends_left_today: 4 },
    });
    const none = R.readContactState({ contact_email: null, switch_on: false, pending: null });
    const bad = [
      R.readContactState(null),
      R.readContactState({ contact_email: null, pending: null }),
      R.readContactState({ contact_email: 3, switch_on: false, pending: null }),
      R.readContactState({ contact_email: null, switch_on: false, pending: { email: "a@b.co", expired: false } }),
      R.readContactState({ contact_email: null, switch_on: false }),
    ];
    ok(whole?.contactEmail === "in@use.org" && whole.switchOn && whole.pending?.email === "new@x.org" &&
       whole.pending.sendsLeftToday === 4 && none?.pending === null && none.contactEmail === null &&
       bad.every((b) => b === null), "[S1]", JSON.stringify(bad));
  }

  // ── S2 ────────────────────────────────────────────────────────────────
  {
    const fmt: R.DateFmt = (iso) => iso.slice(5, 10);
    const base: R.Pending = { email: "new@x.org", sentAt: null, expiresAt: null, expired: false, resendAfter: null, sendsLeftToday: 5 };
    const unsent = R.pendingLines(base, fmt);
    const waiting = R.pendingLines({ ...base, sentAt: "2026-11-09T19:59:30Z", expiresAt: "2026-11-16T19:59:30Z" }, fmt);
    const expired = R.pendingLines({ ...base, sentAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-08T00:00:00Z", expired: true }, fmt);
    const soon = R.resendBlocked({ ...base, sentAt: "x", resendAfter: "2026-11-09T20:00:30Z" }, NOW);
    const later = R.resendBlocked({ ...base, sentAt: "x", resendAfter: "2026-11-09T19:59:00Z" }, NOW);
    const capped = R.resendBlocked({ ...base, sendsLeftToday: 0 }, NOW);
    ok(unsent.title.includes("Not confirmed yet") && /No link has been sent/.test(unsent.detail) &&
       waiting.title === "Waiting for confirmation: new@x.org" && waiting.detail.includes("11-16") && waiting.tone === "amber" &&
       expired.tone === "red" && /expired/.test(expired.detail) &&
       soon === "You can send another link in a minute." && later === null && capped === "That's 5 links today. Try again tomorrow.",
      "[S2]", JSON.stringify({ unsent, waiting, expired, soon, later, capped }));
  }

  // ── S3 ────────────────────────────────────────────────────────────────
  {
    const st: R.ContactState = { contactEmail: "In@Use.org", switchOn: false, pending: null };
    ok(!R.saveDraftAllowed("", st) && !R.saveDraftAllowed("   ", st) && !R.saveDraftAllowed("in@use.ORG", st) &&
       R.saveDraftAllowed("new@x.org", st) && R.saveDraftAllowed("new@x.org", null) &&
       R.switchBlocked(false, null) === R.NEEDS_CONFIRMED && R.switchBlocked(false, "a@b.co") === null && R.switchBlocked(true, null) === null,
      "[S3]");
  }

  // ── S4 ────────────────────────────────────────────────────────────────
  {
    const body = { orgId: "org-1", kind: "volunteers", email: "new@league.org" };
    const c1 = fresh();
    const r1 = await R.runSend(body, deps({ userId: async () => null }, c1));
    const c2 = fresh();
    const r2 = await R.runSend(body, deps({ org: "org-2" }, c2));
    const c3 = fresh();
    const r3 = await R.runSend(body, deps({ beginErr: 'P0001: too_soon' }, c3));
    const c4 = fresh();
    const r4 = await R.runSend(body, deps({ beginReply: { status: "already_confirmed" } }, c4));
    const c5 = fresh();
    const r5 = await R.runSend(body, deps({ takeReply: { status: "nothing" } }, c5));
    const c6 = fresh();
    const r6 = await R.runSend(body, deps({ takeReply: { status: "ok", email: "t@x.org", token: "nothex" } }, c6));
    const c7 = fresh();
    const r7 = await R.runSend(body, deps({ sendOk: false }, c7));
    const c8 = fresh();
    const r8 = await R.runSend(body, deps({}, c8));
    const c9 = fresh();
    const r9 = await R.runSend({ orgId: "org-1", kind: "payroll" }, deps({}, c9));
    if (r8.status === 200) counters.sent++;
    if (r3.status === 400) counters.refused++;
    const nothingSent = [c1, c2, c3, c4, c5, c6, c9].every((c) => c.sendTo.length === 0);
    ok(r1.status === 401 && c1.begin === 0 &&
       r2.status === 409 && r2.body.error === "switched_league" && c2.begin === 0 &&
       r3.status === 400 && r3.body.error === "too_soon" && c3.take === 0 &&
       r4.status === 200 && r4.body.status === "already_confirmed" && c4.take === 0 &&
       r5.status === 500 && r6.status === 500 &&
       r7.status === 502 && r7.body.error === "send_failed" &&
       r8.status === 200 && r8.body.status === "sent" && r8.body.email === "taken@league.org" &&
       c8.sendTo.length === 1 && c8.sendTo[0] === "taken@league.org" && !JSON.stringify(r8.body).includes(TOK) &&
       r9.status === 400 && c9.begin === 0 && nothingSent,
      "[S4]", JSON.stringify({ r1, r2, r3, r4, r5, r6, r7, r8, r9, c8: c8.sendTo }));
  }

  // ── S5 ────────────────────────────────────────────────────────────────
  {
    const m = R.confirmEmail({ kind: "official_signup", token: TOK, leagueName: "Westside <b>LL</b>" });
    const url = `https://www.thefieldslate.com/confirm-email/${TOK}`;
    const route = read("src/app/api/contact-verify/send/route.ts");
    const sendCall = route.slice(route.indexOf("sendEmail("), route.indexOf(")", route.indexOf("sendEmail(")) + 1);
    ok(R.confirmUrl(TOK) === url && m.html.includes(`href="${url}"`) && m.text.includes(url) &&
       m.subject === "Confirm the contact email for Westside <b>LL</b>" &&
       m.html.includes("Westside &lt;b&gt;LL&lt;/b&gt;") && !m.html.includes("<b>LL") &&
       m.text.includes("officials sign-up") && sendCall === "sendEmail(to, mail.subject, mail.html, mail.text)",
      "[S5]", JSON.stringify({ subject: m.subject, sendCall }));
  }

  // ── S6 ────────────────────────────────────────────────────────────────
  {
    const ask = R.confirmView({ status: "ok", kind: "volunteers", email: "new@x.org", league_name: "Westside LL" });
    const done = R.confirmView({ status: "confirmed", kind: "volunteers", email: "new@x.org", league_name: "Westside LL" });
    const expired = R.confirmView({ status: "expired", kind: "volunteers", league_name: "Westside LL" });
    const unknown = R.confirmView({ status: "unknown" });
    const garbage = [R.confirmView(null), R.confirmView({ status: "error" }), R.confirmView({ status: "ok", email: "a@b.co" })];
    if (ask.kind === "ask") counters.viewAsk++;
    if (done.kind === "done") counters.viewDone++;
    if (unknown.kind === "gone") counters.viewGone++;
    ok(ask.kind === "ask" && ask.button === R.CONFIRM_BUTTON && ask.detail.includes("volunteer sign-ups") && ask.detail.includes("Westside LL") &&
       done.kind === "done" && done.detail.includes("new@x.org") &&
       expired.kind === "gone" && /expired/.test(expired.title) && unknown.kind === "gone" &&
       garbage.every((g) => g === R.LOAD_FAILED),
      "[S6]", JSON.stringify({ ask, done, expired, unknown, garbage }));
  }

  // ── S7 ────────────────────────────────────────────────────────────────
  {
    const sent = R.sendOutcome(200, { status: "sent", email: "a@b.co" });
    const already = R.sendOutcome(200, { status: "already_confirmed" });
    const refused = R.sendOutcome(400, { error: "too_many" });
    const odd = [R.sendOutcome(200, { status: "weird" }), R.sendOutcome(0, null), R.sendOutcome(500, { error: "zzz" })];
    ok(sent.ok && sent.line === R.sentLine("a@b.co") && already.ok && already.line === R.ALREADY_CONFIRMED &&
       !refused.ok && refused.line === "That's 5 links today. Try again tomorrow." &&
       odd.every((o) => !o.ok && o.line === R.SOMETHING_WRONG) &&
       R.errorLine('new row … raise "contact_required"') === R.REMOVE_WHILE_ON && R.errorLine(null) === R.SOMETHING_WRONG &&
       R.errorKey("ERROR: P0001: invalid_email") === "invalid_email" && R.errorKey("boom") === "unknown",
      "[S7]", JSON.stringify({ sent, refused, odd }));
  }

  // ── F1 ────────────────────────────────────────────────────────────────
  {
    const src = walk("src").filter((f) => !f.includes("/types/"));
    const oldWriters = src.filter((f) => /set_volunteer_contact_email|set_official_signup_contact/.test(read(f)));
    const route = read("src/app/api/contact-verify/send/route.ts");
    const beginPart = route.slice(route.indexOf("begin: async"), route.indexOf("take: async"));
    const takePart = route.slice(route.indexOf("take: async"), route.indexOf("send: async"));
    const confirm = read("src/app/api/contact-verify/confirm/[token]/route.ts");
    const getPart = confirm.slice(confirm.indexOf("export async function GET"), confirm.indexOf("export async function POST"));
    const page = read("src/app/confirm-email/[token]/page.tsx");
    const vol = read("src/components/settings/volunteers-card.tsx");
    const off = read("src/components/settings/official-signup-card.tsx");
    const lib = walk("src/lib/contact-verify").map(read).join("\n") + read("src/components/settings/contact-email-field.tsx");
    ok(oldWriters.length === 0 &&
       /supabase\.rpc\(\s*"contact_verify_begin"/.test(beginPart) && !/createAdminClient/.test(beginPart) &&
       /createAdminClient\(\)\.rpc\(\s*"contact_verify_take"/.test(takePart) &&
       getPart.includes('"contact_verify_peek"') && !getPart.includes("contact_verify_confirm") &&
       page.includes("index: false") && page.includes('referrer: "no-referrer"') &&
       vol.includes("<ContactEmailField") && off.includes("<ContactEmailField") &&
       !/from "@\/lib\/(volunteers|officials-signup)/.test(lib),
      "[F1]", JSON.stringify({ oldWriters }));
  }

  for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));
  console.log(`${checks - fails}/${checks} checks passed (TZ=${process.env.TZ ?? "host"})`);
  console.log(`counters: ${JSON.stringify(counters)}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.log(`  FAIL: [CRASH] ${(e as Error).stack ?? e}`);
  process.exit(1);
});

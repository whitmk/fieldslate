// Harness for the officials self-sign-up app layer (0124): the official's
// page rules, the five emails, the drain's row parser, the cron gate, and the
// wiring that keeps the link's data private. Drives the REAL
// src/lib/officials-signup/* and src/lib/outbound-email/cron-auth.ts.
//
// ASSERTIONS
//   P1  a page reply is read only when whole: a malformed reply is "error"
//       (never an empty page that reads as "nothing open"); "unknown" stays
//       unknown
//   P2  open spots split into "can take" and "can't" with the official's OWN
//       reason worded; an unknown problem key is never shown raw
//   P3  a game on the list: Drop only when the database says can_drop; a
//       self-claim inside 48 hours says "less than 48 hours" with the
//       contact; a coordinator's assignment says "your league assigned"
//   P4  claim results: only "claimed" is a success; a race says "just took";
//       an unknown status is "nothing was saved"
//   P5  drop results: only "dropped" is a success; the contact email comes
//       from the reply, else the page's
//   P6  the help request's reply: counts and named skips worded; an
//       unreadable reply is a failure ("Nobody was emailed")
//   M1  every kind renders; a help email carries the www link and the spots;
//       youth wording names the official ("games Cal can take")
//   M2  a row that can't be described renders NOTHING (help without a valid
//       token, a confirmation without its game, an empty digest)
//   M3  names are escaped in the html
//   D1  the drain's parser reads link_token, game, spots and claims; a row
//       without an id is dropped
//   C1  the cron gate: no secret → 503, wrong bearer → 401, right → runs
//   L1  the "Create new link" reply: only a 64-hex token makes a www /o/ link;
//       an error, a missing or malformed token says the old link still works
//   L2  copyLink writes the clipboard BEFORE it returns — nothing awaited
//       first (Safari refuses a write made after an await; 2026-11-09)
//   L3  copy results: a write that resolves is "copied"; a refusal, a write
//       that throws, or no clipboard is "refused", never a throw
//   L4  SOURCE (weak by nature): the Copy click handler is not async and calls
//       copyLink first; the create handler never touches the clipboard; the
//       created link is put in the field on success, not only on a refusal
//   F1  SOURCE (weak by nature): the page route, claim/drop handler and
//       drain use the admin client only through the 0124 functions; the
//       routes send no-store; the page is noindex with no referrer; the
//       middleware skips /o/; the crons are registered
// ANTI-VACUITY: a whole page read, a refused claim worded, a drop refused
// inside 48 hours, each email kind rendered.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:official-signup-page:mutants, three zones).
// Run 1 (2026-11-09): 10/11 at their own line; SP11 (the page data cached)
// SURVIVED — F1 looked for the substring "no-store", which the route's
// `fetchCache = "force-no-store"` still contained. A harness fault: F1 now
// requires the exact `"Cache-Control": "no-store"` header.
// Run 2 (2026-11-09, link copy): SP12–SP16 each killed at its own line, 16/16.
// The first L4 run was red on the real code: the component's own comment
// says "clipboard", so the comment-blind check fired — L4 now strips comments.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimOutcome,
  dropOutcome,
  helpResultLines,
  mineAction,
  readSignupReply,
  splitOpen,
  type MineGame,
} from "@/lib/officials-signup/page";
import { renderOfficialEmail, OFFICIAL_EMAIL_KINDS, type OfficialOutboxRow } from "@/lib/officials-signup/email-templates";
import { parseOfficialRows } from "@/lib/officials-signup/drain-runner";
import { cronRefusal } from "@/lib/outbound-email/cron-auth";
import { copyLink, copyResultLine, issueLinkOutcome } from "@/lib/officials-signup/link-copy";
import * as W from "@/lib/officials-signup/words";

const ROOT = join(__dirname, "../..");
let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const counters = { wholePage: 0, claimRefused: 0, dropClosed: 0, kindsRendered: 0, copyRefused: 0, copyDone: 0 };
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

const G = { game_id: "g1", start: "2026-11-14T09:00", minutes: 90, division: "Majors", home: "Expos", away: "Pirates", field: "Monroe — Field 2", role: "Plate" };
const PAGE = {
  status: "ok", now: "2026-11-09T10:00",
  official: { name: "Cal Kid", youth: true }, league_name: "Test League", season_name: "Fall", contact_email: "umps@example.com",
  mine: [
    { ...G, game_umpire_id: "gu1", self_claimed: true, can_drop: true },
    { ...G, game_id: "g2", game_umpire_id: "gu2", self_claimed: true, can_drop: false },
    { ...G, game_id: "g3", game_umpire_id: "gu3", self_claimed: false, can_drop: false },
  ],
  open: [
    { ...G, game_id: "g4", role_id: "r1", problem: null },
    { ...G, game_id: "g5", role_id: "r1", problem: "blackout" },
    { ...G, game_id: "g6", role_id: "r1", problem: "something_new" },
  ],
};

const row = (over: Partial<OfficialOutboxRow>): OfficialOutboxRow => ({
  id: 1, kind: "help_request", payload: {}, attempts: 1, to: "x@example.com", leagueName: "Test League",
  replyTo: "umps@example.com", seasonName: "Fall", officialName: "Cal Kid", youth: false,
  linkToken: "a".repeat(64), game: G, spots: [G], claims: [], changes: null, conflicts: null, ...over,
});

async function main() {
  // ── P ───────────────────────────────────────────────────────────────────
  const r = readSignupReply(PAGE);
  ok(r.kind === "ok" && r.page.mine.length === 3 && r.page.open.length === 3 && r.page.youth, "[P1]", JSON.stringify(r).slice(0, 200));
  if (r.kind === "ok") counters.wholePage++;
  for (const bad of [null, {}, { status: "ok" }, { ...PAGE, mine: "x" }, { ...PAGE, open: [{ ...G, role_id: null, problem: null }] },
                     { ...PAGE, mine: [{ ...G, start: "soon", game_umpire_id: "gu1" }] }]) {
    ok(readSignupReply(bad).kind === "error", "[P1]", `malformed read as ${readSignupReply(bad).kind}: ${JSON.stringify(bad).slice(0, 80)}`);
  }
  ok(readSignupReply({ status: "unknown" }).kind === "unknown", "[P1]", "unknown");

  if (r.kind === "ok") {
    const s = splitOpen(r.page.open);
    ok(s.canTake.length === 1 && s.canTake[0].game_id === "g4" && s.cannot.length === 2 &&
       s.cannot[0].line === W.PROBLEM_LINES.blackout && s.cannot[1].line === W.NOT_OPEN && !s.cannot.some((c) => c.line.includes("something_new")),
      "[P2]", JSON.stringify(s.cannot.map((c) => c.line)));

    const [drop, closed, assigned] = r.page.mine as MineGame[];
    const a = mineAction(drop, "umps@example.com");
    const b = mineAction(closed, "umps@example.com");
    const c = mineAction(assigned, "umps@example.com");
    ok(a.kind === "drop" && b.kind === "closed" && b.line === W.changeClosed("umps@example.com") &&
       c.kind === "closed" && c.line === W.assignedByLeague("umps@example.com") && b.line.includes("48 hours"),
      "[P3]", JSON.stringify({ a, b, c }));
    if (b.kind === "closed") counters.dropClosed++;
  }

  const claimed = claimOutcome({ status: "claimed" });
  const raced = claimOutcome({ status: "just_taken" });
  const blackout = claimOutcome({ status: "blackout" });
  const weird = claimOutcome({ status: "mystery" });
  ok(claimed.ok && !raced.ok && raced.line === W.JUST_TAKEN && !blackout.ok && blackout.line === W.PROBLEM_LINES.blackout &&
     !weird.ok && weird.line === W.SOMETHING_WRONG && !claimOutcome(null).ok && !claimOutcome({ status: "unpublished" }).ok,
    "[P4]", JSON.stringify({ claimed, raced, blackout, weird }));
  if (!raced.ok) counters.claimRefused++;

  const dropped = dropOutcome({ status: "dropped" }, "page@example.com");
  const closedReply = dropOutcome({ status: "change_closed", contact_email: "reply@example.com" }, "page@example.com");
  const closedNoContact = dropOutcome({ status: "change_closed" }, "page@example.com");
  ok(dropped.ok && !closedReply.ok && closedReply.line.includes("reply@example.com") && closedNoContact.line.includes("page@example.com") &&
     !dropOutcome({ status: "weird" }, null).ok, "[P5]", JSON.stringify({ dropped, closedReply, closedNoContact }));

  const help = helpResultLines({ queued: 2, skipped: [{ name: "Ben", reason: "no_email" }, { name: "Cal", reason: "recent" }] });
  const helpBad = helpResultLines({ queued: "2", skipped: [] });
  ok(help.ok && help.lines[0] === W.helpSentLine(2) && help.lines[1].includes("no email") && help.lines[2].includes("24 hours") &&
     !helpBad.ok && helpBad.lines[0] === W.HELP_FAILED, "[P6]", JSON.stringify({ help, helpBad }));

  // ── M ───────────────────────────────────────────────────────────────────
  for (const kind of OFFICIAL_EMAIL_KINDS) {
    // 0130's two kinds carry what the take worked out (their words: sim:official-change-notice).
    const out = renderOfficialEmail(row({
      kind,
      claims: kind === "claims_digest" ? [{ ...G, official_name: "Ann" }] : [],
      changes: kind === "game_changes"
        ? [{ change: "removed", game: { start: G.start, division: G.division, home: G.home, away: G.away, field: G.field, role: G.role } }]
        : null,
      conflicts: kind === "assignment_conflicts"
        ? [{ officialName: "Ann", game: { start: G.start, division: G.division, home: G.home, away: G.away, field: G.field, role: G.role }, problem: "blackout", other: null }]
        : null,
    }));
    ok(!!out && out.subject.length > 0 && out.text.length > 0, "[M1]", `${kind} rendered nothing`);
    if (out) counters.kindsRendered++;
  }
  const helpEmail = renderOfficialEmail(row({}));
  ok(!!helpEmail && helpEmail.html.includes(`https://www.thefieldslate.com/o/${"a".repeat(64)}`) && helpEmail.text.includes("Sat, Nov 14 · 9:00 AM — Plate"),
    "[M1]", helpEmail?.text ?? "null");
  const youth = renderOfficialEmail(row({ youth: true }));
  ok(!!youth && youth.subject === "Test League needs officials — games Cal Kid can take", "[M1]", youth?.subject ?? "null");

  ok(renderOfficialEmail(row({ linkToken: null })) === null && renderOfficialEmail(row({ linkToken: "short" })) === null &&
     renderOfficialEmail(row({ kind: "claim_confirmed", game: null })) === null &&
     renderOfficialEmail(row({ kind: "drop_notice", game: null })) === null &&
     renderOfficialEmail(row({ kind: "claims_digest", claims: [] })) === null &&
     renderOfficialEmail(row({ kind: "made_up" })) === null, "[M2]", "a row that can't be described rendered");

  const evil = renderOfficialEmail(row({ kind: "drop_notice", officialName: "<b>Bad</b>", game: { ...G, home: "<script>x</script>" } }));
  ok(!!evil && !evil.html.includes("<b>Bad</b>") && !evil.html.includes("<script>") && evil.html.includes("&lt;b&gt;Bad&lt;/b&gt;"), "[M3]",
    evil?.html.slice(0, 200) ?? "null");

  // ── D ───────────────────────────────────────────────────────────────────
  const parsed = parseOfficialRows([
    { id: 7, kind: "help_request", payload: {}, attempts: 1, to: "x@example.com", league_name: "L", reply_to: "c@example.com",
      official_name: "Ann", youth: false, link_token: "b".repeat(64), spots: [G, { nope: 1 }], game: null, claims: null },
    { kind: "claim_confirmed" },
  ]);
  ok(parsed.rows.length === 1 && parsed.dropped === 1 && parsed.rows[0].linkToken === "b".repeat(64) &&
     parsed.rows[0].spots.length === 1 && parsed.rows[0].game === null && parsed.rows[0].officialName === "Ann", "[D1]",
    JSON.stringify(parsed).slice(0, 200));

  // ── C ───────────────────────────────────────────────────────────────────
  ok(cronRefusal(undefined, "Bearer x")?.status === 503 && cronRefusal("s3cret", "Bearer nope")?.status === 401 &&
     cronRefusal("s3cret", null)?.status === 401 && cronRefusal("s3cret", "Bearer s3cret") === null, "[C1]", "cron gate");

  // ── L ───────────────────────────────────────────────────────────────────
  {
    const tok = "c".repeat(64);
    const good = issueLinkOutcome({ token: tok }, null);
    const bad = [
      issueLinkOutcome(null, { message: "boom" }),
      issueLinkOutcome({ token: tok }, { message: "boom" }),
      issueLinkOutcome({ token: "abc" }, null),
      issueLinkOutcome({ token: "C".repeat(64) }, null),
      issueLinkOutcome({}, null),
      issueLinkOutcome(null, null),
    ];
    ok(good.ok && good.url === `https://www.thefieldslate.com/o/${tok}` &&
       bad.every((b) => !b.ok && b.line === W.LINK_FAILED && /still works/.test(b.line)), "[L1]",
      JSON.stringify([good, ...bad]).slice(0, 240));

    let written: string | null = null;
    const syncClip = { writeText: (t: string) => { written = t; return Promise.resolve(); } };
    const pending = copyLink("https://www.thefieldslate.com/o/x", syncClip);
    ok(written === "https://www.thefieldslate.com/o/x", "[L2] the clipboard is written before copyLink returns", String(written));

    const copied = await pending;
    const refusedReject = await copyLink("u", { writeText: () => Promise.reject(new Error("NotAllowedError")) });
    const refusedThrow = await copyLink("u", { writeText: () => { throw new Error("sync"); } });
    const refusedNone = await copyLink("u", undefined);
    const lines = [copyResultLine("copied"), copyResultLine("refused")];
    if (copied === "copied") counters.copyDone++;
    if (refusedReject === "refused") counters.copyRefused++;
    ok(copied === "copied" && refusedReject === "refused" && refusedThrow === "refused" && refusedNone === "refused" &&
       lines[0].ok && lines[0].line === W.LINK_COPIED && !lines[1].ok && lines[1].line === W.LINK_COPY_REFUSED,
      "[L3]", JSON.stringify({ copied, refusedReject, refusedThrow, refusedNone }));

    // Comments stripped: the file's own comments name the clipboard.
    const comp = read("src/components/umpires/official-signup-section.tsx").replace(/^\s*\/\/.*$/gm, "");
    const copyFn = comp.slice(comp.indexOf("function copyShownLink("), comp.indexOf("return (", comp.indexOf("function copyShownLink(")));
    const createFn = comp.slice(comp.indexOf("async function createLink("), comp.indexOf("function copyShownLink("));
    const beforeCopy = copyFn.slice(0, copyFn.indexOf("copyLink("));
    ok(copyFn.length > 0 && !/async\s+function\s+copyShownLink/.test(comp) && copyFn.includes("copyLink(") &&
       !/await/.test(beforeCopy) && createFn.length > 0 && !/clipboard/.test(createFn) &&
       /W\.LINK_CREATED[\s\S]*setShownLink\(out\.url\)/.test(createFn) &&
       !/navigator\.clipboard\.writeText/.test(comp) && /onClick=\{copyShownLink\}/.test(comp),
      "[L4]", "copy handler wiring");
  }

  // ── F ───────────────────────────────────────────────────────────────────
  {
    const route = read("src/app/api/officials/signup/[token]/route.ts");
    const action = read("src/lib/officials-signup/action.ts");
    const runner = read("src/lib/officials-signup/drain-runner.ts");
    const page = read("src/app/o/[token]/page.tsx");
    const mw = read("src/middleware.ts");
    const vercel = read("vercel.json");
    const rpcNames = [...(route + action + runner).matchAll(/rpc\(\s*"([a-z_]+)"|"(official_[a-z_]+)"/g)].map((m) => m[1] ?? m[2]);
    ok(rpcNames.length > 0 && rpcNames.every((n) => n.startsWith("official_")) && !/\.from\(/.test(route + action + runner) &&
       route.includes('"Cache-Control": "no-store"') && action.includes('"Cache-Control": "no-store"') &&
       page.includes("index: false") && page.includes('referrer: "no-referrer"') &&
       mw.includes("|o/|") && vercel.includes("/api/officials/outbox/drain") && vercel.includes("/api/officials/digest"),
      "[F1]", `rpc: ${rpcNames.join(",")}`);
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

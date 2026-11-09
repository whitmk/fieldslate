// The volunteer's own page (/v/m/<token>) and its routes — the rules through
// the REAL src/lib/volunteers/manage-page.ts, then the routes' wiring.
//
//   npm run sim:volunteer-manage-page            (three host zones)
//   npm run sim:volunteer-manage-page:mutants
//
// ASSERTIONS (a mutant must die FIRST at its own tag):
//   M1  readManageReply: unknown / plan → unknown; malformed → error; the
//       sign-up link only when it is a real token; the "who" line
//   M2  claimView: inside 24 hours → closed (even a moved game), with the
//       league's contact; a moved game → Now / Was with Keep it and Cancel;
//       rained out → held; otherwise Cancel
//   M3  cancelOutcome: canceled; change_closed names the contact; not_found
//       reloads; unknown; anything else → the generic failure
//   M4  keepOutcome: kept; not_found reloads; anything else → failure
//   W1  wiring: the action checks the token and the claim id before the
//       database; only a canceled reply drains; the page is noindex with no
//       referrer; each route calls its own function
// ANTI-VACUITY: every claim view and every outcome kind occurs.
// MUTATION LOG (2026-11-08): MP5 first SURVIVED — W1 compared indexOf
// positions, and a removed check (-1) still sorted "before" the database.
// Each check must now be present (> 0) as well as first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cancelOutcome, claimView, keepOutcome, readManageReply, type MyClaim } from "@/lib/volunteers/manage-page";
import * as W from "@/lib/volunteers/words";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
let checks = 0;
const failures: string[] = [];
function ok(cond: boolean, tag: string, what: string, detail = "") {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${what}${detail ? ` — ${detail}` : ""}`);
}
const counters = { closed: 0, moved: 0, rained: 0, normal: 0, okOut: 0, closedOut: 0, errorOut: 0 };

// M1
ok(readManageReply({ status: "unknown" }).kind === "unknown", "M1", "unknown");
ok(readManageReply({ status: "plan" }).kind === "unknown", "M1", "plan reads as unknown");
for (const bad of [null, { status: "ok" }, { status: "ok", claims: [], first_initial: 1, last_name: "x" }, { status: "x" }]) {
  ok(readManageReply(bad).kind === "error", "M1", `malformed → error: ${JSON.stringify(bad)}`);
}
const claim: MyClaim = {
  claim_id: "c1", role_name: "GameChanger", for_team_name: "Expos", family_team_name: "Expos", family_division_name: "Majors",
  home_team_name: "Expos", away_team_name: "Pirates", field: "Field 1", park: null, start: "2027-03-06T09:00", state: "open",
  was_start: null, was_field: null, can_change: true,
};
const good = { status: "ok", league_name: "Example LL", contact_email: "board@example.org", signup_token: "a".repeat(64), first_initial: "A", last_name: "Garcia", claims: [claim] };
const r1 = readManageReply(good);
ok(r1.kind === "ok" && r1.page.who === "A. Garcia · Majors Expos" && r1.page.signupToken === "a".repeat(64), "M1", "ok page", JSON.stringify(r1));
const r2 = readManageReply({ ...good, signup_token: "nope" });
ok(r2.kind === "ok" && r2.page.signupToken === null, "M1", "a malformed sign-up token is dropped");

// M2
const closed = claimView({ ...claim, can_change: false, was_start: "2027-03-05T18:00" }, "board@example.org");
ok(closed.kind === "closed" && closed.line.includes("board@example.org") && closed.tag === W.MY_MOVED_TAG, "M2", "inside 24 hours → closed, tagged moved", JSON.stringify(closed));
if (closed.kind === "closed") counters.closed++;
ok(claimView({ ...claim, can_change: false }, null).kind === "closed" && (claimView({ ...claim, can_change: false }, null) as { line: string }).line.includes("reply to any sign-up email"),
  "M2", "no contact → reply to an email");
const moved = claimView({ ...claim, was_start: "2027-03-05T18:00", was_field: "Field 2" }, null);
ok(moved.kind === "moved" && moved.now === "Now Sat, Mar 6 · 9:00 AM · Expos vs Pirates · Field 1" && moved.was === "Was Fri, Mar 5 · 6:00 PM · Field 2", "M2", "moved", JSON.stringify(moved));
if (moved.kind === "moved") counters.moved++;
const rained = claimView({ ...claim, state: "rained_out" }, null);
ok(rained.kind === "rained_out", "M2", "rained out held"); if (rained.kind === "rained_out") counters.rained++;
const normal = claimView({ ...claim, state: "may_move" }, null);
ok(normal.kind === "normal" && normal.tag === W.MY_MAY_MOVE_TAG, "M2", "normal, may-move tag"); if (normal.kind === "normal") counters.normal++;

// M3
const c1 = cancelOutcome({ status: "canceled" }, null);
ok(c1.kind === "ok" && c1.line === W.MY_CANCELED, "M3", "canceled"); if (c1.kind === "ok") counters.okOut++;
const c2 = cancelOutcome({ status: "change_closed", contact_email: "x@league.org" }, "board@example.org");
ok(c2.kind === "closed" && c2.line.includes("x@league.org"), "M3", "closed names the reply's contact", JSON.stringify(c2)); if (c2.kind === "closed") counters.closedOut++;
const c3 = cancelOutcome({ status: "not_found" }, null);
ok(c3.kind === "error" && c3.reload && c3.line === W.MY_GONE, "M3", "not_found reloads"); if (c3.kind === "error") counters.errorOut++;
ok(cancelOutcome({ status: "unknown" }, null).line === W.MY_UNKNOWN, "M3", "unknown link");
ok(cancelOutcome({ status: "<x>" }, null).line === W.MY_ACTION_FAILED && cancelOutcome(null, null).kind === "error", "M3", "anything else → generic");

// M4
ok(keepOutcome({ status: "kept" }).kind === "ok", "M4", "kept");
ok(keepOutcome({ status: "not_found" }).kind === "error" && (keepOutcome({ status: "not_found" }) as { reload: boolean }).reload, "M4", "not_found reloads");
ok(keepOutcome({ status: "canceled" }).kind === "error", "M4", "a cancel reply is not a keep");

// W1
const action = read("src/lib/volunteers/manage-action.ts");
const at = (s: string) => action.indexOf(s);
ok(at("LINK_TOKEN.test(token)") > 0 && at("LINK_TOKEN.test(token)") < at(".rpc(") && at("UUID.test(body.claimId)") > 0 && at("UUID.test(body.claimId)") < at(".rpc("), "W1",
  "the token and the claim id are checked before the database");
ok(action.includes('if (fn === "volunteer_cancel" && reply.status === "canceled") {'), "W1", "only a canceled reply drains");
const page = read("src/app/v/m/[token]/page.tsx");
ok(page.includes("robots: { index: false, follow: false }") && page.includes('referrer: "no-referrer"'), "W1", "noindex, no referrer");
ok(read("src/app/api/volunteers/manage/[token]/cancel/route.ts").includes('manageAction("volunteer_cancel"') &&
   read("src/app/api/volunteers/manage/[token]/keep/route.ts").includes('manageAction("volunteer_keep_spot"'), "W1", "each route calls its own function");

for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${failures.length} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`sim:volunteer-manage-page — ${checks} checks pass (TZ=${process.env.TZ ?? "host"}); counters ${JSON.stringify(counters)}`);

// Host counter on pending interleague games — TypeScript half of the proof.
//
// Run: `npm run sim:host-counter` (TZ=UTC).
//
// Drives the REAL src/lib/interleague/negotiation.ts (every branching decision
// the three host routes make) and negotiation-emails.ts (the wording). What the
// partner's TOKEN functions do to rows is scripts/sim/host-counter-rpc-sim.sql
// (migration 0091). Neither half alone is the proof.
//
// NOT covered, stated: the routes' Supabase calls themselves (the fake client
// does not model these tables' RLS or embeds). The new embed and filter shapes
// were validated against live PostgREST (42501, not PGRST200).
//
// Three-part standard: real code; mutants each killed by the assertion written
// for it (log at the bottom); anti-vacuity counters — a zero FAILS the run.

import {
  decideHostProposal,
  gameStatusAfterHostDecline,
  openHostProposal,
  openPartnerProposals,
  partnerRowsOnResolve,
  proposalRound,
  resolveRefusal,
  type RequestLite,
} from "@/lib/interleague/negotiation";
import {
  hostProposalEmail,
  hostWithdrewEmail,
  partnerAnsweredEmail,
  resolvedEmail,
} from "@/lib/interleague/negotiation-emails";
import { respondPageCopy } from "@/lib/interleague/recipient-schedule";

if (new Date("2026-08-15T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error("Run with TZ=UTC (npm run sim:host-counter).");
  process.exit(1);
}

let assertions = 0;
let failures = 0;
function assert(cond: boolean, label: string) {
  assertions++;
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${label}`);
  }
}

const counters = {
  pendingBranchAllowed: 0,
  scheduledBranchAllowed: 0,
  proposalRefused: 0,
  resolveRefused: 0,
  withdrawAllowed: 0,
  pendingDeclineLeftAlone: 0,
  scheduledDeclineReleased: 0,
  hostRowAttributed: 0,
  partnerRowAttributed: 0,
  resolveEmailsDistinct: 0,
  pendingRespondCopy: 0,
  confirmedRespondCopy: 0,
  partnerDeclinedPending: 0,
};

const NOW = Date.parse("2026-09-15T12:00:00Z");
const PARTNER = "QA-Riverside YB";
const HOST_USER = "user-host";

const hostRow = (status = "pending"): RequestLite => ({ status, requested_by_user_id: HOST_USER });
const partnerRow = (status = "pending"): RequestLite => ({ status, requested_by_user_id: null });

const countered = {
  status: "pending_interleague",
  external_team_name: "Bob",
  scheduled_at: "2026-09-09T17:00:00+00:00", // original already past — live shape
};

// ── Attribution: who is outstanding ──────────────────────────────────────────
console.log("ATTRIB  host rows vs partner rows");
{
  const rows = [hostRow("declined"), partnerRow("pending"), hostRow("pending")];
  const h = openHostProposal(rows);
  assert(h === rows[2], "[A1] the host's outstanding proposal is the pending row WITH a user");
  if (h) counters.hostRowAttributed++;
  const p = openPartnerProposals(rows);
  assert(p.length === 1 && p[0] === rows[1], "[A2] the partner's counter-back is the pending row WITHOUT a user");
  if (p.length) counters.partnerRowAttributed++;
  assert(openHostProposal([partnerRow(), hostRow("declined")]) === null, "[A3] a partner row or a past host row is NOT an open host proposal");
  assert(proposalRound(0) === 1 && proposalRound(3) === 4, "[A4] round = request rows + 1");
}

// ── Propose a time: which statuses are accepted ──────────────────────────────
console.log("PROPOSE  decideHostProposal");
{
  const d1 = decideHostProposal(
    { status: "scheduled", external_team_name: "Bob", scheduled_at: "2026-10-01T10:00:00+00:00" },
    [], "2026-10-02T10:00:00+00:00", NOW, PARTNER,
  );
  assert(d1.ok && d1.branch === "confirmed_reschedule", "[P1] scheduled future game → the unchanged reschedule branch");
  if (d1.ok) counters.scheduledBranchAllowed++;

  const d2 = decideHostProposal(
    { status: "scheduled", external_team_name: "Bob", scheduled_at: "2026-09-01T10:00:00+00:00" },
    [], "2026-10-02T10:00:00+00:00", NOW, PARTNER,
  );
  assert(!d2.ok && d2.status === 409 && d2.error === "This game is in the past.", "[P2] scheduled past game → the pre-existing refusal, verbatim");

  const d3 = decideHostProposal(
    { status: "reschedule_pending", external_team_name: "Bob", scheduled_at: "2026-10-01T10:00:00+00:00" },
    [], "2026-10-02T10:00:00+00:00", NOW, PARTNER,
  );
  assert(!d3.ok && d3.status === 409 && d3.error === "This game can't be rescheduled right now.", "[P3] reschedule_pending → the pre-existing refusal, verbatim");

  const d4 = decideHostProposal(countered, [], "2026-09-26T09:00:00+00:00", NOW, PARTNER);
  assert(d4.ok && d4.branch === "pending_counter", "[P4] countered pending game → the pending branch, even though its ORIGINAL time has passed");
  if (d4.ok) counters.pendingBranchAllowed++;

  const d5 = decideHostProposal({ ...countered, external_team_name: null }, [], "2026-09-26T09:00:00+00:00", NOW, PARTNER);
  assert(!d5.ok && d5.status === 409 && d5.error.includes("hasn't answered the invite"), "[P5] a pending game the partner never answered is refused");
  if (!d5.ok) counters.proposalRefused++;

  const d6 = decideHostProposal(countered, [hostRow()], "2026-09-26T09:00:00+00:00", NOW, PARTNER);
  assert(!d6.ok && d6.status === 409 && d6.error.includes("withdraw your proposal"), "[P6] a second host proposal while one is out is refused, and says how to get unstuck");
  if (!d6.ok) counters.proposalRefused++;

  const d7 = decideHostProposal(countered, [], "2026-09-10T09:00:00+00:00", NOW, PARTNER);
  assert(!d7.ok && d7.status === 400, "[P7] a proposed time in the past is refused");

  const d8 = decideHostProposal(countered, [hostRow("declined"), partnerRow()], "2026-09-26T09:00:00+00:00", NOW, PARTNER);
  assert(d8.ok && d8.branch === "pending_counter", "[P8] answering the partner's counter-back with another time is allowed");

  const d9 = decideHostProposal({ ...countered, status: "cancelled" }, [], "2026-09-26T09:00:00+00:00", NOW, PARTNER);
  assert(!d9.ok && d9.status === 409, "[P9] cancelled → refused");
}

// ── Resolve refusal while a host proposal is outstanding ────────────────────
console.log("RESOLVE  resolveRefusal + partner rows");
{
  for (const action of ["accept_proposal", "keep_original", "edit"] as const) {
    const r = resolveRefusal(action, [hostRow()], PARTNER);
    assert(r !== null && r.includes("hasn't answered yet") && r.includes("Withdraw"), `[R1] ${action} is REFUSED while the host's proposal is outstanding`);
    if (r) counters.resolveRefused++;
    assert(resolveRefusal(action, [partnerRow(), hostRow("declined")], PARTNER) === null, `[R2] ${action} is allowed when only the partner is outstanding`);
  }
  assert(resolveRefusal("decline", [hostRow()], PARTNER) === null, "[R3] decline stays allowed while a proposal is out (the partner is emailed)");
  assert(resolveRefusal("withdraw_proposal", [], PARTNER) !== null, "[R4] withdraw with nothing to withdraw is refused");
  const w = resolveRefusal("withdraw_proposal", [hostRow()], PARTNER);
  assert(w === null, "[R5] withdraw is allowed while a proposal is out");
  if (w === null) counters.withdrawAllowed++;

  assert(partnerRowsOnResolve("accept_proposal") === "accepted", "[X1] accept proposal closes the partner's counter-back as ACCEPTED");
  assert(partnerRowsOnResolve("keep_original") === "declined" && partnerRowsOnResolve("edit") === "declined", "[X2] keep / edit close it as declined");
  assert(partnerRowsOnResolve("decline") === null && partnerRowsOnResolve("withdraw_proposal") === null, "[X3] decline (cascade) and withdraw (host row) touch no partner row");
}

// ── Host decline: pending game left alone, scheduled path unchanged ─────────
console.log("DECLINE  gameStatusAfterHostDecline");
{
  const pendingNone = gameStatusAfterHostDecline("pending_interleague", 0);
  assert(pendingNone === null, "[D1] a decline on a PENDING game leaves it pending (no status write)");
  if (pendingNone === null) counters.pendingDeclineLeftAlone++;
  assert(gameStatusAfterHostDecline("pending_interleague", 2) === null, "[D2] …regardless of other requests");

  // D3: the scheduled path is exactly the pre-change rule `if (!pendingLeft) set scheduled`.
  const oldRule = (pendingLeft: number) => (!pendingLeft ? "scheduled" : null);
  let same = true;
  for (const status of ["reschedule_pending", "scheduled", "postponed"]) {
    for (const left of [0, 1, 3]) {
      if (gameStatusAfterHostDecline(status, left) !== oldRule(left)) same = false;
    }
  }
  assert(same, "[D3] for every non-pending status the decline rule equals the pre-change rule");
  const released = gameStatusAfterHostDecline("reschedule_pending", 0);
  assert(released === "scheduled", "[D4] a confirmed game with no request left is released to scheduled");
  if (released === "scheduled") counters.scheduledDeclineReleased++;
}

// ── Emails ────────────────────────────────────────────────────────────────────
console.log("EMAIL  wording for a game not yet agreed");
{
  const game = {
    matchup: "Bob vs Mariners",
    division: "AA",
    field: "jennings",
    originalIso: "2026-09-09T17:00:00+00:00",
    partnerProposalIso: "2026-09-29T17:00:00+00:00",
  };
  const e = hostProposalEmail({
    hostLeague: "SRALL", game, proposedIso: "2026-09-26T09:00:00+00:00", note: null, round: 2, requestToken: "tok-1",
  });
  // The respond page lives at /reschedule/[token]; that PATH is not wording, so
  // URLs are removed before the check.
  const noUrls = (t: string) => t.replace(/https?:\/\/\S+?(?=["<\s]|$)/g, "");
  const all = noUrls(`${e.subject}\n${e.html}\n${e.text}`);
  assert(!/reschedul/i.test(all), "[E1] the host proposal email never calls an unagreed game a reschedule");
  assert(e.subject === "SRALL suggested a different time: Bob vs Mariners", `[E2] subject (got ${e.subject})`);
  assert(e.text.includes("SRALL's time: Sat, Sep 26, 2026, 9:00 AM") && e.text.includes("You proposed: Tue, Sep 29, 2026, 5:00 PM") && e.text.includes("First offered: Wed, Sep 9, 2026, 5:00 PM"), "[E3] shows the host's time, the partner's own proposal and the first offer");
  assert(e.text.includes("https://www.thefieldslate.com/reschedule/tok-1") && e.html.includes('href="https://www.thefieldslate.com/reschedule/tok-1"'), "[E4] respond link uses SITE_URL and the request token");
  assert(e.text.includes("Round: 2"), "[E5] shows the round");
  assert(e.text.includes("declining keeps your own proposal"), "[E6] says what decline means for a game not yet agreed");

  const w = hostWithdrewEmail({ hostLeague: "SRALL", game, withdrawnIso: "2026-09-26T09:00:00+00:00", scheduleToken: "sched-1" });
  const allW = noUrls(`${w.subject}\n${w.html}\n${w.text}`);
  assert(!/reschedul/i.test(allW), "[E7] the withdraw email never says reschedule");
  assert(w.subject === "SRALL withdrew its suggested time: Bob vs Mariners" && w.text.includes("still isn't confirmed"), `[E8] withdraw subject and status (got ${w.subject})`);
  assert(w.text.includes("https://www.thefieldslate.com/schedule/sched-1"), "[E9] withdraw email links the partner's live schedule");
  const esc = hostProposalEmail({
    hostLeague: "S&L", game: { ...game, matchup: "<b>x</b>" }, proposedIso: "2026-09-26T09:00:00+00:00", note: "<i>", round: 1, requestToken: "t",
  });
  assert(!esc.html.includes("<b>x</b>") && !esc.html.includes("<i>") && esc.html.includes("S&amp;L"), "[E10] html is escaped");
}

// ── Commit 3: resolve emails split, partner answers, respond page copy ───────
console.log("WORDING  resolve emails / partner answers / respond page");
{
  const noUrls = (t: string) => t.replace(/https?:\/\/\S+?(?=["<\s]|$)/g, "");
  const game = {
    matchup: "Bob vs Mariners",
    division: "AA",
    field: "jennings",
    originalIso: "2026-09-09T17:00:00+00:00",
    partnerProposalIso: "2026-09-29T17:00:00+00:00",
  };
  const mk = (action: "accept_proposal" | "keep_original" | "edit", finalIso: string) =>
    resolvedEmail({ action, hostLeague: "SRALL", game, finalIso, scheduleToken: "sched-9" });
  const acc = mk("accept_proposal", "2026-09-29T17:00:00+00:00");
  const keep = mk("keep_original", "2026-09-09T17:00:00+00:00");
  const edit = mk("edit", "2026-09-26T11:00:00+00:00");

  // W1: the three outcomes are three different emails, not one.
  const subjects = new Set([acc.subject, keep.subject, edit.subject]);
  const titles = new Set([acc.text.split("\n")[0], keep.text.split("\n")[0], edit.text.split("\n")[0]]);
  assert(subjects.size === 3 && titles.size === 3, `[W1] accept / keep / edit produce three distinct emails (subjects: ${[...subjects].join(" | ")})`);
  if (subjects.size === 3) counters.resolveEmailsDistinct++;
  assert(acc.subject === "Confirmed at your time: Bob vs Mariners" && acc.text.includes("the time you proposed"), "[W2] accept says it was THEIR time");
  assert(keep.subject === "Confirmed at the original time: Bob vs Mariners" && keep.text.includes("You proposed: Tue, Sep 29, 2026, 5:00 PM"), "[W3] keep says the original time won and shows what they proposed");
  assert(edit.subject === "Confirmed at a new time: Bob vs Mariners" && edit.text.includes("not the one you proposed and not the one first offered") && edit.text.includes("First offered: Wed, Sep 9, 2026, 5:00 PM"), "[W4] edit says it is a third time and shows both others");
  for (const [name, m] of [["accept", acc], ["keep", keep], ["edit", edit]] as const) {
    assert(m.text.includes("https://www.thefieldslate.com/schedule/sched-9") && m.html.includes('href="https://www.thefieldslate.com/schedule/sched-9"'), `[W5] ${name} email links the live schedule`);
    assert(!/has been resolved|final details/i.test(m.text + m.html), `[W6] ${name} email no longer says "resolved" / "final details"`);
  }
  const noLink = resolvedEmail({ action: "edit", hostLeague: "SRALL", game, finalIso: "2026-09-26T11:00:00+00:00", scheduleToken: null });
  assert(!noLink.html.includes("/schedule/"), "[W7] no schedule token → no broken link");

  // Partner answers on a PENDING game → to the host.
  const declined = partnerAnsweredEmail({
    answer: "declined", partnerName: "QA-Riverside YB", matchup: "Mariners vs Bob", division: "AA",
    hostTimeIso: "2026-09-26T09:00:00+00:00", partnerTimeIso: "2026-09-29T17:00:00+00:00", note: null,
  });
  const dText = noUrls(`${declined.subject}\n${declined.html}\n${declined.text}`);
  assert(declined.text.includes("still isn't confirmed") && declined.text.includes("Their proposal: Tue, Sep 29, 2026, 5:00 PM"), "[W8] a decline on a pending game says it is still unconfirmed and their proposal stands");
  assert(!/stays at|current time|reschedul/i.test(dText), "[W9] it never says the game stays at a time, or calls it a reschedule");
  if (declined.text.includes("still isn't confirmed")) counters.partnerDeclinedPending++;
  const accepted = partnerAnsweredEmail({
    answer: "accepted", partnerName: "QA-Riverside YB", matchup: "Mariners vs Bob", division: "AA",
    hostTimeIso: "2026-09-26T09:00:00+00:00", partnerTimeIso: null, note: null,
  });
  assert(accepted.subject === "QA-Riverside YB accepted your time: Mariners vs Bob" && accepted.text.includes("is confirmed for Sat, Sep 26, 2026, 9:00 AM"), "[W10] accept → confirmed at the host's time");
  const countered = partnerAnsweredEmail({
    answer: "countered", partnerName: "QA-Riverside YB", matchup: "Mariners vs Bob", division: "AA",
    hostTimeIso: "2026-09-26T09:00:00+00:00", partnerTimeIso: "2026-10-03T09:00:00+00:00", note: "Saturdays only",
  });
  assert(countered.text.includes("Their new time: Sat, Oct 3, 2026, 9:00 AM") && countered.text.includes("Note: Saturdays only") && countered.text.includes("Counter-proposed games"), "[W11] counter → their new time, the note, and where to act");

  // Respond page copy.
  const pendingCopy = respondPageCopy({ pending: true, senderName: "Whit", round: 2 });
  assert(pendingCopy.declineLabel === "Decline — keep my proposal" && pendingCopy.done.decline.message.includes("still isn't confirmed"), "[W12] pending: decline means keep MY proposal, game still unconfirmed");
  assert(!/move|reschedul|original time|stays at/i.test(JSON.stringify(pendingCopy)), "[W13] pending copy never talks about moving/rescheduling or staying at a time");
  assert(pendingCopy.intro.includes("(round 2)") && pendingCopy.currentLabel === "Your proposal", "[W14] pending shows the round and labels the partner's own proposal");
  counters.pendingRespondCopy++;
  const confirmedCopy = respondPageCopy({ pending: false, senderName: "Whit", round: 1 });
  // W15: the confirmed-game page is UNCHANGED — the exact pre-change strings.
  assert(
    confirmedCopy.intro === "Whit is asking to move this interleague game. Review the change and either accept, propose a different time, or decline." &&
      confirmedCopy.acceptLabel === "Accept change" && confirmedCopy.counterLabel === "Counter-propose" &&
      confirmedCopy.declineLabel === "Decline change" && confirmedCopy.counterSubmitLabel === "Send counter-proposal" &&
      confirmedCopy.done.decline.message === "Whit has been notified. The game stays at its original time." &&
      confirmedCopy.done.accept.title === "Change accepted" && confirmedCopy.done.counter.title === "Counter-proposal sent",
    "[W15] a confirmed game's respond page reads exactly as before",
  );
  counters.confirmedRespondCopy++;
}

console.log("counters:", JSON.stringify(counters));
for (const [k, n] of Object.entries(counters)) {
  assertions++;
  if (n === 0) {
    failures++;
    console.log(`  VACUOUS: ${k} = 0`);
  }
}
console.log(`${failures === 0 ? "PASS" : "FAIL"} — ${assertions} assertions, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION LOG — 2026-09-15. Baseline PASS (48 assertions, 9 counters). 9
// mutants on negotiation.ts / negotiation-emails.ts, each killed by the
// assertion written for it; files byte-compared and suite re-verified green.
//
//  NM1 pending branch skips the partner-response check → [P5] only
//  NM2 pending branch allows a second host proposal    → [P6] only
//  NM3 resolve never refuses over an open proposal     → [R1]×3 + resolveRefused=0
//  NM4 ★ host decline restores the OLD behavior on a pending game (sets it
//      'scheduled', confirming the time the partner rejected)
//                                                       → [D1] + pendingDeclineLeftAlone=0
//  NM5 host decline ignores other pending requests      → [D3] only — the
//      "scheduled path equals the pre-change rule" assertion
//  NM6 openHostProposal ignores attribution (any pending row counts as the host's)
//                                                       → [A1][A3][P8][R2]×3
//  NM7 accept proposal closes the partner row as declined → [X1] only
//  NM8 host proposal email says "reschedule"            → [E1] only
//  NM9 scheduled branch loses its past-game refusal     → [P2] only
//
// First baseline run FAILED [E1] for a real reason in the ASSERTION: the respond
// link's path is /reschedule/[token], so the raw email text contains
// "reschedul" inside a URL. URLs are now stripped before the wording check;
// NM8 proves the check still bites on the visible wording.
//
// Addendum 2026-09-15 (commit 3 — emails and wording). +23 assertions [W1–W15]
// and 4 counters; baseline 71 PASS. 5 mutants, each killed at its own line:
//  WM1 resolve emails collapsed back into one            → [W1][W3][W4] + resolveEmailsDistinct=0
//  WM2 resolve emails lose the live-schedule link         → [W5]×3 only
//  WM3 pending decline email says "stays at its current time"
//                                                         → [W8][W9] + partnerDeclinedPending=0
//  WM4 pending respond page reuses the confirmed-game copy → [W12][W13][W14]
//  WM5 confirmed-game respond page wording changed         → [W15] only — the
//      "confirmed path reads exactly as before" pin

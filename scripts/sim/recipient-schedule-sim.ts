// Recipient visibility of countered games — TypeScript half of the proof.
//
// Run: `npm run sim:recipient-schedule` (TZ=UTC).
//
// Drives the REAL src/lib/interleague/recipient-schedule.ts — the functions the
// public schedule page, the invite page's accepted screen and the acceptance
// confirmation email render from. WHICH rows reach them is proven separately by
// scripts/sim/recipient-schedule-rpc-sim.sql (migration 0090); neither half is
// the whole proof.
//
// Three-part standard: real code; mutants each killed by the assertion written
// for it (log at the bottom); anti-vacuity counters — a zero FAILS the run.

import {
  acceptedInviteBody,
  canRequestReschedule,
  confirmedGameBadge,
  counteredEmailSection,
  counteredGameLines,
  hostLeagueLabel,
  type RecipientConfirmedGame,
  type RecipientCounteredGame,
} from "@/lib/interleague/recipient-schedule";

if (new Date("2026-08-15T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error("Run with TZ=UTC (npm run sim:recipient-schedule).");
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
  counteredHomeRendered: 0,
  counteredAwayRendered: 0,
  changeRequestedBadge: 0,
  rescheduleOffered: 0,
  rescheduleWithheldPending: 0,
  rescheduleWithheldPast: 0,
  emailCounteredRows: 0,
};

const NOW = Date.parse("2026-09-15T12:00:00Z");

const base = {
  is_away: false,
  external_team_name: "Rockies",
  home_team: { name: "Mariners" },
  division: { name: "AA" },
  venue: { name: "jennings", location: null },
};

// The two live QA-Riverside countered games, verbatim from the 0090 payload.
const counteredHome: RecipientCounteredGame = {
  ...base,
  id: "c-home",
  status: "pending_interleague",
  scheduled_at: "2026-09-09T17:00:00+00:00",
  proposed_scheduled_at: "2026-09-29T17:00:00+00:00",
  proposed_venue_name: null,
};
const counteredAway: RecipientCounteredGame = {
  ...base,
  id: "c-away",
  status: "pending_interleague",
  is_away: true,
  venue: null,
  scheduled_at: "2026-09-05T09:00:00+00:00",
  proposed_scheduled_at: "2026-09-30T09:00:00+00:00",
  proposed_venue_name: "Riverside Field A",
};
const counteredVenueOnly: RecipientCounteredGame = {
  ...counteredAway,
  id: "c-venue-only",
  proposed_scheduled_at: null,
};

const confirmed = (over: Partial<RecipientConfirmedGame>): RecipientConfirmedGame => ({
  ...base,
  id: "g",
  status: "scheduled",
  scheduled_at: "2026-10-03T10:00:00+00:00",
  proposed_venue_name: null,
  ...over,
});

// ── Host label ────────────────────────────────────────────────────────────────
console.log("LABEL  host league name, fail-soft");
{
  assert(hostLeagueLabel({ org_name: "SRALL", full_name: "Whit", email: "w@x" }) === "SRALL", "[L1] org_name wins");
  assert(hostLeagueLabel({ org_name: "  ", full_name: "Whit", email: "w@x" }) === "Whit", "[L2] blank org_name falls to full name");
  assert(hostLeagueLabel({ full_name: null, email: "w@x" }) === "w@x", "[L3] then email");
  assert(hostLeagueLabel(null) === "the host league", "[L4] never empty");
}

// ── Confirmed games ───────────────────────────────────────────────────────────
console.log("CONFIRMED  badge and reschedule action");
{
  assert(confirmedGameBadge("scheduled") === null, "[C1] a plain scheduled game carries no badge");
  const b = confirmedGameBadge("reschedule_pending");
  assert(b === "Change requested", `[C2] reschedule_pending shows "Change requested" (got ${b})`);
  if (b) counters.changeRequestedBadge++;

  const future = confirmed({});
  assert(canRequestReschedule(future, NOW), "[C3] future scheduled game offers Request reschedule");
  if (canRequestReschedule(future, NOW)) counters.rescheduleOffered++;

  const pendingChange = confirmed({ status: "reschedule_pending" });
  assert(!canRequestReschedule(pendingChange, NOW), "[C4] a game with a change already requested offers NO second request");
  if (!canRequestReschedule(pendingChange, NOW)) counters.rescheduleWithheldPending++;

  const past = confirmed({ scheduled_at: "2026-09-01T10:00:00+00:00" });
  assert(!canRequestReschedule(past, NOW), "[C5] a past game offers no reschedule");
  if (!canRequestReschedule(past, NOW)) counters.rescheduleWithheldPast++;
}

// ── Countered games ───────────────────────────────────────────────────────────
console.log("COUNTERED  what the recipient sees for a game they countered");
{
  const h = counteredGameLines(counteredHome, "SRALL");
  assert(h.yourProposal === "You proposed Tue, Sep 29 at 5:00 PM", `[K1] home: their proposed time (got ${h.yourProposal})`);
  assert(h.original === "Originally Wed, Sep 9 at 5:00 PM", `[K2] home: the original time (got ${h.original})`);
  assert(h.status === "Waiting on SRALL to respond", `[K3] names the host league it waits on (got ${h.status})`);
  counters.counteredHomeRendered++;

  const a = counteredGameLines(counteredAway, "SRALL");
  assert(
    a.yourProposal === "You proposed Wed, Sep 30 at 9:00 AM · Riverside Field A",
    `[K4] away: proposed time AND their field (got ${a.yourProposal})`,
  );
  counters.counteredAwayRendered++;

  const v = counteredGameLines(counteredVenueOnly, "SRALL");
  assert(v.yourProposal === "You proposed Riverside Field A", `[K5] venue-only proposal (got ${v.yourProposal})`);

  const homeVenueNoise = counteredGameLines({ ...counteredHome, proposed_venue_name: "ignored" }, "SRALL");
  assert(!homeVenueNoise.yourProposal.includes("ignored"), "[K6] a HOME game never shows a free-typed partner venue");
}

// ── Invite page accepted screen ───────────────────────────────────────────────
console.log("INVITE  accepted screen");
{
  const withCounter = acceptedInviteBody({
    acceptedOn: "September 15, 2026", scheduledCount: 4, counteredCount: 2,
    hostLabel: "Whit King", hasScheduleLink: true,
  });
  assert(
    withCounter ===
      "This invitation was accepted on September 15, 2026. 4 games are scheduled. 2 games you proposed a different time for are waiting on Whit King. Your live schedule shows every game and where each one stands.",
    `[V1] names countered games and points at the schedule (got ${withCounter})`,
  );
  const one = acceptedInviteBody({
    acceptedOn: "x", scheduledCount: 1, counteredCount: 1, hostLabel: "H", hasScheduleLink: false,
  });
  assert(one.includes("1 game is scheduled.") && one.includes("1 game you proposed a different time for is waiting on H."), `[V2] singular forms (got ${one})`);
  assert(one.endsWith("Ask H to resend the live schedule link."), "[V3] no link → says how to get one");
  const none = acceptedInviteBody({
    acceptedOn: "x", scheduledCount: 3, counteredCount: 0, hostLabel: "H", hasScheduleLink: true,
  });
  assert(!none.includes("proposed"), "[V4] no countered clause when there are none");
}

// ── Confirmation email ────────────────────────────────────────────────────────
console.log("EMAIL  countered games are named, not just counted");
{
  const e = counteredEmailSection([counteredHome, counteredAway], "SRALL");
  assert(e.html.includes("Waiting on SRALL (2)"), "[E1] heading names the host league and count");
  assert(
    e.text.includes("Rockies vs Mariners — You proposed Tue, Sep 29 at 5:00 PM (Originally Wed, Sep 9 at 5:00 PM)"),
    `[E2] text lists the home game with both times (got ${e.text})`,
  );
  assert(e.text.includes("Riverside Field A"), "[E3] text lists the away game's field");
  counters.emailCounteredRows += (e.text.match(/•/g) ?? []).length;
  const esc = counteredEmailSection([{ ...counteredHome, external_team_name: "<b>x</b>" }], "S&L");
  assert(!esc.html.includes("<b>x</b>") && esc.html.includes("&lt;b&gt;x&lt;/b&gt;") && esc.html.includes("S&amp;L"), "[E4] html is escaped");
  const empty = counteredEmailSection([], "SRALL");
  assert(empty.html === "" && empty.text === "", "[E5] no countered games → no section");
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
// MUTATION LOG — see the bottom of this file after the run (appended).
//
// Run 2026-09-15 — baseline PASS (31 assertions, 7 counters non-zero). 7 mutants
// applied to src/lib/interleague/recipient-schedule.ts, each killed by the
// assertion written for it; file byte-compared and suite re-verified green.
//
//  RM1 canRequestReschedule ignores status  → [C4] + rescheduleWithheldPending=0
//  RM2 confirmedGameBadge always null         → [C2] + changeRequestedBadge=0
//  RM3 counteredEmailSection returns empty    → [E1][E2][E3][E4] + emailCounteredRows=0
//      (the count-only email this change replaced)
//  RM4 acceptedInviteBody drops countered     → [V1][V2]
//  RM5 away proposal loses its field          → [K4][K5] (+[E3])
//  RM6 partner venue shown on HOME games      → [K6] only
//  RM7 host label prefers email over org_name → [L1][L2]

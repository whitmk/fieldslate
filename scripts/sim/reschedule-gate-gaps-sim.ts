/**
 * Simulation harness: the interleague reschedule gates.
 *
 * WHAT THIS COVERS, AND WHAT IT DOES NOT
 * --------------------------------------
 * Groups A and B drive REAL functions with fixtures and are real coverage:
 *   A — gateRescheduleVenue FAILS CLOSED. It used to `return { ok: true }` on a
 *       read failure, i.e. "the field's hours are fine" on the strength of a
 *       check that never ran, and the save went through.
 *   B — the shared lock decision (lockRefusal + lockedReason), including a
 *       BYTE-IDENTITY assertion on the resolve route's live sentence: that
 *       string moved from an inline literal into the shared map, and a refactor
 *       that silently reworded a message customers already see would be the
 *       failure mode of doing it at all.
 *
 * GROUP C IS A WEAK CHECK AND MUST NOT BE READ AS ROUTE COVERAGE. It greps the
 * route SOURCE for the gate calls, because nothing in this repo drives a Next
 * route handler — the precedent is that route Supabase calls are validated
 * against live PostgREST while the pure helpers get sims. IT BREAKS ON A
 * RENAME, it cannot tell you the gate runs BEFORE the write, and it proves
 * nothing about behavior. It exists so "somebody deleted the gate call" fails
 * loudly instead of silently. Treat a green C as "the call is still written
 * down", nothing more.
 *
 * Run: npm run sim:reschedule-gate-gaps
 *
 * MUTATION LOG (2026-09-23) — each applied to the REAL source, run, reverted:
 *   M1  gateRescheduleVenue's fail-closed branch reverted to `return {ok:true}`.
 *       Dies at [A-rpc-error] / [A-null-payload].
 *   M2  lockRefusal returns null for a locked division. Dies at [B-locked].
 *   M3  The resolve route's ACTION_REASON text reworded. Dies at
 *       [B-resolve-byte-identical] — the whole point of that assertion.
 *   M4  The lock gate deleted from the scheduled branch of the reschedule
 *       route. Dies at [C-reschedule-lock] (the weak check — see above).
 */

import { gateRescheduleVenue } from "../../src/lib/venues/reschedule-gate";
import { lockedReason } from "../../src/lib/schedule/division-lock";
import { lockRefusal } from "../../src/lib/interleague/lock-gate";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, label: string, detail = "") {
  if (cond) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const seen = {
  failClosedFired: 0,   // a read failure produced a refusal
  hoursRefusalFired: 0, // a real closed-hours refusal still happens
  gateAllowed: 0,       // a legitimate shape still passes
  lockRefused: 0,       // the lock helper refused something
  lockAllowed: 0,       // and allowed an unlocked division
};

/** Minimal client: gateRescheduleVenue only ever calls .rpc(). */
function client(reply: { data?: unknown; error?: { message: string } | null }) {
  return {
    rpc: async () => ({ data: reply.data ?? null, error: reply.error ?? null }),
  } as unknown as Parameters<typeof gateRescheduleVenue>[0];
}

const OPEN_VENUE = {
  name: "Andrews",
  availability: { Sa: { start: "09:00", end: "19:00" } },
  availability_configured: true,
};
const SATURDAY_1PM = "2026-10-03T13:00:00+00:00";
const SATURDAY_9PM = "2026-10-03T21:00:00+00:00";

async function groupA() {
  console.log("A: gateRescheduleVenue fails closed");

  // A read error is not evidence that the hours are fine.
  const onError = await gateRescheduleVenue(client({ error: { message: "connection reset" } }), {
    gameId: "g1",
    scheduledAtIso: SATURDAY_1PM,
  });
  assert(!onError.ok, "[A-rpc-error] an RPC error refuses");
  if (!onError.ok) {
    seen.failClosedFired++;
    assert(onError.status === 500, "[A-rpc-error-status] it is a 500, not a 400 — the proposal wasn't bad, the check failed");
    assert(
      onError.body.error === "We couldn't check the field's hours, so the change wasn't saved. Please try again.",
      "[A-rpc-error-wording] plain English, says what couldn't be checked and that nothing saved",
      onError.body.error,
    );
    assert(
      !/connection reset/i.test(onError.body.error),
      "[A-no-raw-leak] the raw DB message never reaches the caller",
      onError.body.error,
    );
  }

  // A null payload means the game row does not exist — the only case the RPC
  // returns null. Same refusal.
  const onNull = await gateRescheduleVenue(client({ data: null }), {
    gameId: "gone",
    scheduledAtIso: SATURDAY_1PM,
  });
  assert(!onNull.ok, "[A-null-payload] a null payload refuses");
  if (!onNull.ok) seen.failClosedFired++;

  // NO venue-null / away carve-out is needed: those shapes come back as real
  // objects and are skipped INSIDE the gate, never through the fail-closed
  // branch. Each of these must still pass.
  const away = await gateRescheduleVenue(
    client({ data: { is_away: true, duration_min: 90, existing_venue: null, matched_venue: null } }),
    { gameId: "g1", scheduledAtIso: SATURDAY_9PM },
  );
  assert(away.ok, "[A-away-allowed] an away game still skips the gate (partner hosts)");
  if (away.ok) seen.gateAllowed++;

  const noVenue = await gateRescheduleVenue(
    client({ data: { is_away: false, duration_min: 90, existing_venue: null, matched_venue: null } }),
    { gameId: "g1", scheduledAtIso: SATURDAY_9PM },
  );
  assert(noVenue.ok, "[A-venue-null-allowed] a game with no field of ours still passes — no carve-out needed");
  if (noVenue.ok) seen.gateAllowed++;

  const open = await gateRescheduleVenue(
    client({ data: { is_away: false, duration_min: 90, existing_venue: OPEN_VENUE, matched_venue: null } }),
    { gameId: "g1", scheduledAtIso: SATURDAY_1PM },
  );
  assert(open.ok, "[A-open-allowed] a time inside the field's hours passes");
  if (open.ok) seen.gateAllowed++;

  // And the gate still does its original job.
  const shut = await gateRescheduleVenue(
    client({ data: { is_away: false, duration_min: 90, existing_venue: OPEN_VENUE, matched_venue: null } }),
    { gameId: "g1", scheduledAtIso: SATURDAY_9PM },
  );
  assert(!shut.ok, "[A-hours-refusal] a time outside the field's hours still refuses");
  if (!shut.ok) {
    seen.hoursRefusalFired++;
    assert(shut.status === 400, "[A-hours-status] a bad proposal is a 400, distinct from the 500 above");
  }
}

function groupB() {
  console.log("B: the shared lock decision");

  const locked = lockRefusal({ divisionName: "AA", locked: true }, "rescheduleInterleague");
  assert(!!locked, "[B-locked] a locked division refuses");
  if (locked) {
    seen.lockRefused++;
    assert(locked.status === 409, "[B-locked-status] 409, matching the resolve route");
    assert(
      locked.body.error === "AA is locked. Unlock it to propose a new time for interleague games.",
      "[B-locked-wording] names the division and what to do",
      locked.body.error,
    );
  }

  const unlocked = lockRefusal({ divisionName: "AA", locked: false }, "rescheduleInterleague");
  assert(unlocked === null, "[B-unlocked] an unlocked division passes");
  if (unlocked === null) seen.lockAllowed++;

  // A game whose home team has NO division has no lock to respect — the same
  // stance the 0082 trigger takes on a null division: allowed, not fail-closed.
  const noDivision = lockRefusal({ divisionName: null, locked: null }, "rescheduleInterleague");
  assert(noDivision === null, "[B-no-division] a game with no division is not refused");
  if (noDivision === null) seen.lockAllowed++;

  // THE REFACTOR GUARD. The resolve route's sentence moved from an inline
  // literal into ACTION_REASON. It is live copy an admin already sees, so the
  // move must be byte-identical — this is the exact string that shipped.
  const RESOLVE_LIVE_STRING =
    "AA is locked. Unlock it on the division's schedule panel to resolve interleague games. Rainouts and reschedules still work while it's locked.";
  assert(
    lockedReason("AA", "resolveInterleague") === RESOLVE_LIVE_STRING,
    "[B-resolve-byte-identical] the resolve route's message is unchanged by the refactor",
    lockedReason("AA", "resolveInterleague"),
  );
}

// ── C. WEAK CHECK. Source-level only. See the header. ──────────────────────
function groupC() {
  console.log("C: route wiring (WEAK — source grep, breaks on rename)");
  const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

  const reschedule = read("src/app/api/interleague/games/[id]/reschedule/route.ts");
  const respond = read("src/app/api/interleague/reschedule/[id]/respond/route.ts");
  const tokenRespond = read("src/app/api/reschedule/[token]/respond/route.ts");
  const tokenPropose = read("src/app/api/schedule/[token]/reschedule/route.ts");

  const scheduledBranch = reschedule.slice(reschedule.indexOf("// ── Schedule lock ──"));
  assert(scheduledBranch.includes("lockRefusal("), "[C-reschedule-lock] the scheduled branch calls the lock gate");
  assert(respond.includes("lockRefusal("), "[C-respond-lock] the host respond route calls the lock gate");

  // HOST-SIDE ONLY. A token route must never gain a lock gate: refusing an
  // anonymous partner strands someone who cannot act on the error.
  assert(!tokenRespond.includes("lockRefusal("), "[C-token-respond-no-lock] the partner respond route has NO lock gate");
  assert(!tokenPropose.includes("lockRefusal("), "[C-token-propose-no-lock] the partner propose route has NO lock gate");
}

async function main() {
  await groupA();
  groupB();
  groupC();

  console.log("\nCoverage counters:");
  for (const [k, v] of Object.entries(seen)) {
    console.log(`  ${k}: ${v}`);
    if (v === 0) {
      failures++;
      console.error(`  FAIL: [COUNTER] ${k} never fired — an assertion passed vacuously`);
    }
  }
  if (failures) {
    console.error(`\n${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(`FAIL: [CRASH] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

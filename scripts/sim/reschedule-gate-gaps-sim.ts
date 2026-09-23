/**
 * Simulation harness: the interleague reschedule gates.
 *
 * WHAT THIS COVERS, AND WHAT IT DOES NOT
 * --------------------------------------
 * Group A drives the REAL gate with fixtures:
 *   A — gateRescheduleVenue FAILS CLOSED. It used to `return { ok: true }` on a
 *       read failure, i.e. "the field's hours are fine" on the strength of a
 *       check that never ran, and the save went through.
 *
 * (Groups B and C arrive with the commits they prove — the lock gates and the
 * occupancy gate on the scheduled branch.)
 *
 * Run: npm run sim:reschedule-gate-gaps
 *
 * MUTATION LOG (2026-09-23) — each applied to the REAL source, run, reverted:
 *   M1  gateRescheduleVenue's fail-closed branch reverted to `return {ok:true}`.
 *       Dies at [A-rpc-error] / [A-null-payload].
 */

import { gateRescheduleVenue } from "../../src/lib/venues/reschedule-gate";

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

async function main() {
  await groupA();

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

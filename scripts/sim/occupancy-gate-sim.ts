// Venue-occupancy gate for the interleague reschedule endpoints — drives the
// REAL `gateRescheduleOccupancy` from src/lib/venues/occupancy-gate.ts. Nothing
// is reimplemented here; the fake only stands in for the Supabase client so the
// RPC payload can be scripted.
//
// Three-part harness standard (CLAUDE.md "Harness standard"):
//   1. Real code, full playthroughs — the actual exported gate, end to end,
//      including the real candidateClearsSpan/spansOverlap it delegates to.
//   2. Mutation-tested — every mutant must be killed BY THE ASSERTION IT WAS
//      WRITTEN TO EXERCISE. Procedure and results are logged at the bottom.
//   3. Anti-vacuity counters — a ZERO COUNTER FAILS THE RUN. A conditional
//      assertion whose condition never fires passes while checking nothing.
//
// WHAT THIS FILE COVERS vs WHAT THE SQL HARNESS COVERS.
// This one owns the DECISION: overlap, the arriving team's buffer, per-game
// durations, the venue-null skip, fail-closed, and the message. The RPC's own
// guarantees — self-exclusion in the WHERE clause, the token gate raising
// rather than returning empty, date scoping — are SQL-level and cannot be
// proven from here; they live in scripts/sim/occupancy-rpc-sim.sql. Neither
// file is sufficient alone and the split is stated in both headers.
//
// TZ=UTC is mandatory: every time here is a wall-clock substring, and the run
// asserts literal values.

import {
  gateRescheduleOccupancy,
  type OccupancyGateResult,
} from "../../src/lib/venues/occupancy-gate";

if (process.env.TZ !== "UTC") {
  console.error("FATAL: run with TZ=UTC (npm run sim:occupancy-gate).");
  process.exit(1);
}

// ── Harness plumbing ─────────────────────────────────────────────────────────

let failures = 0;
let assertions = 0;

function ok(cond: boolean, label: string) {
  assertions++;
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}

function eq<T>(actual: T, expected: T, label: string) {
  assertions++;
  if (actual !== expected) {
    failures++;
    console.error(`  FAIL  ${label}\n        expected: ${String(expected)}\n        actual:   ${String(actual)}`);
  }
}

// Anti-vacuity counters. A zero here fails the run.
const counters = {
  conflict_rejected: 0,
  cleared_no_conflict: 0,
  boundary_exact_allowed: 0,
  boundary_one_step_rejected: 0,
  venue_null_skipped: 0,
  fail_closed_fired: 0,
  token_path_used: 0,
  authenticated_path_used: 0,
  per_game_duration_mattered: 0,
  arriving_buffer_mattered: 0,
  keep_original_shape: 0,
};

// ── Fake Supabase client ─────────────────────────────────────────────────────
//
// Only `.rpc()` is needed. It records which RPC was called with what, so the
// token path can be proven to pass ONLY the token (no game id to enumerate
// with) — that is an assertion, not an incidental detail.

type RpcOutcome =
  | { kind: "data"; payload: unknown }
  | { kind: "error"; message: string };

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function fakeClient(outcome: RpcOutcome, calls: RpcCall[]) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(
        outcome.kind === "data"
          ? { data: outcome.payload, error: null }
          : { data: null, error: { message: outcome.message } },
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Build an RPC payload. Times are wall-clock ISO, exactly as the RPC emits. */
function ctx(opts: {
  venueId?: string | null;
  venueName?: string | null;
  at: string; // "HH:MM"
  duration?: number | null;
  buffer?: number | null;
  occupied?: { at: string; duration: number | null; label?: string }[];
}) {
  const date = "2026-09-12";
  return {
    game_id: "GAME-UNDER-TEST",
    venue_id: opts.venueId === undefined ? "VEN-1" : opts.venueId,
    venue_name: opts.venueName === undefined ? "Andrews Field" : opts.venueName,
    scheduled_at: `${date}T${opts.at}:00`,
    game_duration: opts.duration === undefined ? 105 : opts.duration,
    buffer_minutes: opts.buffer === undefined ? 30 : opts.buffer,
    occupied: (opts.occupied ?? []).map((o, i) => ({
      game_id: `OCC-${i}`,
      scheduled_at: `${date}T${o.at}:00`,
      game_duration: o.duration,
      label: o.label ?? `Occupant ${i}`,
    })),
  };
}

// By DEFAULT the argument passed to the gate AGREES with the time the payload
// echoes. That is not cosmetic: it is what keeps mutant M6 (read the caller's
// own argument instead of the RPC's echo) from dying everywhere at once for the
// unrelated reason that a dummy argument parses to NaN. With the two agreeing,
// M6 is a no-op in every fixture EXCEPT C10, where they are deliberately made
// to disagree — so M6 is caught by the assertion written for it and by nothing
// else. See the "killed by the RIGHT assertion" rule in CLAUDE.md.
async function run(
  payload: unknown,
  args?: Parameters<typeof gateRescheduleOccupancy>[1],
): Promise<{ result: OccupancyGateResult; calls: RpcCall[] }> {
  const echoed = (payload as { scheduled_at?: string } | null)?.scheduled_at;
  const calls: RpcCall[] = [];
  const result = await gateRescheduleOccupancy(
    fakeClient({ kind: "data", payload }, calls),
    args ?? {
      gameId: "GAME-UNDER-TEST",
      scheduledAtIso: echoed ?? "2026-09-12T00:00:00",
    },
  );
  return { result, calls };
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("occupancy-gate-sim  (TZ=UTC)\n");

  // ── C1  THE LIVE SHAPE. Andrews Field: Majors 1:00–3:00 (120 min). Placing
  //       Minors 105 + 30 buffer. A 3:00 PM start must be REJECTED — the field
  //       is clear at 3:00 but the arriving team needs 30 minutes.
  {
    console.log("C1  conflict is rejected, with a plain-English message");
    const { result } = await run(
      ctx({
        at: "15:00",
        duration: 105,
        buffer: 30,
        occupied: [{ at: "13:00", duration: 120, label: "Cubs vs Reds" }],
      }),
    );
    ok(!result.ok, "C1 rejected");
    if (!result.ok) {
      counters.conflict_rejected++;
      eq(result.status, 409, "C1 status is 409");
      const msg = result.body.error;
      ok(msg.includes("Andrews Field"), "C1 message names the FIELD");
      ok(msg.includes("Cubs vs Reds"), "C1 message names the OCCUPYING GAME");
      ok(msg.includes("1:00 PM"), "C1 message names the OCCUPANT'S TIME");
      ok(msg.includes("30 minutes"), "C1 message states the buffer");
      ok(!/\b(42501|P0001|PGRST|null|undefined)\b/.test(msg), "C1 message carries no raw error code");
      eq(result.body.conflicts?.length, 1, "C1 reports exactly one conflict");
    }
  }

  // ── C2  CLEAR. Same shape, 3:30 PM — real end 3:00 plus the arriving 30.
  {
    console.log("C2  a genuinely free slot is allowed");
    const { result } = await run(
      ctx({
        at: "15:30",
        duration: 105,
        buffer: 30,
        occupied: [{ at: "13:00", duration: 120, label: "Cubs vs Reds" }],
      }),
    );
    ok(result.ok, "C2 allowed");
    if (result.ok) counters.cleared_no_conflict++;
  }

  // ── C3  THE BOUNDARY CASE required by the brief: a game that ends exactly
  //       when the next starts, WITH the arriving team's buffer applied, must
  //       be allowed. Existing 13:00 + 120 = 15:00 end; arriving buffer 30 ⇒
  //       15:30 is the first legal start. 15:15 (one grid step earlier) is not.
  {
    console.log("C3  boundary: end + arriving buffer is allowed; one step earlier is not");
    const exact = await run(
      ctx({ at: "15:30", duration: 105, buffer: 30, occupied: [{ at: "13:00", duration: 120 }] }),
    );
    ok(exact.result.ok, "C3a exact (end + buffer) ALLOWED");
    if (exact.result.ok) counters.boundary_exact_allowed++;

    const early = await run(
      ctx({ at: "15:15", duration: 105, buffer: 30, occupied: [{ at: "13:00", duration: 120 }] }),
    );
    ok(!early.result.ok, "C3b one grid step earlier REJECTED");
    if (!early.result.ok) counters.boundary_one_step_rejected++;

    // Zero-buffer half-open case: touching endpoints do not overlap.
    const touch = await run(
      ctx({ at: "15:00", duration: 105, buffer: 0, occupied: [{ at: "13:00", duration: 120 }] }),
    );
    ok(touch.result.ok, "C3c buffer 0: start == existing end is ALLOWED (half-open)");

    const overlapByOne = await run(
      ctx({ at: "14:59", duration: 105, buffer: 0, occupied: [{ at: "13:00", duration: 120 }] }),
    );
    ok(!overlapByOne.result.ok, "C3d buffer 0: one minute earlier REJECTED");
  }

  // ── C4  VENUE-NULL SKIP. Keyed on venue_id, NEVER on is_away. Occupied rows
  //       are present and would conflict — the gate must still pass, because a
  //       game with no field has nothing to contend for.
  {
    console.log("C4  venue_id null skips the check (keyed on venue, not is_away)");
    const { result } = await run(
      ctx({
        venueId: null,
        venueName: null,
        at: "13:30",
        duration: 105,
        buffer: 30,
        occupied: [{ at: "13:00", duration: 120, label: "Would clash" }],
      }),
    );
    ok(result.ok, "C4 null venue is skipped despite an overlapping occupant");
    if (result.ok) counters.venue_null_skipped++;
  }

  // ── C5  FAIL CLOSED. Every read failure rejects. None of these is evidence
  //       that the field is free.
  {
    console.log("C5  fail closed on every read failure");
    const calls: RpcCall[] = [];
    const errored = await gateRescheduleOccupancy(
      fakeClient({ kind: "error", message: "boom" }, calls),
      { gameId: "G", scheduledAtIso: "x" },
    );
    ok(!errored.ok, "C5a RPC error REJECTS");
    if (!errored.ok) {
      counters.fail_closed_fired++;
      eq(errored.status, 500, "C5a status 500");
      ok(!errored.body.error.includes("boom"), "C5a raw DB message is not leaked to the caller");
      ok(errored.body.error.length > 20, "C5a message is plain English, not a code");
    }

    const nulled = await run(null);
    ok(!nulled.result.ok, "C5b null payload REJECTS");
    if (!nulled.result.ok) counters.fail_closed_fired++;

    // A payload whose `occupied` is not an array — a shape the gate must not
    // silently read as "nothing is booked".
    const malformed = await run({
      game_id: "G", venue_id: "VEN-1", venue_name: "F",
      scheduled_at: "2026-09-12T13:00:00",
      game_duration: 90, buffer_minutes: 15, occupied: "not-an-array",
    });
    ok(!malformed.result.ok, "C5c non-array occupied REJECTS");
    if (!malformed.result.ok) counters.fail_closed_fired++;

    const badRow = await run({
      game_id: "G", venue_id: "VEN-1", venue_name: "F",
      scheduled_at: "2026-09-12T13:00:00",
      game_duration: 90, buffer_minutes: 15,
      occupied: [{ game_id: "x", scheduled_at: null, game_duration: 90, label: "x" }],
    });
    ok(!badRow.result.ok, "C5d malformed occupied ROW REJECTS");
    if (!badRow.result.ok) counters.fail_closed_fired++;
  }

  // ── C6  THE BUFFER BELONGS TO THE ARRIVING TEAM. Two runs, identical except
  //       for the ARRIVING division's buffer. If the gate used the existing
  //       game's buffer or max() of the two, the arriving value could not
  //       change the outcome on its own — and both runs would agree.
  {
    console.log("C6  the ARRIVING team's buffer decides (not the existing game's, not max)");
    const tight = await run(
      ctx({ at: "15:15", duration: 60, buffer: 0, occupied: [{ at: "13:00", duration: 120 }] }),
    );
    const wide = await run(
      ctx({ at: "15:15", duration: 60, buffer: 30, occupied: [{ at: "13:00", duration: 120 }] }),
    );
    ok(tight.result.ok, "C6a arriving buffer 0 → 15:15 allowed");
    ok(!wide.result.ok, "C6b arriving buffer 30 → same slot rejected");
    if (tight.result.ok !== wide.result.ok) counters.arriving_buffer_mattered++;
  }

  // ── C7  PER-GAME DURATIONS. The occupant's OWN duration decides how far it
  //       reaches — not the arriving game's. Two runs differing only in the
  //       OCCUPANT'S duration must disagree.
  {
    console.log("C7  each occupant is measured by its OWN duration");
    const shortOcc = await run(
      ctx({ at: "14:30", duration: 90, buffer: 0, occupied: [{ at: "13:00", duration: 60 }] }),
    );
    const longOcc = await run(
      ctx({ at: "14:30", duration: 90, buffer: 0, occupied: [{ at: "13:00", duration: 120 }] }),
    );
    ok(shortOcc.result.ok, "C7a occupant 60 min → 14:30 clear");
    ok(!longOcc.result.ok, "C7b occupant 120 min → 14:30 rejected");
    if (shortOcc.result.ok !== longOcc.result.ok) counters.per_game_duration_mattered++;

    // Unresolvable occupant duration falls back to the shared 90 default
    // (durationFromSettings) rather than reaching zero — a zero-length span
    // would overlap nothing and silently clear every conflict.
    const nullDur = await run(
      ctx({ at: "13:30", duration: 90, buffer: 0, occupied: [{ at: "13:00", duration: null }] }),
    );
    ok(!nullDur.result.ok, "C7c occupant with NO duration uses the 90 default, still conflicts");
  }

  // ── C8  MULTIPLE CONFLICTS are all reported, and the message says how many.
  {
    console.log("C8  multiple occupants are all counted");
    const { result } = await run(
      ctx({
        at: "13:30", duration: 90, buffer: 15,
        occupied: [
          { at: "13:00", duration: 120, label: "Game A" },
          { at: "14:00", duration: 90, label: "Game B" },
          { at: "19:00", duration: 90, label: "Far later" },
        ],
      }),
    );
    ok(!result.ok, "C8 rejected");
    if (!result.ok) {
      eq(result.body.conflicts?.length, 2, "C8 exactly two of three occupants clash");
      ok(result.body.error.includes("1 more"), "C8 message counts the extra clash");
      ok(!result.body.error.includes("Far later"), "C8 non-clashing occupant is not named");
    }
  }

  // ── C9  ROUTING. The token path must pass ONLY the token; the authenticated
  //       path passes the game id and time. This is the enumeration guarantee,
  //       asserted rather than assumed.
  {
    console.log("C9  token path passes only the token; authenticated path passes id + time");
    const tokenCalls: RpcCall[] = [];
    await gateRescheduleOccupancy(
      fakeClient({ kind: "data", payload: ctx({ at: "09:00", occupied: [] }) }, tokenCalls),
      { token: "TOK-123" },
    );
    eq(tokenCalls.length, 1, "C9a one RPC call");
    eq(tokenCalls[0]?.name, "get_reschedule_occupancy_by_token", "C9b token RPC chosen");
    eq(Object.keys(tokenCalls[0]?.args ?? {}).length, 1, "C9c token call takes exactly ONE argument");
    eq(tokenCalls[0]?.args.p_token, "TOK-123", "C9d that argument is the token");
    ok(!("p_game_id" in (tokenCalls[0]?.args ?? {})), "C9e NO game id crosses the token boundary");
    counters.token_path_used++;

    const authCalls: RpcCall[] = [];
    await gateRescheduleOccupancy(
      fakeClient({ kind: "data", payload: ctx({ at: "09:00", occupied: [] }) }, authCalls),
      { gameId: "G-9", scheduledAtIso: "2026-09-12T09:00:00+00:00" },
    );
    eq(authCalls[0]?.name, "get_game_occupancy_context", "C9f authenticated RPC chosen");
    eq(authCalls[0]?.args.p_game_id, "G-9", "C9g game id passed");
    eq(authCalls[0]?.args.p_scheduled_at, "2026-09-12T09:00:00+00:00", "C9h time passed");
    counters.authenticated_path_used++;
  }

  // ── C10 THE `keep_original` SHAPE. That action moves no time: it flips
  //       pending_interleague -> scheduled and the check runs against the time
  //       ALREADY ON THE ROW, which arrives as a raw Postgres timestamptz
  //       ("2026-09-12 15:00:00+00" — space-separated, not "T"), not as the
  //       normalized ISO the moving actions build.
  //
  //       The gate must read the RPC's ECHOED `scheduled_at`, never the
  //       caller's raw argument. Proven by making the two DISAGREE: the caller
  //       passes a time that would clear, the RPC echoes the time that clashes.
  //       If the gate ever reads its own input instead, this flips to allowed.
  {
    console.log("C10 keep_original: the gate reads the RPC's echoed time, not its own argument");
    const { result } = await run(
      ctx({ at: "15:00", duration: 105, buffer: 30, occupied: [{ at: "13:00", duration: 120, label: "Cubs vs Reds" }] }),
      // A raw timestamptz for a time that WOULD clear (23:00) — deliberately
      // not the 15:00 the payload echoes.
      { gameId: "GAME-UNDER-TEST", scheduledAtIso: "2026-09-12 23:00:00+00" },
    );
    ok(!result.ok, "C10a echoed 15:00 decides, not the passed 23:00");
    if (!result.ok) counters.keep_original_shape++;

    // And the same row genuinely clears when the ECHO says so.
    const cleared = await run(
      ctx({ at: "23:00", duration: 105, buffer: 30, occupied: [{ at: "13:00", duration: 120 }] }),
      { gameId: "GAME-UNDER-TEST", scheduledAtIso: "2026-09-12 15:00:00+00" },
    );
    ok(cleared.result.ok, "C10b echoed 23:00 clears, though 15:00 was passed");
  }

  // ── Anti-vacuity ───────────────────────────────────────────────────────────
  console.log("\nAnti-vacuity counters:");
  let zero = 0;
  for (const [k, v] of Object.entries(counters)) {
    console.log(`  ${v > 0 ? "ok " : "ZERO"}  ${k} = ${v}`);
    if (v === 0) zero++;
  }
  if (zero > 0) {
    failures += zero;
    console.error(`\n${zero} counter(s) at zero — assertions guarded by them proved nothing.`);
  }

  console.log(`\n${assertions} assertions, ${failures} failure(s).`);
  if (failures > 0) process.exit(1);
  console.log("PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ── Mutation log ─────────────────────────────────────────────────────────────
//
// Criterion (CLAUDE.md): a mutant is KILLED only if the BASELINE ASSERTION
// fails — and it must be killed by the assertion it was WRITTEN to exercise.
// Each mutant below is applied to src/lib/venues/occupancy-gate.ts, the sim is
// re-run, the FAILING ASSERTION NAME is recorded, then the file is restored and
// the suite re-verified green.
//
// Run 2026-09-09 — baseline 40 assertions / 0 failures, all 11 counters
// non-zero. 6 mutants, EVERY ONE killed by the assertion it was written for.
//
// This harness does NOT short-circuit: every assertion is evaluated on every
// run. So where a mutant also trips assertions other than its target, the
// target was still evaluated and still failed — the failure mode CLAUDE.md
// warns about (dying early to an unrelated assertion, leaving the target
// UNEVALUATED and the tally falsely reading "all killed") cannot occur here.
// Collateral failures are recorded below rather than hidden.
//
//   M1  Disable the check: `return { ok: true }` before the occupied loop.
//       → target C1 FAILED ✓  ("C1 rejected", first failure listed)
//       → collateral: C3b, C3d, C5c, C5d, C6b, C7b, C7c — every assertion that
//         expects a rejection. C2/C3a/C4 stayed green, as they must: they
//         expect ok, so an always-allow mutant cannot be caught there. That
//         asymmetry is exactly why C1 has to exist.
//
//   M2  Fail OPEN: `if (error || !data) return { ok: true }`.
//       → target C5a FAILED ✓  ("C5a RPC error REJECTS")
//       → collateral: C5b only. C5c/C5d stayed green — they carry a valid
//         payload and fail later in the shape checks, so this mutant is
//         narrowly caught by exactly the two assertions about read failure.
//
//   M3  Key the skip on is_away instead of venue_id (Amendment 2's mutant).
//       → target C4 FAILED ✓ — and NOTHING ELSE. Perfect targeting.
//       → C4 supplies a CLASHING occupant on purpose; with an empty occupied
//         list this mutant would pass and the venue-null rule would be
//         unproven. Do not simplify that fixture.
//
//   M4  Stop honouring the arriving team's buffer (force it to 0, the shape a
//       max()/existing-game's-buffer implementation collapses to here).
//       → target C6b FAILED ✓  ("C6b arriving buffer 30 → same slot rejected")
//       → C6a stayed GREEN, which is the real proof: C6 is a matched pair whose
//         two runs differ ONLY in the arriving buffer, so the mutant is caught
//         precisely by making the pair agree when it must disagree.
//       → collateral: C1, C3b — both depend on the buffer to reject. Expected;
//         the buffer genuinely participates in those.
//
//   M5  Use the arriving game's duration for every occupant.
//       → target C7b FAILED ✓  ("C7b occupant 120 min → 14:30 rejected")
//       → C7a stayed green — again a matched pair, differing only in the
//         OCCUPANT'S duration. With equal durations the swap is a no-op, which
//         is why C7a's 60-minute occupant is load-bearing.
//       → collateral: C3b, C3d, C6b — fixtures whose occupant duration differs
//         from the arriving one.
//
//   M6  Read the caller's own `scheduledAtIso` argument instead of the RPC's
//       echoed `scheduled_at` (added with the `keep_original` commit).
//       → target C10a AND C10b FAILED ✓, plus keep_original_shape 1 → 0.
//         NOTHING ELSE failed.
//       → THIS MUTANT WAS MIS-TARGETED ON ITS FIRST RUN and the fixture was
//         corrected rather than the result accepted. The default `run()` used
//         to pass a dummy `scheduledAtIso: "x"`, so M6 made every fixture
//         compute NaN and the mutant died at C1 — a rejection assertion that
//         says nothing about WHICH time was read. 6 assertions failed and C10
//         was never the reason. `run()` now defaults the argument to the time
//         the payload echoes, so the two agree everywhere except C10, where
//         they are deliberately made to disagree. That is the whole point of
//         the "killed by the RIGHT assertion" rule: the first run's tally read
//         "killed" while the property under test was unproven.
//
// After every mutant the file was restored and the suite re-verified: 40
// assertions, 0 failures, byte-identical to the backup.
//
// NOT COVERED HERE, by construction: self-exclusion, the token gate's raise,
// date scoping, cancelled-game exclusion and the grants. Those are enforced by
// Postgres and are proven in scripts/sim/occupancy-rpc-sim.sql (2 mutants, both
// killed). A green run here says nothing about them.
//
// Fixture notes worth keeping:
//   * C3c/C3d use buffer 0 deliberately. With a buffer they would prove the
//     buffer arithmetic rather than the HALF-OPEN property, and the half-open
//     boundary would never be exercised at a touching endpoint.
//   * C8's third occupant ("Far later") exists so the "only clashing occupants
//     are named" assertion has a non-clashing row to exclude. Without it that
//     assertion is vacuous.

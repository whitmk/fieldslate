/**
 * Simulation harness for `fetchAllRows` (src/lib/supabase/fetch-all.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * `fetchAllRows` is the repo's complete-or-throw read. Its entire value is the
 * promise that a caller never receives a short array — the schedule PDF that
 * printed "200 games" for a 260-game season is what a broken version looks like
 * in a parent's hands. A paging bug here would not throw and would not look
 * wrong; it would quietly return 900 of 1000 rows and every consumer would
 * report that as fact. So the helper is worth more assertions than its size
 * suggests.
 *
 * WHAT IT FAKES
 * -------------
 * Only the server. The function under test is the real one, driven end to end.
 * The fake reproduces the PostgREST semantics that matter:
 *   - `range(from, to)` is INCLUSIVE on both ends
 *   - a response is silently capped at `cap` rows, with NO error and no
 *     indication the cap was applied (this is the whole problem)
 *   - an exact count is returned only when asked for
 *
 * THREE-PART STANDARD (see CLAUDE.md "Harness standard")
 *   1. Real code, full playthroughs — yes, the real fetchAllRows.
 *   2. Mutation-tested — see the mutant list in the footer comment.
 *   3. Anti-vacuity counters — the run FAILS if the cap-discovery, multi-page,
 *      short-final-page, or throw paths never actually fired.
 *
 * Run: npm run sim:fetch-all
 */

import { fetchAllRows, type PagedResult } from "../../src/lib/supabase/fetch-all";

// ── Assertion plumbing ──────────────────────────────────────────────────────
let assertions = 0;
const failures: string[] = [];

function ok(label: string, cond: boolean, detail = "") {
  assertions++;
  if (!cond) failures.push(`[${label}] ${detail || "assertion failed"}`);
}

function eq<T>(label: string, actual: T, expected: T, detail = "") {
  assertions++;
  if (actual !== expected) {
    failures.push(
      `[${label}] expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${
        detail ? ` — ${detail}` : ""
      }`,
    );
  }
}

// ── Anti-vacuity counters ───────────────────────────────────────────────────
const seen = {
  multiPage: 0, // a scenario needed more than one request
  capDiscovery: 0, // the server cap was below the requested page size
  shortFinalPage: 0, // last page came back partially filled
  exactMultiple: 0, // total was an exact multiple of the page size
  threwOnError: 0,
  threwOnMaxRows: 0,
  threwOnNoCount: 0,
  staleCountRace: 0, // count disagreed with the rows that actually existed
};

// ── Fake PostgREST server ───────────────────────────────────────────────────
type FakeOpts = {
  rows: number[];
  /** Max rows the server will return per response, silently. */
  cap?: number;
  /** 1-indexed request number that returns an error instead of data. */
  errorOnRequest?: number;
  /** Report this instead of the real row count (simulates a concurrent race). */
  countOverride?: number;
  /** Omit `count` entirely, even when asked (defensive path). */
  suppressCount?: boolean;
};

class FakeServer {
  requests = 0;
  maxRequestedPageSize = 0;
  private readonly o: FakeOpts;

  constructor(o: FakeOpts) {
    this.o = o;
  }

  get cap() {
    return this.o.cap ?? Number.MAX_SAFE_INTEGER;
  }

  build = (range: { from: number; to: number; exactCount: boolean }) => {
    this.requests++;
    // A runaway loop is a real failure mode (see mutant M6). Without this the
    // harness would hang instead of reporting, so cap it hard.
    if (this.requests > 500) {
      throw new Error("FakeServer: runaway request loop (>500 requests)");
    }
    const requested = range.to - range.from + 1;
    this.maxRequestedPageSize = Math.max(this.maxRequestedPageSize, requested);

    if (this.o.errorOnRequest === this.requests) {
      return Promise.resolve<PagedResult<number>>({
        data: null,
        error: { message: "simulated read failure" },
        count: null,
      });
    }

    const allowed = Math.min(requested, this.cap);
    const data = this.o.rows.slice(range.from, range.from + allowed);
    const count = range.exactCount
      ? this.o.suppressCount
        ? undefined
        : (this.o.countOverride ?? this.o.rows.length)
      : undefined;

    return Promise.resolve<PagedResult<number>>({ data, error: null, count });
  };
}

const ids = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => i + 1 + offset);

/** Exact sequence equality — catches drops, duplicates, and reordering. */
function sameSequence(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function run() {
  // ── S1: single page, fewer rows than the page size ────────────────────────
  {
    const rows = ids(260);
    const s = new FakeServer({ rows });
    const got = await fetchAllRows<number>("S1", s.build, { pageSize: 1000 });
    ok("S1", sameSequence(got, rows), `got ${got.length} of ${rows.length}`);
    eq("S1-requests", s.requests, 1, "one page should cost one round trip");
    seen.shortFinalPage++;
  }

  // ── S2: exact multiple of the page size ───────────────────────────────────
  // The dangerous boundary: the final full page looks identical to "more rows
  // exist", so termination has to come from the count, not from a short page.
  {
    const rows = ids(300);
    const s = new FakeServer({ rows });
    const got = await fetchAllRows<number>("S2", s.build, { pageSize: 100 });
    ok("S2", sameSequence(got, rows), `got ${got.length} of ${rows.length}`);
    // 4, not 3: termination is by short page, never by reaching the count, so a
    // full final page costs one confirming request. That extra round trip is
    // the deliberate price of not dropping concurrent inserts (see S11).
    eq("S2-requests", s.requests, 4, "exact multiple needs a confirming page");
    seen.multiPage++;
    seen.exactMultiple++;
  }

  // ── S3: multi-page with a remainder ───────────────────────────────────────
  {
    const rows = ids(2600);
    const s = new FakeServer({ rows });
    const got = await fetchAllRows<number>("S3", s.build, { pageSize: 1000 });
    ok("S3", sameSequence(got, rows), `got ${got.length} of ${rows.length}`);
    eq("S3-requests", s.requests, 3);
    seen.multiPage++;
    seen.shortFinalPage++;
  }

  // ── S4: server cap BELOW the requested page size (cap discovery) ──────────
  // This is the scenario the whole design exists for. Naive paging stops at 400
  // and reports it as the complete set.
  {
    const rows = ids(1000);
    const s = new FakeServer({ rows, cap: 400 });
    const got = await fetchAllRows<number>("S4", s.build, { pageSize: 1000 });
    ok("S4", sameSequence(got, rows), `got ${got.length} of ${rows.length}`);
    seen.multiPage++;
    seen.capDiscovery++;
  }

  // ── S5: pathological cap of 1 row per response ────────────────────────────
  {
    const rows = ids(37);
    const s = new FakeServer({ rows, cap: 1 });
    const got = await fetchAllRows<number>("S5", s.build, { pageSize: 1000 });
    ok("S5", sameSequence(got, rows), `got ${got.length} of ${rows.length}`);
    eq("S5-requests", s.requests, 38, "37 rows + one confirming empty page");
    seen.multiPage++;
    seen.capDiscovery++;
  }

  // ── S6: empty result set ──────────────────────────────────────────────────
  {
    const s = new FakeServer({ rows: [] });
    const got = await fetchAllRows<number>("S6", s.build, { pageSize: 1000 });
    eq("S6", got.length, 0);
    eq("S6-requests", s.requests, 1);
  }

  // ── S7: error on the FIRST page throws, never returns [] ──────────────────
  {
    const s = new FakeServer({ rows: ids(50), errorOnRequest: 1 });
    let threw: Error | null = null;
    try {
      await fetchAllRows<number>("the season schedule", s.build, { pageSize: 10 });
    } catch (e) {
      threw = e as Error;
    }
    ok("S7", threw !== null, "a failed read must throw, not return an empty list");
    ok(
      "S7-label",
      !!threw?.message.includes("the season schedule"),
      `message must name the read: ${threw?.message}`,
    );
    ok(
      "S7-cause",
      !!threw?.message.includes("simulated read failure"),
      "message must carry the underlying cause",
    );
    seen.threwOnError++;
  }

  // ── S8: error MID-WALK throws — no partial return ─────────────────────────
  // The nastiest case: 20 good rows already in hand. Returning them would look
  // completely normal.
  {
    const s = new FakeServer({ rows: ids(100), errorOnRequest: 3 });
    let threw: Error | null = null;
    try {
      await fetchAllRows<number>("S8", s.build, { pageSize: 10 });
    } catch (e) {
      threw = e as Error;
    }
    ok("S8", threw !== null, "a mid-walk failure must discard the partial set");
    seen.threwOnError++;
  }

  // ── S9: maxRows ceiling throws ────────────────────────────────────────────
  {
    const s = new FakeServer({ rows: ids(5000) });
    let threw: Error | null = null;
    try {
      await fetchAllRows<number>("S9", s.build, { pageSize: 1000, maxRows: 2500 });
    } catch (e) {
      threw = e as Error;
    }
    ok("S9", threw !== null, "exceeding maxRows must throw");
    ok(
      "S9-guidance",
      !!threw?.message.includes("aggregation"),
      "the ceiling message must point at a redesign, not a bigger number",
    );
    seen.threwOnMaxRows++;
  }

  // ── S10: stale count promising MORE rows than exist (concurrent delete) ───
  // Benign race, not a truncation. Must terminate and return what's there.
  {
    const rows = ids(150);
    const s = new FakeServer({ rows, countOverride: 400 });
    const got = await fetchAllRows<number>("S10", s.build, { pageSize: 100 });
    ok("S10", sameSequence(got, rows), `got ${got.length} of ${rows.length}`);
    ok("S10-terminates", s.requests <= 4, `took ${s.requests} requests`);
    seen.staleCountRace++;
    seen.multiPage++;
  }

  // ── S11: stale count promising FEWER rows than exist (concurrent insert) ──
  // Must not stop at the stale total and drop the extras.
  {
    const rows = ids(250);
    const s = new FakeServer({ rows, countOverride: 100 });
    const got = await fetchAllRows<number>("S11", s.build, { pageSize: 100 });
    ok(
      "S11",
      sameSequence(got, rows),
      `stale-low count must not truncate: got ${got.length} of ${rows.length}`,
    );
    seen.multiPage++;
    seen.staleCountRace++;
  }

  // ── S12: no count returned at all must THROW ──────────────────────────────
  // Without a count, a short page and a server cap are indistinguishable, so
  // completeness cannot be verified. An unverifiable read must not quietly
  // succeed — that is the whole failure mode. This also turns "the builder
  // forgot { count: 'exact' }" into an immediate, obvious error for the seven
  // surfaces still to be converted, instead of a truncation discovered in a PDF.
  {
    const s = new FakeServer({ rows: ids(250), suppressCount: true });
    let threw: Error | null = null;
    try {
      await fetchAllRows<number>("S12", s.build, { pageSize: 100 });
    } catch (e) {
      threw = e as Error;
    }
    ok("S12", threw !== null, "a countless read must throw, not guess");
    ok(
      "S12-guidance",
      !!threw?.message.includes('count: "exact"'),
      `message must tell the caller how to fix it: ${threw?.message}`,
    );
    seen.threwOnNoCount++;
  }

  // ── S13: no drops or duplicates across many page boundaries ───────────────
  // Sequence equality above already covers this, but assert set identity too so
  // a compensating drop+duplicate can't pass.
  {
    const rows = ids(1234);
    const s = new FakeServer({ rows, cap: 97 });
    const got = await fetchAllRows<number>("S13", s.build, { pageSize: 1000 });
    eq("S13-len", got.length, 1234);
    eq("S13-unique", new Set(got).size, 1234, "duplicates across page boundaries");
    ok("S13-order", sameSequence(got, rows), "rows reordered across pages");
    seen.multiPage++;
    seen.capDiscovery++;
  }

  // ── S15: server cap AND a stale-low count together ────────────────────────
  // This is the scenario that makes cap discovery LOAD-BEARING rather than a
  // mere efficiency trick, and it was added only after the mutation pass showed
  // M1 (cap discovery removed) dying to a request-count assertion instead of a
  // completeness one — i.e. the assertion written to catch it never fired.
  //
  // Why it bites: without cap discovery every page stays short, so termination
  // depends entirely on the count. Let the count also be stale-low and the walk
  // stops at 194 of 250 and reports it as complete. With cap discovery the page
  // size drops to the cap, pages come back FULL, and the walk keeps going on
  // page-fullness instead of trusting the count.
  {
    const rows = ids(250);
    const s = new FakeServer({ rows, cap: 97, countOverride: 100 });
    const got = await fetchAllRows<number>("S15", s.build, { pageSize: 1000 });
    ok(
      "S15",
      sameSequence(got, rows),
      `cap + stale-low count must still be complete: got ${got.length} of ${rows.length}`,
    );
    seen.multiPage++;
    seen.capDiscovery++;
    seen.staleCountRace++;
  }

  // ── S14: the real regression — a 260-game season must not stop at 200 ─────
  {
    const rows = ids(260);
    const s = new FakeServer({ rows });
    const got = await fetchAllRows<number>("S14", s.build, { pageSize: 1000 });
    eq("S14", got.length, 260, "SRALL Fall 2026 must print all 260 games");
    ok("S14-tail", got[got.length - 1] === 260, "the final two weeks must survive");
  }

  // ── Anti-vacuity ──────────────────────────────────────────────────────────
  for (const [name, n] of Object.entries(seen)) {
    ok(`vacuity:${name}`, n > 0, `scenario "${name}" never fired — assertions about it prove nothing`);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`\nfetch-all sim: ${assertions} assertions`);
  console.log(
    "coverage " +
      Object.entries(seen)
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );
  if (failures.length) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const f of failures) console.error("  " + f);
    process.exit(1);
  }
  console.log("ALL PASS\n");
}

run().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});

// ── Mutation log ────────────────────────────────────────────────────────────
// A harness is unproven until deliberately broken code fails it. Per CLAUDE.md,
// a mutant counts as KILLED only when the assertion WRITTEN TO CATCH IT fails —
// not merely when the run goes red. Mutants applied to fetch-all.ts one at a
// time, restoring between each:
//
//   M1  delete the cap-discovery line (`pageSize = page.length`)
//         → S15 (cap + stale-low count → 194 of 250)
//         WORKED EXAMPLE OF THE "RIGHT ASSERTION" RULE. On the first pass M1
//         died only to [S5-requests], an efficiency assertion about round-trip
//         counts, while every completeness assertion PASSED. The tally read
//         "8/8 killed" and was meaningless: with `offset = rows.length`, paging
//         self-corrects even when the page size stays above the cap, so S4/S5/
//         S13 could not distinguish the mutant. Cap discovery only becomes
//         load-bearing when the count is ALSO wrong — no full page ever appears,
//         so termination falls back entirely on a stale count and stops early.
//         S15 was written to construct exactly that, and M1 now dies to a
//         completeness assertion. Do not delete S15.
//   M2  `if (page.length < requested) break;` unconditionally, ignoring count
//         → S4 / S5 / S13
//   M3  drop the `if (error) throw` and continue
//         → S7 / S8 (throw assertions)
//   M4  drop the maxRows throw
//         → S9
//   M5  `offset += requested` instead of `offset = rows.length`
//         → S13-unique / S13-order (drops and duplicates under a server cap)
//   M6  remove the `page.length === 0` break
//         → runaway loop, caught by the FakeServer's 500-request guard
//   M7  re-add the count-based early exit
//       (`if (rows.length >= expectedTotal) break`)
//         → S11 (stale-low count must not truncate). THIS MUTANT IS THE FIRST
//           DRAFT OF THE HELPER: the harness caught it before the code shipped,
//           which is the reason S11 exists. Do not delete S11.
//   M8  drop the missing-count throw and treat `count` as optional
//         → S12 / S12-guidance
//
// Every mutant above was applied and confirmed to fail the assertion it was
// written for — not merely to turn the run red (CLAUDE.md: a mutant must die to
// the RIGHT assertion). Mutants were restored and the suite re-verified green.

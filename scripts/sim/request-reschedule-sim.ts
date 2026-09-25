// Harness for the shared interleague reschedule-request submit path
// (src/lib/interleague/request-reschedule.ts).
//
// WHY IT EXISTS. The function was extracted from schedule-list.tsx's inline
// submitRescheduleRequest so a second surface (the division schedule panel)
// can submit through the SAME code. The extraction must not change what the
// Schedule page does. This harness is a DIFFERENTIAL: `preExtraction` below is
// the pre-change inline body, verbatim except that the React state setters are
// replaced by a recorder, and every case must produce the same observable
// outcome through both.
//
// `preExtraction` is a GOLDEN, not a second implementation — it is never
// imported by product code and must never be edited to make a run pass. If a
// case diverges, the extraction changed behavior: fix the lib.
//
// ANTI-VACUITY: every outcome branch (success, error-with-message,
// error-without-message, thrown network error, non-JSON body, non-Error throw)
// must be hit at least once, counted on the LIB side.
//
// ── MUTATION LOG (2026-09-25) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   RR1  fallback wording changed ("Failed to send request" w/o period) → [D-noMessage]
//   RR2  gameId not URI-encoded                                          → [R-url]
//   RR3  res.ok check dropped (error responses read as success)          → [D-routeError]
//   RR4  network catch returns a fixed string, not err.message           → [D-network]
// RESULT: 4/4 killed, each FIRST at its own assertion (RR3 and RR4 also trip a
// sibling case, but the named assertion is among the first failures).

import {
  submitInterleagueRescheduleRequest,
  type RescheduleRequestPayload,
} from "@/lib/interleague/request-reschedule";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };
type Behaviour =
  | { kind: "respond"; ok: boolean; body: unknown }
  | { kind: "nonJson"; ok: boolean }
  | { kind: "throw"; value: unknown };

function fakeFetch(b: Behaviour, calls: Call[]) {
  return async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    if (b.kind === "throw") throw b.value;
    return {
      ok: b.ok,
      json: async () => {
        if (b.kind === "nonJson") throw new SyntaxError("Unexpected token < in JSON");
        return b.body;
      },
    };
  };
}

// ── GOLDEN: pre-extraction inline body (schedule-list.tsx before 2026-09-25) ──
// State setters → recorder. `fetch` → the injected fake. Nothing else changed.
type Recorded = { error: string | null; closed: boolean; refreshed: boolean };
async function preExtraction(
  gameId: string,
  payload: RescheduleRequestPayload,
  fetch: ReturnType<typeof fakeFetch>,
): Promise<Recorded> {
  const rec: Recorded = { error: null, closed: false, refreshed: false };
  const setRescheduleError = (e: string | null) => (rec.error = e);
  const setRequestRescheduleGame = () => (rec.closed = true);
  const router = { refresh: () => (rec.refreshed = true) };
  const requestRescheduleGame = { id: gameId };
  try {
    const res = await fetch(
      `/api/interleague/games/${encodeURIComponent(requestRescheduleGame.id)}/reschedule`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    if (!res.ok) {
      setRescheduleError(data.error ?? "Failed to send request.");
      return rec;
    }
    setRequestRescheduleGame();
    router.refresh();
  } catch (err) {
    setRescheduleError(err instanceof Error ? err.message : "Network error.");
  }
  return rec;
}

// The post-extraction caller, as schedule-list.tsx now runs it.
async function postExtraction(
  gameId: string,
  payload: RescheduleRequestPayload,
  fetch: ReturnType<typeof fakeFetch>,
): Promise<Recorded> {
  const rec: Recorded = { error: null, closed: false, refreshed: false };
  const outcome = await submitInterleagueRescheduleRequest(gameId, payload, fetch);
  if (!outcome.ok) {
    rec.error = outcome.error;
    return rec;
  }
  rec.closed = true;
  rec.refreshed = true;
  return rec;
}

const counters = {
  success: 0,
  routeErrorWithMessage: 0,
  routeErrorNoMessage: 0,
  networkError: 0,
  nonJson: 0,
  nonErrorThrow: 0,
};

async function main() {
  console.log("\nrequest-reschedule sim");
  const payload: RescheduleRequestPayload = {
    scheduled_at: "2026-10-10T15:30:00+00:00",
    venue_name: "Andrews Field",
    note: "Field conflict",
  };
  const cases: { name: string; b: Behaviour; counter: keyof typeof counters }[] = [
    { name: "D-success", b: { kind: "respond", ok: true, body: { ok: true } }, counter: "success" },
    {
      name: "D-routeError",
      b: { kind: "respond", ok: false, body: { error: "AA is locked. Unlock it to propose a new time for interleague games." } },
      counter: "routeErrorWithMessage",
    },
    { name: "D-noMessage", b: { kind: "respond", ok: false, body: {} }, counter: "routeErrorNoMessage" },
    { name: "D-network", b: { kind: "throw", value: new TypeError("Failed to fetch") }, counter: "networkError" },
    { name: "D-nonJson", b: { kind: "nonJson", ok: false }, counter: "nonJson" },
    { name: "D-nonErrorThrow", b: { kind: "throw", value: "boom" }, counter: "nonErrorThrow" },
  ];

  for (const c of cases) {
    const gold = await preExtraction("g/1 ?x", payload, fakeFetch(c.b, []));
    const calls: Call[] = [];
    const got = await postExtraction("g/1 ?x", payload, fakeFetch(c.b, calls));
    ok(
      JSON.stringify(got) === JSON.stringify(gold),
      `[${c.name}] same outcome as the pre-extraction code`,
      `gold=${JSON.stringify(gold)} got=${JSON.stringify(got)}`,
    );
    if (calls.length === 1) counters[c.counter]++;
  }

  // Request shape, asserted against literals (not just against the golden).
  const calls: Call[] = [];
  await submitInterleagueRescheduleRequest(
    "g/1 ?x",
    payload,
    fakeFetch({ kind: "respond", ok: true, body: {} }, calls),
  );
  ok(
    calls[0]?.url === "/api/interleague/games/g%2F1%20%3Fx/reschedule",
    "[R-url] game id URI-encoded into the route path",
    calls[0]?.url,
  );
  ok(calls[0]?.init.method === "POST", "[R-method] POST");
  ok(
    calls[0]?.init.headers["Content-Type"] === "application/json",
    "[R-header] JSON content type",
  );
  ok(
    calls[0]?.init.body === JSON.stringify(payload),
    "[R-body] payload sent verbatim",
  );

  for (const [name, n] of Object.entries(counters)) {
    ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  }
  console.log("  counters:", JSON.stringify(counters));
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

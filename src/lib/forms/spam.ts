// Spam protection for the public marketing forms (contact, request a demo).
// ONE implementation; both routes call it. Two layers:
//
//   1. HONEYPOT — a hidden text field named HONEYPOT_FIELD that a person never
//      sees or fills and a form-filling bot usually does. A hit is answered
//      with a normal-looking success and NOTHING is saved or sent, so the bot
//      learns nothing from the response.
//   2. RATE LIMIT — at most RATE_LIMIT_MAX submissions per RATE_LIMIT_WINDOW_MS
//      from one client address, generous enough that a real person who
//      resubmits a few times is never blocked. A trip is answered with
//      RATE_LIMIT_MESSAGE and HTTP 429.
//
// THE LIMIT IS BEST-EFFORT, PER INSTANCE. The counter lives in this module's
// memory. On Vercel each serverless instance keeps its own, instances come
// and go, and a cold start resets it, so a determined sender can exceed the
// limit across instances. It still stops the common case (one client hammering
// one warm instance) at no cost. A durable limit would need a table of hashed
// addresses written through the admin client — not built; see the
// request-a-demo completion report (2026-09-30).
//
// THE CLIENT ADDRESS is the FIRST entry of x-forwarded-for, which on Vercel is
// the connecting client (later entries are proxies). A request with no such
// header (local dev) is keyed as "unknown" and shares one bucket.

export const HONEYPOT_FIELD = "website";

export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MESSAGE = "Too many requests. Please try again in a few minutes.";

/** True when the hidden field carries anything but an empty string. A
 *  missing field is NOT a hit: an older client that never rendered the
 *  field must not be treated as a bot. */
export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  const v = body[HONEYPOT_FIELD];
  return typeof v === "string" ? v.trim().length > 0 : v != null;
}

/** First hop of x-forwarded-for, or "unknown". */
export function clientAddress(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

const hits = new Map<string, number[]>();

/** Records one submission from `address` and says whether it should be
 *  refused. The decision counts submissions in the trailing window BEFORE
 *  this one, so the first RATE_LIMIT_MAX go through and the next is refused.
 *  `now` is injectable for the harness. */
export function isRateLimited(address: string, now: number = Date.now()): boolean {
  const since = now - RATE_LIMIT_WINDOW_MS;
  const recent = (hits.get(address) ?? []).filter((t) => t > since);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(address, recent);
    return true;
  }
  recent.push(now);
  hits.set(address, recent);
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => t > since)) hits.delete(k);
    }
  }
  return false;
}

/** Harness only: forget every address. */
export function _resetRateLimitForTests(): void {
  hits.clear();
}

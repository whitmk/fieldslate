// The ONE client-side submit path for an interleague reschedule request
// (POST /api/interleague/games/[id]/reschedule). Every surface that opens
// RescheduleRequestModal for a new request submits through this function —
// today the Schedule page's row menu (schedule-list.tsx) — so the request
// shape and the error wording cannot drift between surfaces.
//
// Extracted VERBATIM from schedule-list.tsx's inline submitRescheduleRequest
// (2026-09-25). `npm run sim:request-reschedule` pins it against the
// pre-extraction logic across every outcome: success, a route error with a
// message, a route error without one, a network failure, and a non-JSON body.
//
// The route owns every gate (lock, venue hours, occupancy) and every refusal
// sentence; this function only carries them back — with ONE addition
// (2026-11-02): an hours refusal arrives as "Venue is not open at the proposed
// time." plus the field, the day and its hours in separate keys, and those
// keys used to be dropped, leaving the admin with no idea what the hours are.
// `requestErrorMessage` appends them. Every other refusal reads as before.

export type RescheduleRequestPayload = {
  scheduled_at: string; // wall-clock ISO
  venue_name?: string;
  note?: string;
};

export type RescheduleRequestOutcome =
  | { ok: true }
  | { ok: false; error: string };

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

type RouteErrorBody = {
  error?: string;
  venue?: unknown;
  day?: unknown;
  venue_hours?: unknown;
};

const FULL_DAY: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

/** The sentence the modal shows for a refused request. Only the hours
 *  refusal (gateVenueProposal's body: venue + day + venue_hours) gains a
 *  second sentence; anything else is the route's own `error`, verbatim. */
export function requestErrorMessage(data: RouteErrorBody): string {
  const base = data.error ?? "Failed to send request.";
  const { venue, day, venue_hours: hours } = data;
  if (typeof venue !== "string" || typeof day !== "string" || typeof hours !== "string") {
    return base;
  }
  const dayName = FULL_DAY[day] ?? day;
  return hours === "Closed"
    ? `${base} ${venue} is closed on ${dayName}s.`
    : `${base} ${venue} is open ${hours} on ${dayName}s, and the game has to start and finish inside those hours.`;
}

/**
 * `fetchImpl` exists ONLY so the harness can drive this function without a
 * network; production callers omit it.
 */
export async function submitInterleagueRescheduleRequest(
  gameId: string,
  payload: RescheduleRequestPayload,
  fetchImpl: FetchLike = fetch,
): Promise<RescheduleRequestOutcome> {
  try {
    const res = await fetchImpl(
      `/api/interleague/games/${encodeURIComponent(gameId)}/reschedule`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = (await res.json()) as RouteErrorBody;
    if (!res.ok) {
      return { ok: false, error: requestErrorMessage(data) };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error.",
    };
  }
}

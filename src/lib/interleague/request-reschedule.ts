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
// sentence; this function only carries them back.

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
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Failed to send request." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error.",
    };
  }
}

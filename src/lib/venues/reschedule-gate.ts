// Server-side gate used by the four interleague reschedule endpoints.
//
// One call shape regardless of auth context — the underlying RPC
// (`get_game_venue_context_for_gate`) is `security definer`, so anon
// endpoints (token-authed external orgs) and auth'd admin endpoints both
// work. The RPC returns the venue rows we need + game.is_away + the home
// team's division.game_duration. This wrapper feeds those rows into the
// shared `gateVenueProposal` predicate and returns a uniform result.
//
// Call patterns:
//
//   1. "Validate the EXISTING venue against a NEW time" — e.g. accept_proposal
//      in /resolve, or accept in either /respond endpoint. Pass
//      `proposedVenueName: null`.
//
//   2. "Validate a NEW proposed venue NAME against a NEW time" — e.g. counter
//      in either /respond, or the sender-side propose. Pass
//      `proposedVenueName: <user-typed string>`.
//
//   3. Both — pass both. Both checks run; first failure wins.
//
// For away games (is_away === true), the proposed-name check is skipped
// (the partner org hosts, we don't have their hours). The existing-venue
// check is also skipped because game.venue_id is null for away games.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  gateVenueProposal,
  type VenueGateResult,
  type VenueGateRow,
} from "./availability";

type DB = SupabaseClient<Database>;

interface VenueContext {
  is_away: boolean;
  duration_min: number;
  existing_venue: VenueGateRow | null;
  matched_venue: VenueGateRow | null;
}

export interface GateArgs {
  gameId: string;
  scheduledAtIso: string;
  /** Free-text venue label, if the user proposed one. Null/undefined skips the matched-name check. */
  proposedVenueName?: string | null;
  /** Skip the existing-venue check (used when the endpoint isn't moving an already-scheduled time — e.g. /counter actions). */
  skipExistingVenueCheck?: boolean;
}

export async function gateRescheduleVenue(
  supabase: DB,
  { gameId, scheduledAtIso, proposedVenueName, skipExistingVenueCheck }: GateArgs,
): Promise<VenueGateResult> {
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "get_game_venue_context_for_gate",
    {
      p_game_id: gameId,
      p_proposed_venue_name: proposedVenueName ?? null,
    },
  );
  // FAIL CLOSED. This used to `return { ok: true }` on a read failure, which
  // told every caller "the field's hours are fine" on the strength of a check
  // that never ran — and the save went through.
  //
  // WHY NO venue_id / is_away CARVE-OUT HERE, unlike gateRescheduleOccupancy.
  // That gate's RPC returns a real context for a venue-less game, so it must
  // key its skip on `venue_id` explicitly. This RPC
  // (get_game_venue_context_for_gate) returns null in exactly ONE case: the
  // game row does not exist. Every legitimate shape comes back as an object and
  // is skipped INSIDE the gate below — an away game via `is_away`, a venue-less
  // game via a null `existing_venue`, an unmatched free-text label via a null
  // `matched_venue`. So nothing legitimate travels through this branch, and a
  // blanket refusal here cannot block a save that should have succeeded.
  if (error || !data) {
    return {
      ok: false,
      status: 500,
      body: {
        error:
          "We couldn't check the field's hours, so the change wasn't saved. Please try again.",
      },
    };
  }
  const ctx = data as VenueContext;

  // Away games: partner org hosts, we don't track their hours. Skip both.
  if (ctx.is_away) return { ok: true };

  // 1. Existing-venue check. If a venue is already on the game, validate
  //    it stays open at the new time. (Skipped on /counter — that branch
  //    doesn't move the game's scheduled_at.)
  if (!skipExistingVenueCheck && ctx.existing_venue) {
    const result = gateVenueProposal(
      ctx.existing_venue,
      scheduledAtIso,
      ctx.duration_min,
    );
    if (!result.ok) return result;
  }

  // 2. Matched-name check. If the user proposed a venue_name that resolves
  //    to one of our owned venues, validate THAT venue at the new time.
  //    Unmatched free-text labels (partner-org venues, typos) skip — same
  //    behavior as the sender-side gate from e2b985c.
  if (ctx.matched_venue) {
    const result = gateVenueProposal(
      ctx.matched_venue,
      scheduledAtIso,
      ctx.duration_min,
    );
    if (!result.ok) return result;
  }

  return { ok: true };
}

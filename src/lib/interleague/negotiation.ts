// Host-side decisions for negotiating an interleague game's time.
//
// Pure: no directive, no Supabase. The three authenticated host routes —
//   /api/interleague/games/[id]/reschedule   (propose a time)
//   /api/interleague/games/[id]/resolve      (accept / keep / edit / decline / withdraw)
//   /api/interleague/reschedule/[id]/respond (answer a partner's request)
// make every branching decision through these functions, and
// scripts/sim/host-counter-sim.ts drives them. What the partner's TOKEN
// functions do to rows is proven separately by
// scripts/sim/host-counter-rpc-sim.sql (migration 0091).
//
// THE MODEL for a counter-proposed (pending_interleague) game — see 0091's
// header for the full statement:
//   games.proposed_*           the PARTNER's newest proposal
//   pending host request row   the HOST's outstanding proposal (awaiting partner)
//   pending partner row        the partner's counter-back (awaiting host),
//                              mirrored into games.proposed_*
// The game stays pending_interleague until someone agrees. It is NEVER moved to
// reschedule_pending: countsAsScheduledGame does not list that status.

export type RequestLite = {
  status: string;
  requested_by_user_id: string | null;
};

export type GameLite = {
  status: string;
  external_team_name: string | null;
  scheduled_at: string;
};

/** The host's outstanding proposal on a game, if any. */
export function openHostProposal<T extends RequestLite>(requests: T[]): T | null {
  return requests.find((r) => r.status === "pending" && r.requested_by_user_id !== null) ?? null;
}

/** The partner's outstanding counter-back on a game, if any. */
export function openPartnerProposals<T extends RequestLite>(requests: T[]): T[] {
  return requests.filter((r) => r.status === "pending" && r.requested_by_user_id === null);
}

/**
 * "Round N" shown to both sides. Round 1 is the partner's original counter on
 * the invite (not a request row); every request row after it is one more
 * round. No cap is enforced — see CLAUDE.md "Interleague host counter".
 */
export function proposalRound(requestRowCount: number): number {
  return Math.max(0, requestRowCount) + 1;
}

// ── Propose a time (/api/interleague/games/[id]/reschedule) ─────────────────

export type ProposalDecision =
  /** status 'scheduled': the pre-existing reschedule request. The route flips
   *  the game to reschedule_pending, exactly as before this change. */
  | { ok: true; branch: "confirmed_reschedule" }
  /** status 'pending_interleague' WITH a partner response: a host counter.
   *  The game stays pending_interleague. */
  | { ok: true; branch: "pending_counter" }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Which statuses the host may propose a time on, and why not otherwise.
 *
 *   scheduled               → allowed (unchanged: the game must be in the future)
 *   pending_interleague     → allowed ONLY with a partner response
 *                             (external_team_name set), no host proposal already
 *                             outstanding, and a proposed time in the future
 *   anything else           → refused (reschedule_pending, cancelled, …)
 *
 * The scheduled branch's two refusals keep their exact pre-existing wording.
 */
export function decideHostProposal(
  game: GameLite,
  requests: RequestLite[],
  proposedIso: string,
  nowMs: number,
  partnerName: string,
): ProposalDecision {
  if (game.status === "scheduled") {
    if (new Date(game.scheduled_at).getTime() <= nowMs) {
      return { ok: false, status: 409, error: "This game is in the past." };
    }
    return { ok: true, branch: "confirmed_reschedule" };
  }
  if (game.status === "pending_interleague") {
    if (!game.external_team_name) {
      return {
        ok: false,
        status: 409,
        error: `${partnerName} hasn't answered the invite for this game yet, so there's no proposal to respond to.`,
      };
    }
    if (openHostProposal(requests)) {
      return {
        ok: false,
        status: 409,
        error: `You've already proposed a different time for this game. Wait for ${partnerName} to answer, or withdraw your proposal first.`,
      };
    }
    if (new Date(proposedIso).getTime() <= nowMs) {
      return { ok: false, status: 400, error: "Propose a time that hasn't passed yet." };
    }
    return { ok: true, branch: "pending_counter" };
  }
  return { ok: false, status: 409, error: "This game can't be rescheduled right now." };
}

// ── Resolve a counter-proposed game (/api/interleague/games/[id]/resolve) ───

export type ResolveAction =
  | "accept_proposal"
  | "keep_original"
  | "edit"
  | "decline"
  | "withdraw_proposal";

/**
 * Refuse a resolve action that would talk over an outstanding host proposal.
 *
 * Accept proposal / Keep original / Edit all SET the game's time. While the host
 * has a different time out with the partner, doing that would silently change
 * the answer to a question the partner is still considering, so each is refused
 * until the host withdraws the proposal (or the partner answers).
 * Decline stays allowed: it removes the game and the partner is emailed.
 * Withdraw requires a proposal to withdraw.
 */
export function resolveRefusal(
  action: ResolveAction,
  requests: RequestLite[],
  partnerName: string,
): string | null {
  const open = openHostProposal(requests);
  if (action === "withdraw_proposal") {
    return open ? null : "There's no proposal of yours to withdraw on this game.";
  }
  if (action === "decline") return null;
  if (open) {
    return `You've proposed a different time and ${partnerName} hasn't answered yet. Withdraw your proposal first if you want to settle the time yourself.`;
  }
  return null;
}

/**
 * What happens to the partner's own outstanding counter-back rows when the host
 * resolves the game. They must not be left 'pending' on a game whose time is
 * now settled (or that no longer exists).
 *   accept_proposal → 'accepted' (the host took the partner's newest time)
 *   keep_original / edit → 'declined'
 *   decline → none (the rows cascade with the deleted game)
 *   withdraw_proposal → none (it closes the HOST's row, not the partner's)
 */
export function partnerRowsOnResolve(action: ResolveAction): "accepted" | "declined" | null {
  if (action === "accept_proposal") return "accepted";
  if (action === "keep_original" || action === "edit") return "declined";
  return null;
}

// ── Answer a partner's request (/api/interleague/reschedule/[id]/respond) ───

/**
 * The game's status after the HOST declines a partner's request.
 *
 * Mirrors decline_reschedule_request_by_token (0091) from the other side:
 *   pending_interleague → null (never write). The game was never agreed;
 *                         setting it 'scheduled' would confirm a time the
 *                         partner rejected. The pre-0091 route did exactly that.
 *   otherwise           → 'scheduled' once no other request is pending
 *                         (unchanged behaviour for confirmed games).
 */
export function gameStatusAfterHostDecline(
  gameStatus: string,
  pendingLeft: number,
): "scheduled" | null {
  if (gameStatus === "pending_interleague") return null;
  return pendingLeft > 0 ? null : "scheduled";
}

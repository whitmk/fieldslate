// The schedule-lock gate for the HOST-SIDE interleague routes.
//
// WHY A ROUTE GATE AND NOT THE TRIGGER. The 0082 trigger cannot help here:
// every write these routes make is already permitted on a locked division —
// the host-proposal path writes only `games.status` (allowlisted) plus a row in
// another table, and the respond route's accept writes `scheduled_at` /
// `status` / `proposed_*`, every one of them allowlisted. So the route gate is
// the ONLY enforcement, exactly as the resolve route's own comment says. Be
// honest about what that buys: it stops the product's paths completely, but it
// is not a database guarantee the way a blocked INSERT is.
//
// HOST SIDE ONLY. The token routes must NEVER call this. A locked division is
// our admin's "don't re-derive this schedule" flag; an anonymous partner
// accepting or declining is not our admin re-deriving anything, and refusing
// them strands someone who cannot act on the error. That asymmetry is the
// settled rule (see CLAUDE.md, "Schedule lock + posted flag").
//
// The WORDING lives in division-lock.ts with every other locked sentence — the
// house rule is that it is written in exactly one place.

import { lockedReason, type LockedAction } from "@/lib/schedule/division-lock";

export type LockGateGame = {
  /** The division's name, or null when the home team has no division. */
  divisionName: string | null;
  /** `divisions.locked`, or null when there is no division / it is unreadable. */
  locked: boolean | null;
};

export type LockGateRefusal = {
  status: 409;
  body: { error: string };
};

/**
 * The refusal a locked division earns, or null to proceed.
 *
 * A game whose home team has NO division is allowed through: no division means
 * no lock, which is the same stance the 0082 trigger takes on a null division —
 * allowed rather than fail-closed, because failing closed there would make an
 * orphan row permanently immutable.
 */
export function lockRefusal(
  game: LockGateGame,
  action: Extract<LockedAction, "resolveInterleague" | "rescheduleInterleague">,
): LockGateRefusal | null {
  if (!game.locked) return null;
  return {
    status: 409,
    body: { error: lockedReason(game.divisionName ?? "This game's division", action) },
  };
}

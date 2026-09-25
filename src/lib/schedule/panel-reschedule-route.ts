// Where a game picked in the division schedule panel's "Reschedule a game"
// mode goes. ONE pure decision, so the panel cannot open the plain slot picker
// on a game that must not reach it — and so the harness drives the same code
// the panel calls (`npm run sim:panel-reschedule`, part R).
//
// THE ROUTES
// - `plain`: an ordinary scheduled game → RainoutRescheduleModal
//   (variant "move"). The picker offers only slots that clear venue hours,
//   real-span occupancy, both teams' games, blackouts and team constraints —
//   those are its gates, reused unchanged. Its save is a client-side
//   `games.update` with NO server re-check (see CLAUDE.md).
// - `interleague_request`: an accepted, upcoming interleague game →
//   RescheduleRequestModal → POST /api/interleague/games/[id]/reschedule, whose
//   lock / venue-hours / occupancy gates apply server-side. Another league
//   agreed to this time; moving it without their consent is what the
//   request/respond flow exists to prevent.
// - `upgrade`: an ordinary game on a Free plan — the plain picker is the Pro+
//   rescheduler. Interleague requests stay Free (they are on the Schedule page).
// - `blocked`: every other case, WITH a sentence. Never a silent no-op.
//
// THE TYPED awayTeamId IS THE POINT. `plain` carries `awayTeamId: string`, and
// is returned ONLY when the game has no interleague org AND a real away team.
// The render site passes it straight through — no `!`, no cast. The four
// ungated RainoutRescheduleModal render paths recorded in CLAUDE.md all exist
// because a nullable `away_team_id` was asserted non-null; with a null away
// team the picker's away-team checks match nothing and pass silently.
//
// LOCK. A plain move is gated on the division lock ("move" reason), exactly
// like the conflict resolver's move — and UNLIKE rainout recovery, which is
// deliberately exempt because weather is not a choice. A plain move is a
// choice, on a schedule that may already be in parents' hands. This is a UI
// gate: the 0082 trigger's allowlist permits `scheduled_at`/`venue_id` writes
// on a locked division, so it is not a database guarantee.

import { lockedReason } from "@/lib/schedule/division-lock";

export type MoveCandidate = {
  status: string;
  scheduled_at: string;
  interleague_org_id: string | null;
  away_team_id: string | null;
  interleague_org?: { name: string } | null;
};

export type MoveBlockReason =
  | "cancelled"
  | "locked"
  | "pending_interleague"
  | "already_requested"
  | "past_interleague"
  | "not_movable_status"
  | "no_opponent";

export type MoveRoute =
  | { kind: "plain"; awayTeamId: string }
  | { kind: "interleague_request"; intro: string }
  | { kind: "upgrade" }
  | {
      kind: "blocked";
      reason: MoveBlockReason;
      message: string;
      link?: { href: string; label: string };
    };

export type MoveContext = {
  locked: boolean;
  canReschedule: boolean;
  divisionName: string;
  /** Injected so the harness is deterministic. The panel passes Date.now(). */
  nowMs: number;
};

const INTERLEAGUE_LINK = {
  href: "/dashboard/interleague",
  label: "Open the Interleague page",
};

/** The feature label the Pro upsell names. */
export const MOVE_UPGRADE_FEATURE = "Moving a game to an open slot";

export function routeMoveTarget(
  game: MoveCandidate,
  ctx: MoveContext,
): MoveRoute {
  if (game.status === "cancelled") {
    return {
      kind: "blocked",
      reason: "cancelled",
      message:
        "This game was rained out — use the Reschedule button on its row.",
    };
  }

  if (game.interleague_org_id) {
    const org = game.interleague_org?.name ?? "The other league";
    if (game.status === "pending_interleague") {
      return {
        kind: "blocked",
        reason: "pending_interleague",
        message: `${org} hasn't agreed to this game yet, so it can't be moved from here. Manage it on the Interleague page.`,
        link: INTERLEAGUE_LINK,
      };
    }
    if (game.status === "reschedule_pending") {
      return {
        kind: "blocked",
        reason: "already_requested",
        message: `A reschedule request for this game is already waiting on ${org}. Follow it on the Interleague page.`,
        link: INTERLEAGUE_LINK,
      };
    }
    if (game.status !== "scheduled") {
      return {
        kind: "blocked",
        reason: "not_movable_status",
        message: "Only scheduled games can be moved from here.",
      };
    }
    // Same future-only rule as the Schedule page's "Request reschedule".
    if (new Date(game.scheduled_at).getTime() <= ctx.nowMs) {
      return {
        kind: "blocked",
        reason: "past_interleague",
        message: "This game has already been played, so there's nothing to request.",
      };
    }
    if (ctx.locked) {
      return {
        kind: "blocked",
        reason: "locked",
        message: lockedReason(ctx.divisionName, "rescheduleInterleague"),
      };
    }
    return {
      kind: "interleague_request",
      intro: `${org} agreed to this game's time, so moving it sends them a request. The game stays where it is until they accept.`,
    };
  }

  // Ordinary game. `scheduled` only: writing the picker's save onto any other
  // status (a recorded `completed`, say) would silently rewrite it.
  if (game.status !== "scheduled") {
    return {
      kind: "blocked",
      reason: "not_movable_status",
      message: "Only scheduled games can be moved from here.",
    };
  }
  if (!game.away_team_id) {
    return {
      kind: "blocked",
      reason: "no_opponent",
      message: "This game has no opponent set, so there are no teams to check a new time against.",
    };
  }
  if (ctx.locked) {
    return {
      kind: "blocked",
      reason: "locked",
      message: lockedReason(ctx.divisionName, "move"),
    };
  }
  if (!ctx.canReschedule) return { kind: "upgrade" };
  return { kind: "plain", awayTeamId: game.away_team_id };
}

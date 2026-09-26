// Where the Schedule page's "Reschedule" (list row menu AND calendar popover)
// sends a game. ONE rule: `routeMoveTarget` — the division panel's router —
// plus the single case this surface adds.
//
// WHY A WRAPPER. On the panel, a rained-out row has its own Reschedule button,
// so routeMoveTarget treats `cancelled` as "use that button". On this page the
// SAME menu item serves both jobs: a scheduled game is a plain move, a
// rained-out game is rainout recovery. So:
// - `cancelled`, not interleague, with a real away team → the RAINOUT picker:
//   rain-cloud header, makeup days offered, no manual entry, and NO lock gate
//   (rainout recovery is exempt — weather is not a choice). Pro only.
// - `cancelled` interleague → a stated refusal: moving it needs the partner,
//   and the interleague request route only accepts scheduled games.
// - everything else → routeMoveTarget, unchanged: plain → the MOVE picker
//   (manual entry, no makeup days, lock-gated), accepted upcoming interleague →
//   the request flow, Free → the upsell, and every other case (pending /
//   already requested / past interleague, no opponent, COMPLETED) → a stated
//   refusal. Refusing `completed` closes a live path: the picker's save writes
//   `status: "scheduled"`, which would silently un-complete a finished game.
//
// The variant is therefore chosen PER GAME, never fixed for the surface.
// `pickerFor` is the one place a route becomes a picker variant; both render
// sites call it. Pinned by `npm run sim:schedule-page-reschedule`.

import {
  routeMoveTarget,
  type MoveCandidate,
  type MoveContext,
  type MoveRoute,
} from "@/lib/schedule/panel-reschedule-route";
import type { RescheduleVariant } from "@/lib/schedule/reschedule-variant";
import { lockedReason } from "@/lib/schedule/division-lock";

export type ScheduleRescheduleRoute =
  | MoveRoute
  | { kind: "rainout"; awayTeamId: string }
  | {
      kind: "blocked";
      reason: "cancelled_interleague";
      message: string;
      link?: { href: string; label: string };
    };

export function routeScheduleReschedule(
  game: MoveCandidate,
  ctx: MoveContext,
): ScheduleRescheduleRoute {
  if (game.status === "cancelled") {
    if (game.interleague_org_id) {
      const org = game.interleague_org?.name ?? "the other league";
      return {
        kind: "blocked",
        reason: "cancelled_interleague",
        message: `This interleague game was rained out. A new time needs ${org}'s agreement — arrange it on the Interleague page.`,
        link: { href: "/dashboard/interleague", label: "Open the Interleague page" },
      };
    }
    if (!game.away_team_id) {
      return {
        kind: "blocked",
        reason: "no_opponent",
        message: "This game has no opponent set, so there are no teams to check a new time against.",
      };
    }
    // Rainout recovery: NO lock check, on purpose.
    if (!ctx.canReschedule) return { kind: "upgrade" };
    return { kind: "rainout", awayTeamId: game.away_team_id };
  }
  return routeMoveTarget(game, ctx);
}

/** The picker a route opens, or null when it opens none. The ONLY place a
 *  route becomes a variant — never pass a fixed variant at a render site. */
export function pickerFor(
  route: ScheduleRescheduleRoute,
): { variant: RescheduleVariant; awayTeamId: string } | null {
  if (route.kind === "rainout") return { variant: "rainout", awayTeamId: route.awayTeamId };
  if (route.kind === "plain") return { variant: "move", awayTeamId: route.awayTeamId };
  return null;
}

/**
 * The lock, shown BEFORE the click: the "Reschedule" item is disabled with this
 * sentence as its tooltip when it would open the MOVE picker on a locked
 * division — the panel's disabled-icon pattern. Null = not gated.
 *
 * Only a scheduled, non-interleague game is gated here: a rained-out game is
 * rainout recovery (exempt), and interleague games route to a refusal or to
 * the request flow, whose server route has its own lock gate.
 * `routeScheduleReschedule` refuses the same case with the same sentence if a
 * click ever gets through, so this is presentation over the same rule.
 */
export function rescheduleItemLockTitle(
  game: { status: string; interleague_org_id: string | null },
  divisionLocked: boolean,
  divisionName: string,
): string | null {
  if (game.status !== "scheduled" || game.interleague_org_id || !divisionLocked) return null;
  return lockedReason(divisionName, "move");
}

/**
 * Whether the "Reschedule" item shows at all — matching the division panel.
 * Free sees it on every game that isn't rained out (a scheduled game's click
 * opens the upsell: a menu that explains the upgrade teaches something, one
 * that silently omits the option teaches nothing). Rained-out games stay
 * hidden on Free, as the panel hides a rained-out row's Reschedule button.
 */
export function rescheduleItemVisible(
  status: string,
  canReschedule: boolean,
): boolean {
  return canReschedule || status !== "cancelled";
}

// The division schedule panel's per-row "Reschedule game" affordance: the icon
// beside the rainout cloud, and the line that appears UNDER the row when a
// click is refused. Hook-free on purpose, so `npm run sim:panel-reschedule`
// (part W) renders exactly what the panel renders.
//
// WHERE A REFUSAL SHOWS (approved 2026-09-25):
// - Locked division → the icon is DISABLED and its tooltip carries the lock
//   sentence — the same pattern as the roster's team-delete icon. The
//   "Schedule locked" card at the top of the panel says it on every screen.
// - Every other refusal routeMoveTarget returns (not yet agreed, request
//   already out, already played, no opponent, not a scheduled game) → the
//   icon stays enabled, and a click puts the reason on a line directly under
//   THAT row, with its link. Not a tooltip: tooltips don't exist on touch and
//   can't hold a link. Not the footer: a refusal rendered away from the action
//   reads as "nothing happened" (CLAUDE.md, Team deletion, Defect 2).
// - Rained-out rows get no icon: the row already says "Rained out" and has
//   its own Reschedule button.

import Link from "next/link";
import { CalendarClock, X } from "lucide-react";
import { lockedReason } from "@/lib/schedule/division-lock";
import { ROW_ICON_REVEAL } from "@/components/ui/row-icon-reveal";

export function moveIconTitle(p: {
  locked: boolean;
  divisionName: string;
  /** The partner org's name when this is an interleague game, else null. */
  interleagueOrgName: string | null;
  isInterleague: boolean;
}): string {
  if (p.locked) {
    return lockedReason(
      p.divisionName,
      p.isInterleague ? "rescheduleInterleague" : "move",
    );
  }
  return p.isInterleague
    ? `Request a new time from ${p.interleagueOrgName ?? "the other league"}`
    : "Reschedule game";
}

export function MoveGameIcon({
  locked,
  divisionName,
  isInterleague,
  interleagueOrgName,
  onClick,
}: {
  locked: boolean;
  divisionName: string;
  isInterleague: boolean;
  interleagueOrgName: string | null;
  onClick: () => void;
}) {
  const title = moveIconTitle({ locked, divisionName, isInterleague, interleagueOrgName });
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={locked}
      title={title}
      aria-label={title}
      className={`flex h-7 w-7 items-center justify-center rounded-lg ${ROW_ICON_REVEAL} transition-all hover:bg-green-50 hover:text-[#22C55E] disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <CalendarClock className="h-3.5 w-3.5" />
    </button>
  );
}

export function MoveNoticeLine({
  message,
  link,
  onDismiss,
}: {
  message: string;
  link?: { href: string; label: string };
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="ml-[80px] mr-2 flex items-start justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2"
    >
      <p className="text-xs text-amber-700">
        {message}
        {link && (
          <>
            {" "}
            <Link
              href={link.href}
              className="text-[#22C55E] underline underline-offset-2"
            >
              {link.label}
            </Link>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        aria-label="Dismiss"
        className="flex-shrink-0 text-amber-400 hover:text-amber-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

"use client";

// The Schedule page's "Reschedule" wiring, shared by the list row menu and the
// calendar popover so the two cannot drift. Routing is
// `routeScheduleReschedule` (the panel's routeMoveTarget + the rained-out
// case); the picker variant comes from `pickerFor`, PER GAME — a scheduled game
// opens the MOVE picker (manual entry, no makeup days), a rained-out game opens
// the RAINOUT picker (makeup days, no lock gate). Refusals come back as a
// notice the caller renders with MoveNoticeLine next to the game — never a
// silent no-op.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RainoutRescheduleModal } from "@/components/divisions/rainout-reschedule-modal";
import { RescheduleRequestModal } from "@/components/interleague/reschedule-request-modal";
import { UpgradeModal } from "@/components/plan/upgrade-cta";
import { submitInterleagueRescheduleRequest } from "@/lib/interleague/request-reschedule";
import { MOVE_UPGRADE_FEATURE } from "@/lib/schedule/panel-reschedule-route";
import {
  pickerFor,
  routeScheduleReschedule,
} from "@/lib/schedule/schedule-page-reschedule-route";
import type { RescheduleVariant } from "@/lib/schedule/reschedule-variant";
import type { ScheduleGame } from "./schedule-list";

export type RescheduleNotice = {
  gameId: string;
  message: string;
  link?: { href: string; label: string };
};

export function useScheduleReschedule({
  canReschedule,
  lockedDivisionIds,
}: {
  canReschedule: boolean;
  /** Divisions locked as of this page load (the page's divisions read). */
  lockedDivisionIds: ReadonlySet<string>;
}): {
  /** Route a game. Returns true when it produced a notice rather than opening
   *  something, so a popover can stay open to show it. */
  open: (game: ScheduleGame) => boolean;
  notice: RescheduleNotice | null;
  clearNotice: () => void;
  modals: ReactNode;
} {
  const router = useRouter();
  // awayTeamId is carried separately, typed `string` by the router — the
  // render site needs no `!` on the nullable column.
  const [target, setTarget] = useState<
    { game: ScheduleGame; variant: RescheduleVariant; awayTeamId: string } | null
  >(null);
  const [notice, setNotice] = useState<RescheduleNotice | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [request, setRequest] = useState<{ game: ScheduleGame; intro: string } | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  function open(game: ScheduleGame): boolean {
    const divisionId = game.home_team?.division_id ?? null;
    // ScheduleGame declares interleague_org_id optional; absent means none.
    const candidate = { ...game, interleague_org_id: game.interleague_org_id ?? null };
    const route = routeScheduleReschedule(candidate, {
      locked: divisionId !== null && lockedDivisionIds.has(divisionId),
      canReschedule,
      divisionName: game.home_team?.division?.name ?? "This division",
      nowMs: Date.now(),
    });
    const picker = pickerFor(route);
    if (picker) {
      setNotice(null);
      setTarget({ game, ...picker });
      return false;
    }
    switch (route.kind) {
      case "interleague_request":
        setNotice(null);
        setRequestError(null);
        setRequest({ game, intro: route.intro });
        return false;
      case "upgrade":
        setNotice(null);
        setUpgradeOpen(true);
        return false;
      case "blocked":
        setNotice({ gameId: game.id, message: route.message, link: route.link });
        return true;
    }
    return false;
  }

  async function submitRequest(payload: {
    scheduled_at: string;
    venue_name?: string;
    note?: string;
  }) {
    if (!request) return;
    setRequestError(null);
    setRequestBusy(true);
    // The one shared submit path — see request-reschedule.ts.
    const outcome = await submitInterleagueRescheduleRequest(request.game.id, payload);
    setRequestBusy(false);
    if (!outcome.ok) {
      setRequestError(outcome.error);
      return;
    }
    setRequest(null);
    router.refresh();
  }

  const modals = (
    <>
      {target && (
        <RainoutRescheduleModal
          variant={target.variant}
          gameId={target.game.id}
          homeTeamId={target.game.home_team_id}
          awayTeamId={target.awayTeamId}
          homeTeamName={target.game.home_team?.name ?? "Home"}
          awayTeamName={target.game.away_team?.name ?? "Away"}
          divisionId={target.game.home_team?.division_id ?? ""}
          leagueId={target.game.league_id}
          currentScheduledAt={target.game.scheduled_at}
          currentVenueId={target.game.venue_id}
          onClose={() => setTarget(null)}
          onRescheduled={() => {
            setTarget(null);
            router.refresh();
          }}
        />
      )}
      {request && (
        <RescheduleRequestModal
          intro={request.intro}
          game={{
            scheduled_at: request.game.scheduled_at,
            is_away: !!request.game.is_away,
            external_team_name: request.game.external_team_name ?? null,
            proposed_venue_name: request.game.proposed_venue_name ?? null,
            home_team: request.game.home_team ? { name: request.game.home_team.name } : null,
            venue: request.game.venue ?? null,
            interleague_org: request.game.interleague_org ?? null,
          }}
          busy={requestBusy}
          error={requestError}
          onSubmit={submitRequest}
          onClose={() => setRequest(null)}
        />
      )}
      {upgradeOpen && (
        <UpgradeModal
          mode="feature"
          feature={MOVE_UPGRADE_FEATURE}
          onClose={() => setUpgradeOpen(false)}
        />
      )}
    </>
  );

  return { open, notice, clearNotice: () => setNotice(null), modals };
}

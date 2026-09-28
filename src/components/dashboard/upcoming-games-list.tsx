"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, CloudRain, CalendarClock, Loader2, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { useScheduleReschedule } from "@/components/schedule/use-schedule-reschedule";
import { MoveNoticeLine } from "@/components/divisions/move-game-row";
import { useGameNoteEditor } from "@/components/schedule/use-game-note-editor";
import { GameNoteIcon, GameNoteLine } from "@/components/schedule/game-note";
import type { GameNoteFields } from "@/lib/schedule/game-notes";
import {
  rescheduleItemLockTitle,
  rescheduleItemVisible,
} from "@/lib/schedule/schedule-page-reschedule-route";
import { logActivity } from "@/lib/activity-log";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";

export type UpcomingGame = {
  id: string;
  scheduled_at: string;
  status: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string | null;
  venue_id: string | null;
  interleague_org_id: string | null;
  interleague_org: { name: string } | null;
  is_away: boolean | null;
  external_team_name: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string; division_id: string | null; division: { name: string } | null } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
} & GameNoteFields;

interface Props {
  initialGames: UpcomingGame[];
  /** Pro+ only — the auto-reschedule action. "Log Rainout" stays Free. */
  canReschedule?: boolean;
  /** Divisions locked as of this page load (dashboard page). */
  lockedDivisionIds?: string[];
}

export function UpcomingGamesList({ initialGames, canReschedule = false, lockedDivisionIds = [] }: Props) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rainoutId, setRainoutId] = useState<string | null>(null);
  const lockedSet = useMemo(() => new Set(lockedDivisionIds), [lockedDivisionIds]);
  const note = useGameNoteEditor({ logSource: "dashboard upcoming games" });
  // Routed per game: ordinary → move picker (Pro); interleague → request.
  const reschedule = useScheduleReschedule({
    canReschedule,
    lockedDivisionIds: lockedSet,
    logSource: "dashboard upcoming games",
  });
  const menuContainerRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleRainout(game: UpcomingGame) {
    setRainoutId(game.id);
    setOpenMenuId(null);
    const supabase = createClient();
    await supabase
      .from("games")
      .update({ status: "cancelled" } as never)
      .eq("id", game.id);
    console.log("[logActivity] before call: rainout_logged (upcoming-games-list)", { leagueId: game.league_id });
    const _r = await logActivity(
      game.league_id,
      game.home_team?.division_id ?? null,
      "rainout_logged",
      `${game.home_team?.name ?? "Home"} vs ${game.away_team?.name ?? "Away"} on ${fmtGameDate(game.scheduled_at)} marked as rained out`,
    );
    console.log("[logActivity] result (upcoming-games-list):", _r);
    setRainoutId(null);
    router.refresh();
  }

  function handleRescheduleClick(game: UpcomingGame) {
    setOpenMenuId(null);
    reschedule.open(game);
  }

  if (initialGames.length === 0) {
    return <p className="text-sm text-gray-500">No upcoming games scheduled.</p>;
  }

  return (
    <>
      <ul ref={menuContainerRef} className="flex flex-col divide-y divide-gray-50">
        {initialGames.map((game) => (
          <li key={game.id} className="flex flex-wrap items-center gap-3 py-3">
            {/* Matchup + date */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#0C1F3F]">
                {game.home_team?.name ?? "TBD"} vs {game.away_team?.name ?? "TBD"}
              </p>
              <GameNoteLine game={game} onClick={() => note.open(game)} />
              <p className="mt-0.5 text-xs text-gray-400">
                {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}
              </p>
            </div>

            {/* Venue */}
            {game.venue?.name && (
              <div className="hidden items-center gap-1 sm:flex flex-shrink-0">
                <MapPin className="h-3 w-3 text-gray-300" />
                <span className="text-xs text-gray-400">{game.venue.name}</span>
              </div>
            )}

            {/* Status badge */}
            <Badge variant="info">Scheduled</Badge>

            <GameNoteIcon game={game} onClick={() => note.open(game)} />

            {/* ⋯ actions menu */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() =>
                  setOpenMenuId(openMenuId === game.id ? null : game.id)
                }
                disabled={rainoutId === game.id}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500 disabled:opacity-50"
                aria-label="Game actions"
              >
                {rainoutId === game.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </button>

              {openMenuId === game.id && (
                <div className="absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
                  <button
                    onClick={() => handleRainout(game)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <CloudRain className="h-3.5 w-3.5 text-blue-400" />
                    Log Rainout
                  </button>
                  {rescheduleItemVisible(game.status, canReschedule, !!game.interleague_org_id) && (() => {
                    const lockTitle = rescheduleItemLockTitle(
                      game,
                      !!game.home_team?.division_id && lockedSet.has(game.home_team.division_id),
                      game.home_team?.division?.name ?? "This division",
                    );
                    return (
                    <button
                      onClick={() => handleRescheduleClick(game)}
                      disabled={!!lockTitle}
                      title={lockTitle ?? undefined}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <CalendarClock className="h-3.5 w-3.5 text-[#22C55E]" />
                      {game.interleague_org_id ? "Request reschedule" : "Reschedule"}
                    </button>
                    );
                  })()}
                </div>
              )}
            </div>
            {reschedule.notice?.gameId === game.id && (
              <div className="basis-full">
                <MoveNoticeLine
                  message={reschedule.notice.message}
                  link={reschedule.notice.link}
                  onDismiss={reschedule.clearNotice}
                  inset="mx-0"
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {reschedule.modals}
      {note.modal}
    </>
  );
}

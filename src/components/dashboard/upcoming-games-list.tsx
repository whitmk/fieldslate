"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, CloudRain, CalendarClock, Loader2, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { RainoutRescheduleModal } from "@/components/divisions/rainout-reschedule-modal";
import { logActivity } from "@/lib/activity-log";
import { fmtGameDate } from "@/lib/utils/game-time";

export type UpcomingGame = {
  id: string;
  scheduled_at: string;
  status: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string; division_id: string | null } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

interface Props {
  initialGames: UpcomingGame[];
}

export function UpcomingGamesList({ initialGames }: Props) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rainoutId, setRainoutId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<UpcomingGame | null>(null);
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
    await logActivity(
      supabase,
      game.league_id,
      game.home_team?.division_id ?? null,
      "rainout_logged",
      `${game.home_team?.name ?? "Home"} vs ${game.away_team?.name ?? "Away"} on ${fmtGameDate(game.scheduled_at)} marked as rained out`,
    );
    setRainoutId(null);
    router.refresh();
  }

  function handleRescheduleClick(game: UpcomingGame) {
    setOpenMenuId(null);
    setRescheduleGame(game);
  }

  if (initialGames.length === 0) {
    return <p className="text-sm text-gray-500">No upcoming games scheduled.</p>;
  }

  return (
    <>
      <ul ref={menuContainerRef} className="flex flex-col divide-y divide-gray-50">
        {initialGames.map((game) => (
          <li key={game.id} className="flex items-center gap-3 py-3">
            {/* Matchup + date */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#0C1F3F]">
                {game.home_team?.name ?? "TBD"} vs {game.away_team?.name ?? "TBD"}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {new Date(game.scheduled_at).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
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
                  <button
                    onClick={() => handleRescheduleClick(game)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <CalendarClock className="h-3.5 w-3.5 text-[#22C55E]" />
                    Reschedule
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {rescheduleGame && (
        <RainoutRescheduleModal
          gameId={rescheduleGame.id}
          homeTeamId={rescheduleGame.home_team_id}
          awayTeamId={rescheduleGame.away_team_id}
          homeTeamName={rescheduleGame.home_team?.name ?? "Home"}
          awayTeamName={rescheduleGame.away_team?.name ?? "Away"}
          divisionId={rescheduleGame.home_team?.division_id ?? ""}
          leagueId={rescheduleGame.league_id}
          onClose={() => setRescheduleGame(null)}
          onRescheduled={() => {
            setRescheduleGame(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

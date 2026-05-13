"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CloudRain, X, CalendarClock, RotateCcw, Loader2,
  CalendarDays, MapPin, Layers,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { RainoutRescheduleModal } from "@/components/divisions/rainout-reschedule-modal";

export type RainedOutGame = {
  id: string;
  scheduled_at: string;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string; division_id: string | null } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

interface Props {
  count: number;
  initialGames: RainedOutGame[];
  leagueId: string;
  divisionNames: Record<string, string>;
}

export function RainedOutStatCard({ count, initialGames, leagueId, divisionNames }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<RainedOutGame[]>(initialGames);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<RainedOutGame | null>(null);

  const active = count > 0;

  async function handleRestore(game: RainedOutGame) {
    setRestoringId(game.id);
    const supabase = createClient();
    await supabase
      .from("games")
      .update({ status: "scheduled" } as never)
      .eq("id", game.id);
    setGames((prev) => prev.filter((g) => g.id !== game.id));
    setRestoringId(null);
    router.refresh();
  }

  function handleRescheduled(gameId: string) {
    setGames((prev) => prev.filter((g) => g.id !== gameId));
    setRescheduleGame(null);
    router.refresh();
  }

  return (
    <>
      {/* ── Stat card ── */}
      <button
        onClick={() => active && setOpen(true)}
        className={`w-full rounded-xl border bg-white p-5 shadow-sm text-left transition-shadow ${
          active
            ? "border-blue-200 cursor-pointer hover:shadow-md"
            : "border-gray-100 cursor-default"
        }`}
      >
        <div className="flex items-center justify-between">
          <p className={`text-sm font-medium ${active ? "text-blue-500" : "text-gray-500"}`}>
            Rained Out
          </p>
          <CloudRain className={`h-4 w-4 ${active ? "text-blue-300" : "text-gray-300"}`} />
        </div>
        <p className={`mt-2 text-3xl font-bold ${active ? "text-blue-600" : "text-[#0C1F3F]"}`}>
          {count}
        </p>
        {active && (
          <p className="mt-1 text-xs font-medium text-blue-400">View →</p>
        )}
      </button>

      {/* ── Modal ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-[85dvh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <CloudRain className="h-4 w-4 text-blue-400" />
                <h2 className="font-semibold text-[#0C1F3F]">Rained Out Games</h2>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-500">
                  {games.length}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {games.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#22C55E]/10">
                    <CloudRain className="h-6 w-6 text-[#22C55E]" />
                  </div>
                  <p className="font-medium text-[#0C1F3F]">All caught up</p>
                  <p className="text-sm text-gray-400">No rained-out games remaining.</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {games.map((game) => {
                    const divisionId = game.home_team?.division_id ?? "";
                    const divisionName = divisionId ? divisionNames[divisionId] : null;
                    const isRestoring = restoringId === game.id;

                    return (
                      <li key={game.id} className="px-6 py-4">
                        {/* Date / time / venue / division */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {fmtGameDate(game.scheduled_at)}
                          </span>
                          <span>{fmtGameTime(game.scheduled_at)}</span>
                          {game.venue?.name && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {game.venue.name}
                            </span>
                          )}
                          {divisionName && (
                            <span className="flex items-center gap-1">
                              <Layers className="h-3 w-3" />
                              {divisionName}
                            </span>
                          )}
                        </div>

                        {/* Matchup */}
                        <p className="mt-1.5 text-sm font-semibold text-[#0C1F3F]">
                          {game.home_team?.name ?? "TBD"}
                          <span className="mx-1.5 font-normal text-gray-400">vs</span>
                          {game.away_team?.name ?? "TBD"}
                        </p>

                        {/* Actions */}
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => setRescheduleGame(game)}
                            disabled={isRestoring}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:opacity-50"
                          >
                            <CalendarClock className="h-3 w-3" />
                            Reschedule
                          </button>
                          <button
                            onClick={() => handleRestore(game)}
                            disabled={isRestoring}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 disabled:opacity-50"
                          >
                            {isRestoring ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3" />
                            )}
                            {isRestoring ? "Restoring…" : "Remove Rainout"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Reschedule slot picker ── */}
      {rescheduleGame && (
        <RainoutRescheduleModal
          gameId={rescheduleGame.id}
          homeTeamId={rescheduleGame.home_team_id}
          awayTeamId={rescheduleGame.away_team_id}
          homeTeamName={rescheduleGame.home_team?.name ?? "Home"}
          awayTeamName={rescheduleGame.away_team?.name ?? "Away"}
          divisionId={rescheduleGame.home_team?.division_id ?? ""}
          leagueId={leagueId}
          onClose={() => setRescheduleGame(null)}
          onRescheduled={() => handleRescheduled(rescheduleGame.id)}
        />
      )}
    </>
  );
}

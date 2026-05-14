"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, X, CalendarClock, CalendarDays, MapPin, Layers, CalendarX,
} from "lucide-react";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { RainoutRescheduleModal } from "@/components/divisions/rainout-reschedule-modal";

export type ConflictGame = {
  id: string;
  scheduled_at: string;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string; division_id: string | null } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
  conflictType: "schedule" | "blackout";
  blackoutLabel: string | null;
};

interface Props {
  initialConflictGames: ConflictGame[];
  leagueId: string;
  divisionNames: Record<string, string>;
}

export function ConflictStatCard({ initialConflictGames, leagueId, divisionNames }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<ConflictGame[]>(initialConflictGames);
  const [rescheduleGame, setRescheduleGame] = useState<ConflictGame | null>(null);

  // Sync when server re-renders after router.refresh()
  useEffect(() => { setGames(initialConflictGames); }, [initialConflictGames]);

  const active = games.length > 0;

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
          active ? "border-red-200 cursor-pointer hover:shadow-md" : "border-gray-100 cursor-default"
        }`}
      >
        <div className="flex items-center justify-between">
          <p className={`text-sm font-medium ${active ? "text-red-500" : "text-gray-500"}`}>Conflicts</p>
          <AlertCircle className={`h-4 w-4 ${active ? "text-red-300" : "text-gray-300"}`} />
        </div>
        <p className={`mt-2 text-3xl font-bold ${active ? "text-red-600" : "text-[#0C1F3F]"}`}>{games.length}</p>
        {active && <p className="mt-1 text-xs font-medium text-red-400">View →</p>}
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
                <AlertCircle className="h-4 w-4 text-red-400" />
                <h2 className="font-semibold text-[#0C1F3F]">Schedule Conflicts</h2>
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-500">
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
                    <AlertCircle className="h-6 w-6 text-[#22C55E]" />
                  </div>
                  <p className="font-medium text-[#0C1F3F]">All conflicts resolved</p>
                  <p className="text-sm text-gray-400">No scheduling conflicts remaining.</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {games.map((game) => {
                    const divId = game.home_team?.division_id ?? "";
                    const divisionName = divId ? divisionNames[divId] : null;
                    return (
                      <li key={game.id} className="px-6 py-4">
                        {/* Meta */}
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

                        {/* Reason badge */}
                        <div className="mt-1.5">
                          {game.conflictType === "blackout" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                              <CalendarX className="h-3 w-3" />
                              Blackout date{game.blackoutLabel ? ` — ${game.blackoutLabel}` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-500">
                              <AlertCircle className="h-3 w-3" />
                              Double-booked field
                            </span>
                          )}
                        </div>

                        {/* Action */}
                        <div className="mt-3">
                          <button
                            onClick={() => setRescheduleGame(game)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
                          >
                            <CalendarClock className="h-3 w-3" />
                            Reschedule
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
          buildLogMessage={
            rescheduleGame.conflictType === "blackout"
              ? ({ newScheduledAt }) =>
                  `${rescheduleGame.home_team?.name ?? "Home"} vs ${rescheduleGame.away_team?.name ?? "Away"} rescheduled from ${fmtGameDate(rescheduleGame.scheduled_at)} to ${fmtGameDate(newScheduledAt)} — was on blackout date`
              : undefined
          }
        />
      )}
    </>
  );
}

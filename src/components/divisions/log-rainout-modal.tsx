"use client";

import { useState, useEffect } from "react";
import {
  CloudRain, X, Loader2, CalendarDays, CheckCircle2, CalendarClock, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { RainoutRescheduleModal } from "./rainout-reschedule-modal";
import type { Division } from "@/types/database";

type GameOption = {
  id: string;
  scheduled_at: string;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

interface Props {
  leagueId: string;
  divisions: Division[];
  onClose: () => void;
  onRainedOut: () => void;
}

export function LogRainoutModal({ leagueId, divisions, onClose, onRainedOut }: Props) {
  const [divisionId, setDivisionId] = useState(divisions.length === 1 ? divisions[0].id : "");
  const [games, setGames] = useState<GameOption[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [selectedGame, setSelectedGame] = useState<GameOption | null>(null);
  const [marking, setMarking] = useState(false);
  const [markedGame, setMarkedGame] = useState<GameOption | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);

  useEffect(() => {
    if (!divisionId) { setGames([]); return; }
    void loadGames(divisionId);
  }, [divisionId]);

  async function loadGames(divId: string) {
    setGamesLoading(true);
    setSelectedGame(null);
    const supabase = createClient();

    const { data: teamData } = await supabase
      .from("teams")
      .select("id")
      .eq("division_id", divId);
    const teamIds = (teamData ?? []).map((t: { id: string }) => t.id);

    if (!teamIds.length) {
      setGames([]);
      setGamesLoading(false);
      return;
    }

    const { data: gameData } = await supabase
      .from("games")
      .select(`
        id, scheduled_at, home_team_id, away_team_id,
        home_team:teams!home_team_id(name),
        away_team:teams!away_team_id(name),
        venue:venues(name)
      `)
      .in("home_team_id", teamIds)
      .eq("status", "scheduled")
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(30);

    setGames((gameData ?? []) as unknown as GameOption[]);
    setGamesLoading(false);
  }

  async function handleMarkRainout() {
    if (!selectedGame) return;
    setMarking(true);
    const supabase = createClient();
    await supabase
      .from("games")
      .update({ status: "cancelled" } as never)
      .eq("id", selectedGame.id);
    setMarkedGame(selectedGame);
    setMarking(false);
    onRainedOut();
  }

  const selectedDivision = divisions.find((d) => d.id === divisionId);

  // Hand off directly to the slot-picker when user chooses "Reschedule now"
  if (showReschedule && markedGame) {
    return (
      <RainoutRescheduleModal
        gameId={markedGame.id}
        homeTeamId={markedGame.home_team_id}
        awayTeamId={markedGame.away_team_id}
        homeTeamName={markedGame.home_team?.name ?? "Home"}
        awayTeamName={markedGame.away_team?.name ?? "Away"}
        divisionId={divisionId}
        leagueId={leagueId}
        onClose={onClose}
        onRescheduled={() => { onRainedOut(); onClose(); }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[85dvh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <CloudRain className="h-4 w-4 text-blue-400" />
            <h2 className="font-semibold text-[#0C1F3F]">Log a Rainout</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Step 3: done — offer reschedule or later ── */}
          {markedGame ? (
            <div className="flex flex-col items-center gap-5 px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                <CheckCircle2 className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <p className="font-semibold text-[#0C1F3F]">Game marked as rained out</p>
                <p className="mt-1 text-sm text-gray-500">
                  {markedGame.home_team?.name ?? "Home"} vs {markedGame.away_team?.name ?? "Away"}
                  <br />
                  {fmtGameDate(markedGame.scheduled_at)} at {fmtGameTime(markedGame.scheduled_at)}
                </p>
              </div>
              <div className="flex w-full max-w-xs flex-col gap-2">
                <button
                  onClick={() => setShowReschedule(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
                >
                  <CalendarClock className="h-4 w-4" />
                  Reschedule now
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
                >
                  Do it later
                </button>
              </div>
            </div>

          ) : selectedGame ? (
            /* ── Step 2: confirm the selected game ── */
            <div className="flex flex-col gap-4 px-6 py-5">
              <button
                onClick={() => setSelectedGame(null)}
                className="self-start text-xs text-gray-400 transition-colors hover:text-gray-600"
              >
                ← Back
              </button>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Selected game
                </p>
                <p className="text-sm font-semibold text-[#0C1F3F]">
                  {selectedGame.home_team?.name ?? "TBD"}
                  <span className="mx-1.5 font-normal text-gray-400">vs</span>
                  {selectedGame.away_team?.name ?? "TBD"}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {fmtGameDate(selectedGame.scheduled_at)} at {fmtGameTime(selectedGame.scheduled_at)}
                  {selectedGame.venue?.name ? ` · ${selectedGame.venue.name}` : ""}
                </p>
              </div>
              <p className="text-sm text-gray-600">
                Marking this game as rained out will cancel it. You can reschedule it to a new slot immediately or come back to it later.
              </p>
              <button
                onClick={handleMarkRainout}
                disabled={marking}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
              >
                {marking
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Marking…</>
                  : <><CloudRain className="h-4 w-4" />Mark as rained out</>}
              </button>
            </div>

          ) : (
            /* ── Step 1: pick division then pick game ── */
            <div className="flex flex-col gap-5 px-6 py-5">
              {/* Division selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-500">Division</label>
                {divisions.length === 1 ? (
                  <p className="text-sm font-medium text-[#0C1F3F]">{divisions[0].name}</p>
                ) : (
                  <select
                    value={divisionId}
                    onChange={(e) => setDivisionId(e.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/30"
                  >
                    <option value="">Select a division…</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Game list */}
              {divisionId && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-gray-500">
                    Upcoming scheduled games
                  </label>
                  {gamesLoading ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                    </div>
                  ) : games.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-200 py-10 text-center">
                      <CalendarDays className="h-6 w-6 text-gray-200" />
                      <p className="text-sm font-medium text-gray-500">No upcoming games</p>
                      <p className="text-xs text-gray-400">
                        No scheduled games found for {selectedDivision?.name}.
                      </p>
                    </div>
                  ) : (
                    <ul className="overflow-hidden rounded-xl border border-gray-100">
                      {games.map((game) => (
                        <li key={game.id} className="border-b border-gray-50 last:border-0">
                          <button
                            onClick={() => setSelectedGame(game)}
                            className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-gray-50"
                          >
                            <div>
                              <p className="text-sm font-semibold text-[#0C1F3F]">
                                {game.home_team?.name ?? "TBD"}
                                <span className="mx-1.5 font-normal text-gray-400">vs</span>
                                {game.away_team?.name ?? "TBD"}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-400">
                                {fmtGameDate(game.scheduled_at)} at {fmtGameTime(game.scheduled_at)}
                                {game.venue?.name ? ` · ${game.venue.name}` : ""}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import {
  CloudRain, X, Loader2, CalendarDays, CheckCircle2, CalendarClock, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { RainoutRescheduleModal } from "./rainout-reschedule-modal";
import { logActivity } from "@/lib/activity-log";
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

type MultiGameOption = GameOption & {
  division_id: string;
  division_name: string;
};

interface Props {
  leagueId: string;
  divisions: Division[];
  onClose: () => void;
  onRainedOut: () => void;
}

export function LogRainoutModal({ leagueId, divisions, onClose, onRainedOut }: Props) {
  const [mode, setMode] = useState<"single" | "multi" | null>(null);

  // ── Single-game flow ──────────────────────────────────────────────────────
  const [divisionId, setDivisionId] = useState(divisions.length === 1 ? divisions[0].id : "");
  const [games, setGames] = useState<GameOption[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [selectedGame, setSelectedGame] = useState<GameOption | null>(null);
  const [marking, setMarking] = useState(false);
  const [markedGame, setMarkedGame] = useState<GameOption | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);

  // ── Multi-game flow ───────────────────────────────────────────────────────
  const [multiGames, setMultiGames] = useState<MultiGameOption[]>([]);
  const [multiLoading, setMultiLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSaving, setMultiSaving] = useState(false);
  const [multiDoneCount, setMultiDoneCount] = useState(0);

  useEffect(() => {
    if (mode !== "single") return;
    if (!divisionId) { setGames([]); return; }
    void loadGames(divisionId);
  }, [divisionId, mode]);

  useEffect(() => {
    if (mode !== "multi") return;
    void loadMultiGames();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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

  async function loadMultiGames() {
    setMultiLoading(true);
    const supabase = createClient();

    const divisionIds = divisions.map((d) => d.id);
    const { data: teamData } = await supabase
      .from("teams")
      .select("id, division_id")
      .in("division_id", divisionIds);

    const teamDivMap: Record<string, string> = {};
    const teamIds: string[] = [];
    for (const t of teamData ?? []) {
      teamDivMap[t.id] = t.division_id ?? "";
      teamIds.push(t.id);
    }

    if (!teamIds.length) {
      setMultiGames([]);
      setMultiLoading(false);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
      .gte("scheduled_at", today.toISOString())
      .order("scheduled_at", { ascending: true });

    const divisionNameMap: Record<string, string> = {};
    for (const d of divisions) divisionNameMap[d.id] = d.name;

    const enriched: MultiGameOption[] = ((gameData ?? []) as unknown as GameOption[]).map((g) => {
      const divId = teamDivMap[g.home_team_id] ?? "";
      return { ...g, division_id: divId, division_name: divisionNameMap[divId] ?? "" };
    });

    setMultiGames(enriched);
    setMultiLoading(false);
  }

  async function handleMarkRainout() {
    if (!selectedGame) return;
    setMarking(true);
    const supabase = createClient();
    await supabase
      .from("games")
      .update({ status: "cancelled" } as never)
      .eq("id", selectedGame.id);
    console.log("[logActivity] before call: rainout_logged (handleMarkRainout)", { leagueId, divisionId });
    const _r = await logActivity(
      leagueId,
      divisionId || null,
      "rainout_logged",
      `${selectedGame.home_team?.name ?? "Home"} vs ${selectedGame.away_team?.name ?? "Away"} on ${fmtGameDate(selectedGame.scheduled_at)} marked as rained out`,
    );
    console.log("[logActivity] result (handleMarkRainout):", _r);
    setMarkedGame(selectedGame);
    setMarking(false);
    onRainedOut();
  }

  async function handleMarkMultipleRainouts() {
    if (!selectedIds.size) return;
    setMultiSaving(true);
    const supabase = createClient();
    const ids = Array.from(selectedIds);
    await supabase
      .from("games")
      .update({ status: "cancelled" } as never)
      .in("id", ids);
    await Promise.all(
      ids.map(async (id) => {
        const g = multiGames.find((mg) => mg.id === id);
        if (!g) return;
        await logActivity(
          leagueId,
          g.division_id || null,
          "rainout_logged",
          `${g.home_team?.name ?? "Home"} vs ${g.away_team?.name ?? "Away"} on ${fmtGameDate(g.scheduled_at)} marked as rained out`,
        );
      })
    );
    setMultiDoneCount(ids.length);
    setMultiSaving(false);
    onRainedOut();
  }

  function toggleGame(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Group multi games by date key (YYYY-MM-DD)
  const groupedMulti = multiGames.reduce<Record<string, MultiGameOption[]>>((acc, g) => {
    const dateKey = g.scheduled_at.slice(0, 10);
    (acc[dateKey] ??= []).push(g);
    return acc;
  }, {});
  const dateKeys = Object.keys(groupedMulti).sort();

  const selectedDivision = divisions.find((d) => d.id === divisionId);

  // Reschedule handoff (single flow)
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

          {/* ── Mode picker ─────────────────────────────────────────────── */}
          {mode === null && (
            <div className="flex flex-col gap-3 px-6 py-5">
              <p className="text-sm text-gray-500">How many games do you need to rain out?</p>
              <button
                onClick={() => setMode("single")}
                className="flex items-center justify-between rounded-xl border border-gray-200 px-5 py-4 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/40"
              >
                <div>
                  <p className="font-semibold text-[#0C1F3F]">One game</p>
                  <p className="mt-0.5 text-xs text-gray-400">Pick a division and select a single game</p>
                </div>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
              </button>
              <button
                onClick={() => setMode("multi")}
                className="flex items-center justify-between rounded-xl border border-gray-200 px-5 py-4 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/40"
              >
                <div>
                  <p className="font-semibold text-[#0C1F3F]">Multiple games</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    See all upcoming league games starting today and select any to rain out
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
              </button>
            </div>
          )}

          {/* ── Single-game flow ─────────────────────────────────────────── */}
          {mode === "single" && (
            markedGame ? (
              /* Done */
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
              /* Confirm */
              <div className="flex flex-col gap-4 px-6 py-5">
                <button
                  onClick={() => setSelectedGame(null)}
                  className="self-start text-xs text-gray-400 transition-colors hover:text-gray-600"
                >
                  ← Back
                </button>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Selected game</p>
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
              /* Pick division → pick game */
              <div className="flex flex-col gap-5 px-6 py-5">
                <button
                  onClick={() => setMode(null)}
                  className="self-start text-xs text-gray-400 transition-colors hover:text-gray-600"
                >
                  ← Back
                </button>
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

                {divisionId && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-gray-500">Upcoming scheduled games</label>
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
            )
          )}

          {/* ── Multi-game flow ──────────────────────────────────────────── */}
          {mode === "multi" && (
            multiDoneCount > 0 ? (
              /* Done */
              <div className="flex flex-col items-center gap-5 px-6 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                  <CheckCircle2 className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-[#0C1F3F]">
                    {multiDoneCount} game{multiDoneCount !== 1 ? "s" : ""} marked as rained out
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    You can reschedule these from the division schedule view.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-gray-200 px-6 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
                >
                  Close
                </button>
              </div>
            ) : multiLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              </div>
            ) : multiGames.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <CalendarDays className="h-8 w-8 text-gray-200" />
                <p className="font-medium text-gray-500">No upcoming games found</p>
                <p className="text-sm text-gray-400">
                  No scheduled games in this league from today onward.
                </p>
                <button
                  onClick={() => setMode(null)}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-600"
                >
                  ← Back
                </button>
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Back + select-all */}
                <div className="flex items-center justify-between border-b border-gray-50 px-6 py-3">
                  <button
                    onClick={() => setMode(null)}
                    className="text-xs text-gray-400 transition-colors hover:text-gray-600"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() =>
                      setSelectedIds(
                        selectedIds.size === multiGames.length
                          ? new Set()
                          : new Set(multiGames.map((g) => g.id))
                      )
                    }
                    className="text-xs font-medium text-blue-500 hover:text-blue-600"
                  >
                    {selectedIds.size === multiGames.length ? "Deselect all" : "Select all"}
                  </button>
                </div>

                {/* Games grouped by date */}
                {dateKeys.map((dateKey) => (
                  <div key={dateKey}>
                    <div className="bg-gray-50/70 px-6 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {fmtGameDate(`${dateKey}T12:00:00`)}
                      </p>
                    </div>
                    <ul className="divide-y divide-gray-50">
                      {groupedMulti[dateKey].map((game) => {
                        const isSelected = selectedIds.has(game.id);
                        return (
                          <li key={game.id}>
                            <button
                              onClick={() => toggleGame(game.id)}
                              className={`flex w-full items-center gap-3 px-6 py-3.5 text-left transition-colors ${
                                isSelected ? "bg-blue-50/60" : "hover:bg-gray-50"
                              }`}
                            >
                              {/* Checkbox */}
                              <div
                                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
                                  isSelected ? "border-blue-500 bg-blue-500" : "border-gray-300"
                                }`}
                              >
                                {isSelected && (
                                  <svg
                                    className="h-3 w-3 text-white"
                                    fill="none"
                                    viewBox="0 0 12 12"
                                    stroke="currentColor"
                                    strokeWidth={2.5}
                                  >
                                    <polyline points="2,6 5,9 10,3" />
                                  </svg>
                                )}
                              </div>
                              {/* Info */}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-[#0C1F3F]">
                                  {game.home_team?.name ?? "TBD"}
                                  <span className="mx-1.5 font-normal text-gray-400">vs</span>
                                  {game.away_team?.name ?? "TBD"}
                                </p>
                                <p className="mt-0.5 text-xs text-gray-400">
                                  {fmtGameTime(game.scheduled_at)}
                                  {game.venue?.name ? ` · ${game.venue.name}` : ""}
                                  {game.division_name ? ` · ${game.division_name}` : ""}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* ── Multi sticky footer ──────────────────────────────────────────── */}
        {mode === "multi" && multiDoneCount === 0 && !multiLoading && multiGames.length > 0 && (
          <div className="flex-shrink-0 border-t border-gray-100 px-6 py-4">
            <button
              onClick={handleMarkMultipleRainouts}
              disabled={selectedIds.size === 0 || multiSaving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
            >
              {multiSaving ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Marking…</>
              ) : (
                <><CloudRain className="h-4 w-4" />
                  {selectedIds.size > 0
                    ? `Rain out ${selectedIds.size} game${selectedIds.size !== 1 ? "s" : ""}`
                    : "Select games to rain out"}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

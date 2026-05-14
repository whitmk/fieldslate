"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Zap, Loader2, CheckCircle2, AlertTriangle, CalendarDays,
  RefreshCw, PlusCircle, Printer, CloudRain, CalendarClock,
  Pencil, Trash2, Check, Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  generateSchedule,
  finishSchedule,
  detectScheduleConflicts,
} from "@/lib/schedule/generate-schedule";
import type { ScheduleConflict } from "@/lib/schedule/generate-schedule";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { RainoutRescheduleModal } from "./rainout-reschedule-modal";
import { logActivity } from "@/lib/activity-log";

interface Props {
  divisionId: string;
  divisionName: string;
  leagueName: string;
  leagueId: string;
  triggerPrint?: boolean;
  onPrintDone?: () => void;
  onScheduleChange?: () => void;
}

type Team = { id: string; name: string };

type GameRow = {
  id: string;
  scheduled_at: string;
  status: string;
  venue_id: string | null;
  home_team_id: string;
  away_team_id: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

export function DivisionSchedulePanel({
  divisionId, divisionName, leagueName, leagueId,
  triggerPrint, onPrintDone, onScheduleChange,
}: Props) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [gamesPerTeam, setGamesPerTeam] = useState(0);
  const [games, setGames] = useState<GameRow[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [rainoutId, setRainoutId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<GameRow | null>(null);

  // Team inline-edit state
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingTeamId, setSavingTeamId] = useState<string | null>(null);

  // Team delete state
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const editInputRef = useRef<HTMLInputElement>(null);

  const fetchGames = useCallback(async () => {
    setLoadingGames(true);
    const supabase = createClient();

    const { data: teamData } = await supabase
      .from("teams")
      .select("id, name")
      .eq("division_id", divisionId)
      .order("name");

    const teamList = (teamData ?? []) as Team[];
    setTeams(teamList);
    const teamIds = teamList.map((t) => t.id);

    if (!teamIds.length) {
      setGames([]);
      setConflicts([]);
      setLoadingGames(false);
      return;
    }

    const { data: divDataRaw } = await supabase
      .from("divisions")
      .select("settings")
      .eq("id", divisionId)
      .single();

    const divData = divDataRaw as unknown as { settings: Record<string, unknown> } | null;
    const settings = (divData?.settings ?? {}) as {
      game_duration?: number;
      buffer_minutes?: number;
      games_per_team?: number;
    };

    setGamesPerTeam(Number(settings.games_per_team ?? 0));

    const { data } = await supabase
      .from("games")
      .select(
        `id, scheduled_at, status, venue_id, home_team_id, away_team_id,
         home_team:teams!home_team_id(name),
         away_team:teams!away_team_id(name),
         venue:venues(name)`,
      )
      .in("home_team_id", teamIds)
      .order("scheduled_at");

    const rows = (data as unknown as GameRow[]) ?? [];
    setGames(rows);

    // Only count scheduled/active games for conflict detection
    const activeRows = rows.filter((g) => g.status !== "cancelled");
    const flat = activeRows.map((g) => ({
      id: g.id,
      scheduled_at: g.scheduled_at,
      venue_id: g.venue_id,
      venue_name: g.venue?.name ?? "Unknown venue",
      home_team_name: g.home_team?.name ?? "TBD",
      away_team_name: g.away_team?.name ?? "TBD",
    }));
    setConflicts(
      detectScheduleConflicts(flat, settings.game_duration ?? 0, settings.buffer_minutes ?? 0),
    );

    setLoadingGames(false);
  }, [divisionId]);

  useEffect(() => { fetchGames(); }, [fetchGames]);

  useEffect(() => {
    if (triggerPrint && !loadingGames) {
      window.print();
      onPrintDone?.();
    }
  }, [triggerPrint, loadingGames, onPrintDone]);

  async function handleGenerate() {
    setGenerating(true);
    setResult(null);
    const res = await generateSchedule(divisionId);
    if (res.success) {
      setResult({ type: "success", message: `${res.gamesCreated} game${res.gamesCreated === 1 ? "" : "s"} scheduled` });
      const supabase = createClient();
      await logActivity(supabase, leagueId, divisionId, "schedule_generated",
        `${divisionName} schedule generated — ${res.gamesCreated} game${res.gamesCreated === 1 ? "" : "s"} scheduled`);
      fetchGames();
      onScheduleChange?.();
    } else {
      setResult({ type: "error", message: res.error });
    }
    setGenerating(false);
  }

  async function handleFinish() {
    setFinishing(true);
    setResult(null);
    const res = await finishSchedule(divisionId);
    if (res.success) {
      setResult({
        type: "success",
        message: res.gamesCreated === 0
          ? "Schedule is already complete"
          : `${res.gamesCreated} missing game${res.gamesCreated === 1 ? "" : "s"} added`,
      });
      if (res.gamesCreated > 0) {
        const supabase = createClient();
        await logActivity(supabase, leagueId, divisionId, "schedule_generated",
          `${divisionName} schedule generated — ${res.gamesCreated} game${res.gamesCreated === 1 ? "" : "s"} added`);
      }
      fetchGames();
      onScheduleChange?.();
    } else {
      setResult({ type: "error", message: res.error });
    }
    setFinishing(false);
  }

  function startEdit(team: Team) {
    setEditingTeamId(team.id);
    setEditingName(team.name);
    setEditError(null);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditingTeamId(null);
    setEditingName("");
    setEditError(null);
  }

  async function handleSaveTeamName(teamId: string) {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditError("Name cannot be blank.");
      return;
    }
    const duplicate = teams.some(
      (t) => t.id !== teamId && t.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      setEditError("Another team in this division already has that name.");
      return;
    }
    setSavingTeamId(teamId);
    const supabase = createClient();
    const { error } = await supabase
      .from("teams")
      .update({ name: trimmed } as never)
      .eq("id", teamId);
    if (error) {
      setEditError(error.message);
    } else {
      cancelEdit();
      await fetchGames();
      onScheduleChange?.();
    }
    setSavingTeamId(null);
  }

  async function handleDeleteTeam(team: Team) {
    setDeleteLoading(true);
    const supabase = createClient();

    // Delete games where the team is home or away (no cascade on those FKs)
    await supabase.from("games").delete().eq("home_team_id", team.id);
    await supabase.from("games").delete().eq("away_team_id", team.id);

    await supabase.from("teams").delete().eq("id", team.id);

    setDeleteTarget(null);
    setDeleteLoading(false);
    await fetchGames();
    onScheduleChange?.();
  }

  async function handleRainOut(game: GameRow) {
    setRainoutId(game.id);
    const supabase = createClient();
    await supabase.from("games").update({ status: "cancelled" } as never).eq("id", game.id);
    await logActivity(
      supabase,
      leagueId,
      divisionId,
      "rainout_logged",
      `${game.home_team?.name ?? "Home"} vs ${game.away_team?.name ?? "Away"} on ${fmtGameDate(game.scheduled_at)} marked as rained out`,
    );
    await fetchGames();
    router.refresh();
    onScheduleChange?.();
    setRainoutId(null);
  }

  // ── Compute per-team counts (exclude cancelled games) ─────────────────────────

  const activeGames = games.filter((g) => g.status !== "cancelled");
  const cancelledGames = games.filter((g) => g.status === "cancelled");

  const gameCountByTeam: Record<string, number> = {};
  for (const t of teams) gameCountByTeam[t.id] = 0;
  for (const g of activeGames) {
    if (g.home_team_id) gameCountByTeam[g.home_team_id] = (gameCountByTeam[g.home_team_id] ?? 0) + 1;
    if (g.away_team_id) gameCountByTeam[g.away_team_id] = (gameCountByTeam[g.away_team_id] ?? 0) + 1;
  }

  const teamsWithDeficit = teams
    .map((t) => ({ ...t, count: gameCountByTeam[t.id] ?? 0, deficit: Math.max(0, gamesPerTeam - (gameCountByTeam[t.id] ?? 0)) }))
    .filter((t) => t.deficit > 0);

  const isIncomplete = games.length > 0 && teamsWithDeficit.length > 0;

  // ── Group games by date ───────────────────────────────────────────────────────

  const grouped = new Map<string, GameRow[]>();
  for (const g of games) {
    const key = g.scheduled_at.substring(0, 10);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(g);
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50/40 px-6 py-5">

      {/* ── Team roster ── */}
      {teams.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-xl border border-gray-100 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-50 px-4 py-2.5">
            <Users className="h-3.5 w-3.5 text-gray-300" />
            <p className="text-xs font-semibold text-gray-500">
              Teams · {teams.length}
            </p>
          </div>
          <ul className="divide-y divide-gray-50">
            {teams.map((team) => {
              const isEditing = editingTeamId === team.id;
              const isSaving = savingTeamId === team.id;
              return (
                <li key={team.id} className="group flex items-center gap-2 px-4 py-2.5">
                  {isEditing ? (
                    /* Inline edit mode */
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <input
                          ref={editInputRef}
                          value={editingName}
                          onChange={(e) => { setEditingName(e.target.value); setEditError(null); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveTeamName(team.id);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/30"
                        />
                        <button
                          onClick={() => handleSaveTeamName(team.id)}
                          disabled={isSaving}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#22C55E] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded-lg px-2 py-1 text-xs text-gray-400 transition-colors hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                      {editError && (
                        <p className="text-xs text-red-500">{editError}</p>
                      )}
                    </div>
                  ) : (
                    /* Normal display mode */
                    <>
                      <span className="flex-1 text-sm font-medium text-[#0C1F3F]">{team.name}</span>
                      <span className="text-xs text-gray-400">
                        {gameCountByTeam[team.id] ?? 0}
                        {gamesPerTeam > 0 ? ` / ${gamesPerTeam}` : ""} games
                      </span>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => startEdit(team)}
                          title="Rename team"
                          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(team)}
                          title="Delete team"
                          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              <h3 className="text-base font-bold text-[#0C1F3F]">Delete team?</h3>
            </div>
            <p className="mt-2 text-sm text-gray-600">
              <span className="font-semibold">{deleteTarget.name}</span> will be permanently removed along with{" "}
              <span className="font-semibold">all of their scheduled games</span>. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteTeam(deleteTarget)}
                disabled={deleteLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {deleteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {deleteLoading ? "Deleting…" : "Delete team & games"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex flex-wrap items-center gap-3">
        {isIncomplete ? (
          <>
            <button
              onClick={handleFinish}
              disabled={finishing || generating}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {finishing
                ? <><Loader2 className="h-4 w-4 animate-spin" />Finishing…</>
                : <><PlusCircle className="h-4 w-4" />Finish scheduling</>}
            </button>
            <button
              onClick={handleGenerate}
              disabled={finishing || generating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Regenerating…</>
                : <><RefreshCw className="h-3.5 w-3.5" />Regenerate full schedule</>}
            </button>
          </>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating
              ? <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
              : <><Zap className="h-4 w-4" />{games.length > 0 ? "Regenerate schedule" : "Generate schedule"}</>}
          </button>
        )}

        {result && (
          <span className={`flex items-center gap-1.5 text-sm font-medium ${result.type === "success" ? "text-[#22C55E]" : "text-red-500"}`}>
            {result.type === "success"
              ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
            {result.message}
          </span>
        )}

        {games.length > 0 && (
          <button
            onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] print:hidden"
          >
            <Printer className="h-4 w-4" />
            Print Schedule
          </button>
        )}
      </div>

      {/* ── Rained out pending banner ── */}
      {cancelledGames.length > 0 && (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <CloudRain className="h-4 w-4 flex-shrink-0 text-blue-400" />
            <p className="text-sm font-semibold text-blue-700">
              {cancelledGames.length} rained-out game{cancelledGames.length !== 1 ? "s" : ""} need rescheduling
            </p>
          </div>
        </div>
      )}

      {/* ── Incomplete breakdown ── */}
      {isIncomplete && (
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="mb-1.5 text-xs font-semibold text-amber-700">
            Missing games — {teamsWithDeficit.reduce((s, t) => s + t.deficit, 0)} game{teamsWithDeficit.reduce((s, t) => s + t.deficit, 0) !== 1 ? "s" : ""} still needed
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {teamsWithDeficit.map((t) => (
              <span key={t.id} className="text-xs text-amber-700">
                <span className="font-medium">{t.name}</span>{" "}
                <span className="text-amber-600">{t.count}/{gamesPerTeam} ({t.deficit} missing)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Conflict warning ── */}
      {conflicts.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-700">
                Field conflict detected —{" "}
                {conflicts.reduce((sum, c) => sum + c.games.length, 0)} games are double-booked
              </p>
              <ul className="mt-1.5 space-y-1">
                {conflicts.slice(0, 5).map((c, i) => (
                  <li key={i} className="text-xs text-red-600">
                    <span className="font-medium">{c.venueName}</span> on {fmtGameDate(c.date)}:{" "}
                    {c.games
                      .map((g) =>
                        g.divisionName
                          ? `${g.homeTeam} vs ${g.awayTeam} (${g.divisionName}) at ${g.timeLabel}`
                          : `${g.homeTeam} vs ${g.awayTeam} at ${g.timeLabel}`,
                      )
                      .join(" · ")}
                  </li>
                ))}
                {conflicts.length > 5 && (
                  <li className="text-xs text-red-500">and {conflicts.length - 5} more…</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule list ── */}
      {loadingGames ? (
        <div className="mt-5 flex justify-center py-4">
          <svg className="h-5 w-5 animate-spin text-gray-300" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : games.length === 0 ? (
        <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-gray-200 bg-white py-8 text-center">
          <CalendarDays className="h-6 w-6 text-gray-300" />
          <p className="mt-2 text-sm font-medium text-[#0C1F3F]">No schedule yet</p>
          <p className="mt-0.5 text-xs text-gray-400">
            Add teams to this division, then generate a schedule.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-100 bg-white">
          <div className="flex items-center justify-between border-b border-gray-50 px-4 py-2.5">
            <p className="text-xs font-semibold text-gray-500">Schedule</p>
            <p className="text-xs text-gray-400">
              {activeGames.length} game{activeGames.length !== 1 ? "s" : ""}
              {cancelledGames.length > 0 && (
                <span className="ml-1.5 text-blue-400">· {cancelledGames.length} rained out</span>
              )}
            </p>
          </div>

          {Array.from(grouped.entries()).map(([, dayGames], groupIdx) => (
            <div key={dayGames[0].scheduled_at.substring(0, 10)} className={groupIdx > 0 ? "border-t border-gray-50" : ""}>
              <div className="bg-gray-50/70 px-4 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {fmtGameDate(dayGames[0].scheduled_at)}
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {dayGames.map((game) => {
                  const isCancelled = game.status === "cancelled";
                  const isRaining = rainoutId === game.id;
                  return (
                    <div
                      key={game.id}
                      className={`group flex items-center justify-between px-4 py-3 ${isCancelled ? "bg-gray-50/80" : ""}`}
                    >
                      {/* Left: time + teams */}
                      <div className="flex min-w-0 items-center gap-3">
                        {isCancelled && (
                          <CloudRain className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                        )}
                        <span className={`w-16 flex-shrink-0 text-xs tabular-nums ${isCancelled ? "text-gray-300 line-through" : "text-gray-400"}`}>
                          {fmtGameTime(game.scheduled_at)}
                        </span>
                        <span className={`truncate text-sm font-semibold ${isCancelled ? "text-gray-400" : "text-[#0C1F3F]"}`}>
                          {game.home_team?.name ?? "TBD"}
                        </span>
                        <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${isCancelled ? "bg-gray-100 text-gray-300" : "bg-gray-100 text-gray-400"}`}>
                          vs
                        </span>
                        <span className={`truncate text-sm font-medium ${isCancelled ? "text-gray-400" : "text-gray-600"}`}>
                          {game.away_team?.name ?? "TBD"}
                        </span>
                      </div>

                      {/* Right: venue + action */}
                      <div className="ml-3 flex flex-shrink-0 items-center gap-2">
                        {game.venue?.name && (
                          <span className={`text-xs ${isCancelled ? "text-gray-300" : "text-gray-400"}`}>
                            {game.venue.name}
                          </span>
                        )}

                        {isCancelled ? (
                          /* Rained out: show badge + reschedule button */
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
                              Rained out
                            </span>
                            <button
                              onClick={() => setRescheduleGame(game)}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                            >
                              <CalendarClock className="h-3 w-3" />
                              Reschedule
                            </button>
                          </div>
                        ) : (
                          /* Scheduled: show rain-out button on hover */
                          <button
                            onClick={() => handleRainOut(game)}
                            disabled={isRaining}
                            title="Mark as rained out"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-200 opacity-0 transition-all group-hover:opacity-100 hover:bg-blue-50 hover:text-blue-400 disabled:opacity-50"
                          >
                            {isRaining
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <CloudRain className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Print region ── */}
      {games.length > 0 && (
        <div className="fieldslate-print-region hidden">
          <div className="fieldslate-print-header">
            <div className="fieldslate-print-wordmark">Field<span>Slate</span></div>
            <p className="fieldslate-print-league">{leagueName}</p>
            <p className="fieldslate-print-division">{divisionName}</p>
            <p className="fieldslate-print-meta">
              Printed {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              {" "}· {activeGames.length} game{activeGames.length !== 1 ? "s" : ""}
            </p>
          </div>
          {Array.from(grouped.entries()).map(([, dayGames]) => (
            <div key={dayGames[0].scheduled_at.substring(0, 10)}>
              <div className="fieldslate-print-date-group">{fmtGameDate(dayGames[0].scheduled_at)}</div>
              <table className="fieldslate-print-table">
                <thead>
                  <tr><th>Date</th><th>Time</th><th>Home Team</th><th>Away Team</th><th>Field / Venue</th></tr>
                </thead>
                <tbody>
                  {dayGames.filter((g) => g.status !== "cancelled").map((game) => (
                    <tr key={game.id}>
                      <td>{fmtGameDate(game.scheduled_at)}</td>
                      <td>{fmtGameTime(game.scheduled_at)}</td>
                      <td>{game.home_team?.name ?? "TBD"}</td>
                      <td>{game.away_team?.name ?? "TBD"}</td>
                      <td>{game.venue?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── Reschedule modal ── */}
      {rescheduleGame && (
        <RainoutRescheduleModal
          gameId={rescheduleGame.id}
          homeTeamId={rescheduleGame.home_team_id}
          awayTeamId={rescheduleGame.away_team_id}
          homeTeamName={rescheduleGame.home_team?.name ?? "Home"}
          awayTeamName={rescheduleGame.away_team?.name ?? "Away"}
          divisionId={divisionId}
          leagueId={leagueId}
          onClose={() => setRescheduleGame(null)}
          onRescheduled={() => {
            setRescheduleGame(null);
            fetchGames();
            onScheduleChange?.();
          }}
        />
      )}
    </div>
  );
}

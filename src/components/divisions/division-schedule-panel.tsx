"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Zap, Loader2, CheckCircle2, AlertTriangle, CalendarDays,
  RefreshCw, PlusCircle, Printer, CloudRain, CalendarClock,
  Pencil, Trash2, Check, Users, Dumbbell, ListChecks,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  generateSchedule,
  finishSchedule,
  detectScheduleConflicts,
} from "@/lib/schedule/generate-schedule";
import type { ScheduleConflict } from "@/lib/schedule/generate-schedule";
import { generatePractices } from "@/lib/schedule/generate-practices";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { RainoutRescheduleModal } from "./rainout-reschedule-modal";
import { SchedulePracticeModal } from "./schedule-practice-modal";
import { logActivity } from "@/lib/activity-log";
import { AutoAssignUmpiresButton } from "@/components/umpires/auto-assign-button";
import {
  UmpireSlots,
  type SlotAssignment,
  type UmpireOption,
} from "@/components/umpires/umpire-slots";


type UnscheduledPractice = {
  key: string;
  practiceId: string;
  teamId: string;
  teamName: string;
  weekMonday: string; // YYYY-MM-DD (the week's Monday, stored as scheduled_date)
  weekLabel: string;  // "Jun 2"
};

type PrintMode = "games" | "practices" | "combined";

interface Props {
  divisionId: string;
  divisionName: string;
  leagueName: string;
  leagueId: string;
  triggerPrint?: boolean;
  printMode?: PrintMode;
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

type PracticeRow = {
  id: string;
  scheduled_date: string; // YYYY-MM-DD
  start_time: string;     // HH:MM
  status: string;
  team_id: string;
  venue_id: string | null;
  team: { name: string } | null;
  venue: { name: string } | null;
};

type ScheduleEvent =
  | { kind: "game"; sortKey: string; data: GameRow }
  | { kind: "practice"; sortKey: string; data: PracticeRow };

export function DivisionSchedulePanel({
  divisionId, divisionName, leagueName, leagueId,
  triggerPrint, printMode = "games", onPrintDone, onScheduleChange,
}: Props) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [gamesPerTeam, setGamesPerTeam] = useState(0);
  const [games, setGames] = useState<GameRow[]>([]);
  const [practices, setPractices] = useState<PracticeRow[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [generatingPractices, setGeneratingPractices] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [practiceShortfall, setPracticeShortfall] = useState<{ count: number; target: number } | null>(null);
  const [activitiesPerWeek, setActivitiesPerWeek] = useState(0);
  const [schedulingPractice, setSchedulingPractice] = useState<UnscheduledPractice | null>(null);
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

  // Bulk rainout select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());
  const [confirmingBulkRainout, setConfirmingBulkRainout] = useState(false);
  const [bulkRainoutLoading, setBulkRainoutLoading] = useState(false);

  // Umpire state
  const [umpiresPerGame, setUmpiresPerGame] = useState(0);
  const [umpireRoles, setUmpireRoles] = useState<string[]>([]);
  const [umpireRoster, setUmpireRoster] = useState<UmpireOption[]>([]);
  const [assignmentsByGame, setAssignmentsByGame] = useState<
    Map<string, SlotAssignment[]>
  >(new Map());
  const [gameDurationMinutes, setGameDurationMinutes] = useState(90);

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
      setPractices([]);
      setConflicts([]);
      setLoadingGames(false);
      return;
    }

    const { data: divDataRaw } = await supabase
      .from("divisions")
      .select("settings, activities_per_week, umpires_per_game, umpire_roles, intra_division_games_per_team")
      .eq("id", divisionId)
      .single();

    const divData = divDataRaw as unknown as {
      settings: Record<string, unknown>;
      activities_per_week: number | null;
      umpires_per_game: number | null;
      umpire_roles: unknown;
      intra_division_games_per_team: number | null;
    } | null;
    const settings = (divData?.settings ?? {}) as {
      game_duration?: number;
      buffer_minutes?: number;
      games_per_team?: number;
    };

    setGamesPerTeam(Number(divData?.intra_division_games_per_team ?? settings.games_per_team ?? 0));
    setActivitiesPerWeek(Number(divData?.activities_per_week ?? 0));
    setGameDurationMinutes(Number(settings.game_duration ?? 90));

    const upg = Number(divData?.umpires_per_game ?? 0);
    setUmpiresPerGame(upg);
    const persistedRoles = Array.isArray(divData?.umpire_roles)
      ? (divData!.umpire_roles as unknown[]).filter(
          (r): r is string => typeof r === "string",
        )
      : [];
    const roles = [...persistedRoles];
    while (roles.length < upg) roles.push(`Umpire ${roles.length + 1}`);
    setUmpireRoles(roles);

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

    // Umpire roster for this season and assignments for these games
    const [{ data: umpiresRaw }, { data: assignsRaw }] = await Promise.all([
      supabase
        .from("umpires")
        .select("id, name")
        .eq("season_id", leagueId)
        .order("name"),
      rows.length > 0
        ? supabase
            .from("game_umpires")
            .select("id, game_id, role, umpire:umpires(id, name)")
            .in(
              "game_id",
              rows.map((g) => g.id),
            )
        : Promise.resolve({ data: [] as unknown[] }),
    ]);
    setUmpireRoster((umpiresRaw ?? []) as UmpireOption[]);
    type AssignRow = {
      id: string;
      game_id: string;
      role: string;
      umpire: { id: string; name: string } | null;
    };
    const assigns = ((assignsRaw as unknown as AssignRow[] | null) ?? []).filter(
      (r) => r.umpire,
    );
    const map = new Map<string, SlotAssignment[]>();
    for (const a of assigns) {
      const slot: SlotAssignment = {
        id: a.id,
        umpire_id: a.umpire!.id,
        umpire_name: a.umpire!.name,
        role: a.role,
      };
      if (!map.has(a.game_id)) map.set(a.game_id, []);
      map.get(a.game_id)!.push(slot);
    }
    setAssignmentsByGame(map);

    const { data: practiceData } = await supabase
      .from("practices")
      .select("id, scheduled_date, start_time, status, team_id, venue_id, team:teams(name), venue:venues(name)")
      .eq("division_id", divisionId)
      .order("scheduled_date")
      .order("start_time");

    setPractices((practiceData as unknown as PracticeRow[]) ?? []);

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
  }, [divisionId, leagueId]);

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
      console.log("[logActivity] before call: schedule_generated (handleGenerate)");
      const _r1 = await logActivity(leagueId, divisionId, "schedule_generated",
        `${divisionName} schedule generated — ${res.gamesCreated} game${res.gamesCreated === 1 ? "" : "s"} scheduled`);
      console.log("[logActivity] result (handleGenerate):", _r1);
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
        console.log("[logActivity] before call: schedule_generated (handleFinish)");
        const _r2 = await logActivity(leagueId, divisionId, "schedule_generated",
          `${divisionName} schedule generated — ${res.gamesCreated} game${res.gamesCreated === 1 ? "" : "s"} added`);
        console.log("[logActivity] result (handleFinish):", _r2);
      }
      fetchGames();
      onScheduleChange?.();
    } else {
      setResult({ type: "error", message: res.error });
    }
    setFinishing(false);
  }

  async function handleGeneratePractices() {
    setGeneratingPractices(true);
    setResult(null);
    setPracticeShortfall(null);
    const res = await generatePractices(divisionId);
    if (res.success) {
      setResult({
        type: "success",
        message: res.practicesCreated === 0
          ? "No practices to schedule"
          : `${res.practicesCreated} practice${res.practicesCreated === 1 ? "" : "s"} scheduled`,
      });
      if (res.shortfallCount > 0) {
        setPracticeShortfall({ count: res.shortfallCount, target: activitiesPerWeek });
      }
      await logActivity(leagueId, divisionId, "practices_generated",
        `${divisionName} practices generated — ${res.practicesCreated} practice${res.practicesCreated === 1 ? "" : "s"} scheduled`);
      fetchGames();
      onScheduleChange?.();
    } else {
      setResult({ type: "error", message: res.error });
    }
    setGeneratingPractices(false);
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
    console.log("[logActivity] before call: rainout_logged (handleRainOut)", { leagueId, divisionId });
    const _r3 = await logActivity(
      leagueId,
      divisionId,
      "rainout_logged",
      `${game.home_team?.name ?? "Home"} vs ${game.away_team?.name ?? "Away"} on ${fmtGameDate(game.scheduled_at)} marked as rained out`,
    );
    console.log("[logActivity] result (handleRainOut):", _r3);
    await fetchGames();
    router.refresh();
    onScheduleChange?.();
    setRainoutId(null);
  }

  // ── Bulk rainout helpers ──────────────────────────────────────────────────────

  function enterSelectMode() {
    setSelectMode(true);
    setSelectedGameIds(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedGameIds(new Set());
    setConfirmingBulkRainout(false);
  }

  function toggleGameSelect(gameId: string) {
    setSelectedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  }

  async function handleBulkRainOut() {
    if (selectedGameIds.size === 0) return;
    setBulkRainoutLoading(true);

    const supabase = createClient();
    const ids = Array.from(selectedGameIds);

    await supabase.from("games").update({ status: "cancelled" } as never).in("id", ids);

    const selectedGames = games.filter((g) => selectedGameIds.has(g.id));
    await Promise.all(
      selectedGames.map((g) =>
        logActivity(
          leagueId,
          divisionId,
          "rainout_logged",
          `${g.home_team?.name ?? "Home"} vs ${g.away_team?.name ?? "Away"} on ${fmtGameDate(g.scheduled_at)} marked as rained out`,
        ),
      ),
    );

    await fetchGames();
    router.refresh();
    onScheduleChange?.();
    exitSelectMode();
    setBulkRainoutLoading(false);
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

  // ── Unscheduled practice slots (status = "unscheduled" rows from generator) ───
  // The generator inserts placeholder rows for slots it couldn't fill; they are
  // deleted on every re-run and updated to "scheduled" when manually placed.

  const unscheduledPractices: UnscheduledPractice[] = practices
    .filter((p) => p.status === "unscheduled")
    .map((p) => ({
      key: p.id,
      practiceId: p.id,
      teamId: p.team_id,
      teamName: p.team?.name ?? "Unknown",
      weekMonday: p.scheduled_date,
      weekLabel: new Date(p.scheduled_date + "T00:00:00").toLocaleDateString("en-US", {
        month: "short", day: "numeric",
      }),
    }));

  // ── Merge games and practices into a unified sorted timeline ─────────────────

  const allEvents: ScheduleEvent[] = [
    ...games.map((g): ScheduleEvent => ({
      kind: "game",
      sortKey: g.scheduled_at.substring(0, 16),
      data: g,
    })),
    ...practices.filter((p) => p.status !== "unscheduled").map((p): ScheduleEvent => ({
      kind: "practice",
      sortKey: `${p.scheduled_date}T${p.start_time}`,
      data: p,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const grouped = new Map<string, ScheduleEvent[]>();
  for (const ev of allEvents) {
    const key = ev.kind === "game"
      ? ev.data.scheduled_at.substring(0, 10)
      : ev.data.scheduled_date;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ev);
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

        <button
          onClick={handleGeneratePractices}
          disabled={generatingPractices || generating || finishing}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generatingPractices
            ? <><Loader2 className="h-4 w-4 animate-spin" />Scheduling practices…</>
            : <><Dumbbell className="h-4 w-4" />Generate Practices</>}
        </button>

        {result && (
          <span className={`flex items-center gap-1.5 text-sm font-medium ${result.type === "success" ? "text-[#22C55E]" : "text-red-500"}`}>
            {result.type === "success"
              ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
            {result.message}
          </span>
        )}

        {activeGames.length > 0 && (
          <button
            onClick={enterSelectMode}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-blue-300 hover:text-blue-500 print:hidden"
          >
            <ListChecks className="h-4 w-4" />
            Select games
          </button>
        )}

        {umpiresPerGame > 0 && activeGames.length > 0 && (
          <AutoAssignUmpiresButton
            divisionId={divisionId}
            seasonId={leagueId}
            enabled
          />
        )}

        {allEvents.length > 0 && (
          <button
            onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] print:hidden"
          >
            <Printer className="h-4 w-4" />
            Print Schedule
          </button>
        )}
      </div>

      {/* ── Practice shortage warning ── */}
      {practiceShortfall && practiceShortfall.count > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Warning: Not enough venue availability to meet {practiceShortfall.target} practice{practiceShortfall.target !== 1 ? "s" : ""} per week for all teams.
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                {practiceShortfall.count} practice{practiceShortfall.count !== 1 ? "s" : ""} could not be scheduled. Add more venue availability or adjust practice slots.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Unscheduled practice slots ── */}
      {unscheduledPractices.length > 0 && (
        <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <Dumbbell className="h-4 w-4 flex-shrink-0 text-indigo-400" />
            <p className="text-sm font-semibold text-indigo-800">
              {unscheduledPractices.length} unscheduled practice slot{unscheduledPractices.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            {unscheduledPractices.slice(0, 10).map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
                <div>
                  <span className="text-xs font-semibold text-indigo-900">{item.teamName}</span>
                  <span className="ml-1.5 text-xs text-indigo-600">week of {item.weekLabel}</span>
                </div>
                <button
                  onClick={() => setSchedulingPractice(item)}
                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  Schedule
                </button>
              </div>
            ))}
            {unscheduledPractices.length > 10 && (
              <p className="mt-0.5 text-xs text-indigo-500">
                and {unscheduledPractices.length - 10} more…
              </p>
            )}
          </div>
        </div>
      )}

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
      ) : allEvents.length === 0 ? (
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
            {selectMode ? (
              /* ── Select mode header ── */
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">
                    {selectedGameIds.size} selected
                  </span>
                  {selectedGameIds.size < activeGames.length ? (
                    <button
                      onClick={() => setSelectedGameIds(new Set(activeGames.map((g) => g.id)))}
                      className="text-xs text-blue-500 hover:underline"
                    >
                      Select all
                    </button>
                  ) : (
                    <button
                      onClick={() => setSelectedGameIds(new Set())}
                      className="text-xs text-gray-400 hover:underline"
                    >
                      Deselect all
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedGameIds.size > 0 && (
                    <button
                      onClick={() => setConfirmingBulkRainout(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-600"
                    >
                      <CloudRain className="h-3 w-3" />
                      Mark as rained out ({selectedGameIds.size})
                    </button>
                  )}
                  <button
                    onClick={exitSelectMode}
                    className="text-xs text-gray-400 transition-colors hover:text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              /* ── Normal header ── */
              <>
                <p className="text-xs font-semibold text-gray-500">Schedule</p>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-gray-400">
                    {activeGames.length} game{activeGames.length !== 1 ? "s" : ""}
                    {practices.filter((p) => p.status !== "cancelled").length > 0 && (
                      <span className="ml-1.5 text-indigo-400">
                        · {practices.filter((p) => p.status !== "cancelled").length} practice{practices.filter((p) => p.status !== "cancelled").length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {cancelledGames.length > 0 && (
                      <span className="ml-1.5 text-blue-400">· {cancelledGames.length} rained out</span>
                    )}
                  </p>
                </div>
              </>
            )}
          </div>

          {Array.from(grouped.entries()).map(([dateKey, dayEvents], groupIdx) => (
            <div key={dateKey} className={groupIdx > 0 ? "border-t border-gray-50" : ""}>
              <div className="bg-gray-50/70 px-4 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {fmtGameDate(dateKey)}
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {dayEvents.map((ev) => {
                  if (ev.kind === "practice") {
                    const practice = ev.data;
                    return (
                      <div
                        key={practice.id}
                        className="flex items-center justify-between bg-indigo-50/40 px-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Dumbbell className="h-3.5 w-3.5 flex-shrink-0 text-indigo-400" />
                          <span className="w-16 flex-shrink-0 text-xs tabular-nums text-indigo-400">
                            {fmtGameTime(`${practice.scheduled_date}T${practice.start_time}:00`)}
                          </span>
                          <span className="truncate text-sm font-semibold text-indigo-700">
                            {practice.team?.name ?? "TBD"}
                          </span>
                          <span className="flex-shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-500">
                            Practice
                          </span>
                        </div>
                        <div className="ml-3 flex flex-shrink-0 items-center gap-2">
                          {practice.venue?.name && (
                            <span className="text-xs text-indigo-400">{practice.venue.name}</span>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const game = ev.data as GameRow;
                  const isCancelled = game.status === "cancelled";
                  const isRaining = rainoutId === game.id;
                  const isSelected = selectedGameIds.has(game.id);
                  const isSelectable = selectMode && !isCancelled;
                  const gameAssignments = assignmentsByGame.get(game.id) ?? [];
                  const showSlots =
                    !isCancelled && !selectMode && umpiresPerGame > 0;
                  return (
                    <div
                      key={game.id}
                      onClick={() => { if (isSelectable) toggleGameSelect(game.id); }}
                      className={`group flex flex-col gap-2 px-4 py-3 transition-colors ${
                        isCancelled
                          ? "bg-gray-50/80"
                          : isSelectable
                          ? isSelected
                            ? "cursor-pointer bg-blue-50/60"
                            : "cursor-pointer hover:bg-gray-50/60"
                          : ""
                      }`}
                    >
                    <div className="flex items-center justify-between">
                      {/* Left: checkbox (select mode) or rain icon (cancelled) + time + teams */}
                      <div className="flex min-w-0 items-center gap-3">
                        {selectMode && !isCancelled ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleGameSelect(game.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer rounded border-gray-300 accent-blue-500"
                          />
                        ) : isCancelled ? (
                          <CloudRain className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                        ) : null}
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
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
                              Rained out
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setRescheduleGame(game); }}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                            >
                              <CalendarClock className="h-3 w-3" />
                              Reschedule
                            </button>
                          </div>
                        ) : !selectMode ? (
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
                        ) : null}
                      </div>
                    </div>
                    {showSlots && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="ml-[80px] mr-2 mt-1"
                      >
                        {umpireRoster.length === 0 ? (
                          <p className="text-[11px] text-gray-400">
                            Add umpires on the Umpires tab to assign them here.
                          </p>
                        ) : (
                          <UmpireSlots
                            game={{
                              id: game.id,
                              scheduled_at: game.scheduled_at,
                              duration_minutes: gameDurationMinutes,
                              home_team_name: game.home_team?.name ?? "TBD",
                              away_team_name: game.away_team?.name ?? "TBD",
                            }}
                            roles={umpireRoles}
                            assignments={gameAssignments}
                            umpires={umpireRoster}
                            compact
                          />
                        )}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Print regions — only the active mode is rendered ── */}

      {/* Games */}
      {printMode === "games" && games.length > 0 && (
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
          {Array.from(
            games
              .filter((g) => g.status !== "cancelled")
              .reduce((map, g) => {
                const k = g.scheduled_at.substring(0, 10);
                if (!map.has(k)) map.set(k, []);
                map.get(k)!.push(g);
                return map;
              }, new Map<string, GameRow[]>())
              .entries()
          ).map(([, dayGames]) => (
            <div key={dayGames[0].scheduled_at.substring(0, 10)}>
              <div className="fieldslate-print-date-group">{fmtGameDate(dayGames[0].scheduled_at)}</div>
              <table className="fieldslate-print-table">
                <thead>
                  <tr><th>Date</th><th>Time</th><th>Home Team</th><th>Away Team</th><th>Field / Venue</th></tr>
                </thead>
                <tbody>
                  {dayGames.map((game) => (
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

      {/* Practices */}
      {printMode === "practices" && practices.filter((p) => p.status === "scheduled").length > 0 && (() => {
        const scheduledPractices = practices.filter((p) => p.status === "scheduled");
        const grouped = scheduledPractices.reduce((map, p) => {
          if (!map.has(p.scheduled_date)) map.set(p.scheduled_date, []);
          map.get(p.scheduled_date)!.push(p);
          return map;
        }, new Map<string, PracticeRow[]>());
        return (
          <div className="fieldslate-print-region hidden">
            <div className="fieldslate-print-header">
              <div className="fieldslate-print-wordmark">Field<span>Slate</span></div>
              <p className="fieldslate-print-league">{leagueName}</p>
              <p className="fieldslate-print-division">{divisionName} — Practice Schedule</p>
              <p className="fieldslate-print-meta">
                Printed {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                {" "}· {scheduledPractices.length} practice{scheduledPractices.length !== 1 ? "s" : ""}
              </p>
            </div>
            {Array.from(grouped.entries()).map(([date, dayPractices]) => (
              <div key={date}>
                <div className="fieldslate-print-date-group">{fmtGameDate(date)}</div>
                <table className="fieldslate-print-table">
                  <thead>
                    <tr><th>Date</th><th>Time</th><th>Team</th><th>Field / Venue</th></tr>
                  </thead>
                  <tbody>
                    {dayPractices.map((p) => (
                      <tr key={p.id}>
                        <td>{fmtGameDate(p.scheduled_date)}</td>
                        <td>{fmtGameTime(`${p.scheduled_date}T${p.start_time}:00`)}</td>
                        <td>{p.team?.name ?? "TBD"}</td>
                        <td>{p.venue?.name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Combined */}
      {printMode === "combined" && (games.length > 0 || practices.filter((p) => p.status === "scheduled").length > 0) && (() => {
        const scheduledPractices = practices.filter((p) => p.status === "scheduled");
        const gamesByDate = games
          .filter((g) => g.status !== "cancelled")
          .reduce((map, g) => {
            const k = g.scheduled_at.substring(0, 10);
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(g);
            return map;
          }, new Map<string, GameRow[]>());
        const practicesByDate = scheduledPractices.reduce((map, p) => {
          if (!map.has(p.scheduled_date)) map.set(p.scheduled_date, []);
          map.get(p.scheduled_date)!.push(p);
          return map;
        }, new Map<string, PracticeRow[]>());
        return (
          <div className="fieldslate-print-region hidden">
            <div className="fieldslate-print-header">
              <div className="fieldslate-print-wordmark">Field<span>Slate</span></div>
              <p className="fieldslate-print-league">{leagueName}</p>
              <p className="fieldslate-print-division">{divisionName} — Full Schedule</p>
              <p className="fieldslate-print-meta">
                Printed {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                {" "}· {activeGames.length} game{activeGames.length !== 1 ? "s" : ""}
                {scheduledPractices.length > 0 ? ` · ${scheduledPractices.length} practice${scheduledPractices.length !== 1 ? "s" : ""}` : ""}
              </p>
            </div>
            {/* Games section */}
            {gamesByDate.size > 0 && (
              <>
                <div className="fieldslate-print-date-group" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>Games</div>
                {Array.from(gamesByDate.entries()).map(([, dayGames]) => (
                  <div key={dayGames[0].scheduled_at.substring(0, 10)}>
                    <div className="fieldslate-print-date-group">{fmtGameDate(dayGames[0].scheduled_at)}</div>
                    <table className="fieldslate-print-table">
                      <thead>
                        <tr><th>Date</th><th>Time</th><th>Home Team</th><th>Away Team</th><th>Field / Venue</th></tr>
                      </thead>
                      <tbody>
                        {dayGames.map((game) => (
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
              </>
            )}
            {/* Practices section */}
            {practicesByDate.size > 0 && (
              <>
                <div className="fieldslate-print-date-group">Practices</div>
                {Array.from(practicesByDate.entries()).map(([date, dayPractices]) => (
                  <div key={date}>
                    <div className="fieldslate-print-date-group">{fmtGameDate(date)}</div>
                    <table className="fieldslate-print-table">
                      <thead>
                        <tr><th>Date</th><th>Time</th><th>Team</th><th>Field / Venue</th></tr>
                      </thead>
                      <tbody>
                        {dayPractices.map((p) => (
                          <tr key={p.id}>
                            <td>{fmtGameDate(p.scheduled_date)}</td>
                            <td>{fmtGameTime(`${p.scheduled_date}T${p.start_time}:00`)}</td>
                            <td>{p.team?.name ?? "TBD"}</td>
                            <td>{p.venue?.name ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })()}

      {/* ── Bulk rainout confirmation modal ── */}
      {confirmingBulkRainout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <CloudRain className="h-4 w-4 text-blue-500" />
              <h3 className="text-base font-bold text-[#0C1F3F]">
                Mark {selectedGameIds.size} game{selectedGameIds.size !== 1 ? "s" : ""} as rained out?
              </h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              These games will be cancelled and added to the rescheduling queue.
            </p>
            <ul className="mt-3 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              {games
                .filter((g) => selectedGameIds.has(g.id))
                .map((g) => (
                  <li key={g.id} className="text-xs text-gray-600">
                    <span className="font-medium">{fmtGameDate(g.scheduled_at)}</span>
                    {" · "}
                    {g.home_team?.name ?? "Home"} vs {g.away_team?.name ?? "Away"}
                    {g.venue?.name && <span className="text-gray-400"> @ {g.venue.name}</span>}
                  </li>
                ))}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmingBulkRainout(false)}
                disabled={bulkRainoutLoading}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkRainOut}
                disabled={bulkRainoutLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                {bulkRainoutLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Cancelling…</>
                  : <><CloudRain className="h-3.5 w-3.5" />Confirm rainout</>}
              </button>
            </div>
          </div>
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

      {schedulingPractice && (
        <SchedulePracticeModal
          practiceId={schedulingPractice.practiceId}
          teamId={schedulingPractice.teamId}
          teamName={schedulingPractice.teamName}
          weekMonday={schedulingPractice.weekMonday}
          weekLabel={schedulingPractice.weekLabel}
          divisionId={divisionId}
          leagueId={leagueId}
          onClose={() => setSchedulingPractice(null)}
          onScheduled={() => {
            setSchedulingPractice(null);
            fetchGames();
            onScheduleChange?.();
          }}
        />
      )}
    </div>
  );
}

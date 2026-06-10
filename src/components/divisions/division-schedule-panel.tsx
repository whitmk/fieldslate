"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Zap, Loader2, CheckCircle2, AlertTriangle, CalendarDays,
  RefreshCw, Plus, PlusCircle, Printer, CloudRain, CalendarClock,
  Pencil, Trash2, Check, Users, ListChecks,
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
import { AddGameModal } from "@/components/schedule/add-game-modal";
import { logActivity } from "@/lib/activity-log";
import { AutoAssignUmpiresButton } from "@/components/umpires/auto-assign-button";
import {
  UmpireSlots,
  type SlotAssignment,
  type UmpireOption,
} from "@/components/umpires/umpire-slots";
import {
  getOfficialTitlePluralLower,
  padRoleLabels,
} from "@/lib/utils/official-title";


type PrintMode = "games";

interface Props {
  divisionId: string;
  divisionName: string;
  leagueName: string;
  leagueId: string;
  leagueSport?: string | null;
  triggerPrint?: boolean;
  printMode?: PrintMode;
  onPrintDone?: () => void;
  onScheduleChange?: () => void;
  /** Pro+ only — the auto-reschedule action on rained-out rows. Marking a
   *  game rained out stays Free. */
  canReschedule?: boolean;
}

type Team = { id: string; name: string };

type GameRow = {
  id: string;
  scheduled_at: string;
  status: string;
  venue_id: string | null;
  home_team_id: string;
  away_team_id: string | null;
  interleague_org_id: string | null;
  is_away: boolean | null;
  external_team_name: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  interleague_org: { name: string } | null;
  venue: { name: string } | null;
};

type ScheduleEvent = { kind: "game"; sortKey: string; data: GameRow };

// Opponent label: real away team for intra, recipient's team name once
// accepted for interleague (else "TBD — Org"). The vs/AT prefix is rendered
// separately so this returns just the opponent identifier.
function opponentName(g: GameRow): string {
  if (g.away_team?.name) return g.away_team.name;
  if (g.interleague_org_id) {
    const orgName = g.interleague_org?.name ?? "Other org";
    const team = g.external_team_name?.trim();
    if (g.is_away) return team ? `${orgName} (${team})` : orgName;
    return team ? team : `TBD — ${orgName}`;
  }
  return "TBD";
}

function vsLabel(g: GameRow): string {
  return g.is_away ? "AT" : "vs";
}

export function DivisionSchedulePanel({
  divisionId, divisionName, leagueName, leagueId, leagueSport,
  triggerPrint, printMode = "games", onPrintDone, onScheduleChange,
  canReschedule = false,
}: Props) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [gamesPerTeam, setGamesPerTeam] = useState(0);
  const [games, setGames] = useState<GameRow[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [rainoutId, setRainoutId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<GameRow | null>(null);
  const [addGameOpen, setAddGameOpen] = useState(false);

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

  const officialsPluralLower = getOfficialTitlePluralLower(leagueSport);

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

    const [{ data: divDataRaw }, { data: seasonRolesRaw }] = await Promise.all([
      supabase
        .from("divisions")
        .select("settings, umpires_per_game, intra_division_games_per_team")
        .eq("id", divisionId)
        .single(),
      supabase
        .from("official_roles")
        .select("name")
        .eq("season_id", leagueId)
        .order("sort_order"),
    ]);

    const divData = divDataRaw as unknown as {
      settings: Record<string, unknown>;
      umpires_per_game: number | null;
      intra_division_games_per_team: number | null;
    } | null;
    const settings = (divData?.settings ?? {}) as {
      game_duration?: number;
      buffer_minutes?: number;
      games_per_team?: number;
    };

    // gamesPerTeam = intra target + sum of interleague game counts across orgs.
    // Each team plays both, so the per-team total drives the completeness display.
    const intraTarget = Number(divData?.intra_division_games_per_team ?? settings.games_per_team ?? 0);
    const { data: igRowsRaw } = await supabase
      .from("division_interleague_games")
      .select("game_count")
      .eq("division_id", divisionId);
    const interleagueTarget = ((igRowsRaw ?? []) as { game_count: number }[])
      .reduce((sum, r) => sum + Number(r.game_count ?? 0), 0);
    setGamesPerTeam(intraTarget + interleagueTarget);
    setGameDurationMinutes(Number(settings.game_duration ?? 90));

    const upg = Number(divData?.umpires_per_game ?? 0);
    setUmpiresPerGame(upg);
    // Slot labels: first umpires_per_game season roles by sort_order, padded
    // sport-aware — same derivation as game-detail-modal and auto-assign.
    // UmpireSlots appends any legacy assignment labels outside this list.
    const seasonRoleNames = ((seasonRolesRaw ?? []) as { name: string }[]).map(
      (r) => r.name,
    );
    setUmpireRoles(padRoleLabels(seasonRoleNames.slice(0, upg), upg, leagueSport));

    const { data } = await supabase
      .from("games")
      .select(
        `id, scheduled_at, status, venue_id, home_team_id, away_team_id, interleague_org_id, is_away, external_team_name, proposed_venue_name,
         home_team:teams!home_team_id(name),
         away_team:teams!away_team_id(name),
         interleague_org:interleague_orgs!interleague_org_id(name),
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
        .select("id, name, team_id")
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

    // Only count scheduled/active games for conflict detection
    const activeRows = rows.filter((g) => g.status !== "cancelled");
    const flat = activeRows.map((g) => ({
      id: g.id,
      scheduled_at: g.scheduled_at,
      venue_id: g.venue_id,
      venue_name: g.venue?.name ?? "Unknown venue",
      home_team_name: g.home_team?.name ?? "TBD",
      away_team_name: opponentName(g),
    }));
    setConflicts(
      detectScheduleConflicts(flat, settings.game_duration ?? 0, settings.buffer_minutes ?? 0),
    );

    setLoadingGames(false);
  }, [divisionId, leagueId, leagueSport]);

  useEffect(() => { fetchGames(); }, [fetchGames]);

  useEffect(() => {
    if (triggerPrint && !loadingGames) {
      window.print();
      onPrintDone?.();
    }
  }, [triggerPrint, loadingGames, onPrintDone]);

  function requestGenerate() {
    if (games.length > 0) {
      setConfirmRegenOpen(true);
    } else {
      void handleGenerate();
    }
  }

  async function handleGenerate() {
    setConfirmRegenOpen(false);
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
      `${game.home_team?.name ?? "Home"} vs ${opponentName(game)} on ${fmtGameDate(game.scheduled_at)} marked as rained out`,
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
          `${g.home_team?.name ?? "Home"} vs ${opponentName(g)} on ${fmtGameDate(g.scheduled_at)} marked as rained out`,
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

  // ── Sorted timeline of games ─────────────────────────────────────────────────

  const allEvents: ScheduleEvent[] = games
    .map((g): ScheduleEvent => ({
      kind: "game",
      sortKey: g.scheduled_at.substring(0, 16),
      data: g,
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const grouped = new Map<string, ScheduleEvent[]>();
  for (const ev of allEvents) {
    const key = ev.data.scheduled_at.substring(0, 10);
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
              onClick={requestGenerate}
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
            onClick={requestGenerate}
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
            sport={leagueSport}
            enabled
            onAssigned={() => void fetchGames()}
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
                  const game = ev.data;
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
                          {vsLabel(game)}
                        </span>
                        <span className={`truncate text-sm font-medium ${isCancelled ? "text-gray-400" : "text-gray-600"}`}>
                          {opponentName(game)}
                        </span>
                        {game.interleague_org_id && (
                          <span className="flex-shrink-0 rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-600">
                            Interleague
                          </span>
                        )}
                        {game.status === "pending_interleague" && (
                          <span className="flex-shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                            Pending
                          </span>
                        )}
                      </div>

                      {/* Right: venue + action */}
                      <div className="ml-3 flex flex-shrink-0 items-center gap-2">
                        {game.venue?.name ? (
                          <span className={`text-xs ${isCancelled ? "text-gray-300" : "text-gray-400"}`}>
                            {game.venue.name}
                          </span>
                        ) : game.is_away && game.proposed_venue_name ? (
                          <span className={`text-xs ${isCancelled ? "text-gray-300" : "text-gray-400"}`}>
                            {game.proposed_venue_name}
                          </span>
                        ) : game.is_away && game.interleague_org?.name ? (
                          <span className="text-xs italic text-gray-400">
                            TBD — {game.interleague_org.name} venue
                          </span>
                        ) : null}

                        {isCancelled ? (
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
                              Rained out
                            </span>
                            {canReschedule && !game.interleague_org_id && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setRescheduleGame(game); }}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                              >
                                <CalendarClock className="h-3 w-3" />
                                Reschedule
                              </button>
                            )}
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
                            Add {officialsPluralLower} on the Officials tab to assign them here.
                          </p>
                        ) : (
                          <UmpireSlots
                            game={{
                              id: game.id,
                              scheduled_at: game.scheduled_at,
                              duration_minutes: gameDurationMinutes,
                              home_team_name: game.home_team?.name ?? "TBD",
                              away_team_name: opponentName(game),
                              home_team_id: game.home_team_id,
                              away_team_id: game.away_team_id,
                            }}
                            seasonId={leagueId}
                            roles={umpireRoles}
                            assignments={gameAssignments}
                            umpires={umpireRoster}
                            compact
                            onChanged={() => void fetchGames()}
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

      {/* ── Add game quick action ── */}
      <div className="mt-3 print:hidden">
        <button
          onClick={() => setAddGameOpen(true)}
          disabled={teams.length < 2}
          title={
            teams.length < 2
              ? "Add at least two teams before scheduling a game"
              : "Manually add a single game to this division"
          }
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-[#22C55E] hover:text-[#22C55E] disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0"
        >
          <Plus className="h-4 w-4" />
          Add game
        </button>
      </div>

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
                      <td>{opponentName(game)}</td>
                      <td>{game.venue?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

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
                    {g.home_team?.name ?? "Home"} vs {opponentName(g)}
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

      {/* ── Regenerate confirmation ── */}
      {confirmRegenOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setConfirmRegenOpen(false)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
            <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <h3 className="font-semibold text-[#0C1F3F]">Regenerate schedule?</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Regenerating will wipe pending interleague games but preserve accepted ones. Continue?
                </p>
              </div>
            </div>
            <div className="flex gap-2 px-6 py-5">
              <button
                onClick={() => setConfirmRegenOpen(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleGenerate(); }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0C1F3F] py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add game modal — division locked to this panel's division ── */}
      {addGameOpen && (
        <AddGameModal
          seasons={[{ id: leagueId, name: leagueName }]}
          divisions={[{ id: divisionId, name: divisionName, league_id: leagueId }]}
          teams={teams.map((t) => ({ ...t, division_id: divisionId }))}
          lockedDivisionId={divisionId}
          onClose={() => setAddGameOpen(false)}
          onAdded={(summary) => {
            setAddGameOpen(false);
            setResult({ type: "success", message: summary });
            fetchGames();
            onScheduleChange?.();
          }}
        />
      )}

      {/* ── Reschedule modal ── */}
      {rescheduleGame && (
        <RainoutRescheduleModal
          gameId={rescheduleGame.id}
          homeTeamId={rescheduleGame.home_team_id}
          awayTeamId={rescheduleGame.away_team_id!}
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

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Zap, Loader2, CheckCircle2, AlertTriangle, CalendarDays,
  RefreshCw, Plus, PlusCircle, Printer, CloudRain, CalendarClock,
  Pencil, Trash2, Check, Users, ListChecks, Lock, LockOpen, Send,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { renameTeamInline, reconcileJsonbAfterTeamDelete } from "@/lib/divisions/reconcile-teams";
import {
  generateSchedule,
  finishSchedule,
  detectScheduleConflicts,
} from "@/lib/schedule/generate-schedule";
import type { ScheduleConflict } from "@/lib/schedule/generate-schedule";
import {
  detectSeasonCoachConflicts,
  coachConflictTouchesDivision,
  type CoachConflict,
} from "@/lib/schedule/detect-coach-conflicts";
import { CoachConflictNotice } from "@/components/schedule/coach-conflict-notice";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { RainoutRescheduleModal } from "./rainout-reschedule-modal";
import { AddGameModal } from "@/components/schedule/add-game-modal";
import { logActivity } from "@/lib/activity-log";
import {
  setDivisionLock,
  setDivisionPosted,
  lockedReason,
} from "@/lib/schedule/division-lock";
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
import { byeTeamsByWeek, weekKeyFromIsoDate } from "@/lib/venues/game-days";


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

// ── Team-delete preview (delete_team_if_unblocked, migration 0084) ────────────
type DeleteDestroyed = {
  games: number;
  umpire_assignments: number;
  reschedule_requests: number;
  override_history: number;
  practice_slots: number;
  availability_blocks: number;
  team_constraints: number;
  official_conflicts: number;
};
type DeleteSideEffects = {
  playoff_slots_cleared: number;
  official_coach_links_cleared: number;
  snack_shack_assignments_cleared: number;
};
type DeletePreview =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "blocked"; reasons: string[] }
  | { status: "ready"; destroyed: DeleteDestroyed; sideEffects: DeleteSideEffects };

/** Human sentence for each server block reason. Lock wording is shared with the
 *  rest of the panel via lockedReason so it can't drift. */
function describeDeleteBlock(reason: string, divisionName: string): string {
  switch (reason) {
    case "division_locked":
      return lockedReason(divisionName, "deleteTeam");
    case "interleague_accepted":
      return "This team has accepted interleague games — a partner league is relying on them. Resolve those games first (that flow notifies the partner).";
    case "result_recorded":
      return "This team has a game with a recorded result. Deleting it would erase season history.";
    default:
      return "This team can't be deleted right now.";
  }
}

/** Confirm-dialog lines from the preview's real counts. Coach-entered data
 *  (practice slots, availability blocks) is always named — it is the reason
 *  this delete is dangerous. Zero-count categories are omitted rather than
 *  shown as a bare "0" on a destructive confirm. */
function deletePreviewLines(d: DeleteDestroyed, s: DeleteSideEffects): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines: string[] = [plural(d.games, "scheduled game", "scheduled games")];
  if (d.practice_slots > 0) lines.push(`${plural(d.practice_slots, "practice slot", "practice slots")} (coach-entered)`);
  if (d.availability_blocks > 0) lines.push(`${plural(d.availability_blocks, "availability block", "availability blocks")} (coach-entered)`);
  if (d.team_constraints > 0) lines.push(plural(d.team_constraints, "scheduling constraint", "scheduling constraints"));
  if (d.official_conflicts > 0) lines.push(plural(d.official_conflicts, "official conflict-of-interest link", "official conflict-of-interest links"));
  if (d.umpire_assignments > 0) lines.push(plural(d.umpire_assignments, "umpire assignment", "umpire assignments"));
  const orphaned: string[] = [];
  if (s.official_coach_links_cleared > 0) orphaned.push(`${plural(s.official_coach_links_cleared, "official's coach link", "officials' coach links")}`);
  if (s.playoff_slots_cleared > 0) orphaned.push(plural(s.playoff_slots_cleared, "playoff slot", "playoff slots"));
  if (s.snack_shack_assignments_cleared > 0) orphaned.push(plural(s.snack_shack_assignments_cleared, "snack shack assignment", "snack shack assignments"));
  if (orphaned.length > 0) lines.push(`Cleared (kept, not deleted): ${orphaned.join(", ")}`);
  return lines;
}

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
  const [coachConflicts, setCoachConflicts] = useState<CoachConflict[]>([]);
  const [rainoutId, setRainoutId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<GameRow | null>(null);
  const [addGameOpen, setAddGameOpen] = useState(false);

  // Schedule lock + posted. The trigger (0082) is the guard; these drive the
  // pre-click UI so a locked division never looks clickable.
  const [locked, setLocked] = useState(false);
  const [posted, setPosted] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [postedBusy, setPostedBusy] = useState(false);

  // Team inline-edit state
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingTeamId, setSavingTeamId] = useState<string | null>(null);

  // Team delete state. The preview (delete_team_if_unblocked in p_commit=false
  // mode) fills the confirm dialog with the server's real counts / block
  // reasons; the modal stays open on a blocked result so the reason is readable
  // AT the action, not down in the footer (Defect 2).
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);

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
        .select("settings, umpires_per_game, intra_division_games_per_team, locked, posted")
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
      locked: boolean | null;
      posted: boolean | null;
    } | null;
    setLocked(!!divData?.locked);
    setPosted(!!divData?.posted);
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
        .select(
          `id, name, team_id, team:teams(name, division:divisions(name)),
           conflicts:official_conflicts(team_id, relationship),
           availability:official_availability(day_of_week, start_time, end_time),
           blackouts:official_blackouts(date),
           booking_rows:game_umpires(game:games(id, scheduled_at,
             home_team:teams!home_team_id(name, division:divisions(settings)),
             away_team:teams!away_team_id(name)))`,
        )
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

    // Shared-coach conflicts are season-wide (a coach can span divisions), so
    // this reads the whole league and keeps only conflicts touching THIS
    // division. Read-only, additive — a failure here must not break the games
    // view, so it fails soft to an empty list (unlike the generator's own
    // fail-closed constraint reads).
    try {
      const allCoach = await detectSeasonCoachConflicts(supabase, leagueId);
      setCoachConflicts(
        allCoach.filter((c) => coachConflictTouchesDivision(c, divisionId)),
      );
    } catch (err) {
      console.error("coach-conflict detection failed", err);
      setCoachConflicts([]);
    }

    setLoadingGames(false);
  }, [divisionId, leagueId, leagueSport]);

  useEffect(() => { fetchGames(); }, [fetchGames]);

  useEffect(() => {
    if (triggerPrint && !loadingGames) {
      window.print();
      onPrintDone?.();
    }
  }, [triggerPrint, loadingGames, onPrintDone]);

  async function handleToggleLock() {
    setLockBusy(true);
    setResult(null);
    const { data: { user } } = await createClient().auth.getUser();
    const res = await setDivisionLock(divisionId, !locked, user?.id ?? null);
    if (!res.ok) {
      setResult({ type: "error", message: `Couldn't ${locked ? "unlock" : "lock"} the schedule: ${res.error}` });
    } else {
      setLocked(!locked);
      await logActivity(
        leagueId,
        divisionId,
        "schedule_generated",
        `${divisionName} schedule ${locked ? "unlocked" : "locked"}`,
      );
    }
    setLockBusy(false);
  }

  async function handleTogglePosted() {
    setPostedBusy(true);
    const next = !posted;
    const res = await setDivisionPosted(divisionId, next);
    if (!res.ok) {
      setResult({ type: "error", message: `Couldn't update the posted flag: ${res.error}` });
    } else {
      setPosted(next);
    }
    setPostedBusy(false);
  }

  function requestGenerate() {
    // Client-side guard for the MESSAGE only — the 0082 trigger is the actual
    // refusal, and it still fires if this state is stale.
    if (locked) {
      setResult({ type: "error", message: lockedReason(divisionName, "generate") });
      return;
    }
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
      // The generator names the cause; this surface renders it verbatim.
      const shortfallNote = res.shortfallSummary ? ` — ${res.shortfallSummary}` : "";
      // Informational, not a warning — preferences are best-effort by design.
      const preferNote = res.preferMissCount > 0
        ? ` · ${res.preferMissCount} game${res.preferMissCount === 1 ? "" : "s"} placed outside team preferences`
        : "";
      setResult({ type: "success", message: `${res.gamesCreated} game${res.gamesCreated === 1 ? "" : "s"} scheduled${shortfallNote}${preferNote}` });
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
    if (locked) {
      setResult({ type: "error", message: lockedReason(divisionName, "finish") });
      return;
    }
    setFinishing(true);
    setResult(null);
    const res = await finishSchedule(divisionId);
    if (res.success) {
      // The generator names the cause; this surface renders it verbatim.
      const shortfallNote = res.shortfallSummary ? ` — ${res.shortfallSummary}` : "";
      const preferNote = res.preferMissCount > 0
        ? ` · ${res.preferMissCount} game${res.preferMissCount === 1 ? "" : "s"} placed outside team preferences`
        : "";
      setResult({
        type: "success",
        message: res.gamesCreated === 0
          ? "Schedule is already complete"
          : `${res.gamesCreated} missing game${res.gamesCreated === 1 ? "" : "s"} added${shortfallNote}${preferNote}`,
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
    setSavingTeamId(teamId);
    // Single shared rename path: updates the teams row AND keeps this
    // division's jsonb entry + every division's name-keyed conflict_team
    // references in sync. No bare teams.update() here — see
    // src/lib/divisions/reconcile-teams.ts.
    const res = await renameTeamInline({
      leagueId,
      divisionId,
      teamId,
      newName: trimmed,
      siblingTeams: teams.map((t) => ({ id: t.id, name: t.name })),
    });
    if (!res.ok) {
      setEditError(res.error);
    } else {
      cancelEdit();
      await fetchGames();
      onScheduleChange?.();
    }
    setSavingTeamId(null);
  }

  // ── Guarded team delete (delete_team_if_unblocked, migration 0084) ──────────
  // Replaces the old three bare, non-atomic client deletes (delete home games,
  // delete away games, delete team) that skipped the jsonb and surfaced the
  // locked refusal in the footer. Now: open -> server PREVIEW (real counts /
  // block reasons) -> confirm -> server COMMIT (atomic) -> reconcile jsonb.
  type DeleteRpc = {
    blocked?: boolean;
    deleted?: boolean;
    reasons?: string[];
    destroyed?: DeleteDestroyed;
    side_effects?: DeleteSideEffects;
  };

  function openDeleteModal(team: Team) {
    setDeleteTarget(team);
    void runDeletePreview(team);
  }

  function closeDeleteModal() {
    if (deleteLoading) return;
    setDeleteTarget(null);
    setDeletePreview(null);
  }

  async function runDeletePreview(team: Team) {
    setDeletePreview({ status: "loading" });
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_team_if_unblocked" as never, {
      p_team_id: team.id,
      p_commit: false,
    } as never);
    if (error) {
      setDeletePreview({ status: "error", message: error.message });
      return;
    }
    const res = (data ?? {}) as DeleteRpc;
    if (res.blocked) {
      if (res.reasons?.includes("division_locked")) setLocked(true);
      setDeletePreview({ status: "blocked", reasons: res.reasons ?? [] });
      return;
    }
    setDeletePreview({
      status: "ready",
      destroyed: res.destroyed as DeleteDestroyed,
      sideEffects: res.side_effects as DeleteSideEffects,
    });
  }

  async function confirmDeleteTeam(team: Team) {
    setDeleteLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_team_if_unblocked" as never, {
      p_team_id: team.id,
      p_commit: true,
    } as never);
    if (error) {
      setDeleteLoading(false);
      setDeletePreview({ status: "error", message: error.message });
      return;
    }
    const res = (data ?? {}) as DeleteRpc;
    if (res.blocked) {
      // Raced: a block condition (usually a lock toggled between preview and
      // confirm) appeared. Nothing was deleted — keep the modal open, show why,
      // and let the UI catch up.
      if (res.reasons?.includes("division_locked")) setLocked(true);
      setDeleteLoading(false);
      setDeletePreview({ status: "blocked", reasons: res.reasons ?? [] });
      return;
    }
    // Deleted. Reconcile the name-keyed jsonb copy (the RPC deliberately leaves
    // divisions.settings.teams[] alone) so the two stay in agreement.
    const recon = await reconcileJsonbAfterTeamDelete({
      leagueId,
      divisionId,
      teamName: team.name,
    });
    setDeleteLoading(false);
    setDeleteTarget(null);
    setDeletePreview(null);
    await fetchGames();
    onScheduleChange?.();
    setResult(
      recon.ok
        ? { type: "success", message: `${team.name} deleted.` }
        : {
            type: "error",
            message: `${team.name} was deleted, but its saved team list couldn't be updated (${recon.error}). Re-saving the division from the wizard will fix it.`,
          },
    );
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

  // ── Per-week bye lines ────────────────────────────────────────────────────
  // Computed from the FULL division game set (`games`) + roster (`teams`),
  // never the rendered/filtered array — a team playing elsewhere must never
  // read as on bye. `grouped` is chronological, so each week's day-groups are
  // contiguous; we tag the FIRST day-group of each week and draw the line there.
  const byeByWeek = byeTeamsByWeek(games, teams);
  const firstDateKeyOfWeek = new Map<string, string>();
  for (const dateKey of grouped.keys()) {
    const wk = weekKeyFromIsoDate(dateKey);
    if (!firstDateKeyOfWeek.has(wk)) firstDateKeyOfWeek.set(wk, dateKey);
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
                          onClick={() => openDeleteModal(team)}
                          disabled={locked}
                          title={locked ? lockedReason(divisionName, "deleteTeam") : "Delete team"}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-300"
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

      {/* ── Delete confirmation modal ──
          Counts and block reasons come from the server preview
          (delete_team_if_unblocked, p_commit=false). On a blocked result the
          modal STAYS OPEN with the reason and no delete button — the whole
          point of Defect 2's fix is that the "why" is readable at the action. */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              {deletePreview?.status === "blocked"
                ? <Lock className="h-4 w-4 text-amber-500" />
                : <Trash2 className="h-4 w-4 text-red-500" />}
              <h3 className="text-base font-bold text-[#0C1F3F]">
                {deletePreview?.status === "blocked" ? "Can't delete this team" : "Delete team?"}
              </h3>
            </div>

            {deletePreview?.status === "loading" && (
              <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking what this would remove…
              </p>
            )}

            {deletePreview?.status === "error" && (
              <p className="mt-2 text-sm text-red-600">
                Couldn&apos;t check this team: {deletePreview.message}
              </p>
            )}

            {deletePreview?.status === "blocked" && (
              <div className="mt-2 space-y-2">
                {deletePreview.reasons.map((r) => (
                  <p key={r} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {describeDeleteBlock(r, divisionName)}
                  </p>
                ))}
              </div>
            )}

            {deletePreview?.status === "ready" && (
              <div className="mt-2 text-sm text-gray-600">
                <p>
                  <span className="font-semibold">{deleteTarget.name}</span> will be permanently
                  removed, along with:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {deletePreviewLines(deletePreview.destroyed, deletePreview.sideEffects).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-gray-400">This cannot be undone.</p>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50"
              >
                {deletePreview?.status === "blocked" || deletePreview?.status === "error" ? "Close" : "Cancel"}
              </button>
              {deletePreview?.status === "ready" && (
                <button
                  onClick={() => confirmDeleteTeam(deleteTarget)}
                  disabled={deleteLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  {deleteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {deleteLoading ? "Deleting…" : "Delete team & games"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule lock + posted ───────────────────────────────────────────
          Lock protects this division against destructive re-derivation;
          rainouts and reschedules keep working. Posted is a plain "I sent this
          out" marker that AUTO-CLEARS on any change to this division's games
          (0082 triggers) — nothing branches on it. */}
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
        locked ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-gray-50/60"
      }`}>
        <div className="flex items-start gap-2.5">
          {locked
            ? <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            : <LockOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />}
          <div>
            <p className={`text-sm font-semibold ${locked ? "text-amber-900" : "text-[#0C1F3F]"}`}>
              {locked ? "Schedule locked" : "Schedule unlocked"}
            </p>
            <p className={`text-xs ${locked ? "text-amber-700" : "text-gray-500"}`}>
              {locked
                ? "Rainouts and reschedules still work. Everything else needs an unlock."
                : "Lock this division once the schedule is settled."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={posted}
              disabled={postedBusy}
              onChange={handleTogglePosted}
              className="h-4 w-4 cursor-pointer rounded border-gray-300 text-[#22C55E] focus:ring-[#22C55E]"
            />
            <span className="inline-flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 text-gray-400" />
              Schedule sent out
            </span>
          </label>

          <button
            type="button"
            onClick={handleToggleLock}
            disabled={lockBusy}
            className={
              locked
                ? "inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                : "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-[#0C1F3F] transition-colors hover:border-gray-300 disabled:opacity-50"
            }
          >
            {lockBusy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {lockBusy ? "Saving…" : locked ? "Unlock schedule" : "Lock schedule"}
          </button>
        </div>
      </div>

      {/* ── Action buttons ── */}
      <div className="flex flex-wrap items-center gap-3">
        {isIncomplete ? (
          <>
            <button
              onClick={handleFinish}
              title={locked ? lockedReason(divisionName, "finish") : undefined}
              disabled={finishing || generating || locked}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {finishing
                ? <><Loader2 className="h-4 w-4 animate-spin" />Finishing…</>
                : <><PlusCircle className="h-4 w-4" />Finish scheduling</>}
            </button>
            <button
              onClick={requestGenerate}
              title={locked ? lockedReason(divisionName, "generate") : undefined}
              disabled={finishing || generating || locked}
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
            title={locked ? lockedReason(divisionName, "generate") : undefined}
            disabled={generating || locked}
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

      {/* ── Coach conflict warning (distinct category, read-only) ── */}
      <CoachConflictNotice conflicts={coachConflicts} />

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

          {Array.from(grouped.entries()).map(([dateKey, dayEvents], groupIdx) => {
            // Bye line renders once per week, at that week's first day-group.
            const weekKey = weekKeyFromIsoDate(dateKey);
            const isFirstOfWeek = firstDateKeyOfWeek.get(weekKey) === dateKey;
            const weekByes = isFirstOfWeek ? byeByWeek.get(weekKey) ?? [] : [];
            return (
            <div key={dateKey} className={groupIdx > 0 ? "border-t border-gray-50" : ""}>
              {weekByes.length > 0 && (
                <div className="bg-gray-50/60 px-4 py-2">
                  <p className="text-xs font-medium text-gray-600">
                    <span className="font-semibold uppercase tracking-wide">Bye:</span>{" "}
                    {weekByes.join(", ")}
                  </p>
                </div>
              )}
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
            );
          })}
        </div>
      )}

      {/* ── Add game quick action ── */}
      <div className="mt-3 print:hidden">
        <button
          onClick={() => setAddGameOpen(true)}
          disabled={teams.length < 2 || locked}
          title={
            locked
              ? lockedReason(divisionName, "add")
              : teams.length < 2
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

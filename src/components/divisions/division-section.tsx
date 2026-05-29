"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, CalendarDays, ChevronDown, Pencil, Trash2,
  Zap, CloudRain, ArrowLeftRight, FileDown, Users,
  X, Loader2, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { DivisionBallIcon } from "./division-ball-icon";
import { createClient } from "@/lib/supabase/client";
import { DivisionWizard } from "./division-wizard";
import { DivisionSchedulePanel } from "./division-schedule-panel";
import { ConflictResolverModal } from "./conflict-resolver-modal";
import { LogRainoutModal } from "./log-rainout-modal";
import { ExportPickerModal, type PrintMode } from "./export-picker-modal";
import type { Division } from "@/types/database";
import type { DivisionStat } from "@/app/(dashboard)/dashboard/leagues/[id]/page";
import {
  DEFAULT_WIZARD_DATA, type WizardData, type PlayingDay,
  type ScheduleFormat, type TeamEntry, type DayWindowMap,
  type VenueAssignment, type InterleagueGameEntry,
} from "./wizard-types";
import { UpgradeModal } from "@/components/plan/upgrade-cta";
import { planLabel } from "@/lib/plan/labels";

function divisionToWizardData(
  div: Division,
  venueAssignments: VenueAssignment[],
  interleagueGames: InterleagueGameEntry[] = [],
): WizardData {
  const s = (div.settings ?? {}) as Record<string, unknown>;
  const asNum = (v: unknown, fb: number) => (typeof v === "number" ? v : fb);
  const asStr = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);
  const asBool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);

  const umpireRolesRaw = div.umpire_roles;
  const umpireRoles: string[] = Array.isArray(umpireRolesRaw)
    ? umpireRolesRaw.filter((r): r is string => typeof r === "string")
    : [];

  const playingDays: PlayingDay[] = Array.isArray(s.playing_days)
    ? (s.playing_days as PlayingDay[])
    : DEFAULT_WIZARD_DATA.playing_days;

  // Migrate old single-window format → per-day windows
  let day_windows: DayWindowMap;
  if (s.day_windows && typeof s.day_windows === "object" && !Array.isArray(s.day_windows)) {
    day_windows = s.day_windows as DayWindowMap;
  } else {
    const start = asStr(s.earliest_start, "09:00");
    const end   = asStr(s.latest_start,   "17:00");
    day_windows = {};
    for (const day of playingDays) {
      day_windows[day] = { start, end };
    }
  }

  const practice_days: PlayingDay[] = Array.isArray(s.practice_days)
    ? (s.practice_days as PlayingDay[])
    : DEFAULT_WIZARD_DATA.practice_days;

  const practice_day_windows: DayWindowMap =
    s.practice_day_windows && typeof s.practice_day_windows === "object" && !Array.isArray(s.practice_day_windows)
      ? (s.practice_day_windows as DayWindowMap)
      : DEFAULT_WIZARD_DATA.practice_day_windows;

  return {
    name: div.name,
    team_count: div.team_count,
    start_date: div.start_date ?? "",
    end_date: div.end_date ?? "",
    games_per_team: asNum(s.games_per_team, DEFAULT_WIZARD_DATA.games_per_team),
    max_games_per_week: asNum(s.max_games_per_week, DEFAULT_WIZARD_DATA.max_games_per_week),
    max_games_per_team_per_day: asNum(s.max_games_per_team_per_day, DEFAULT_WIZARD_DATA.max_games_per_team_per_day),
    playing_days: playingDays,
    day_windows,
    practice_days,
    practice_day_windows,
    use_league_schedule: asBool(s.use_league_schedule, false),
    game_duration: asNum(s.game_duration, DEFAULT_WIZARD_DATA.game_duration),
    buffer_minutes: asNum(s.buffer_minutes, DEFAULT_WIZARD_DATA.buffer_minutes),
    max_games_per_field_per_day: asNum(
      s.max_games_per_field_per_day,
      DEFAULT_WIZARD_DATA.max_games_per_field_per_day,
    ),
    bye_weeks: asNum(s.bye_weeks, DEFAULT_WIZARD_DATA.bye_weeks),
    activities_per_week: div.activities_per_week ?? DEFAULT_WIZARD_DATA.activities_per_week,
    practice_season_start: div.practice_season_start ?? "",
    practice_season_end: div.practice_season_end ?? "",
    venue_assignments: venueAssignments,
    umpires_per_game: div.umpires_per_game ?? DEFAULT_WIZARD_DATA.umpires_per_game,
    umpire_roles: umpireRoles,
    format: (s.format as ScheduleFormat) ?? DEFAULT_WIZARD_DATA.format,
    auto_rotate: asBool(s.auto_rotate, DEFAULT_WIZARD_DATA.auto_rotate),
    plays_interleague: div.plays_interleague ?? false,
    interleague_games: interleagueGames,
    teams: Array.isArray(s.teams) ? (s.teams as TeamEntry[]) : [],
  };
}

interface Props {
  leagueId: string;
  leagueName: string;
  leagueSport: string;
  divisionStats: DivisionStat[];
  currentOrgId: string;
  /** Org-wide division count + cap, used to gate the "Add division" buttons
   *  on this page. Mirrors the gate on /dashboard/divisions' AddDivisionButton:
   *  at cap the buttons mute and open the upgrade modal instead of the wizard. */
  divisionCount: number;
  divisionLimit: number;
  /** Org-wide team count + cap, used by the wizard's upfront cap check so
   *  Free users don't end up with a partially-saved division if their
   *  team list would push the org over its limit. */
  teamCount: number;
  teamLimit: number;
  plan: import("@/lib/plan/limits").Plan;
  onDivisionSaved?: () => void;
}

function getDivisionStatus(stat: DivisionStat): {
  label: string;
  className: string;
  action: "view" | "fix" | "none";
} {
  if (stat.conflictCount > 0) {
    return {
      label: `${stat.conflictCount} conflict${stat.conflictCount !== 1 ? "s" : ""}`,
      className: "bg-red-50 text-red-600",
      action: "fix",
    };
  }
  const complete = stat.allTeamsAtMinimum;
  if (complete) {
    return {
      label: "Schedule ready",
      className: "bg-[#22C55E]/10 text-[#22C55E]",
      action: "view",
    };
  }
  if (stat.gameCount > 0) {
    return {
      label: "Incomplete",
      className: "bg-amber-50 text-amber-600",
      action: "view",
    };
  }
  return {
    label: "Not started",
    className: "bg-gray-100 text-gray-400",
    action: "none",
  };
}

const QUICK_ACTIONS = [
  {
    icon: Zap,
    label: "Generate schedule",
    description: "Expand a division below",
    available: true,
    iconBg: "bg-[#0C1F3F]/[0.07]",
    iconColor: "text-[#0C1F3F]/60",
  },
  {
    icon: CloudRain,
    label: "Log a rainout",
    description: "Cancel & reschedule a game",
    available: false,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-400",
  },
  {
    icon: ArrowLeftRight,
    label: "Schedule interleague",
    description: "Invite other orgs",
    available: true,
    iconBg: "bg-purple-50",
    iconColor: "text-purple-500",
  },
  {
    icon: FileDown,
    label: "Export PDF / CSV",
    description: "Print a division schedule",
    available: true,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-400",
  },
];

export function DivisionSection({
  leagueId, leagueName, leagueSport, divisionStats, currentOrgId,
  divisionCount, divisionLimit, teamCount, teamLimit, plan, onDivisionSaved,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [divisions, setDivisions] = useState<Division[]>([]);

  const atDivisionCap = divisionLimit !== -1 && divisionCount >= divisionLimit;
  // Common handler: if at cap, show the upgrade modal instead of opening
  // the wizard. Mirrors the AddDivisionButton gate on /dashboard/divisions.
  function handleAddClick() {
    if (atDivisionCap) {
      setUpgradeOpen(true);
      return;
    }
    setOpen(true);
  }
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingDiv, setEditingDiv] = useState<Division | null>(null);
  const [editInitialData, setEditInitialData] = useState<WizardData | null>(null);
  // Live team count for the division being edited — feeds StepBasics' cap
  // headroom math (existing teams stay, so they add back to available room).
  const [editExistingTeamCount, setEditExistingTeamCount] = useState(0);
  const [fixingDivision, setFixingDivision] = useState<Division | null>(null);
  const [leagueStartDate, setLeagueStartDate] = useState<string>("");
  const [leagueEndDate, setLeagueEndDate] = useState<string>("");
  const [printTriggerId, setPrintTriggerId] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode>("games");
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [showLogRainout, setShowLogRainout] = useState(false);

  // Delete-division state
  const [deletingDivision, setDeletingDivision] = useState<Division | null>(null);
  const [deleteInterleagueCount, setDeleteInterleagueCount] = useState(0);
  const [loadingDeleteContext, setLoadingDeleteContext] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Toast
  type Toast = { kind: "error" | "success"; message: string; id: number };
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );
  function notify(kind: Toast["kind"], message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ kind, message, id: Date.now() });
    toastTimerRef.current = window.setTimeout(
      () => {
        setToast(null);
        toastTimerRef.current = null;
      },
      kind === "error" ? 8000 : 4000,
    );
  }

  const fetchDivisions = useCallback(async () => {
    const supabase = createClient();
    const [{ data }, { data: leagueData }] = await Promise.all([
      supabase
        .from("divisions")
        .select("*")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: true }),
      supabase
        .from("leagues")
        .select("start_date, end_date")
        .eq("id", leagueId)
        .single(),
    ]);
    setDivisions((data as Division[]) ?? []);
    const ld = leagueData as { start_date: string | null; end_date: string | null } | null;
    setLeagueStartDate(ld?.start_date ?? "");
    setLeagueEndDate(ld?.end_date ?? "");
    setLoading(false);
  }, [leagueId]);

  useEffect(() => {
    fetchDivisions();
  }, [fetchDivisions]);

  async function handleEditClick(div: Division, e: React.MouseEvent) {
    e.stopPropagation();
    const supabase = createClient();
    const [{ data: dvRows }, { data: teamRows }, { data: igRows }] = await Promise.all([
      supabase.from("division_venues").select("venue_id, allow_games, allow_practices").eq("division_id", div.id),
      supabase.from("teams").select("id, name").eq("division_id", div.id),
      supabase
        .from("division_interleague_games")
        .select("interleague_org_id, game_count, home_games_per_team, interleague_orgs(name)")
        .eq("division_id", div.id),
    ]);
    const venueAssignments: VenueAssignment[] = (dvRows ?? []).map(
      (r: { venue_id: string; allow_games: boolean; allow_practices: boolean }) => ({
        venue_id: r.venue_id,
        allow_games: r.allow_games,
        allow_practices: r.allow_practices,
      }),
    );
    type IgRow = {
      interleague_org_id: string;
      game_count: number;
      home_games_per_team: number | null;
      interleague_orgs: { name: string } | null;
    };
    const interleagueGames: InterleagueGameEntry[] = ((igRows ?? []) as unknown as IgRow[]).map((r) => ({
      interleague_org_id: r.interleague_org_id,
      org_name: r.interleague_orgs?.name ?? "",
      game_count: r.game_count,
      home_games_per_team: r.home_games_per_team ?? r.game_count,
    }));
    // Wizard's `data.teams` array is rehydrated from divisions.settings.teams
    // (the JSON blob) — the live teams table isn't the source of truth for
    // the wizard's names. But we still need the live row count for the cap
    // headroom calc in StepBasics: those rows stay after save, so they add
    // back to the org-wide team headroom.
    setEditExistingTeamCount((teamRows ?? []).length);
    setEditInitialData(
      divisionToWizardData(div, venueAssignments, interleagueGames),
    );
    setEditingDiv(div);
  }

  function handleComplete() {
    setOpen(false);
    setEditingDiv(null);
    setEditInitialData(null);
    fetchDivisions();
    onDivisionSaved?.();
  }

  async function handleDeleteClick(div: Division, e: React.MouseEvent) {
    e.stopPropagation();
    setDeletingDivision(div);
    setDeleteInterleagueCount(0);
    setLoadingDeleteContext(true);

    const supabase = createClient();
    // Count accepted interleague games for this division (status='scheduled'
    // and interleague_org_id is set). We look at the home team's division.
    const { data: teamRows } = await supabase
      .from("teams")
      .select("id")
      .eq("division_id", div.id);
    const teamIds = ((teamRows ?? []) as { id: string }[]).map((t) => t.id);
    if (teamIds.length > 0) {
      const { count } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .in("home_team_id", teamIds)
        .eq("status", "scheduled")
        .not("interleague_org_id", "is", null);
      setDeleteInterleagueCount(count ?? 0);
    }
    setLoadingDeleteContext(false);
  }

  async function handleDeleteConfirm() {
    if (!deletingDivision) return;
    const div = deletingDivision;
    setDeleteLoading(true);
    const supabase = createClient();

    // teams.division_id is ON DELETE SET NULL, and games reference teams
    // directly. To remove all of the division's data we must explicitly:
    //   1. delete games for those teams
    //   2. delete the teams (cascades practice_slots,
    //      team_availability_blocks, team_practice_slots)
    //   3. delete the division (cascades practice_time_slots,
    //      division_interleague_games, playoff rows, etc.)
    const { data: teamRows, error: teamFetchErr } = await supabase
      .from("teams")
      .select("id")
      .eq("division_id", div.id);

    if (teamFetchErr) {
      setDeleteLoading(false);
      notify("error", `Couldn't load division teams: ${teamFetchErr.message}`);
      return;
    }
    const teamIds = ((teamRows ?? []) as { id: string }[]).map((t) => t.id);

    if (teamIds.length > 0) {
      const { error: gameDelErr } = await supabase
        .from("games")
        .delete()
        .or(
          `home_team_id.in.(${teamIds.join(",")}),away_team_id.in.(${teamIds.join(",")})`,
        );
      if (gameDelErr) {
        setDeleteLoading(false);
        notify("error", `Couldn't delete division games: ${gameDelErr.message}`);
        return;
      }

      const { error: teamDelErr } = await supabase
        .from("teams")
        .delete()
        .in("id", teamIds);
      if (teamDelErr) {
        setDeleteLoading(false);
        notify("error", `Couldn't delete division teams: ${teamDelErr.message}`);
        return;
      }
    }

    const { error: divDelErr } = await supabase
      .from("divisions")
      .delete()
      .eq("id", div.id);

    setDeleteLoading(false);
    if (divDelErr) {
      notify("error", `Couldn't delete division: ${divDelErr.message}`);
      return;
    }

    setDivisions((prev) => prev.filter((d) => d.id !== div.id));
    if (expandedId === div.id) setExpandedId(null);
    setDeletingDivision(null);
    notify("success", `Division "${div.name}" deleted`);
    onDivisionSaved?.();
  }

  function handleExportClick() {
    if (divisions.length === 0) return;
    setShowExportPicker(true);
  }

  function handleExportPrint(divisionId: string, mode: PrintMode) {
    setPrintMode(mode);
    setExpandedId(divisionId);
    setPrintTriggerId(divisionId);
  }

  return (
    <>
      {/* ── Divisions table ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">Divisions</h2>
          <button
            onClick={handleAddClick}
            className={
              atDivisionCap
                ? "inline-flex cursor-default items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500"
                : "inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a]"
            }
            title={
              atDivisionCap
                ? `You've reached your ${planLabel(plan)} plan division limit of ${divisionLimit}.`
                : undefined
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add division
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center px-6 py-10">
            <svg className="h-5 w-5 animate-spin text-gray-300" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : divisions.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <DivisionBallIcon
              sport={leagueSport}
              index={0}
              muted
              containerClassName="h-12 w-12 rounded-full"
              iconClassName="h-5 w-5"
            />
            <p className="mt-4 font-medium text-[#0C1F3F]">No divisions yet</p>
            <p className="mt-1 max-w-xs text-sm text-gray-400">
              {leagueSport === "Baseball" || leagueSport === "Softball"
                ? "Add divisions to organize your teams — e.g. T-Ball, A, AA, AAA, Majors."
                : leagueSport === "Soccer"
                ? "Add divisions to organize your teams — e.g. U8, U10, U12, U14."
                : "Add divisions to organize your teams by age group or skill level."}
            </p>
            <button
              onClick={handleAddClick}
              className={
                atDivisionCap
                  ? "mt-5 inline-flex cursor-default items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-400 opacity-70"
                  : "mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
              }
              title={
                atDivisionCap
                  ? `You've reached your ${planLabel(plan)} plan division limit of ${divisionLimit}.`
                  : undefined
              }
            >
              <Plus className="h-4 w-4" />
              Add your first division
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {divisions.map((div, idx) => {
              const isExpanded = expandedId === div.id;
              const stat = divisionStats.find((s) => s.divisionId === div.id) ?? {
                divisionId: div.id,
                gameCount: 0,
                expectedGames: 0,
                conflictCount: 0,
                allTeamsAtMinimum: false,
                practiceCount: 0,
              };
              const status = getDivisionStatus(stat);
              const progressPct =
                stat.expectedGames > 0
                  ? Math.min(100, Math.round((stat.gameCount / stat.expectedGames) * 100))
                  : stat.gameCount > 0
                  ? 100
                  : 0;
              const barColor =
                stat.conflictCount > 0
                  ? "bg-red-400"
                  : stat.gameCount > 0
                  ? "bg-[#22C55E]"
                  : "bg-gray-200";

              return (
                <div key={div.id}>
                  <div className="flex w-full items-center gap-4 px-6 py-4">
                    {/* Left: icon + name + dates */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : div.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <DivisionBallIcon sport={leagueSport} index={idx} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0C1F3F]">{div.name}</p>
                        {div.start_date && div.end_date && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                            <CalendarDays className="h-3 w-3" />
                            {new Date(div.start_date + "T00:00:00").toLocaleDateString("en-US", {
                              month: "short", day: "numeric",
                            })}{" "}–{" "}
                            {new Date(div.end_date + "T00:00:00").toLocaleDateString("en-US", {
                              month: "short", day: "numeric", year: "numeric",
                            })}
                          </p>
                        )}
                      </div>
                    </button>

                    {/* Center: progress bar + game count */}
                    <div className="hidden w-56 flex-shrink-0 sm:block">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-400">
                          {stat.gameCount}
                          {stat.expectedGames > 0 ? ` / ${stat.expectedGames}` : ""} games
                        </span>
                        {progressPct > 0 && (
                          <span className="text-[11px] text-gray-400">{progressPct}%</span>
                        )}
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Right: team count + status badge + view/fix + edit + chevron */}
                    <div className="flex flex-shrink-0 items-center gap-2.5">
                      {/* Team count */}
                      <span className="hidden items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 sm:inline-flex">
                        <Users className="h-3 w-3" />
                        {div.team_count}
                      </span>

                      {/* Game schedule status badge */}
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>

                      {/* View / Fix action link */}
                      {status.action !== "none" && (
                        <button
                          onClick={() =>
                            status.action === "fix"
                              ? setFixingDivision(div)
                              : setExpandedId(isExpanded ? null : div.id)
                          }
                          className={`text-xs font-semibold underline-offset-2 hover:underline ${
                            status.action === "fix" ? "text-red-500" : "text-[#22C55E]"
                          }`}
                        >
                          {status.action === "fix" ? "Fix →" : "View →"}
                        </button>
                      )}

                      {/* Edit pencil */}
                      <button
                        onClick={(e) => handleEditClick(div, e)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F]"
                        aria-label="Edit division"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>

                      {/* Delete trash */}
                      <button
                        onClick={(e) => handleDeleteClick(div, e)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        aria-label="Delete division"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>

                      {/* Expand chevron */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : div.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      <div className="bg-gray-50/40 px-5 py-4">
                        <DivisionSchedulePanel
                          divisionId={div.id}
                          divisionName={div.name}
                          leagueName={leagueName}
                          leagueId={leagueId}
                          leagueSport={leagueSport}
                          triggerPrint={printTriggerId === div.id}
                          printMode={printMode}
                          onPrintDone={() => setPrintTriggerId(null)}
                          onScheduleChange={() => router.refresh()}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Quick Actions ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">Quick Actions</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          {QUICK_ACTIONS.map(({ icon: Icon, label, description, available, iconBg, iconColor }) => {
            const isExport = label === "Export PDF / CSV";
            const isRainout = label === "Log a rainout";
            const isInterleague = label === "Schedule interleague";
            const isActive = isExport || isRainout ? divisions.length > 0 : available;
            const onClick = isExport
              ? handleExportClick
              : isRainout
              ? () => setShowLogRainout(true)
              : isInterleague
              ? () =>
                  router.push(
                    `/dashboard/interleague?season=${encodeURIComponent(leagueId)}`,
                  )
              : undefined;
            const subtitle = isExport && divisions.length === 0
              ? "Add a division first"
              : isRainout && divisions.length === 0
              ? "Add a division first"
              : description;
            return (
              <button
                key={label}
                disabled={!isActive}
                onClick={onClick}
                className={`flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                  isActive
                    ? "border-gray-100 hover:border-[#22C55E]/40 hover:bg-gray-50/60"
                    : "cursor-not-allowed border-gray-100 opacity-60"
                }`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
                  <Icon className={`h-4 w-4 ${iconColor}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#0C1F3F]">{label}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Wizards ──────────────────────────────────────────────────────── */}
      {open && (
        <DivisionWizard
          leagueId={leagueId}
          leagueName={leagueName}
          leagueSport={leagueSport}
          leagueStartDate={leagueStartDate}
          leagueEndDate={leagueEndDate}
          currentOrgId={currentOrgId}
          teamCount={teamCount}
          teamLimit={teamLimit}
          plan={plan}
          onClose={() => setOpen(false)}
          onComplete={handleComplete}
        />
      )}

      {editingDiv && editInitialData && (
        <DivisionWizard
          leagueId={leagueId}
          leagueName={leagueName}
          leagueSport={leagueSport}
          currentOrgId={currentOrgId}
          teamCount={teamCount}
          teamLimit={teamLimit}
          plan={plan}
          existingTeamCountInDivision={editExistingTeamCount}
          onClose={() => { setEditingDiv(null); setEditInitialData(null); }}
          onComplete={handleComplete}
          editDivision={editingDiv}
          initialData={editInitialData}
        />
      )}

      {/* ── Export / Print picker ────────────────────────────────────────── */}
      {showExportPicker && (
        <ExportPickerModal
          divisions={divisions}
          divisionStats={divisionStats}
          leagueName={leagueName}
          onClose={() => setShowExportPicker(false)}
          onPrint={handleExportPrint}
        />
      )}

      {fixingDivision && (
        <ConflictResolverModal
          leagueId={leagueId}
          divisionId={fixingDivision.id}
          divisionName={fixingDivision.name}
          onClose={() => setFixingDivision(null)}
          onResolved={() => {
            router.refresh();
            fetchDivisions();
            onDivisionSaved?.();
          }}
        />
      )}

      {/* ── Log Rainout ──────────────────────────────────────────────────── */}
      {showLogRainout && (
        <LogRainoutModal
          leagueId={leagueId}
          divisions={divisions}
          onClose={() => setShowLogRainout(false)}
          onRainedOut={() => {
            router.refresh();
            onDivisionSaved?.();
          }}
        />
      )}

      {/* ── Delete division confirmation ─────────────────────────────────── */}
      {deletingDivision && (
        <DeleteDivisionDialog
          division={deletingDivision}
          interleagueGameCount={deleteInterleagueCount}
          loadingContext={loadingDeleteContext}
          deleting={deleteLoading}
          onCancel={() => !deleteLoading && setDeletingDivision(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-md">
            <DivisionToast
              kind={toast.kind}
              message={toast.message}
              onDismiss={() => setToast(null)}
            />
          </div>
        </div>
      )}

      {upgradeOpen ? (
        <UpgradeModal
          cap="divisions"
          limit={divisionLimit}
          currentPlan={plan}
          onClose={() => setUpgradeOpen(false)}
        />
      ) : null}
    </>
  );
}

// ── Delete division confirmation dialog ─────────────────────────────────────

function DeleteDivisionDialog({
  division,
  interleagueGameCount,
  loadingContext,
  deleting,
  onCancel,
  onConfirm,
}: {
  division: Division;
  interleagueGameCount: number;
  loadingContext: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !deleting && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-red-500" />
            <h2 className="font-semibold text-[#0C1F3F]">Delete division?</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 py-5 text-sm text-gray-700">
          <p>
            <span className="font-semibold">{division.name}</span> will be permanently
            deleted. This action cannot be undone.
          </p>

          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
              What gets deleted
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
              <li>All teams in this division</li>
              <li>All scheduled and rained-out games for those teams</li>
              <li>Practice slots (recurring and one-off)</li>
              <li>Practice time slot presets</li>
              <li>Team practice preferences</li>
              <li>Team availability blocks</li>
            </ul>
          </div>

          {loadingContext ? (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking for accepted interleague games…
            </div>
          ) : interleagueGameCount > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold">
                    {interleagueGameCount} accepted interleague game
                    {interleagueGameCount !== 1 ? "s" : ""} will also be deleted.
                  </p>
                  <p className="mt-1 text-xs text-amber-700">
                    The other org won&apos;t be notified. Reach out to them first if
                    they&apos;re expecting these games.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={deleting}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-gray-300 text-red-500 focus:ring-red-500"
            />
            <span>I understand this can&apos;t be undone.</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!acknowledged || deleting || loadingContext}
            className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete division
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toast banner ────────────────────────────────────────────────────────────

function DivisionToast({
  kind,
  message,
  onDismiss,
}: {
  kind: "error" | "success";
  message: string;
  onDismiss: () => void;
}) {
  const isError = kind === "error";
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${
        isError
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-[#22C55E]/30 bg-[#22C55E]/5 text-[#16a34a]"
      }`}
    >
      {isError ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
      )}
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 rounded-md p-1 text-current/60 hover:bg-black/5"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

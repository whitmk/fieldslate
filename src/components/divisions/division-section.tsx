"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, CalendarDays, ChevronDown, Pencil,
  Zap, CloudRain, ArrowLeftRight, FileDown, Users, X,
} from "lucide-react";
import { DivisionBallIcon } from "./division-ball-icon";
import { createClient } from "@/lib/supabase/client";
import { DivisionWizard } from "./division-wizard";
import { DivisionSchedulePanel } from "./division-schedule-panel";
import { ConflictResolverModal } from "./conflict-resolver-modal";
import type { Division } from "@/types/database";
import type { DivisionStat } from "@/app/(dashboard)/dashboard/leagues/[id]/page";
import {
  DEFAULT_WIZARD_DATA, type WizardData, type PlayingDay,
  type ScheduleFormat, type TeamEntry, type DayWindowMap,
} from "./wizard-types";

function divisionToWizardData(div: Division, venueIds: string[]): WizardData {
  const s = (div.settings ?? {}) as Record<string, unknown>;
  const asNum = (v: unknown, fb: number) => (typeof v === "number" ? v : fb);
  const asStr = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);
  const asBool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);

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
    use_league_schedule: asBool(s.use_league_schedule, false),
    game_duration: asNum(s.game_duration, DEFAULT_WIZARD_DATA.game_duration),
    buffer_minutes: asNum(s.buffer_minutes, DEFAULT_WIZARD_DATA.buffer_minutes),
    max_games_per_field_per_day: asNum(
      s.max_games_per_field_per_day,
      DEFAULT_WIZARD_DATA.max_games_per_field_per_day,
    ),
    bye_weeks: asNum(s.bye_weeks, DEFAULT_WIZARD_DATA.bye_weeks),
    venue_ids: venueIds,
    format: (s.format as ScheduleFormat) ?? DEFAULT_WIZARD_DATA.format,
    include_playoffs: asBool(s.include_playoffs, DEFAULT_WIZARD_DATA.include_playoffs),
    auto_rotate: asBool(s.auto_rotate, DEFAULT_WIZARD_DATA.auto_rotate),
    track_standings: asBool(s.track_standings, DEFAULT_WIZARD_DATA.track_standings),
    teams: Array.isArray(s.teams) ? (s.teams as TeamEntry[]) : [],
  };
}

interface Props {
  leagueId: string;
  leagueName: string;
  leagueSport: string;
  divisionStats: DivisionStat[];
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
    description: "Coming soon",
    available: false,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-400",
  },
  {
    icon: ArrowLeftRight,
    label: "Request interleague",
    description: "Coming soon",
    available: false,
    iconBg: "bg-purple-50",
    iconColor: "text-purple-400",
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
  leagueId, leagueName, leagueSport, divisionStats, onDivisionSaved,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingDiv, setEditingDiv] = useState<Division | null>(null);
  const [editInitialData, setEditInitialData] = useState<WizardData | null>(null);
  const [fixingDivision, setFixingDivision] = useState<Division | null>(null);
  const [leagueStartDate, setLeagueStartDate] = useState<string>("");
  const [leagueEndDate, setLeagueEndDate] = useState<string>("");
  const [printTriggerId, setPrintTriggerId] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

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
    const { data: dvRows } = await supabase
      .from("division_venues")
      .select("venue_id")
      .eq("division_id", div.id);
    const venueIds = (dvRows ?? []).map((r: { venue_id: string }) => r.venue_id);
    setEditInitialData(divisionToWizardData(div, venueIds));
    setEditingDiv(div);
  }

  function handleComplete() {
    setOpen(false);
    setEditingDiv(null);
    setEditInitialData(null);
    fetchDivisions();
    onDivisionSaved?.();
  }

  function handleExportClick() {
    if (divisions.length === 0) return;
    if (divisions.length === 1) {
      setExpandedId(divisions[0].id);
      setPrintTriggerId(divisions[0].id);
    } else {
      setShowExportModal(true);
    }
  }

  function handleExportPick(divisionId: string) {
    setShowExportModal(false);
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
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a]"
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
              {leagueSport === "Baseball"
                ? "Add divisions to organize your teams — e.g. T-Ball, A, AA, AAA, Majors."
                : leagueSport === "Soccer"
                ? "Add divisions to organize your teams — e.g. U8, U10, U12, U14."
                : "Add divisions to organize your teams by age group or skill level."}
            </p>
            <button
              onClick={() => setOpen(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
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
                    <div className="hidden w-40 flex-shrink-0 sm:block">
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

                      {/* Status badge */}
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
                    <DivisionSchedulePanel
                      divisionId={div.id}
                      divisionName={div.name}
                      leagueName={leagueName}
                      triggerPrint={printTriggerId === div.id}
                      onPrintDone={() => setPrintTriggerId(null)}
                      onScheduleChange={() => router.refresh()}
                    />
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
            const isActive = isExport ? divisions.length > 0 : available;
            const onClick = isExport ? handleExportClick : undefined;
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
                  <p className="mt-0.5 text-xs text-gray-400">
                    {isExport && divisions.length === 0 ? "Add a division first" : description}
                  </p>
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
          leagueStartDate={leagueStartDate}
          leagueEndDate={leagueEndDate}
          onClose={() => setOpen(false)}
          onComplete={handleComplete}
        />
      )}

      {editingDiv && editInitialData && (
        <DivisionWizard
          leagueId={leagueId}
          leagueName={leagueName}
          onClose={() => { setEditingDiv(null); setEditInitialData(null); }}
          onComplete={handleComplete}
          editDivision={editingDiv}
          initialData={editInitialData}
        />
      )}

      {/* ── Export / Print division picker ──────────────────────────────── */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-[#0C1F3F]">Print Schedule</h3>
                <p className="mt-0.5 text-xs text-gray-400">Choose a division to print</p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#0C1F3F]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2 p-4">
              {divisions.map((div) => {
                const stat = divisionStats.find((s) => s.divisionId === div.id);
                const gameCount = stat?.gameCount ?? 0;
                return (
                  <button
                    key={div.id}
                    onClick={() => handleExportPick(div.id)}
                    className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3 text-left transition-colors hover:border-[#22C55E]/50 hover:bg-gray-50"
                  >
                    <span className="text-sm font-semibold text-[#0C1F3F]">{div.name}</span>
                    <span className="text-xs text-gray-400">
                      {gameCount} game{gameCount !== 1 ? "s" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {fixingDivision && (
        <ConflictResolverModal
          divisionId={fixingDivision.id}
          divisionName={fixingDivision.name}
          onClose={() => setFixingDivision(null)}
          onResolved={() => {
            // Refresh the server component so the stat cards + division badges
            // re-run with the same detection logic used inside the modal.
            router.refresh();
            fetchDivisions();
            onDivisionSaved?.();
          }}
        />
      )}
    </>
  );
}

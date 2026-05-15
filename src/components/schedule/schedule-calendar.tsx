"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CloudRain,
  CalendarClock,
  Eye,
  XCircle,
  MapPin,
  Clock,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { logActivity } from "@/lib/activity-log";
import { RainoutRescheduleModal } from "@/components/divisions/rainout-reschedule-modal";
import { SchedulePracticeModal } from "@/components/divisions/schedule-practice-modal";
import { GameDetailModal } from "@/components/umpires/game-detail-modal";
import type { ScheduleGame, SchedulePractice } from "./schedule-list";

type View = "games" | "practices" | "combined";

interface Props {
  view: View;
  games: ScheduleGame[];
  practices: SchedulePractice[];
  month: string; // "YYYY-MM"
  today: string; // "YYYY-MM-DD"
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function mondayOfWeek(dateStr: string) {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const d = new Date(yr, mo - 1, dy);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return localDateStr(d);
}

function weekLabel(monday: string) {
  const [yr, mo, dy] = monday.split("-").map(Number);
  return new Date(yr, mo - 1, dy, 12).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function buildGrid(month: string): Date[] {
  const [yr, mo] = month.split("-").map(Number);
  const first = new Date(yr, mo - 1, 1);
  const startOffset = first.getDay(); // 0 = Sunday
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(yr, mo - 1, 1 - startOffset + i));
  }
  return cells;
}

function monthLabel(month: string) {
  const [yr, mo] = month.split("-").map(Number);
  return new Date(yr, mo - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function shiftMonth(month: string, delta: number) {
  const [yr, mo] = month.split("-").map(Number);
  const d = new Date(yr, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type GamePill = { kind: "game"; date: string; time: string; data: ScheduleGame };
type PracticePill = {
  kind: "practice";
  date: string;
  time: string;
  data: SchedulePractice;
};
type Pill = GamePill | PracticePill;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_PER_DAY = 3;

// ── Component ─────────────────────────────────────────────────────────────────

export function ScheduleCalendar({ view, games, practices, month, today }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<{
    pos: { x: number; y: number };
    pill: Pill;
  } | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<ScheduleGame | null>(null);
  const [reschedulePractice, setReschedulePractice] = useState<SchedulePractice | null>(null);
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const [detailGame, setDetailGame] = useState<ScheduleGame | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelected(null);
      }
    }
    if (selected) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [selected]);

  function navigateMonth(delta: number) {
    const next = shiftMonth(month, delta);
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", next);
    const qs = params.toString();
    router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
  }

  function goToToday() {
    const [yr, mo] = today.split("-");
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", `${yr}-${mo}`);
    const qs = params.toString();
    router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
  }

  // Build pills indexed by date
  const pillsByDate = new Map<string, Pill[]>();
  if (view !== "practices") {
    for (const g of games) {
      const date = g.scheduled_at.substring(0, 10);
      const time = g.scheduled_at.substring(11, 16);
      const pill: GamePill = { kind: "game", date, time, data: g };
      if (!pillsByDate.has(date)) pillsByDate.set(date, []);
      pillsByDate.get(date)!.push(pill);
    }
  }
  if (view !== "games") {
    for (const p of practices) {
      const pill: PracticePill = {
        kind: "practice",
        date: p.scheduled_date,
        time: p.start_time,
        data: p,
      };
      if (!pillsByDate.has(p.scheduled_date)) pillsByDate.set(p.scheduled_date, []);
      pillsByDate.get(p.scheduled_date)!.push(pill);
    }
  }
  for (const arr of pillsByDate.values()) {
    arr.sort((a, b) => a.time.localeCompare(b.time));
  }

  const cells = buildGrid(month);
  const [, mo] = month.split("-").map(Number);

  async function handleRainout(game: ScheduleGame) {
    setActionLoadingId(game.id);
    setSelected(null);
    const supabase = createClient();
    await supabase
      .from("games")
      .update({ status: "cancelled" } as never)
      .eq("id", game.id);
    await logActivity(
      game.league_id,
      game.home_team?.division_id ?? null,
      "rainout_logged",
      `${game.home_team?.name ?? "Home"} vs ${game.away_team?.name ?? "Away"} on ${fmtGameDate(game.scheduled_at)} marked as rained out`,
    );
    setActionLoadingId(null);
    router.refresh();
  }

  async function handleCancelPractice(p: SchedulePractice) {
    setActionLoadingId(p.id);
    setSelected(null);
    const supabase = createClient();
    await supabase
      .from("practices")
      .update({ status: "cancelled" } as never)
      .eq("id", p.id);
    await logActivity(
      p.league_id,
      p.division_id,
      "practice_cancelled",
      `${p.team?.name ?? "Team"} practice on ${fmtGameDate(p.scheduled_date)} cancelled`,
    );
    setActionLoadingId(null);
    router.refresh();
  }

  function openPopover(e: React.MouseEvent, pill: Pill) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.left, window.innerWidth - 280);
    setSelected({ pos: { x: Math.max(8, x), y: rect.bottom + 4 }, pill });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateMonth(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigateMonth(1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={goToToday}
            className="ml-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
          >
            Today
          </button>
        </div>
        <h3 className="text-base font-semibold text-[#0C1F3F]">
          {monthLabel(month)}
        </h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-orange-500" />
            Games
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            Practices
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, idx) => {
            const cellDate = localDateStr(cell);
            const inMonth = cell.getMonth() === mo - 1;
            const isToday = cellDate === today;
            const isPast = cellDate < today;
            const cellPills = pillsByDate.get(cellDate) ?? [];
            const visible = cellPills.slice(0, MAX_VISIBLE_PER_DAY);
            const overflow = Math.max(0, cellPills.length - MAX_VISIBLE_PER_DAY);
            const isLastRow = idx >= 35;

            return (
              <div
                key={idx}
                className={`min-h-[110px] border-gray-50 p-1.5 ${
                  (idx + 1) % 7 === 0 ? "" : "border-r"
                } ${isLastRow ? "" : "border-b"} ${
                  inMonth ? "bg-white" : "bg-gray-50/40"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                      isToday
                        ? "bg-[#22C55E] text-white"
                        : inMonth
                        ? "text-[#0C1F3F]"
                        : "text-gray-300"
                    }`}
                  >
                    {cell.getDate()}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {visible.map((pill) => (
                    <PillButton
                      key={`${pill.kind}-${pill.data.id}`}
                      pill={pill}
                      muted={isPast}
                      loading={actionLoadingId === pill.data.id}
                      onClick={(e) => openPopover(e, pill)}
                    />
                  ))}
                  {overflow > 0 && (
                    <button
                      onClick={() => setDayDetail(cellDate)}
                      className="rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick detail popover */}
      {selected &&
        (() => {
          const pill = selected.pill;
          return (
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                left: selected.pos.x,
                top: selected.pos.y,
              }}
              className="z-40 w-72 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg"
            >
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      pill.kind === "game"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-indigo-100 text-indigo-500"
                    }`}
                  >
                    {pill.kind === "game" ? "Game" : "Practice"}
                  </span>
                  {pill.data.status === "cancelled" && (
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        pill.kind === "game"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {pill.kind === "game" ? "Rained out" : "Cancelled"}
                    </span>
                  )}
                  {pill.data.status === "scheduled" && (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                      Scheduled
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm font-semibold text-[#0C1F3F]">
                  {pill.kind === "game"
                    ? `${pill.data.home_team?.name ?? "TBD"} vs ${pill.data.away_team?.name ?? "TBD"}`
                    : pill.data.team?.name ?? "Team"}
                </p>
                <div className="mt-2 flex flex-col gap-1 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    {fmtGameDate(
                      pill.kind === "game"
                        ? pill.data.scheduled_at
                        : pill.data.scheduled_date,
                    )}
                    {", "}
                    {fmtGameTime(
                      pill.kind === "game"
                        ? pill.data.scheduled_at
                        : `${pill.data.scheduled_date}T${pill.data.start_time}:00`,
                    )}
                  </span>
                  {pill.data.venue?.name && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      {pill.data.venue.name}
                    </span>
                  )}
                </div>
              </div>
              {pill.kind === "game" ? (
                <>
                  <button
                    onClick={() => handleRainout(pill.data)}
                    disabled={actionLoadingId === pill.data.id}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    <CloudRain className="h-3.5 w-3.5 text-blue-400" />
                    Mark as rained out
                  </button>
                  <button
                    onClick={() => {
                      setRescheduleGame(pill.data);
                      setSelected(null);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <CalendarClock className="h-3.5 w-3.5 text-[#22C55E]" />
                    Reschedule
                  </button>
                  <button
                    onClick={() => {
                      setDetailGame(pill.data);
                      setSelected(null);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Eye className="h-3.5 w-3.5 text-gray-400" />
                    View details
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleCancelPractice(pill.data)}
                    disabled={actionLoadingId === pill.data.id}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5 text-red-400" />
                    Cancel practice
                  </button>
                  <button
                    onClick={() => {
                      setReschedulePractice(pill.data);
                      setSelected(null);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <CalendarClock className="h-3.5 w-3.5 text-[#22C55E]" />
                    Reschedule practice
                  </button>
                </>
              )}
            </div>
          );
        })()}

      {/* Day overflow modal */}
      {dayDetail &&
        (() => {
          const items = pillsByDate.get(dayDetail) ?? [];
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
              onClick={() => setDayDetail(null)}
            >
              <div
                className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="mb-3 text-base font-bold text-[#0C1F3F]">
                  {fmtGameDate(dayDetail)}
                </h3>
                <div className="flex flex-col gap-2">
                  {items.map((pill) => (
                    <PillButton
                      key={`detail-${pill.kind}-${pill.data.id}`}
                      pill={pill}
                      muted={dayDetail < today}
                      loading={actionLoadingId === pill.data.id}
                      size="lg"
                      onClick={(e) => {
                        setDayDetail(null);
                        openPopover(e, pill);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

      {rescheduleGame && (
        <RainoutRescheduleModal
          gameId={rescheduleGame.id}
          homeTeamId={rescheduleGame.home_team_id}
          awayTeamId={rescheduleGame.away_team_id}
          homeTeamName={rescheduleGame.home_team?.name ?? "Home"}
          awayTeamName={rescheduleGame.away_team?.name ?? "Away"}
          divisionId={rescheduleGame.home_team?.division_id ?? ""}
          leagueId={rescheduleGame.league_id}
          onClose={() => setRescheduleGame(null)}
          onRescheduled={() => {
            setRescheduleGame(null);
            router.refresh();
          }}
        />
      )}
      {reschedulePractice && (
        <SchedulePracticeModal
          practiceId={reschedulePractice.id}
          teamId={reschedulePractice.team_id}
          teamName={reschedulePractice.team?.name ?? "Team"}
          weekMonday={mondayOfWeek(reschedulePractice.scheduled_date)}
          weekLabel={weekLabel(mondayOfWeek(reschedulePractice.scheduled_date))}
          divisionId={reschedulePractice.division_id}
          leagueId={reschedulePractice.league_id}
          onClose={() => setReschedulePractice(null)}
          onScheduled={() => {
            setReschedulePractice(null);
            router.refresh();
          }}
        />
      )}

      {detailGame && (
        <GameDetailModal game={detailGame} onClose={() => setDetailGame(null)} />
      )}
    </div>
  );
}

// ── Pill button ───────────────────────────────────────────────────────────────

interface PillButtonProps {
  pill: Pill;
  muted: boolean;
  loading: boolean;
  size?: "sm" | "lg";
  onClick: (e: React.MouseEvent) => void;
}

function PillButton({ pill, muted, loading, size = "sm", onClick }: PillButtonProps) {
  const isCancelled = pill.data.status === "cancelled";
  const dim = muted || isCancelled;

  const colors =
    pill.kind === "game"
      ? dim
        ? "bg-gray-100 text-gray-400"
        : "bg-orange-100 text-orange-700 hover:bg-orange-200"
      : dim
      ? "bg-gray-100 text-gray-400"
      : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100";

  const label =
    pill.kind === "game"
      ? `${pill.data.home_team?.name ?? "TBD"} vs ${pill.data.away_team?.name ?? "TBD"}`
      : pill.data.team?.name ?? "Team";

  const timeStr = fmtGameTime(
    pill.kind === "game"
      ? pill.data.scheduled_at
      : `${pill.data.scheduled_date}T${pill.data.start_time}:00`,
  );

  const padding = size === "lg" ? "px-2.5 py-1.5" : "px-1.5 py-0.5";
  const fontSize = size === "lg" ? "text-xs" : "text-[11px]";

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex w-full items-center gap-1.5 truncate rounded text-left font-medium transition-colors disabled:opacity-50 ${colors} ${padding} ${fontSize} ${
        isCancelled ? "line-through" : ""
      }`}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
      ) : (
        <span className="tabular-nums">{timeStr}</span>
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

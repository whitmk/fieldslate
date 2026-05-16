"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CloudRain,
  CalendarClock,
  Eye,
  MapPin,
  Clock,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { logActivity } from "@/lib/activity-log";
import { RainoutRescheduleModal } from "@/components/divisions/rainout-reschedule-modal";
import { GameDetailModal } from "@/components/umpires/game-detail-modal";
import type { ScheduleGame } from "./schedule-list";

interface Props {
  games: ScheduleGame[];
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_PER_DAY = 3;

// Render a matchup line that handles interleague away ("AT [Org] (Wildcats)")
// and pending placeholders ("vs TBD — [Org]") consistently with the list view.
function pillMatchupLabel(g: ScheduleGame): string {
  const home = g.home_team?.name ?? "TBD";
  if (g.away_team?.name) return `${home} vs ${g.away_team.name}`;
  if (g.interleague_org_id) {
    const orgName = g.interleague_org?.name ?? "Other org";
    const team = g.external_team_name?.trim();
    if (g.is_away) {
      return `${home} AT ${orgName}${team ? ` (${team})` : ""}`;
    }
    return `${home} vs ${team ? team : `TBD — ${orgName}`}`;
  }
  return `${home} vs TBD`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScheduleCalendar({ games, month, today }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<{
    pos: { x: number; y: number };
    pill: GamePill;
  } | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<ScheduleGame | null>(null);
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
  const pillsByDate = new Map<string, GamePill[]>();
  for (const g of games) {
    const date = g.scheduled_at.substring(0, 10);
    const time = g.scheduled_at.substring(11, 16);
    const pill: GamePill = { kind: "game", date, time, data: g };
    if (!pillsByDate.has(date)) pillsByDate.set(date, []);
    pillsByDate.get(date)!.push(pill);
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

  function openPopover(e: React.MouseEvent, pill: GamePill) {
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
        <div className="text-xs text-gray-500" />
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
                      key={`game-${pill.data.id}`}
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
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700">
                    Game
                  </span>
                  {pill.data.status === "cancelled" && (
                    <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-700">
                      Rained out
                    </span>
                  )}
                  {pill.data.status === "scheduled" && (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                      Scheduled
                    </span>
                  )}
                  {pill.data.status === "pending_interleague" && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                      Pending
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm font-semibold text-[#0C1F3F]">
                  {pillMatchupLabel(pill.data)}
                </p>
                <div className="mt-2 flex flex-col gap-1 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    {fmtGameDate(pill.data.scheduled_at)}
                    {", "}
                    {fmtGameTime(pill.data.scheduled_at)}
                  </span>
                  {pill.data.venue?.name ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      {pill.data.venue.name}
                    </span>
                  ) : pill.data.is_away && pill.data.interleague_org?.name ? (
                    <span className="inline-flex items-center gap-1.5 italic">
                      <MapPin className="h-3 w-3" />
                      TBD — {pill.data.interleague_org.name} venue
                    </span>
                  ) : null}
                </div>
              </div>
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
                      key={`detail-game-${pill.data.id}`}
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

      {rescheduleGame && rescheduleGame.away_team_id && (
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

      {detailGame && (
        <GameDetailModal game={detailGame} onClose={() => setDetailGame(null)} />
      )}
    </div>
  );
}

// ── Pill button ───────────────────────────────────────────────────────────────

interface PillButtonProps {
  pill: GamePill;
  muted: boolean;
  loading: boolean;
  size?: "sm" | "lg";
  onClick: (e: React.MouseEvent) => void;
}

function PillButton({ pill, muted, loading, size = "sm", onClick }: PillButtonProps) {
  const isCancelled = pill.data.status === "cancelled";
  const dim = muted || isCancelled;

  const colors = dim
    ? "bg-gray-100 text-gray-400"
    : "bg-orange-100 text-orange-700 hover:bg-orange-200";

  const label = pillMatchupLabel(pill.data);
  const timeStr = fmtGameTime(pill.data.scheduled_at);

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

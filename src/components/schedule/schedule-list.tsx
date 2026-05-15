"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  CloudRain,
  CalendarClock,
  Eye,
  XCircle,
  Loader2,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { RainoutRescheduleModal } from "@/components/divisions/rainout-reschedule-modal";
import { SchedulePracticeModal } from "@/components/divisions/schedule-practice-modal";
import { GameDetailModal } from "@/components/umpires/game-detail-modal";

export type ScheduleGameUmpire = {
  id: string;
  role: string;
  umpire: { id: string; name: string } | null;
};

export type ScheduleGame = {
  id: string;
  scheduled_at: string;
  status: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  home_team: {
    name: string;
    division_id: string | null;
    division: {
      name: string;
      umpires_per_game?: number | null;
      umpire_roles?: unknown;
    } | null;
  } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
  game_umpires?: ScheduleGameUmpire[];
};

export type SchedulePractice = {
  id: string;
  scheduled_date: string;
  start_time: string;
  status: string;
  league_id: string;
  division_id: string;
  team_id: string;
  team: { name: string } | null;
  division: { name: string } | null;
  venue: { name: string } | null;
};

type View = "games" | "practices" | "combined";

interface Props {
  view: View;
  games: ScheduleGame[];
  practices: SchedulePractice[];
}

const gameStatusVariants: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  scheduled: "success",
  in_progress: "info",
  completed: "default",
  // Cancelled games on FieldSlate are always rainouts (the only way to cancel
  // a game through the UI), so amber + a "Rained out" label.
  cancelled: "warning",
  postponed: "default",
};

const practiceStatusVariants: Record<string, "default" | "success" | "danger"> = {
  scheduled: "success",
  cancelled: "danger",
};

function gameStatusLabel(status: string) {
  if (status === "cancelled") return "Rained out";
  return status.replace("_", " ");
}

type CombinedItem =
  | { kind: "game"; sortKey: string; data: ScheduleGame }
  | { kind: "practice"; sortKey: string; data: SchedulePractice };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function mondayOfWeek(dateStr: string): string {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const d = new Date(yr, mo - 1, dy);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function weekLabel(mondayStr: string): string {
  const [yr, mo, dy] = mondayStr.split("-").map(Number);
  return new Date(yr, mo - 1, dy, 12).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ScheduleList({ view, games, practices }: Props) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rainoutId, setRainoutId] = useState<string | null>(null);
  const [cancellingPracticeId, setCancellingPracticeId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<ScheduleGame | null>(null);
  const [reschedulePractice, setReschedulePractice] = useState<SchedulePractice | null>(null);
  const [detailGame, setDetailGame] = useState<ScheduleGame | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleRainout(game: ScheduleGame) {
    setRainoutId(game.id);
    setOpenMenuId(null);
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
    setRainoutId(null);
    router.refresh();
  }

  async function handleCancelPractice(practice: SchedulePractice) {
    setCancellingPracticeId(practice.id);
    setOpenMenuId(null);
    const supabase = createClient();
    await supabase
      .from("practices")
      .update({ status: "cancelled" } as never)
      .eq("id", practice.id);
    await logActivity(
      practice.league_id,
      practice.division_id,
      "practice_cancelled",
      `${practice.team?.name ?? "Team"} practice on ${fmtGameDate(practice.scheduled_date)} cancelled`,
    );
    setCancellingPracticeId(null);
    router.refresh();
  }

  const isEmpty =
    view === "games"
      ? games.length === 0
      : view === "practices"
      ? practices.length === 0
      : games.length === 0 && practices.length === 0;

  if (isEmpty) {
    const msg =
      view === "games"
        ? "No games found."
        : view === "practices"
        ? "No practices found."
        : "No games or practices found.";
    return <p className="text-sm text-gray-500">{msg}</p>;
  }

  // ─── Combined view ───────────────────────────────────────────────────────────

  if (view === "combined") {
    const items: CombinedItem[] = [
      ...games.map((g): CombinedItem => ({
        kind: "game",
        sortKey: g.scheduled_at.substring(0, 16),
        data: g,
      })),
      ...practices.map((p): CombinedItem => ({
        kind: "practice",
        sortKey: `${p.scheduled_date}T${p.start_time}`,
        data: p,
      })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return (
      <div ref={tableRef} className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="pb-3 font-medium text-gray-500">Date & Time</th>
              <th className="pb-3 font-medium text-gray-500">Type</th>
              <th className="pb-3 font-medium text-gray-500">Matchup / Team</th>
              <th className="pb-3 font-medium text-gray-500">Division</th>
              <th className="pb-3 font-medium text-gray-500">Venue</th>
              <th className="pb-3 font-medium text-gray-500">Umpires</th>
              <th className="pb-3 font-medium text-gray-500">Status</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              if (item.kind === "game") {
                const g = item.data;
                return (
                  <GameRowCells
                    key={`g-${g.id}`}
                    game={g}
                    isMenuOpen={openMenuId === `g-${g.id}`}
                    onMenuToggle={() =>
                      setOpenMenuId(openMenuId === `g-${g.id}` ? null : `g-${g.id}`)
                    }
                    onRainout={() => handleRainout(g)}
                    onReschedule={() => {
                      setOpenMenuId(null);
                      setRescheduleGame(g);
                    }}
                    onViewDetails={() => {
                      setOpenMenuId(null);
                      setDetailGame(g);
                    }}
                    rainoutLoading={rainoutId === g.id}
                    showType
                  />
                );
              }
              const p = item.data;
              return (
                <PracticeRowCells
                  key={`p-${p.id}`}
                  practice={p}
                  isMenuOpen={openMenuId === `p-${p.id}`}
                  onMenuToggle={() =>
                    setOpenMenuId(openMenuId === `p-${p.id}` ? null : `p-${p.id}`)
                  }
                  onCancel={() => handleCancelPractice(p)}
                  onReschedule={() => {
                    setOpenMenuId(null);
                    setReschedulePractice(p);
                  }}
                  cancelLoading={cancellingPracticeId === p.id}
                  showType
                />
              );
            })}
          </tbody>
        </table>

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

  // ─── Games-only view ─────────────────────────────────────────────────────────

  if (view === "games") {
    return (
      <div ref={tableRef} className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="pb-3 font-medium text-gray-500">Date & Time</th>
              <th className="pb-3 font-medium text-gray-500">Matchup</th>
              <th className="pb-3 font-medium text-gray-500">Division</th>
              <th className="pb-3 font-medium text-gray-500">Venue</th>
              <th className="pb-3 font-medium text-gray-500">Umpires</th>
              <th className="pb-3 font-medium text-gray-500">Status</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <GameRowCells
                key={g.id}
                game={g}
                isMenuOpen={openMenuId === g.id}
                onMenuToggle={() => setOpenMenuId(openMenuId === g.id ? null : g.id)}
                onRainout={() => handleRainout(g)}
                onReschedule={() => {
                  setOpenMenuId(null);
                  setRescheduleGame(g);
                }}
                onViewDetails={() => {
                  setOpenMenuId(null);
                  setDetailGame(g);
                }}
                rainoutLoading={rainoutId === g.id}
              />
            ))}
          </tbody>
        </table>

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

        {detailGame && (
          <GameDetailModal game={detailGame} onClose={() => setDetailGame(null)} />
        )}
      </div>
    );
  }

  // ─── Practices-only view ─────────────────────────────────────────────────────

  return (
    <div ref={tableRef} className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left">
            <th className="pb-3 font-medium text-gray-500">Date & Time</th>
            <th className="pb-3 font-medium text-gray-500">Team</th>
            <th className="pb-3 font-medium text-gray-500">Division</th>
            <th className="pb-3 font-medium text-gray-500">Venue</th>
            <th className="pb-3 font-medium text-gray-500">Status</th>
            <th className="pb-3" />
          </tr>
        </thead>
        <tbody>
          {practices.map((p) => (
            <PracticeRowCells
              key={p.id}
              practice={p}
              isMenuOpen={openMenuId === p.id}
              onMenuToggle={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
              onCancel={() => handleCancelPractice(p)}
              onReschedule={() => {
                setOpenMenuId(null);
                setReschedulePractice(p);
              }}
              cancelLoading={cancellingPracticeId === p.id}
            />
          ))}
        </tbody>
      </table>

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
    </div>
  );
}

// ─── Row helpers ─────────────────────────────────────────────────────────────

interface GameRowProps {
  game: ScheduleGame;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onRainout: () => void;
  onReschedule: () => void;
  onViewDetails: () => void;
  rainoutLoading: boolean;
  showType?: boolean;
}

function GameRowCells({
  game,
  isMenuOpen,
  onMenuToggle,
  onRainout,
  onReschedule,
  onViewDetails,
  rainoutLoading,
  showType,
}: GameRowProps) {
  const umpiresPerGame = Number(game.home_team?.division?.umpires_per_game ?? 0);
  const umpireRoles: string[] = Array.isArray(game.home_team?.division?.umpire_roles)
    ? (game.home_team!.division!.umpire_roles as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];
  while (umpireRoles.length < umpiresPerGame) {
    umpireRoles.push(`Umpire ${umpireRoles.length + 1}`);
  }
  const assignmentsByRole = new Map<string, string>();
  for (const a of game.game_umpires ?? []) {
    if (a.umpire) assignmentsByRole.set(a.role, a.umpire.name);
  }
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-3 text-gray-600">
        {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}
      </td>
      {showType && (
        <td className="py-3">
          <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-700">
            Game
          </span>
        </td>
      )}
      <td className="py-3 font-medium text-gray-900">
        {game.home_team?.name ?? "TBD"} vs {game.away_team?.name ?? "TBD"}
      </td>
      <td className="py-3 text-gray-600">{game.home_team?.division?.name ?? "—"}</td>
      <td className="py-3 text-gray-600">{game.venue?.name ?? "—"}</td>
      <td className="py-3">
        {umpiresPerGame === 0 ? (
          <span className="text-xs text-gray-300">—</span>
        ) : (
          <button
            onClick={onViewDetails}
            className="flex flex-wrap gap-1 text-left"
            title="Manage umpire assignments"
          >
            {umpireRoles.map((role) => {
              const name = assignmentsByRole.get(role);
              return (
                <span
                  key={role}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    name
                      ? "bg-indigo-50 text-indigo-700"
                      : "border border-dashed border-amber-300 text-amber-600"
                  }`}
                >
                  <UserCheck className="h-2.5 w-2.5" />
                  {role}: {name ?? "Open"}
                </span>
              );
            })}
          </button>
        )}
      </td>
      <td className="py-3">
        <Badge variant={gameStatusVariants[game.status] ?? "default"}>
          {gameStatusLabel(game.status)}
        </Badge>
      </td>
      <td className="relative py-3 text-right">
        <button
          onClick={onMenuToggle}
          disabled={rainoutLoading}
          aria-label="Game actions"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500 disabled:opacity-50"
        >
          {rainoutLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </button>
        {isMenuOpen && (
          <div className="absolute right-0 top-9 z-30 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-lg">
            <button
              onClick={onRainout}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <CloudRain className="h-3.5 w-3.5 text-blue-400" />
              Mark as rained out
            </button>
            <button
              onClick={onReschedule}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <CalendarClock className="h-3.5 w-3.5 text-[#22C55E]" />
              Reschedule
            </button>
            <button
              onClick={onViewDetails}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Eye className="h-3.5 w-3.5 text-gray-400" />
              View details
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

interface PracticeRowProps {
  practice: SchedulePractice;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onCancel: () => void;
  onReschedule: () => void;
  cancelLoading: boolean;
  showType?: boolean;
}

function PracticeRowCells({
  practice,
  isMenuOpen,
  onMenuToggle,
  onCancel,
  onReschedule,
  cancelLoading,
  showType,
}: PracticeRowProps) {
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-3 text-gray-600">
        {fmtGameDate(practice.scheduled_date)},{" "}
        {fmtGameTime(`${practice.scheduled_date}T${practice.start_time}:00`)}
      </td>
      {showType && (
        <td className="py-3">
          <span className="inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-500">
            Practice
          </span>
        </td>
      )}
      <td className="py-3 font-medium text-gray-900">{practice.team?.name ?? "TBD"}</td>
      <td className="py-3 text-gray-600">{practice.division?.name ?? "—"}</td>
      <td className="py-3 text-gray-600">{practice.venue?.name ?? "—"}</td>
      {showType && <td className="py-3 text-xs text-gray-300">—</td>}
      <td className="py-3">
        <Badge variant={practiceStatusVariants[practice.status] ?? "default"}>
          {practice.status}
        </Badge>
      </td>
      <td className="relative py-3 text-right">
        <button
          onClick={onMenuToggle}
          disabled={cancelLoading}
          aria-label="Practice actions"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500 disabled:opacity-50"
        >
          {cancelLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </button>
        {isMenuOpen && (
          <div className="absolute right-0 top-9 z-30 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-lg">
            <button
              onClick={onCancel}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <XCircle className="h-3.5 w-3.5 text-red-400" />
              Cancel practice
            </button>
            <button
              onClick={onReschedule}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <CalendarClock className="h-3.5 w-3.5 text-[#22C55E]" />
              Reschedule practice
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

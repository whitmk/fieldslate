"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  CloudRain,
  CalendarClock,
  Eye,
  Loader2,
  UserCheck,
  Repeat,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { padRoleLabels } from "@/lib/utils/official-title";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { RainoutRescheduleModal } from "@/components/divisions/rainout-reschedule-modal";
import { RescheduleRequestModal } from "@/components/interleague/reschedule-request-modal";
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
  away_team_id: string | null;
  interleague_org_id?: string | null;
  is_away?: boolean | null;
  external_team_name?: string | null;
  proposed_venue_name?: string | null;
  home_team: {
    name: string;
    division_id: string | null;
    division: {
      name: string;
      umpires_per_game?: number | null;
    } | null;
  } | null;
  away_team: { name: string } | null;
  interleague_org?: { name: string } | null;
  venue: { name: string } | null;
  game_umpires?: ScheduleGameUmpire[];
};

interface Props {
  games: ScheduleGame[];
  /** Pro+ only — the rainout auto-reschedule action. "Mark as rained out"
   *  and the interleague "Request reschedule" stay Free. */
  canReschedule?: boolean;
  /** Season official_roles names (ordered by sort_order) + the season sport.
   *  The row builds slot labels from these via padRoleLabels so they match the
   *  game_umpires.role text the assign path writes (the modal uses the same
   *  recipe). Sourcing labels from divisions.umpire_roles made assigned slots
   *  read "Open" whenever the two label sets diverged. */
  seasonRoleNames: string[];
  sport: string | null;
}

const gameStatusVariants: Record<string, "default" | "success" | "warning" | "danger" | "info" | "orange"> = {
  scheduled: "success",
  in_progress: "info",
  completed: "default",
  // Cancelled games on FieldSlate are always rainouts (the only way to cancel
  // a game through the UI), so amber + a "Rained out" label.
  cancelled: "warning",
  postponed: "default",
  pending_interleague: "warning",
  reschedule_pending: "orange",
};

function gameStatusLabel(status: string) {
  if (status === "cancelled") return "Rained out";
  if (status === "pending_interleague") return "Pending";
  if (status === "reschedule_pending") return "Reschedule pending";
  return status.replace("_", " ");
}

/**
 * Opponent label for the Matchup cell. Interleague games may have:
 *  - is_away=true  → we're playing AT [Org]; opponent line reads "AT [Org]"
 *  - is_away=false → we host; opponent is the external team name once accepted,
 *    else "TBD — [Org]"
 * Intra-division games use the real away team name.
 */
function matchupLabel(g: ScheduleGame): string {
  const home = g.home_team?.name ?? "TBD";
  if (g.interleague_org_id) {
    const orgName = g.interleague_org?.name ?? "Other org";
    const opp = g.external_team_name?.trim() || `TBD — ${orgName}`;
    if (g.is_away) {
      return `${home} AT ${orgName}${g.external_team_name ? ` (${g.external_team_name})` : ""}`;
    }
    return `${home} vs ${opp}`;
  }
  return `${home} vs ${g.away_team?.name ?? "TBD"}`;
}

function venueLabel(g: ScheduleGame): string {
  if (g.venue?.name) return g.venue.name;
  if (g.is_away && g.proposed_venue_name) return g.proposed_venue_name;
  if (g.is_away && g.interleague_org?.name) return `TBD — ${g.interleague_org.name} venue`;
  return "—";
}

export function ScheduleList({
  games,
  canReschedule = false,
  seasonRoleNames,
  sport,
}: Props) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rainoutId, setRainoutId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<ScheduleGame | null>(null);
  const [detailGame, setDetailGame] = useState<ScheduleGame | null>(null);
  const [requestRescheduleGame, setRequestRescheduleGame] = useState<ScheduleGame | null>(null);
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
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

  async function submitRescheduleRequest(payload: {
    scheduled_at: string;
    venue_name?: string;
    note?: string;
  }) {
    if (!requestRescheduleGame) return;
    setRescheduleError(null);
    setRescheduleSubmitting(true);
    try {
      const res = await fetch(
        `/api/interleague/games/${encodeURIComponent(requestRescheduleGame.id)}/reschedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setRescheduleError(data.error ?? "Failed to send request.");
        setRescheduleSubmitting(false);
        return;
      }
      setRequestRescheduleGame(null);
      setRescheduleSubmitting(false);
      router.refresh();
    } catch (err) {
      setRescheduleError(
        err instanceof Error ? err.message : "Network error.",
      );
      setRescheduleSubmitting(false);
    }
  }

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

  if (games.length === 0) {
    return <p className="text-sm text-gray-500">No games found.</p>;
  }

  return (
    <div ref={tableRef} className="overflow-x-auto">
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-gray-100 text-left">
            <th className="pb-3 font-medium text-gray-500">Date & Time</th>
            <th className="pb-3 font-medium text-gray-500">Matchup</th>
            <th className="pb-3 font-medium text-gray-500">Division</th>
            <th className="pb-3 font-medium text-gray-500">Venue</th>
            <th className="pb-3 font-medium text-gray-500">Officials</th>
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
              onRequestReschedule={() => {
                setOpenMenuId(null);
                setRescheduleError(null);
                setRequestRescheduleGame(g);
              }}
              canReschedule={canReschedule}
              onViewDetails={() => {
                setOpenMenuId(null);
                setDetailGame(g);
              }}
              rainoutLoading={rainoutId === g.id}
              seasonRoleNames={seasonRoleNames}
              sport={sport}
            />
          ))}
        </tbody>
      </table>

      {/* Mobile card list — same games and the same handlers as the table
          rows (modals are rendered once below, shared by both views). */}
      <ul className="flex flex-col gap-3 md:hidden">
        {games.map((g) => (
          <GameCard
            key={g.id}
            game={g}
            onRainout={() => handleRainout(g)}
            onAddOfficial={() => setDetailGame(g)}
            rainoutLoading={rainoutId === g.id}
          />
        ))}
      </ul>

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

      {requestRescheduleGame && (
        <RescheduleRequestModal
          game={{
            scheduled_at: requestRescheduleGame.scheduled_at,
            is_away: !!requestRescheduleGame.is_away,
            external_team_name: requestRescheduleGame.external_team_name ?? null,
            proposed_venue_name: requestRescheduleGame.proposed_venue_name ?? null,
            home_team: requestRescheduleGame.home_team
              ? { name: requestRescheduleGame.home_team.name }
              : null,
            venue: requestRescheduleGame.venue ?? null,
            interleague_org: requestRescheduleGame.interleague_org ?? null,
          }}
          busy={rescheduleSubmitting}
          error={rescheduleError}
          onSubmit={submitRescheduleRequest}
          onClose={() => setRequestRescheduleGame(null)}
        />
      )}
    </div>
  );
}

// Statuses where marking a rainout makes no sense — the game is already
// rained out or already played. The button stays visible but disabled.
const RAINOUT_BLOCKED_STATUSES = new Set(["cancelled", "completed"]);

interface GameCardProps {
  game: ScheduleGame;
  onRainout: () => void;
  onAddOfficial: () => void;
  rainoutLoading: boolean;
}

function GameCard({ game, onRainout, onAddOfficial, rainoutLoading }: GameCardProps) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-gray-600">
            {fmtGameDate(game.scheduled_at)} · {fmtGameTime(game.scheduled_at)}
          </p>
          <p className="mt-1 font-semibold text-gray-900">{matchupLabel(game)}</p>
          <p className="mt-1 text-sm text-gray-600">
            {venueLabel(game)} · {game.home_team?.division?.name ?? "—"}
          </p>
        </div>
        <Badge
          variant={gameStatusVariants[game.status] ?? "default"}
          className="flex-shrink-0"
        >
          {gameStatusLabel(game.status)}
        </Badge>
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          variant="secondary"
          className="h-11 flex-1 whitespace-nowrap px-2"
          disabled={RAINOUT_BLOCKED_STATUSES.has(game.status)}
          isLoading={rainoutLoading}
          onClick={onRainout}
        >
          {!rainoutLoading && <CloudRain className="mr-2 h-4 w-4 text-blue-400" />}
          Rainout
        </Button>
        <Button
          variant="secondary"
          className="h-11 flex-1 whitespace-nowrap px-2"
          onClick={onAddOfficial}
        >
          <UserCheck className="mr-2 h-4 w-4 text-[#22C55E]" />
          Add Official
        </Button>
      </div>
    </li>
  );
}

interface GameRowProps {
  game: ScheduleGame;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onRainout: () => void;
  onReschedule: () => void;
  onRequestReschedule: () => void;
  canReschedule: boolean;
  onViewDetails: () => void;
  rainoutLoading: boolean;
  seasonRoleNames: string[];
  sport: string | null;
}

function GameRowCells({
  game,
  isMenuOpen,
  onMenuToggle,
  onRainout,
  onReschedule,
  onRequestReschedule,
  canReschedule,
  onViewDetails,
  rainoutLoading,
  seasonRoleNames,
  sport,
}: GameRowProps) {
  const canRequestReschedule =
    !!game.interleague_org_id &&
    game.status === "scheduled" &&
    new Date(game.scheduled_at).getTime() > Date.now();
  const umpiresPerGame = Number(game.home_team?.division?.umpires_per_game ?? 0);
  // Build slot labels from the season's official_roles (padded sport-aware) —
  // the exact recipe the modal/assign path uses to write game_umpires.role.
  // Keying off divisions.umpire_roles instead made assigned slots read "Open".
  const umpireRoles = padRoleLabels(
    seasonRoleNames.slice(0, umpiresPerGame),
    umpiresPerGame,
    sport,
  );
  const assignmentsByRole = new Map<string, string>();
  for (const a of game.game_umpires ?? []) {
    if (a.umpire) assignmentsByRole.set(a.role, a.umpire.name);
  }
  // Surface any assignment whose role falls outside the computed list (legacy
  // free-text rows) so an existing assignment is never hidden — mirrors
  // UmpireSlots' effectiveRoles.
  const effectiveRoles = [...umpireRoles];
  for (const a of game.game_umpires ?? []) {
    if (a.umpire && !effectiveRoles.includes(a.role)) effectiveRoles.push(a.role);
  }
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-3 text-gray-600">
        {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}
      </td>
      <td className="py-3 font-medium text-gray-900">{matchupLabel(game)}</td>
      <td className="py-3 text-gray-600">{game.home_team?.division?.name ?? "—"}</td>
      <td className="py-3 text-gray-600">{venueLabel(game)}</td>
      <td className="py-3">
        {umpiresPerGame === 0 ? (
          <span className="text-xs text-gray-300">—</span>
        ) : (
          <button
            onClick={onViewDetails}
            className="flex flex-wrap gap-1 text-left"
            title="Manage official assignments"
          >
            {effectiveRoles.map((role) => {
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
            {canRequestReschedule ? (
              <button
                onClick={onRequestReschedule}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Repeat className="h-3.5 w-3.5 text-[#22C55E]" />
                Request reschedule
              </button>
            ) : canReschedule ? (
              <button
                onClick={onReschedule}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <CalendarClock className="h-3.5 w-3.5 text-[#22C55E]" />
                Reschedule
              </button>
            ) : null}
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

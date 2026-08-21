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
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { padRoleLabels } from "@/lib/utils/official-title";
import { createClient } from "@/lib/supabase/client";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";
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
  /** `location` is OPTIONAL and NULLABLE, both deliberately. Optional so any
   *  caller that does not select it still type-checks; nullable because only
   *  one org has adopted locations (21 of 30 live venues have `location_id`
   *  null), and an `!inner` join on locations would empty the result for
   *  everyone else. Display surfaces keep rendering the bare `venue.name` — the
   *  qualified "Complex — Field" label is for CHOOSERS, not for reading a
   *  schedule. */
  venue: { name: string; location?: { name: string } | null } | null;
  game_umpires?: ScheduleGameUmpire[];
  /** The two fields below are OPTIONAL and exist for the week-by-field view
   *  mode. List, calendar and the print region never read them, so a caller
   *  that omits them behaves exactly as before.
   *
   *  `games.venue_id` — the row key for a field-centric grid. `venue.name`
   *  alone cannot key rows: two venues may share a name. Null on interleague
   *  away games, which is every null-venue row in production. */
  venue_id?: string | null;
  /** This game's own division `game_duration`, in minutes. Resolved on the
   *  server from the Schedule page's divisions read, which selects the single
   *  projected key `game_duration:settings->game_duration` — never a
   *  `division:divisions(settings)` embed on the games query, because
   *  `settings` also carries the whole teams[] array with coach metadata. See
   *  `src/lib/schedule/division-durations.ts`.
   *
   *  UNDEFINED MEANS UNRESOLVED, NOT ZERO. It is absent when the division has
   *  no usable duration and when the home team has no division. Never coerce it
   *  with `?? 0` — a zero-length span silently matches nothing, which is how a
   *  confident wrong answer gets rendered. Decide on an explicit default or an
   *  honest "not set" state. */
  durationMin?: number;
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
  /** Server-resolved /setup link gate (Chunk 4): own-org owner mid-setup
   *  AND the season has zero games unfiltered — the server checks the total
   *  count, so this is never true while filters are merely hiding games. */
  showSetupLink?: boolean;
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
  showSetupLink,
}: Props) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rainoutId, setRainoutId] = useState<string | null>(null);
  const [rescheduleGame, setRescheduleGame] = useState<ScheduleGame | null>(null);
  const [detailGame, setDetailGame] = useState<ScheduleGame | null>(null);
  const [requestRescheduleGame, setRequestRescheduleGame] = useState<ScheduleGame | null>(null);
  // Delete — the game queued for the confirm dialog. Deletion goes through the
  // delete_game_if_unblocked RPC (0079), which is the guard: it re-checks the
  // block conditions (accepted interleague, recorded result) server-side,
  // atomically with the delete. A returned { blocked } means it refused and
  // nothing was deleted. The dialog owns the RPC call and busy/error/blocked
  // state, mirroring the venue delete dialog.
  const [deleteGame, setDeleteGame] = useState<ScheduleGame | null>(null);
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
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-gray-500">No games found.</p>
        {showSetupLink && <FinishSetupLink />}
      </div>
    );
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
              onDelete={() => {
                setOpenMenuId(null);
                setDeleteGame(g);
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

      {deleteGame && (
        <DeleteGameDialog
          game={deleteGame}
          onClose={() => setDeleteGame(null)}
          onDeleted={async () => {
            await logActivity(
              deleteGame.league_id,
              deleteGame.home_team?.division_id ?? null,
              "game_deleted",
              `${matchupLabel(deleteGame)} on ${fmtGameDate(deleteGame.scheduled_at)} deleted`,
            );
            setDeleteGame(null);
            router.refresh();
          }}
        />
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
  onDelete: () => void;
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
  onDelete,
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
            {/* Always enabled — click-then-block. The RPC decides; blocked
                games get the explanation dialog, not a disabled item. */}
            <button
              onClick={onDelete}
              className="flex w-full items-center gap-2.5 border-t border-gray-100 px-3.5 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete game
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Delete dialog ────────────────────────────────────────────────────────────

// Block reasons returned by delete_game_if_unblocked (0079, extended 0083).
// Strings mirror the RPC's jsonb exactly. All THREE are checked server-side;
// a blocked response lists every reason that applies.
type DeleteGameBlockReason =
  | "interleague_accepted"
  | "result_recorded"
  | "division_locked";

type DeleteGameRpcResult =
  | {
      deleted: true;
      cascaded: {
        umpire_assignments: number;
        override_history: number;
        reschedule_requests: number;
      };
    }
  | { blocked: true; reasons: DeleteGameBlockReason[] };

function describeBlockReason(
  reason: DeleteGameBlockReason,
  game: ScheduleGame,
): string {
  if (reason === "interleague_accepted") {
    const org = game.interleague_org?.name ?? "a partner league";
    return `It's a confirmed interleague game with ${org}. The partner league sees this game on their own schedule, and deleting it would remove it from their view without any notice. Cancel or reschedule it through the interleague flow instead.`;
  }
  if (reason === "division_locked") {
    const div = game.home_team?.division?.name ?? "This game's division";
    return `${div} is locked. Unlock it on the division's schedule panel to delete games. Rainouts and reschedules still work while it's locked.`;
  }
  return "It has a recorded result, so it's part of the season's history.";
}

function DeleteGameDialog({
  game,
  onClose,
  onDeleted,
}: {
  game: ScheduleGame;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<DeleteGameBlockReason[] | null>(null);

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // The RPC is the guard — it re-checks both block conditions server-side,
    // atomically with the delete. A returned { blocked } means it refused;
    // nothing was deleted.
    const { data, error: rpcErr } = await supabase.rpc(
      "delete_game_if_unblocked" as never,
      { p_game_id: game.id } as never,
    );
    if (rpcErr) {
      setError(rpcErr.message ?? "Could not delete this game.");
      setBusy(false);
      return;
    }
    const result = data as unknown as DeleteGameRpcResult;
    if ("blocked" in result) {
      setBlocked(result.reasons);
      setBusy(false);
      return;
    }
    await onDeleted();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
          <Trash2 className="h-4 w-4 text-red-500" />
          <h2 className="text-base font-semibold text-[#0C1F3F]">Delete game</h2>
        </div>
        <div className="flex flex-col gap-3 px-6 py-4">
          {blocked ? (
            <>
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{matchupLabel(game)}</span>{" "}
                can&rsquo;t be deleted:
              </p>
              <ul className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {blocked.map((r) => (
                  <li key={r} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-amber-500"
                    />
                    <span>{describeBlockReason(r, game)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-gray-700">
              Delete{" "}
              <span className="font-semibold">{matchupLabel(game)}</span> —{" "}
              {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}?
              This can&rsquo;t be undone. Any official assignments and conflict
              history for this game will be removed with it.
            </p>
          )}
          {error && (
            <p className="rounded-md border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
          {blocked ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
            >
              Got it
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Delete game
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

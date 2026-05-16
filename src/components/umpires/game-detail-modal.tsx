"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Calendar, MapPin, UserCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import {
  UmpireSlots,
  type SlotAssignment,
  type UmpireOption,
} from "./umpire-slots";

export type GameDetailGame = {
  id: string;
  scheduled_at: string;
  status: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_team: {
    name: string;
    division_id: string | null;
  } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

interface Props {
  game: GameDetailGame;
  onClose: () => void;
}

type Loaded = {
  divisionId: string | null;
  divisionName: string | null;
  umpiresPerGame: number;
  roles: string[];
  durationMinutes: number;
  assignments: SlotAssignment[];
  umpires: UmpireOption[];
};

const gameStatusVariants: Record<
  string,
  "default" | "success" | "warning" | "danger" | "info"
> = {
  scheduled: "success",
  in_progress: "info",
  completed: "default",
  cancelled: "warning",
  postponed: "default",
};

function gameStatusLabel(status: string) {
  if (status === "cancelled") return "Rained out";
  return status.replace("_", " ");
}

export function GameDetailModal({ game, onClose }: Props) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // Division (umpire requirements + duration)
      type DivisionRow = {
        id: string;
        name: string;
        umpires_per_game: number;
        umpire_roles: unknown;
        settings: unknown;
      };
      let division: DivisionRow | null = null;
      if (game.home_team?.division_id) {
        const { data: divRaw } = await supabase
          .from("divisions")
          .select("id, name, umpires_per_game, umpire_roles, settings")
          .eq("id", game.home_team.division_id)
          .single();
        division = (divRaw as unknown as DivisionRow | null) ?? null;
      }

      // Assignments for this game
      type AssignRow = {
        id: string;
        role: string;
        umpire: { id: string; name: string } | null;
      };
      const { data: assignsRaw } = await supabase
        .from("game_umpires")
        .select("id, role, umpire:umpires(id, name)")
        .eq("game_id", game.id);
      const assignments = ((assignsRaw as unknown as AssignRow[] | null) ?? [])
        .filter((r) => r.umpire)
        .map<SlotAssignment>((r) => ({
          id: r.id,
          umpire_id: r.umpire!.id,
          umpire_name: r.umpire!.name,
          role: r.role,
        }));

      // Umpire roster for the season
      const { data: umpiresRaw, error: umpiresErr } = await supabase
        .from("umpires")
        .select("id, name")
        .eq("season_id", game.league_id)
        .order("name");
      if (umpiresErr) {
        if (!cancelled) setError(umpiresErr.message);
      }
      const umpires = (umpiresRaw ?? []) as UmpireOption[];

      const roles = Array.isArray(division?.umpire_roles)
        ? (division!.umpire_roles as unknown[]).filter(
            (r): r is string => typeof r === "string",
          )
        : [];
      while (roles.length < (division?.umpires_per_game ?? 0)) {
        roles.push(`Umpire ${roles.length + 1}`);
      }

      const settings = (division?.settings ?? {}) as { game_duration?: number };
      const durationMinutes =
        typeof settings.game_duration === "number" ? settings.game_duration : 90;

      if (!cancelled) {
        setLoaded({
          divisionId: division?.id ?? null,
          divisionName: division?.name ?? null,
          umpiresPerGame: division?.umpires_per_game ?? 0,
          roles,
          durationMinutes,
          assignments,
          umpires,
        });
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [game.id, game.home_team?.division_id, game.league_id]);

  // Refresh when the modal data may have changed beneath us (e.g., another tab).
  // Children call router.refresh() after writes, but the modal itself is local
  // state — re-fetch on every router refresh by re-running the load effect.
  useEffect(() => {
    // no-op; the load effect already depends on stable props.
  }, [router]);

  const unfilledCount = loaded
    ? Math.max(0, loaded.umpiresPerGame - loaded.assignments.length)
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Game
            </p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-[#0C1F3F]">
              {game.home_team?.name ?? "TBD"} vs {game.away_team?.name ?? "TBD"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-2 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-gray-300" />
              <span>
                {fmtGameDate(game.scheduled_at)} · {fmtGameTime(game.scheduled_at)}
              </span>
            </div>
            {game.venue?.name && (
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-gray-300" />
                <span>{game.venue.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Badge variant={gameStatusVariants[game.status] ?? "default"}>
                {gameStatusLabel(game.status)}
              </Badge>
              {loaded?.divisionName && (
                <span className="text-xs text-gray-400">
                  {loaded.divisionName}
                </span>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="mb-3 flex items-center gap-2">
              <UserCheck className="h-3.5 w-3.5 text-gray-400" />
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Umpires
              </p>
              {loaded && loaded.umpiresPerGame > 0 && (
                <span className="text-xs text-gray-400">
                  {loaded.assignments.length} / {loaded.umpiresPerGame} assigned
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              </div>
            ) : error ? (
              <p className="text-xs text-red-600">{error}</p>
            ) : !loaded || loaded.umpiresPerGame === 0 ? (
              <p className="text-xs text-gray-400">
                This division doesn&apos;t require umpires.
              </p>
            ) : loaded.umpires.length === 0 ? (
              <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
                <p className="text-xs text-amber-700">
                  No umpires on this season&apos;s roster yet.{" "}
                  <Link
                    href="/dashboard/umpires"
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    Add some on the Umpires tab
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <>
                <UmpireSlots
                  game={{
                    id: game.id,
                    scheduled_at: game.scheduled_at,
                    duration_minutes: loaded.durationMinutes,
                    home_team_name: game.home_team?.name ?? "TBD",
                    away_team_name: game.away_team?.name ?? "TBD",
                  }}
                  roles={loaded.roles}
                  assignments={loaded.assignments}
                  umpires={loaded.umpires}
                />
                {unfilledCount > 0 && (
                  <p className="mt-3 text-[11px] text-amber-600">
                    {unfilledCount} role{unfilledCount !== 1 ? "s" : ""} still
                    unfilled.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

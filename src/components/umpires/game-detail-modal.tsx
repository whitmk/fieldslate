"use client";

import { useEffect, useState } from "react";
import { X, Calendar, MapPin, UserCheck, Loader2, History, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import {
  UmpireSlots,
  type SlotAssignment,
  type UmpireOption,
} from "./umpire-slots";
import {
  getOfficialTitlePlural,
  padRoleLabels,
} from "@/lib/utils/official-title";
import {
  CONFLICT_TYPE_LABELS,
  type ConflictType,
} from "@/lib/schedule/conflict-overrides";

export type GameDetailGame = {
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
  } | null;
  away_team: { name: string } | null;
  interleague_org?: { name: string } | null;
  venue: { name: string } | null;
};

function matchupLabel(g: GameDetailGame): string {
  const home = g.home_team?.name ?? "TBD";
  if (g.interleague_org_id) {
    const orgName = g.interleague_org?.name ?? "Other org";
    if (g.is_away) {
      return `${home} AT ${orgName}${g.external_team_name ? ` (${g.external_team_name})` : ""}`;
    }
    const opp = g.external_team_name?.trim() || `TBD — ${orgName}`;
    return `${home} vs ${opp}`;
  }
  return `${home} vs ${g.away_team?.name ?? "TBD"}`;
}

function venueLabel(g: GameDetailGame): string | null {
  if (g.venue?.name) return g.venue.name;
  if (g.is_away && g.proposed_venue_name) return g.proposed_venue_name;
  if (g.is_away && g.interleague_org?.name) return `TBD — ${g.interleague_org.name} venue`;
  return null;
}

interface Props {
  game: GameDetailGame;
  onClose: () => void;
}

type AssignRow = {
  id: string;
  role: string;
  umpire: { id: string; name: string } | null;
};

// Shared by the initial load and the post-save reload — the modal holds
// assignments in client state, so a write inside UmpireSlots must re-fetch
// here (router.refresh() only reaches server components).
async function fetchAssignments(
  supabase: ReturnType<typeof createClient>,
  gameId: string,
): Promise<SlotAssignment[]> {
  const { data } = await supabase
    .from("game_umpires")
    .select("id, role, umpire:umpires(id, name)")
    .eq("game_id", gameId);
  return ((data as unknown as AssignRow[] | null) ?? [])
    .filter((r) => r.umpire)
    .map<SlotAssignment>((r) => ({
      id: r.id,
      umpire_id: r.umpire!.id,
      umpire_name: r.umpire!.name,
      role: r.role,
    }));
}

type OverrideRow = {
  id: string;
  conflict_type: string;
  reason: string;
  created_at: string;
  profile: { full_name: string | null; email: string | null } | null;
};

type Loaded = {
  divisionId: string | null;
  divisionName: string | null;
  umpiresPerGame: number;
  roles: string[];
  durationMinutes: number;
  assignments: SlotAssignment[];
  umpires: UmpireOption[];
  sport: string | null;
  overrides: OverrideRow[];
};

// "Jun 10, 2026 · 8:42 AM"
function fmtOverrideTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

const gameStatusVariants: Record<
  string,
  "default" | "success" | "warning" | "danger" | "info" | "orange"
> = {
  scheduled: "success",
  in_progress: "info",
  completed: "default",
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

export function GameDetailModal({ game, onClose }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Post-save reload: pull the fresh assignment rows into local state so the
  // UmpireSlots selects reflect the write immediately.
  async function reloadAssignments() {
    const assignments = await fetchAssignments(createClient(), game.id);
    setLoaded((prev) => (prev ? { ...prev, assignments } : prev));
  }

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
        settings: unknown;
      };
      let division: DivisionRow | null = null;
      if (game.home_team?.division_id) {
        const { data: divRaw } = await supabase
          .from("divisions")
          .select("id, name, umpires_per_game, settings")
          .eq("id", game.home_team.division_id)
          .single();
        division = (divRaw as unknown as DivisionRow | null) ?? null;
      }

      // Assignments for this game
      const assignments = await fetchAssignments(supabase, game.id);

      // Umpire roster, league sport, the season's normalized role list, and
      // any conflict-override audit rows for this game (0064)
      const [
        { data: umpiresRaw, error: umpiresErr },
        { data: leagueRaw },
        { data: seasonRolesRaw },
        { data: overridesRaw },
      ] = await Promise.all([
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
          .eq("season_id", game.league_id)
          .order("name"),
        supabase
          .from("leagues")
          .select("sport")
          .eq("id", game.league_id)
          .single(),
        supabase
          .from("official_roles")
          .select("name")
          .eq("season_id", game.league_id)
          .order("sort_order"),
        supabase
          .from("conflict_overrides")
          .select("id, conflict_type, reason, created_at, profile:profiles(full_name, email)")
          .eq("game_id", game.id)
          .order("created_at", { ascending: true }),
      ]);
      if (umpiresErr) {
        if (!cancelled) setError(umpiresErr.message);
      }
      const umpires = (umpiresRaw ?? []) as UmpireOption[];
      const sport = (leagueRaw as { sport: string | null } | null)?.sport ?? null;

      // Slot labels: first umpires_per_game season roles by sort_order,
      // padded sport-aware. UmpireSlots appends any legacy assignment labels
      // that fall outside this list.
      const seasonRoleNames = ((seasonRolesRaw ?? []) as { name: string }[]).map(
        (r) => r.name,
      );
      const roles = padRoleLabels(
        seasonRoleNames.slice(0, division?.umpires_per_game ?? 0),
        division?.umpires_per_game ?? 0,
        sport,
      );

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
          sport,
          overrides: (overridesRaw as unknown as OverrideRow[] | null) ?? [],
        });
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [game.id, game.home_team?.division_id, game.league_id]);

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
              {matchupLabel(game)}
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
            {(() => {
              const venue = venueLabel(game);
              if (!venue) return null;
              const isPlaceholder = !game.venue?.name && !game.proposed_venue_name;
              return (
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-gray-300" />
                  <span className={isPlaceholder ? "italic text-gray-400" : ""}>
                    {venue}
                  </span>
                </div>
              );
            })()}
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
                {getOfficialTitlePlural(loaded?.sport)}
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
                This division doesn&apos;t require {getOfficialTitlePlural(loaded?.sport).toLowerCase()}.
              </p>
            ) : loaded.umpires.length === 0 ? (
              <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
                <p className="text-xs text-amber-700">
                  No {getOfficialTitlePlural(loaded.sport).toLowerCase()} on this season&apos;s roster yet.{" "}
                  <Link
                    href="/dashboard/umpires"
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    Add some on the Officials tab
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
                    home_team_id: game.home_team_id,
                    away_team_id: game.away_team_id,
                  }}
                  seasonId={game.league_id}
                  roles={loaded.roles}
                  assignments={loaded.assignments}
                  umpires={loaded.umpires}
                  onChanged={() => void reloadAssignments()}
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

          {/* Conflict history — admin overrides recorded when this game was
              saved past a detected conflict (0064). Hidden when empty. */}
          {loaded && loaded.overrides.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <div className="mb-3 flex items-center gap-2">
                <History className="h-3.5 w-3.5 text-gray-400" />
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Conflict history
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {loaded.overrides.map((o) => {
                  const adminName =
                    o.profile?.full_name?.trim() || o.profile?.email || "Admin";
                  return (
                    <div
                      key={o.id}
                      className="flex items-start gap-2 rounded-lg border border-[#EF9F27] bg-[#FAEEDA] px-3 py-2.5"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#EF9F27]" />
                      <div className="flex flex-col gap-0.5 text-xs text-[#633806]">
                        <p className="font-semibold">
                          {CONFLICT_TYPE_LABELS[o.conflict_type as ConflictType] ??
                            o.conflict_type}{" "}
                          override
                        </p>
                        <p className="italic">&ldquo;{o.reason}&rdquo;</p>
                        <p className="opacity-80">
                          {adminName} · {fmtOverrideTimestamp(o.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

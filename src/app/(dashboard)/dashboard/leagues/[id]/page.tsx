import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft, Users, CalendarDays, Layers, AlertTriangle, AlertCircle } from "lucide-react";
import type { League } from "@/types/database";
import { LeagueContent } from "@/components/dashboard/league-content";
import { BlackoutDatesPanel } from "@/components/blackout/blackout-dates-panel";
import { ActivityLogPanel } from "@/components/dashboard/activity-log-panel";
import { detectConflicts } from "@/lib/schedule/detect-conflicts";
import { RainedOutStatCard, type RainedOutGame } from "@/components/dashboard/rained-out-stat-card";

export type DivisionStat = {
  divisionId: string;
  gameCount: number;
  expectedGames: number;
  conflictCount: number;
  allTeamsAtMinimum: boolean;
};

export default async function LeaguePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rawLeague } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", params.id)
    .eq("owner_id", user!.id)
    .single();

  if (!rawLeague) notFound();
  const league = rawLeague as League;

  type TeamRow = { id: string; division_id: string | null };
  type GameRow = {
    id: string; scheduled_at: string; venue_id: string | null; home_team_id: string; away_team_id: string;
    status: string;
    venue: { name: string } | null;
    home_team: { name: string; division_id: string | null } | null;
    away_team: { name: string } | null;
  };
  type DivVenueRow = { division_id: string; venue_id: string };

  // Fetch everything in one parallel round-trip
  const [
    { data: allDivisionsRaw },
    { data: allTeamsRaw },
    { data: allGamesRaw },
    { data: allDivVenuesRaw },
  ] = await Promise.all([
    supabase.from("divisions").select("*").eq("league_id", league.id).order("created_at", { ascending: true }),
    supabase.from("teams").select("id, division_id").eq("league_id", league.id),
    supabase
      .from("games")
      .select(`id, scheduled_at, venue_id, home_team_id, away_team_id, status,
               venue:venues(name),
               home_team:teams!home_team_id(name, division_id),
               away_team:teams!away_team_id(name)`)
      .eq("league_id", league.id),
    supabase.from("division_venues").select("division_id, venue_id"),
  ]);

  const allDivisions = (allDivisionsRaw ?? []) as import("@/types/database").Division[];
  const allTeams = (allTeamsRaw ?? []) as TeamRow[];
  const allGames = (allGamesRaw ?? []) as unknown as GameRow[];
  const allDivVenues = (allDivVenuesRaw ?? []) as unknown as DivVenueRow[];

  // Build division → venue-id set
  const divToVenues = new Map<string, Set<string>>();
  for (const dv of allDivVenues) {
    if (!divToVenues.has(dv.division_id)) divToVenues.set(dv.division_id, new Set());
    divToVenues.get(dv.division_id)!.add(dv.venue_id);
  }

  // Per-division stats — conflict detection uses each division's own settings and venues,
  // matching exactly what ConflictResolverModal does client-side.
  const allConflictingGameIds = new Set<string>();

  const divisionStats: DivisionStat[] = allDivisions.map((div) => {
    const s = (div.settings ?? {}) as {
      games_per_team?: number;
      game_duration?: number;
      buffer_minutes?: number;
    };
    const gamesPerTeam = s.games_per_team ?? 0;
    const gameDuration = Number(s.game_duration ?? 0);
    const bufferMins = Number(s.buffer_minutes ?? 0);
    const expectedGames = Math.round((gamesPerTeam * div.team_count) / 2);

    const divTeamArr = allTeams.filter((t) => t.division_id === div.id).map((t) => t.id);
    const divTeamIds = new Set(divTeamArr);
    const divGames = allGames.filter((g) => divTeamIds.has(g.home_team_id));

    // Per-team game count (each team appears as home or away)
    const teamGameCount: Record<string, number> = {};
    divTeamArr.forEach((id) => { teamGameCount[id] = 0; });
    for (const g of divGames) {
      teamGameCount[g.home_team_id] = (teamGameCount[g.home_team_id] ?? 0) + 1;
      if (divTeamIds.has(g.away_team_id)) teamGameCount[g.away_team_id] = (teamGameCount[g.away_team_id] ?? 0) + 1;
    }
    const allTeamsAtMinimum =
      divTeamArr.length > 0 &&
      gamesPerTeam > 0 &&
      divTeamArr.every((id) => (teamGameCount[id] ?? 0) >= gamesPerTeam);

    // All games at this division's venues — includes cross-division games, same as the modal
    const divVenueIds = divToVenues.get(div.id) ?? new Set<string>();
    const venueGames = allGames.filter((g) => g.venue_id !== null && divVenueIds.has(g.venue_id!));

    // Detect conflicts with this division's actual game_duration + buffer_minutes
    const conflicts = detectConflicts(
      venueGames.map((g) => ({
        id: g.id,
        scheduled_at: g.scheduled_at,
        venue_id: g.venue_id,
        venue_name: g.venue?.name ?? "Unknown venue",
        home_team_name: g.home_team?.name ?? "TBD",
        away_team_name: g.away_team?.name ?? "TBD",
      })),
      gameDuration,
      bufferMins,
    );

    const conflictingAtVenues = new Set(conflicts.flatMap((c) => c.gameIds));

    // Only count games that belong to THIS division
    const divConflictCount = divGames.filter((g) => conflictingAtVenues.has(g.id)).length;
    divGames.filter((g) => conflictingAtVenues.has(g.id)).forEach((g) => allConflictingGameIds.add(g.id));

    return {
      divisionId: div.id,
      gameCount: divGames.length,
      expectedGames,
      conflictCount: divConflictCount,
      allTeamsAtMinimum,
    };
  });

  const divisionCount = allDivisions.length;
  const teamCount = allTeams.length;
  const gameCount = allGames.filter((g) => g.status !== "cancelled").length;
  const rainedOutGames = allGames.filter((g) => g.status === "cancelled") as unknown as RainedOutGame[];
  const rainedOutCount = rainedOutGames.length;
  const totalConflicts = allConflictingGameIds.size;

  const divisionNames: Record<string, string> = {};
  for (const d of allDivisions) divisionNames[d.id] = d.name;

  const sportColor: Record<string, string> = {
    Baseball: "bg-blue-50 text-blue-700",
    Soccer: "bg-emerald-50 text-emerald-700",
  };

  return (
    <div className="flex flex-col gap-6">

      {/* Back */}
      <Link
        href="/dashboard/leagues"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-[#0C1F3F]"
      >
        <ArrowLeft className="h-4 w-4" />
        All leagues
      </Link>

      {/* League header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[#0C1F3F]">{league.name}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${sportColor[league.sport] ?? "bg-gray-100 text-gray-600"}`}>
              {league.sport}
            </span>
          </div>
          <p className="text-sm text-gray-500">{league.season}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
          league.status === "active"
            ? "bg-[#22C55E]/10 text-[#22C55E]"
            : "bg-gray-100 text-gray-500"
        }`}>
          {league.status}
        </span>
      </div>

      {/* Conflict alert banner */}
      {totalConflicts > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-semibold text-red-700">
              Schedule conflict — {totalConflicts} game{totalConflicts !== 1 ? "s" : ""} double-booked
            </p>
            <p className="mt-0.5 text-xs text-red-600">
              Two or more games are assigned to the same field at overlapping times. Expand a division below to review and fix.
            </p>
          </div>
        </div>
      )}

      {/* Stats row — 5 cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "Divisions", value: divisionCount, icon: Layers },
          { label: "Teams", value: teamCount, icon: Users },
          { label: "Games", value: gameCount, icon: CalendarDays },
          { label: "Conflicts", value: totalConflicts, icon: AlertCircle, alert: totalConflicts > 0 },
        ].map(({ label, value, icon: Icon, alert }) => (
          <div
            key={label}
            className={`rounded-xl border bg-white p-5 shadow-sm ${alert ? "border-red-200" : "border-gray-100"}`}
          >
            <div className="flex items-center justify-between">
              <p className={`text-sm font-medium ${alert ? "text-red-500" : "text-gray-500"}`}>{label}</p>
              <Icon className={`h-4 w-4 ${alert ? "text-red-300" : "text-gray-300"}`} />
            </div>
            <p className={`mt-2 text-3xl font-bold ${alert ? "text-red-600" : "text-[#0C1F3F]"}`}>{value}</p>
          </div>
        ))}

        {/* Rained Out — interactive client card */}
        <RainedOutStatCard
          count={rainedOutCount}
          initialGames={rainedOutGames}
          leagueId={league.id}
          divisionNames={divisionNames}
        />
      </div>

      <BlackoutDatesPanel leagueId={league.id} />

      <ActivityLogPanel leagueId={league.id} />

      <LeagueContent
        leagueId={league.id}
        leagueName={league.name}
        leagueSport={league.sport}
        divisionStats={divisionStats}
      />

    </div>
  );
}

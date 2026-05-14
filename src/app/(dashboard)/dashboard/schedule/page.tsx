import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { DivisionFilter } from "@/components/schedule/division-filter";
import { ViewToggle } from "@/components/schedule/view-toggle";

type GameRow = {
  id: string;
  scheduled_at: string;
  status: string;
  home_team: { name: string; division: { name: string } | null } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

type PracticeRow = {
  id: string;
  scheduled_date: string;
  start_time: string;
  status: string;
  team: { name: string } | null;
  division: { name: string } | null;
  venue: { name: string } | null;
};

const gameStatusVariants: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  scheduled: "info",
  in_progress: "warning",
  completed: "success",
  cancelled: "danger",
  postponed: "default",
};

const practiceStatusVariants: Record<string, "default" | "success" | "danger"> = {
  scheduled: "success",
  cancelled: "danger",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { division?: string; view?: string };
}) {
  const supabase = createClient();
  const selectedDivisionId = searchParams.division ?? "";
  const view = searchParams.view === "practices" ? "practices" : "games";

  // Fetch all divisions for the filter dropdown
  const { data: divisionData } = await supabase
    .from("divisions")
    .select("id, name")
    .order("name");
  const divisions = (divisionData ?? []) as { id: string; name: string }[];

  // ── Games view ────────────────────────────────────────────────────────────────

  let games: GameRow[] = [];

  if (view === "games") {
    let teamIdFilter: string[] | null = null;
    if (selectedDivisionId) {
      const { data: teamData } = await supabase
        .from("teams")
        .select("id")
        .eq("division_id", selectedDivisionId);
      teamIdFilter = (teamData ?? []).map((t: { id: string }) => t.id);
    }

    let gamesQuery = supabase
      .from("games")
      .select(`
        id, scheduled_at, status,
        home_team:teams!home_team_id(name, division:divisions(name)),
        away_team:teams!away_team_id(name),
        venue:venues(name)
      `)
      .order("scheduled_at", { ascending: true })
      .limit(50);

    if (teamIdFilter !== null) {
      gamesQuery = teamIdFilter.length === 0
        ? gamesQuery.in("home_team_id", ["00000000-0000-0000-0000-000000000000"])
        : gamesQuery.in("home_team_id", teamIdFilter);
    }

    const { data: rawGames } = await gamesQuery;
    games = (rawGames as GameRow[] | null) ?? [];
  }

  // ── Practices view ────────────────────────────────────────────────────────────

  let practices: PracticeRow[] = [];

  if (view === "practices") {
    let practicesQuery = supabase
      .from("practices")
      .select(`
        id, scheduled_date, start_time, status,
        team:teams(name),
        division:divisions(name),
        venue:venues(name)
      `)
      .order("scheduled_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(50);

    if (selectedDivisionId) {
      practicesQuery = practicesQuery.eq("division_id", selectedDivisionId);
    }

    const { data: rawPractices } = await practicesQuery;
    practices = (rawPractices as unknown as PracticeRow[] | null) ?? [];
  }

  const isEmpty = view === "games" ? games.length === 0 : practices.length === 0;
  const emptyMessage = view === "games"
    ? (selectedDivisionId ? "No games found for this division." : "No games scheduled yet.")
    : (selectedDivisionId ? "No practices found for this division." : "No practices scheduled yet.");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
          <p className="mt-1 text-sm text-gray-500">All games across your leagues.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add game
        </Button>
      </div>

      {/* Segmented control */}
      <ViewToggle view={view} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{view === "games" ? "All Games" : "All Practices"}</CardTitle>
            {divisions.length > 0 && (
              <DivisionFilter divisions={divisions} selectedId={selectedDivisionId} />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isEmpty ? (
            <p className="text-sm text-gray-500">{emptyMessage}</p>
          ) : view === "games" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="pb-3 font-medium text-gray-500">Date & Time</th>
                    <th className="pb-3 font-medium text-gray-500">Matchup</th>
                    <th className="pb-3 font-medium text-gray-500">Division</th>
                    <th className="pb-3 font-medium text-gray-500">Venue</th>
                    <th className="pb-3 font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((game) => (
                    <tr key={game.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 text-gray-600">
                        {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}
                      </td>
                      <td className="py-3 font-medium text-gray-900">
                        {game.home_team?.name ?? "TBD"} vs {game.away_team?.name ?? "TBD"}
                      </td>
                      <td className="py-3 text-gray-600">
                        {game.home_team?.division?.name ?? "—"}
                      </td>
                      <td className="py-3 text-gray-600">
                        {game.venue?.name ?? "—"}
                      </td>
                      <td className="py-3">
                        <Badge variant={gameStatusVariants[game.status] ?? "default"}>
                          {game.status.replace("_", " ")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="pb-3 font-medium text-gray-500">Date & Time</th>
                    <th className="pb-3 font-medium text-gray-500">Team</th>
                    <th className="pb-3 font-medium text-gray-500">Division</th>
                    <th className="pb-3 font-medium text-gray-500">Venue</th>
                    <th className="pb-3 font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {practices.map((practice) => (
                    <tr key={practice.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 text-gray-600">
                        {fmtGameDate(practice.scheduled_date)},{" "}
                        {fmtGameTime(`${practice.scheduled_date}T${practice.start_time}:00`)}
                      </td>
                      <td className="py-3 font-medium text-gray-900">
                        {practice.team?.name ?? "TBD"}
                      </td>
                      <td className="py-3 text-gray-600">
                        {practice.division?.name ?? "—"}
                      </td>
                      <td className="py-3 text-gray-600">
                        {practice.venue?.name ?? "—"}
                      </td>
                      <td className="py-3">
                        <Badge variant={practiceStatusVariants[practice.status] ?? "default"}>
                          {practice.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

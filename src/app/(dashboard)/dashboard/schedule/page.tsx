import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { DivisionFilter } from "@/components/schedule/division-filter";

type GameRow = {
  id: string;
  scheduled_at: string;
  status: string;
  home_team: { name: string; division: { name: string } | null } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

const statusVariants: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  scheduled: "info",
  in_progress: "warning",
  completed: "success",
  cancelled: "danger",
  postponed: "default",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { division?: string };
}) {
  const supabase = createClient();
  const selectedDivisionId = searchParams.division ?? "";

  // Fetch all divisions for the filter dropdown
  const { data: divisionData } = await supabase
    .from("divisions")
    .select("id, name")
    .order("name");
  const divisions = (divisionData ?? []) as { id: string; name: string }[];

  // When filtering, first resolve the team IDs for the selected division
  let teamIdFilter: string[] | null = null;
  if (selectedDivisionId) {
    const { data: teamData } = await supabase
      .from("teams")
      .select("id")
      .eq("division_id", selectedDivisionId);
    teamIdFilter = (teamData ?? []).map((t: { id: string }) => t.id);
  }

  // Build games query — join division name through home_team
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
    if (teamIdFilter.length === 0) {
      // Division exists but has no teams — guarantee empty result
      gamesQuery = gamesQuery.in("home_team_id", ["00000000-0000-0000-0000-000000000000"]);
    } else {
      gamesQuery = gamesQuery.in("home_team_id", teamIdFilter);
    }
  }

  const { data: rawGames } = await gamesQuery;
  const games = rawGames as GameRow[] | null;

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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>All Games</CardTitle>
            {divisions.length > 0 && (
              <DivisionFilter divisions={divisions} selectedId={selectedDivisionId} />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!games || games.length === 0 ? (
            <p className="text-sm text-gray-500">
              {selectedDivisionId ? "No games found for this division." : "No games scheduled yet."}
            </p>
          ) : (
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
                        <Badge variant={statusVariants[game.status] ?? "default"}>
                          {game.status.replace("_", " ")}
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

import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { AddTeamButton } from "@/components/teams/add-team-button";
import { TeamSnackShackButton } from "@/components/teams/team-snack-shack-button";
import type { Team } from "@/types/database";

type TeamWithLeague = Team & {
  league: { name: string } | null;
  division: { name: string } | null;
};

export default async function TeamsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: rawTeams }, { data: rawLeagues }, { data: rawDivisions }] =
    await Promise.all([
      supabase
        .from("teams")
        .select("*, league:leagues(name), division:divisions(name)")
        .order("name", { ascending: true }),
      supabase
        .from("leagues")
        .select("id, name")
        .eq("owner_id", user!.id)
        .order("name", { ascending: true }),
      supabase
        .from("divisions")
        .select("id, name, league_id")
        .order("name", { ascending: true }),
    ]);

  const teams = (rawTeams as TeamWithLeague[] | null) ?? [];
  const leagues = (rawLeagues ?? []) as { id: string; name: string }[];
  const divisions =
    (rawDivisions as { id: string; name: string; league_id: string }[] | null) ??
    [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
          <p className="mt-1 text-sm text-gray-500">All teams across your seasons.</p>
        </div>
        <AddTeamButton leagues={leagues} divisions={divisions} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Teams</CardTitle>
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Users className="mb-3 h-8 w-8 text-gray-300" />
              <p className="font-medium text-gray-900">No teams yet</p>
              <p className="mt-1 text-sm text-gray-500">
                Add teams to your seasons to get started.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="pb-3 font-medium text-gray-500">Team</th>
                    <th className="pb-3 font-medium text-gray-500">Season</th>
                    <th className="pb-3 font-medium text-gray-500">Division</th>
                    <th className="pb-3 font-medium text-gray-500" />
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 font-medium text-gray-900">{team.name}</td>
                      <td className="py-3 text-gray-600">{team.league?.name ?? "—"}</td>
                      <td className="py-3 text-gray-600">{team.division?.name ?? "—"}</td>
                      <td className="py-2 text-right">
                        <TeamSnackShackButton teamId={team.id} teamName={team.name} />
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

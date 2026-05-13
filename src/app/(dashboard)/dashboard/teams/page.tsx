import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import type { Team } from "@/types/database";

type TeamWithLeague = Team & { league: { name: string } | null };

export default async function TeamsPage() {
  const supabase = createClient();

  const { data: rawTeams } = await supabase
    .from("teams")
    .select("*, league:leagues(name)")
    .order("name", { ascending: true });
  const teams = rawTeams as TeamWithLeague[] | null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
          <p className="mt-1 text-sm text-gray-500">All teams across your leagues.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add team
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Teams</CardTitle>
        </CardHeader>
        <CardContent>
          {!teams || teams.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Users className="mb-3 h-8 w-8 text-gray-300" />
              <p className="font-medium text-gray-900">No teams yet</p>
              <p className="mt-1 text-sm text-gray-500">Add teams to your leagues to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="pb-3 font-medium text-gray-500">Team</th>
                    <th className="pb-3 font-medium text-gray-500">League</th>
                    <th className="pb-3 font-medium text-gray-500">Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 font-medium text-gray-900">{team.name}</td>
                      <td className="py-3 text-gray-600">{team.league?.name ?? "—"}</td>
                      <td className="py-3 text-gray-600">{team.contact_email ?? "—"}</td>
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

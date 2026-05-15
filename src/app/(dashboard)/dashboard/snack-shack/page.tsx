export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingBag } from "lucide-react";
import { SnackShackPageClient } from "@/components/snack-shack/snack-shack-page-client";

type TeamRow = { id: string; name: string; league_id: string };

export default async function SnackShackPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Load all seasons owned by the user
  const { data: seasonsRaw } = await supabase
    .from("leagues")
    .select("id, name, season")
    .eq("owner_id", user!.id)
    .order("created_at", { ascending: false });

  const seasons = (seasonsRaw ?? []) as {
    id: string;
    name: string;
    season: string;
  }[];

  if (seasons.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Snack Shack</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage team coverage assignments for the snack shack.
          </p>
        </div>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center py-16 text-center">
              <ShoppingBag className="mb-3 h-10 w-10 text-gray-200" />
              <p className="font-medium text-gray-900">No seasons yet</p>
              <p className="mt-1 text-sm text-gray-400">
                Create a season first, then come back to set up the Snack Shack.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Load snack_shack_settings for each season
  const seasonIds = seasons.map((s) => s.id);
  const { data: settingsRaw } = await supabase
    .from("snack_shack_settings")
    .select("*")
    .in("season_id", seasonIds);

  const allSettings = (settingsRaw ?? []) as {
    id: string;
    season_id: string;
    start_date: string;
    end_date: string;
    days_of_week: unknown;
    time_blocks_by_day: unknown;
    home_venue_ids: unknown;
    scheduling_preference: string;
    updated_at: string;
  }[];

  // Load teams for all seasons
  const { data: teamsRaw } = await supabase
    .from("teams")
    .select("id, name, league_id")
    .in("league_id", seasonIds)
    .order("name", { ascending: true });
  const allTeams = (teamsRaw ?? []) as TeamRow[];

  // Load blocks for all settings IDs
  const settingIds = allSettings.map((s) => s.id);
  let allBlocks: {
    id: string;
    snack_shack_id: string;
    date: string;
    start_time: string;
    end_time: string;
    assigned_team_id: string | null;
    is_recurring: boolean;
    team: { name: string } | null;
  }[] = [];

  if (settingIds.length > 0) {
    const { data: blocksRaw } = await supabase
      .from("snack_shack_blocks")
      .select("id, snack_shack_id, date, start_time, end_time, assigned_team_id, is_recurring, team:teams(name)")
      .in("snack_shack_id", settingIds)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    allBlocks = (blocksRaw as unknown as typeof allBlocks) ?? [];
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Snack Shack</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage team coverage assignments for the snack shack.
        </p>
      </div>

      <SnackShackPageClient
        seasons={seasons}
        allSettings={allSettings}
        allTeams={allTeams}
        allBlocks={allBlocks}
      />
    </div>
  );
}

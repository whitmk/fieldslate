export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { ShoppingBag } from "lucide-react";
import { SnackShackPageClient } from "@/components/snack-shack/snack-shack-page-client";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isElite } from "@/lib/plan/limits";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";

type TeamRow = { id: string; name: string; league_id: string };

export default async function SnackShackPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Snack Shack is an Elite-only feature — guard the route server-side.
  const plan = await getOrgPlan(currentOrgId);
  if (!isElite(plan)) {
    return <FeatureLockedCard feature="Snack Shack" tier="Elite" />;
  }

  // Season-scoped (Chunk B2): only the topbar's selected season. The
  // `seasons` array keeps its shape (now 0 or 1 elements) so the client's
  // local season dropdown — which only renders for 2+ seasons — naturally
  // disappears and its seasons[0] default IS the selected season.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);

  const { data: seasonsRaw } = seasonId
    ? await supabase
        .from("leagues")
        .select("id, name, season")
        .eq("id", seasonId)
    : { data: [] };

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
              <p className="font-medium text-gray-900">No active season</p>
              <p className="mt-1 text-sm text-gray-400">
                Create a season first, then come back to set up the Snack Shack.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Load snack_shack_settings for the selected season
  const { data: settingsRaw } = await supabase
    .from("snack_shack_settings")
    .select("*")
    .eq("season_id", seasonId!);

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

  // Load teams for the selected season
  const { data: teamsRaw } = await supabase
    .from("teams")
    .select("id, name, league_id")
    .eq("league_id", seasonId!)
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
        currentOrgId={currentOrgId}
      />
    </div>
  );
}

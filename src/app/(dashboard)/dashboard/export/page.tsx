import { createClient } from "@/lib/supabase/server";
import { SportsConnectExporter, type LeagueOption } from "@/components/export/sportsconnect-exporter";
import type { League, Division } from "@/types/database";

export default async function ExportPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rawLeagues } = await supabase
    .from("leagues")
    .select("id, name, sport")
    .eq("owner_id", user!.id)
    .order("name", { ascending: true });

  const leagues = (rawLeagues ?? []) as Pick<League, "id" | "name" | "sport">[];
  const leagueIds = leagues.map((l) => l.id);

  const { data: rawDivisions } = leagueIds.length
    ? await supabase
        .from("divisions")
        .select("id, name, league_id")
        .in("league_id", leagueIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  type DivRow = Pick<Division, "id" | "name"> & { league_id: string };
  const divisions = (rawDivisions ?? []) as DivRow[];

  const leagueOptions: LeagueOption[] = leagues.map((league) => ({
    ...league,
    divisions: divisions
      .filter((d) => d.league_id === league.id)
      .map(({ id, name }) => ({ id, name })),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0C1F3F]">Export</h1>
        <p className="mt-1 text-sm text-gray-500">
          Download your schedule data for use in other platforms.
        </p>
      </div>

      <SportsConnectExporter leagues={leagueOptions} />
    </div>
  );
}

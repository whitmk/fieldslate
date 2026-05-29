import { createClient } from "@/lib/supabase/server";
import { SportsConnectExporter, type LeagueOption } from "@/components/export/sportsconnect-exporter";
import type { League, Division } from "@/types/database";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";

export default async function ExportPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // The /dashboard/export route IS the SportsConnect/BYGA exporter (a Pro+
  // feature, including its per-division picker). Guard server-side so Free
  // deep-links never receive the league/division data the client CSV needs —
  // the basic single-button export stays Free elsewhere (the league detail
  // page's Export PDF/CSV modal). Nav is also hidden for Free.
  const plan = await getOrgPlan(currentOrgId);
  if (plan === "free") {
    return <FeatureLockedCard feature="SportsConnect & BYGA export" />;
  }

  // Export intentionally spans active + archived — exporting past-season
  // rosters / schedules is a primary use case. Active seasons sort first,
  // archived rows get an "[Archived]" tag in the picker.
  const { data: rawLeagues } = await supabase
    .from("leagues")
    .select("id, name, sport, archived_at")
    .eq("owner_id", currentOrgId)
    .order("archived_at", { ascending: false, nullsFirst: true })
    .order("name", { ascending: true });

  type LeagueRow = Pick<League, "id" | "name" | "sport"> & {
    archived_at: string | null;
  };
  const leagues = (rawLeagues ?? []) as LeagueRow[];
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
    id: league.id,
    name: league.name,
    sport: league.sport,
    isArchived: !!league.archived_at,
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

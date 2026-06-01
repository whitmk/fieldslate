import { createClient } from "@/lib/supabase/server";
import { SeasonSelector, type SeasonOption } from "@/components/dashboard/season-selector";
import { OverviewReports } from "@/components/reports/overview-reports";
import { autoArchivePastSeasons } from "@/lib/seasons/auto-archive";
import { resolveSelectedSeasonId } from "@/lib/seasons/resolve-selected";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isElite } from "@/lib/plan/limits";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";

type OwnedLeague = {
  id: string;
  name: string;
  season: string | null;
  status: string;
  archived_at: string | null;
};

// Reports moved here from inline-on-Overview in Chunk 4. It reads the same
// `?season=` param the dashboard uses (via the route-agnostic SeasonSelector),
// so picking a season pushes to /dashboard/reports?season=…
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { season?: string; showArchived?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Reports is an Elite-only feature — guard before any data fetch.
  const plan = await getOrgPlan(currentOrgId);
  if (!isElite(plan)) {
    return <FeatureLockedCard feature="Reports" tier="Elite" />;
  }

  // Keep the season picker fresh (mirrors the Overview/Seasons pages).
  await autoArchivePastSeasons(supabase, currentOrgId);

  const { data: leaguesRaw } = await supabase
    .from("leagues")
    .select("id, name, season, status, archived_at")
    .eq("owner_id", currentOrgId)
    .order("created_at", { ascending: false });

  const ownedLeagues = (leaguesRaw ?? []) as OwnedLeague[];
  const showArchived = searchParams.showArchived === "1";
  const selected = resolveSelectedSeasonId(searchParams.season, ownedLeagues);
  const isAll = selected === "all";

  const seasonOptions: SeasonOption[] = ownedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    season: l.season,
    status: l.status,
    archivedAt: l.archived_at,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0C1F3F]">Reports</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Schedule completion, field utilization, and per-division progress.
        </p>
      </div>

      {ownedLeagues.length > 0 && (
        <SeasonSelector
          seasons={seasonOptions}
          selectedValue={selected}
          showArchived={showArchived}
        />
      )}

      <OverviewReports leagueId={isAll ? null : selected} />
    </div>
  );
}

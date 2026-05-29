import { createClient } from "@/lib/supabase/server";
import type { League } from "@/types/database";
import { SeasonsListClient } from "@/components/seasons/seasons-list-client";
import { autoArchivePastSeasons } from "@/lib/seasons/auto-archive";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { PLAN_LIMITS } from "@/lib/plan/limits";

// Always render fresh — the auto-archive UPDATE needs to run on every visit,
// and the season list reflects mutations from the archive/unarchive modals.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { tab?: string };
}

export default async function LeaguesPage({ searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Auto-archive (write-on-read): bump any past-end-date season into the
  // archived state before the SELECT below sees it. Shared helper so both
  // /dashboard and /dashboard/leagues stay in sync.
  await autoArchivePastSeasons(supabase, currentOrgId);

  const { data } = await supabase
    .from("leagues")
    .select("*")
    .eq("owner_id", currentOrgId)
    .order("archived_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });
  const leagues = (data as League[] | null) ?? [];

  const initialTab = searchParams.tab === "archived" ? "archived" : "active";

  const plan = await getOrgPlan(currentOrgId);
  const activeSeasonCount = leagues.filter((l) => !l.archived_at).length;
  const activeSeasonLimit = PLAN_LIMITS[plan].activeSeasons;

  return (
    <SeasonsListClient
      leagues={leagues}
      initialTab={initialTab}
      activeSeasonCount={activeSeasonCount}
      activeSeasonLimit={activeSeasonLimit}
      plan={plan}
    />
  );
}

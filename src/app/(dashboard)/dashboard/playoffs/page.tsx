import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isElite } from "@/lib/plan/limits";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { PlayoffsPageClient } from "@/components/playoffs/playoffs-page-client";

export default async function PlayoffsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Playoff brackets are Elite-only. Guard the route server-side (nav is also
  // hidden for non-Elite) so deep-links short-circuit before the client loads.
  const plan = await getOrgPlan(currentOrgId);
  if (!isElite(plan)) {
    return <FeatureLockedCard feature="Playoff brackets" tier="Elite" />;
  }

  // Season-scoped (Chunk B2): the selected season is resolved here and
  // threaded as a prop — the client no longer fetches leagues itself, so
  // there's one source of truth. Null (no active seasons) renders the
  // client's existing empty state.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);
  const { data: seasonRow } = seasonId
    ? await supabase
        .from("leagues")
        .select("id, name, sport")
        .eq("id", seasonId)
        .maybeSingle()
    : { data: null };
  const season =
    (seasonRow as { id: string; name: string; sport: string } | null) ?? null;

  return <PlayoffsPageClient currentOrgId={currentOrgId} season={season} />;
}

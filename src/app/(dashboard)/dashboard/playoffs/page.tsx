import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
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

  return <PlayoffsPageClient currentOrgId={currentOrgId} />;
}

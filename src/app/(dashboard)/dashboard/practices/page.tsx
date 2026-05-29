import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { PracticesPageClient } from "@/components/practices/practices-page-client";

// Server wrapper: resolve org context once and thread it as props so the
// client component doesn't have to re-derive currentOrgId on every fetch.
// Multi-org admins see only the selected org's divisions/teams/etc.

export default async function PracticesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Practices is a Pro+ module. Guard the route server-side so deep-links
  // (nav is also hidden for Free) short-circuit before any data fetch and
  // before the client that issues practice writes ever loads.
  const plan = await getOrgPlan(currentOrgId);
  if (plan === "free") {
    return <FeatureLockedCard feature="Practices" />;
  }

  // orgLeagueIds → drives the divisions/teams scope (both have league_id).
  const { data: orgLeagueRows } = await supabase
    .from("leagues")
    .select("id")
    .eq("owner_id", currentOrgId);
  const orgLeagueIds = ((orgLeagueRows ?? []) as { id: string }[]).map(
    (r) => r.id,
  );

  // orgDivisionIds → drives division_venues + practice_time_slots scope
  // (both are division-scoped with no league_id). Fetched server-side so
  // the client never has to ask twice.
  const { data: orgDivisionRows } = orgLeagueIds.length
    ? await supabase
        .from("divisions")
        .select("id")
        .in("league_id", orgLeagueIds)
    : { data: [] as { id: string }[] };
  const orgDivisionIds = ((orgDivisionRows ?? []) as { id: string }[]).map(
    (r) => r.id,
  );

  return (
    <PracticesPageClient
      orgLeagueIds={orgLeagueIds}
      orgDivisionIds={orgDivisionIds}
    />
  );
}

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { PracticesPageClient } from "@/components/practices/practices-page-client";

// Server wrapper: resolve org + season context once and thread them as
// props so the client component doesn't have to re-derive them on every
// fetch. Season-scoped (Chunk B2): the id lists are narrowed to the
// topbar's selected season — the client's internals are untouched, its
// inputs just got smaller. A null season (no active seasons) passes empty
// lists, which the client already renders as its empty state.

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

  // The selected season drives the divisions/teams scope (both have
  // league_id) — prop name stays plural for the client's sake.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);
  const orgLeagueIds = seasonId ? [seasonId] : [];

  // orgDivisionIds → drives division_venues + practice_time_slots scope
  // (both are division-scoped with no league_id). Fetched server-side so
  // the client never has to ask twice.
  const { data: orgDivisionRows } = seasonId
    ? await supabase
        .from("divisions")
        .select("id")
        .eq("league_id", seasonId)
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

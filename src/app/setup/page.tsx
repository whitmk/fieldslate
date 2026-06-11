// First-run setup wizard. Lives OUTSIDE the (dashboard) route group on
// purpose: that layout redirects fresh owners here, so sharing it would
// loop (and the wizard wants chrome-less framing anyway).
//
// Reachable directly even after dismissal — future empty-state links point
// here — so this page gates only on "is this the user's own org", never on
// setup_dismissed. The current step is derived from data state, not stored.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, listMemberships } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { deriveSetupStep } from "@/lib/setup/derive-step";
import { SetupShell } from "@/components/setup/setup-shell";

export default async function SetupPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Setup only configures the user's OWN org. An invited co-admin acting in
  // someone else's org has nothing to set up here.
  const memberships = await listMemberships(supabase, user.id);
  const currentOrgId = await getCurrentOrgId(supabase, user.id, memberships);
  if (currentOrgId !== user.id) {
    redirect("/dashboard");
  }

  const [{ count: venueCount }, seasonId, plan] = await Promise.all([
    supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", currentOrgId),
    // The selected season (cookie chain) — null iff zero active seasons.
    getCurrentSeasonId(supabase, currentOrgId),
    getOrgPlan(currentOrgId),
  ]);

  // Data-derived progress — the shared deriveSetupStep helper (extracted in
  // Chunk 4, logic unchanged): no venues → 1; no active season → 2; no
  // divisions → 3; any division with zero games → 4; all scheduled → 5
  // ("finished" — the generate component shows the done screen and the rail
  // marks step 4 done). venueCount is still fetched above for the shell's
  // step-1 gating prop; the helper re-counts internally (one cheap head
  // count) to stay context-free for its other callers.
  const initialStep = await deriveSetupStep(supabase, currentOrgId, seasonId);

  return (
    <SetupShell
      currentOrgId={currentOrgId}
      initialStep={initialStep}
      initialVenueCount={venueCount ?? 0}
      initialSeasonId={seasonId}
      plan={plan}
    />
  );
}

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
import { getActiveSeasonCount } from "@/lib/plan/counts";
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

  const [{ count: venueCount }, activeSeasonCount] = await Promise.all([
    supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", currentOrgId),
    getActiveSeasonCount(supabase, currentOrgId),
  ]);

  // Data-derived progress: no venues → step 1; venues but no active season →
  // step 2; both → step 3 (placeholder until the division-wizard chunk).
  const initialStep =
    (venueCount ?? 0) === 0 ? 1 : activeSeasonCount === 0 ? 2 : 3;

  return (
    <SetupShell
      currentOrgId={currentOrgId}
      initialStep={initialStep}
      initialVenueCount={venueCount ?? 0}
    />
  );
}

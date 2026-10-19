import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { loadNewSeasonState } from "@/lib/billing/new-season-state";
import { NewSeasonFlow } from "@/components/seasons/new-season-flow";

// Every "New season" button lands here (Overview, Seasons, the empty
// states, the invite page). The league's state decides the screen: create
// free, use a credit, or buy — see newSeasonScreen.
export default async function NewLeaguePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);
  const loaded = await loadNewSeasonState(supabase, currentOrgId);

  return (
    <NewSeasonFlow
      currentOrgId={currentOrgId}
      state={loaded.ok ? loaded.state : null}
      loadError={loaded.ok ? null : loaded.error}
    />
  );
}

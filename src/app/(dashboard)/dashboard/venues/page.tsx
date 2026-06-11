import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { isSetupIncomplete } from "@/lib/setup/derive-step";
import { VenuesPageClient } from "@/components/venues/venues-page-client";

export default async function VenuesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Empty-state /setup link gate (Chunk 4), resolved server-side and passed
  // down — the client owns its venue list (and emptiness), so the gate can't
  // be lazy here. The /setup embed of this client omits the prop.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);
  const showSetupLink =
    currentOrgId === user!.id &&
    (await isSetupIncomplete(supabase, currentOrgId, seasonId));

  return (
    <VenuesPageClient currentOrgId={currentOrgId} showSetupLink={showSetupLink} />
  );
}

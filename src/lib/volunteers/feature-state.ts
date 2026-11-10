// The one server read that says whether an org has the volunteer feature:
// `volunteer_admin_state` (0120). The switch is on for every league unless
// switched off (0127: no org_features row = on). A failed read or the switch
// off mean NULL — no Settings card, no sidebar item, the page 404s — so an
// error can't show a half-read screen.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cardDataFromAdminState, type VolunteerCardData } from "./settings-card";

export async function loadVolunteerFeature(
  supabase: SupabaseClient<Database>,
  orgId: string,
  where: string,
): Promise<VolunteerCardData | null> {
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in the hand-maintained types (0120)
    "volunteer_admin_state",
    { p_org_id: orgId },
  );
  if (error) {
    console.error(`[${where}] volunteer feature read failed:`, error.message);
    return null;
  }
  return cardDataFromAdminState(data);
}

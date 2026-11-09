// The one server read that says whether an org has the volunteer feature:
// `volunteer_admin_state` (0120). A failed read, a missing function or the
// switch off all mean NULL — no Settings card, no sidebar item, the page 404s.
// A real league never sees the feature, and an error can't reveal it.
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

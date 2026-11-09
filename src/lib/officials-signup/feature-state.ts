// The one server read that says whether an org has officials sign-up (0124):
// official_signup_admin_state. A failed read, a missing function (before
// 0124 is applied) or the switch off all mean NULL — no Settings card, no
// "Ask for help", no link button, no divisions control. A real league never
// sees the feature, and an error can't reveal it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type OfficialSignupState = { elite: boolean; enabled: boolean; contactEmail: string | null };

export function stateFromAdminReply(raw: unknown): OfficialSignupState | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || r.feature !== true) return null;
  return {
    elite: r.elite === true,
    enabled: r.enabled === true,
    contactEmail: typeof r.contact_email === "string" ? r.contact_email : null,
  };
}

export async function loadOfficialSignup(
  supabase: SupabaseClient<Database>,
  orgId: string,
  where: string,
): Promise<OfficialSignupState | null> {
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in the hand-maintained types (0124)
    "official_signup_admin_state",
    { p_org_id: orgId },
  );
  if (error) {
    console.error(`[${where}] officials sign-up read failed:`, error.message);
    return null;
  }
  return stateFromAdminReply(data);
}

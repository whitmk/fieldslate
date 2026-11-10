// The one server read that says whether an org has officials sign-up (0124):
// official_signup_admin_state. The switch is on for every league unless
// switched off (0127: no org_features row = on). A failed read or the switch
// off mean NULL — no Settings card, no "Ask for help", no link button, no
// divisions control — so an error can't show a half-read screen.
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

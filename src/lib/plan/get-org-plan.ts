import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isPlan, type Plan } from "./limits";

type ServerClient = SupabaseClient<Database>;

// Reads the plan from the owner's profile. Convention: org_id = owner's
// profile id. Defaults to 'free' on null/missing/unknown values so callers
// can rely on a Plan even if the DB row is in an unexpected state.
export async function getOrgPlan(
  supabase: ServerClient,
  orgId: string,
): Promise<Plan> {
  const { data } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", orgId)
    .single();

  const raw = (data as { plan: string } | null)?.plan;
  return isPlan(raw) ? raw : "free";
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { PLAN_LIMITS, isUnlimited, type Plan } from "./limits";
import { getOrgPlan } from "./get-org-plan";

type ServerClient = SupabaseClient<Database>;

type Cap = keyof typeof PLAN_LIMITS.free;

// Pure reporter — does not enforce. Returns the plan's limit for the
// given cap and whether the caller's currentCount is under it.
// Enforcement lives in RPCs (Chunk 2+).
export async function checkPlanCap(
  supabase: ServerClient,
  orgId: string,
  cap: Cap,
  currentCount: number,
): Promise<{ allowed: boolean; limit: number; plan: Plan }> {
  const plan = await getOrgPlan(supabase, orgId);
  const limit = PLAN_LIMITS[plan][cap];
  const allowed = isUnlimited(limit) || currentCount < limit;
  return { allowed, limit, plan };
}

import { PLAN_LIMITS, isUnlimited, type Plan } from "./limits";
import { getOrgPlan } from "./get-org-plan";

type Cap = keyof typeof PLAN_LIMITS.free;

// Pure reporter — does not enforce. Returns the plan's limit for the
// given cap and whether the caller's currentCount is under it.
// Enforcement lives in the create_* RPCs (migration 0055+).
export async function checkPlanCap(
  orgId: string,
  cap: Cap,
  currentCount: number,
): Promise<{ allowed: boolean; limit: number; plan: Plan }> {
  const plan = await getOrgPlan(orgId);
  const limit = PLAN_LIMITS[plan][cap];
  const allowed = isUnlimited(limit) || currentCount < limit;
  return { allowed, limit, plan };
}

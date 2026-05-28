// Tier-cap source of truth for the client. The DB enforces these values
// independently via public.org_member_cap() (migration 0052) — keep the two
// in sync if the limits change.

export type OrgPlan = "free" | "pro" | "elite";

export const ORG_PLAN_CAPS: Record<OrgPlan, number> = {
  free: 1,
  pro: 2,
  elite: 5,
};

export const ORG_PLAN_LABELS: Record<OrgPlan, string> = {
  free: "Free",
  pro: "Pro",
  elite: "Elite",
};

export function isOrgPlan(value: unknown): value is OrgPlan {
  return value === "free" || value === "pro" || value === "elite";
}

export function planCap(plan: OrgPlan): number {
  return ORG_PLAN_CAPS[plan];
}

export function planLabel(plan: OrgPlan): string {
  return ORG_PLAN_LABELS[plan];
}

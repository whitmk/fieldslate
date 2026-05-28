import type { Plan } from "./limits";

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  elite: "Elite",
};

export function planLabel(plan: Plan): string {
  return PLAN_LABELS[plan];
}

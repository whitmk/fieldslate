import Stripe from "stripe";
import type { Plan } from "@/lib/plan/limits";

// Per-season list price in whole USD. Single source of truth for the
// upgrade-modal math ($129/$249 per season, $258/$498 for two). The actual
// charge is driven by the Stripe Price IDs (env), NOT these numbers — these
// are display-only and must stay in sync with the Price objects in Stripe.
export const SEASON_PRICE_USD: Record<Exclude<Plan, "free">, number> = {
  pro: 129,
  elite: 249,
};

// Lazily construct the server-side Stripe client. Lazy (not module-scope) so
// the build doesn't evaluate `new Stripe()` with an empty key — in test mode
// the keys are blank placeholders, and Stripe's constructor throws on a falsy
// key. Handlers call this inside a try/catch.
let cached: Stripe | null = null;
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  if (!cached) {
    // apiVersion omitted → uses the SDK's pinned default, avoiding a literal
    // version string that drifts with SDK upgrades.
    cached = new Stripe(key);
  }
  return cached;
}

// Resolve the Stripe Price ID for a paid plan from env. Never hardcoded.
export function seasonPriceId(plan: Exclude<Plan, "free">): string {
  const id =
    plan === "pro"
      ? process.env.STRIPE_PRO_SEASON_PRICE_ID
      : process.env.STRIPE_ELITE_SEASON_PRICE_ID;
  if (!id) {
    throw new Error(`Stripe price ID for "${plan}" is not configured.`);
  }
  return id;
}

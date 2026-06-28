import Stripe from "stripe";
import type { Plan } from "@/lib/plan/limits";

// Per-season list price in whole USD, plus the one-time Pro→Elite upgrade
// delta. Single source of truth for the upgrade-modal math ($129/$249 per
// season; $120 to lift an existing Pro season to Elite). The actual charge is
// driven by the Stripe Price IDs (env), NOT these numbers — these are
// display-only and must stay in sync with the Price objects in Stripe.
export const SEASON_PRICE_USD: Record<
  Exclude<Plan, "free"> | "pro_to_elite",
  number
> = {
  pro: 129,
  elite: 249,
  // Elite − Pro difference, charged once when a Pro org upgrades a season.
  pro_to_elite: 120,
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
// When upgradeOnly is set, returns the one-time Pro→Elite upgrade price
// (the $120 difference) instead of a full Elite season.
export function seasonPriceId(
  plan: Exclude<Plan, "free">,
  upgradeOnly = false,
): string {
  if (upgradeOnly) {
    const upgradeId = process.env.STRIPE_ELITE_UPGRADE_FROM_PRO_PRICE_ID;
    if (!upgradeId) {
      throw new Error(
        "Stripe price ID for the Pro→Elite upgrade is not configured.",
      );
    }
    return upgradeId;
  }
  const id =
    plan === "pro"
      ? process.env.STRIPE_PRO_SEASON_PRICE_ID
      : process.env.STRIPE_ELITE_SEASON_PRICE_ID;
  if (!id) {
    throw new Error(`Stripe price ID for "${plan}" is not configured.`);
  }
  return id;
}

export type CheckoutParams = {
  plan: Exclude<Plan, "free">;
  // Always 1 — every purchase is a single season. A Free→paid feature upgrade
  // converts the org's current season in place; the add-season flow buys one
  // more. (The old quantity:2 "convert + also provision a second season" path
  // has been removed.) The webhook keys provisioning off wasPaid, not quantity.
  quantity: 1;
  upgradeOnly?: boolean;
  orgId: string;
  // Stripe requires ABSOLUTE URLs here — callers must pass fully-qualified URLs.
  successUrl: string;
  cancelUrl: string;
};

// Single source of truth for building a per-season Checkout session. Shared by
// the public /api/stripe/checkout route (client-driven purchases) and the
// post-verification /api/auth/callback redirect (server-driven onboarding), so
// the metadata the webhook depends on is constructed in exactly one place.
// Throws if Stripe isn't configured or returns no URL — callers handle it.
export async function createCheckoutSession(
  params: CheckoutParams,
): Promise<{ url: string }> {
  const { plan, quantity, upgradeOnly = false, orgId, successUrl, cancelUrl } =
    params;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    // Per-season purchase = one-time payment, not a subscription.
    mode: "payment",
    line_items: [{ price: seasonPriceId(plan, upgradeOnly), quantity }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // The webhook reads these to apply the plan + provision seasons.
    // Stripe metadata values must be strings.
    metadata: {
      orgId,
      plan,
      quantity: String(quantity),
      upgradeOnly: String(upgradeOnly),
    },
  });
  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  return { url: session.url };
}

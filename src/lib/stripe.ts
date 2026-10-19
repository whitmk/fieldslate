import Stripe from "stripe";
import type { Plan } from "@/lib/plan/limits";
import { expectedPriceCents, PRICE_CURRENCY, type PaidTier } from "@/lib/billing/prices";

// Prices live in ONE pure config (client components import it without the
// Stripe SDK). Re-exported here for existing server importers.
export { SEASON_PRICE_USD } from "@/lib/billing/prices";

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
// (the Pro → Elite difference) instead of a full Elite season.
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
  // The season_purchases row this checkout pays for (0111). The webhook hands
  // it to process_checkout_event, which decides everything from the row.
  purchaseId: string;
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
  // Optional Stripe coupon to AUTO-APPLY (e.g. the INTERLEAGUE promo,
  // resolved from the promo_codes table by src/lib/promo.ts). When set, passed
  // as discounts:[{ coupon }]. When absent, the session sets
  // allow_promotion_codes instead (Stripe's typed promo-code field) — Stripe
  // forbids sending both on one session, so it's strictly one or the other.
  couponId?: string;
};

// Single source of truth for building a per-season Checkout session. Shared by
// the public /api/stripe/checkout route (client-driven purchases) and the
// post-verification /api/auth/callback redirect (server-driven onboarding), so
// the metadata the webhook depends on is constructed in exactly one place.
// Throws if Stripe isn't configured or returns no URL — callers handle it.
export async function createCheckoutSession(
  params: CheckoutParams,
): Promise<{ url: string; id: string }> {
  const { plan, quantity, upgradeOnly = false, orgId, purchaseId, successUrl, cancelUrl, couponId } =
    params;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    // Per-season purchase = one-time payment, not a subscription.
    mode: "payment",
    line_items: [{ price: seasonPriceId(plan, upgradeOnly), quantity }],
    // Auto-apply a coupon when one was resolved (e.g. INTERLEAGUE); otherwise
    // enable Stripe's typed promo-code field. Never both — Stripe rejects a
    // session carrying discounts AND allow_promotion_codes.
    ...(couponId
      ? { discounts: [{ coupon: couponId }] }
      : { allow_promotion_codes: true }),
    success_url: successUrl,
    cancel_url: cancelUrl,
    // The webhook reads these to apply the plan + provision seasons.
    // Stripe metadata values must be strings.
    metadata: {
      orgId,
      plan,
      quantity: String(quantity),
      upgradeOnly: String(upgradeOnly),
      purchaseId,
    },
  });
  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  return { url: session.url, id: session.id };
}

// The live Stripe Price object behind a purchase must charge exactly what the
// screen showed (SEASON_PRICE_USD). Read before every checkout; a mismatch, a
// non-USD price, a recurring price or a failed read all return a reason and
// the caller opens NO session. Never charge an amount nobody was shown.
export async function verifySeasonPrice(
  tier: PaidTier,
  upgradeOnly: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const price = await getStripe().prices.retrieve(seasonPriceId(tier, upgradeOnly));
    const want = expectedPriceCents(tier, upgradeOnly);
    if (price.currency !== PRICE_CURRENCY) {
      return { ok: false, reason: `price currency is ${price.currency}, expected ${PRICE_CURRENCY}` };
    }
    if (price.type !== "one_time") {
      return { ok: false, reason: `price is ${price.type}, expected one_time` };
    }
    if (price.unit_amount !== want) {
      return { ok: false, reason: `price is ${price.unit_amount} cents, config says ${want}` };
    }
    if (!price.active) {
      return { ok: false, reason: "price is not active in Stripe" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "could not read the price" };
  }
}

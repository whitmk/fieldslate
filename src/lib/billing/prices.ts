// THE price config: every displayed price, and the amount the checkout route
// checks each live Stripe Price object against before it opens a session.
// Pure — no Stripe SDK, so client components import it freely.
//
// Never type a price into a component. A price that disagrees with Stripe
// makes the checkout route refuse (503, no session) rather than charge an
// amount the screen didn't show. sim:season-purchase greps for hand-typed
// prices.

export type PaidTier = "pro" | "elite";

// Per-season list price in whole USD, plus the one-time Pro→Elite upgrade.
export const SEASON_PRICE_USD: Record<PaidTier | "pro_to_elite", number> = {
  pro: 249,
  elite: 349,
  // Elite − Pro difference, charged once when a Pro league moves to Elite.
  pro_to_elite: 100,
};

export const PRICE_CURRENCY = "usd";

/** The amount Stripe must charge, in cents, for one purchase. */
export function expectedPriceCents(tier: PaidTier, upgradeOnly: boolean): number {
  return (upgradeOnly ? SEASON_PRICE_USD.pro_to_elite : SEASON_PRICE_USD[tier]) * 100;
}

/** "$249" — the one way a price is written on a screen. */
export function priceLabel(tier: PaidTier, upgradeOnly = false): string {
  return `$${upgradeOnly ? SEASON_PRICE_USD.pro_to_elite : SEASON_PRICE_USD[tier]}`;
}

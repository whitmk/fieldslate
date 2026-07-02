import { createAdminClient } from "@/lib/supabase/admin";

type PromoRow = {
  stripe_coupon_id: string;
  active: boolean;
  expires_at: string | null;
};

// Resolve a signup promo code (profiles.pending_promo) to a Stripe coupon id
// via the promo_codes table — the single source of truth for which codes are
// live and which coupon backs them (see migration 0072). Returns null for a
// missing, inactive, or expired code: a bad promo must NEVER block a checkout;
// callers proceed without the discount (the session then shows Stripe's typed
// promo-code field instead, via allow_promotion_codes).
//
// promo_codes.expires_at is kept ~5 days earlier than the Stripe coupon's
// redeem_by, so an expired-here code is refused before Stripe would reject the
// session outright.
//
// If the TABLE READ ERRORS (not "no row" — a real failure like a missing
// grant or an unreachable DB), fall back to the legacy
// STRIPE_INTERLEAGUE_COUPON_ID env var, but only for the INTERLEAGUE code —
// the one promo that predates the table. The fallback is deliberately kept so
// a promo_codes outage degrades to pre-table behavior instead of dropping the
// discount silently. Do not extend it to new codes; add rows instead.
export async function resolvePromoCoupon(
  code: string | null | undefined,
): Promise<string | null> {
  const normalized = code?.trim().toUpperCase() ?? "";
  if (!normalized) return null;

  let row: PromoRow | null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("promo_codes")
      .select("stripe_coupon_id, active, expires_at")
      .eq("code", normalized)
      .maybeSingle();
    if (error) throw error;
    row = data as PromoRow | null;
  } catch (err) {
    console.error("[promo] promo_codes read failed", { code: normalized, err });
    if (normalized === "INTERLEAGUE") {
      const fallback = process.env.STRIPE_INTERLEAGUE_COUPON_ID;
      if (fallback) {
        console.error(
          "[promo] falling back to STRIPE_INTERLEAGUE_COUPON_ID env var",
        );
        return fallback;
      }
    }
    return null;
  }

  if (!row) {
    console.log(`[promo] code not found: ${normalized}`);
    return null;
  }
  if (!row.active) {
    console.log(`[promo] code inactive: ${normalized}`);
    return null;
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    console.log(`[promo] code expired: ${normalized}`);
    return null;
  }
  return row.stripe_coupon_id;
}

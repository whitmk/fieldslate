import { NextResponse } from "next/server";
import { createCheckoutSession, type CheckoutParams } from "@/lib/stripe";
import { resolvePromoCoupon } from "@/lib/promo";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-only: creates a Stripe Checkout session for a per-season purchase.
// Uses STRIPE_SECRET_KEY via getStripe(). Price IDs come from env only.
export const runtime = "nodejs";

type Body = {
  plan?: unknown;
  quantity?: unknown;
  upgradeOnly?: unknown;
  orgId?: unknown;
  successUrl?: unknown;
  cancelUrl?: unknown;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const plan = body.plan;
  const quantity = body.quantity;
  // Pro→Elite tier upgrade: charge the one-time difference via a dedicated
  // Price, and signal the webhook to flip the tier without adding a season.
  const upgradeOnly = body.upgradeOnly === true;
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const successUrl = typeof body.successUrl === "string" ? body.successUrl : "";
  const cancelUrl = typeof body.cancelUrl === "string" ? body.cancelUrl : "";

  if (plan !== "pro" && plan !== "elite") {
    return NextResponse.json(
      { error: "plan must be 'pro' or 'elite'." },
      { status: 400 },
    );
  }
  // Feature upgrades and add-season purchases are always a single season.
  // The quantity:2 convert-and-also-provision path has been removed.
  if (quantity !== 1) {
    return NextResponse.json(
      { error: "quantity must be 1." },
      { status: 400 },
    );
  }
  if (upgradeOnly && plan !== "elite") {
    return NextResponse.json(
      { error: "upgradeOnly applies only to an Elite upgrade." },
      { status: 400 },
    );
  }
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }
  if (!successUrl || !cancelUrl) {
    return NextResponse.json(
      { error: "successUrl and cancelUrl are required." },
      { status: 400 },
    );
  }

  // Comp guard (Chunk B): a complimentary account must never reach Stripe —
  // this is what protects live smoke-testing through the team's own comped
  // accounts. Independent of plan: a "this row is never charged" marker, not a
  // tier check. FAIL CLOSED — the session is created ONLY on a confirmed
  // not-comped read; a comped read, a Supabase error, or a missing row all
  // refuse, so a transient DB failure can never let a comp through to Stripe.
  // pending_promo rides the same read: if the user signed up through a promo
  // link but their first checkout starts here (dashboard CTA retry) instead of
  // in /api/auth/callback, the discount must still apply. The webhook clears
  // pending_promo on the first successful checkout, so it can never ride a
  // second purchase.
  const admin = createAdminClient();
  const { data: orgProfile, error: compErr } = await admin
    .from("profiles")
    .select("comped, pending_promo")
    .eq("id", orgId)
    .maybeSingle();
  const profileRow = orgProfile as unknown as {
    comped: boolean;
    pending_promo: string | null;
  } | null;
  const comped = profileRow?.comped;
  if (comped === true) {
    return NextResponse.json(
      { error: "This account has complimentary access and cannot be charged." },
      { status: 403 },
    );
  }
  if (compErr || comped !== false) {
    // Could not confirm not-comped (read error or no matching row) — refuse
    // rather than risk charging a comp.
    // Diagnostic: surface the swallowed read result so the real cause of a
    // fail-closed 503 (errored read vs null/RLS-filtered row) is visible in
    // the runtime logs. Logging only — does not change guard behavior.
    console.error("[comp-guard]", { compErr, orgId, orgProfile });
    return NextResponse.json(
      { error: "Could not verify account billing status — please try again." },
      { status: 503 },
    );
  }

  // Resolve the signup promo (if still pending) to a Stripe coupon via the
  // promo_codes table. Null for unknown/inactive/expired codes — a bad promo
  // must never block a purchase; the session then carries the typed
  // promo-code field instead (allow_promotion_codes).
  const couponId =
    (await resolvePromoCoupon(profileRow?.pending_promo)) ?? undefined;

  try {
    const params: Omit<CheckoutParams, "couponId"> = {
      plan,
      quantity,
      upgradeOnly,
      orgId,
      successUrl,
      cancelUrl,
    };
    let url: string;
    try {
      ({ url } = await createCheckoutSession({ ...params, couponId }));
    } catch (couponErr) {
      // Mirror the auth-callback retry: a stale coupon must never 500 a
      // purchase — retry ONCE without it. Couponless failures go straight to
      // the outer catch; a retry would rebuild the identical session.
      if (!couponId) throw couponErr;
      console.error(
        "[stripe-checkout] coupon checkout failed — retrying without coupon",
        { err: couponErr, orgId, couponId },
      );
      ({ url } = await createCheckoutSession(params));
    }
    return NextResponse.json({ url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

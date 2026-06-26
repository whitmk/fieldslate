import { NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/stripe";
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
  if (quantity !== 1 && quantity !== 2) {
    return NextResponse.json(
      { error: "quantity must be 1 or 2." },
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
  const admin = createAdminClient();
  const { data: orgProfile, error: compErr } = await admin
    .from("profiles")
    .select("comped")
    .eq("id", orgId)
    .maybeSingle();
  const comped = (orgProfile as unknown as { comped: boolean } | null)?.comped;
  if (comped === true) {
    return NextResponse.json(
      { error: "This account has complimentary access and cannot be charged." },
      { status: 403 },
    );
  }
  if (compErr || comped !== false) {
    // Could not confirm not-comped (read error or no matching row) — refuse
    // rather than risk charging a comp.
    return NextResponse.json(
      { error: "Could not verify account billing status — please try again." },
      { status: 503 },
    );
  }

  try {
    const { url } = await createCheckoutSession({
      plan,
      quantity,
      upgradeOnly,
      orgId,
      successUrl,
      cancelUrl,
    });
    return NextResponse.json({ url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

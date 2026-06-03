import { NextResponse } from "next/server";
import { getStripe, seasonPriceId } from "@/lib/stripe";

// Server-only: creates a Stripe Checkout session for a per-season purchase.
// Uses STRIPE_SECRET_KEY via getStripe(). Price IDs come from env only.
export const runtime = "nodejs";

type Body = {
  plan?: unknown;
  quantity?: unknown;
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
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }
  if (!successUrl || !cancelUrl) {
    return NextResponse.json(
      { error: "successUrl and cancelUrl are required." },
      { status: 400 },
    );
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      // Per-season purchase = one-time payment, not a subscription.
      mode: "payment",
      line_items: [{ price: seasonPriceId(plan), quantity }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // The webhook reads these to apply the plan + provision seasons.
      // quantity is stringified because Stripe metadata values are strings.
      metadata: {
        orgId,
        plan,
        quantity: String(quantity),
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL." },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

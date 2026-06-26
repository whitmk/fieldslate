import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe webhook. MUST run on Node (Stripe SDK + raw-body crypto) and MUST
// read the unparsed request body for signature verification — in the App
// Router, `request.text()` returns the raw body (Next does not pre-parse it),
// so no extra bodyParser config is required.
export const runtime = "nodejs";

type CheckoutMeta = {
  orgId: string;
  plan: "pro" | "elite";
  quantity: number;
  upgradeOnly: boolean;
};

function readMeta(session: Stripe.Checkout.Session): CheckoutMeta | null {
  const orgId = session.metadata?.orgId;
  const plan = session.metadata?.plan;
  const quantity = Number(session.metadata?.quantity ?? "1");
  const upgradeOnly = session.metadata?.upgradeOnly === "true";
  if (!orgId || (plan !== "pro" && plan !== "elite")) return null;
  return { orgId, plan, quantity: quantity === 2 ? 2 : 1, upgradeOnly };
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not configured." },
      { status: 500 },
    );
  }
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 },
    );
  }

  // Raw body — required for signature verification.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Signature verification failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    // Acknowledge unhandled event types so Stripe doesn't retry them.
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const meta = readMeta(session);
  if (!meta) {
    return NextResponse.json(
      { error: "Missing or invalid session metadata (orgId/plan)." },
      { status: 400 },
    );
  }
  const { orgId, plan, quantity, upgradeOnly } = meta;

  try {
    const admin = createAdminClient();

    // All dedup + plan/season writes happen in ONE transaction inside the RPC
    // (Chunk A). It claims event.id in stripe_events (first writer wins) and
    // ONLY THEN reads the pre-update plan, applies the tier, and runs the same
    // branch logic this route used to do inline. A duplicate delivery conflicts
    // on the claim and returns 'skipped_duplicate' having touched nothing — so
    // retries can no longer double-provision a season, and wasPaid can no
    // longer be recomputed from already-mutated state.
    const { data: result, error: rpcErr } = await admin.rpc(
      "process_checkout_event" as never,
      {
        p_event_id: event.id,
        p_org_id: orgId,
        p_plan: plan,
        p_quantity: quantity,
        p_upgrade_only: upgradeOnly,
      } as never,
    );

    if (rpcErr) {
      // Transient failure: the transaction rolled back, so event.id was NOT
      // recorded. Return 500 so Stripe retries — the retry re-runs cleanly.
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    // 'processed' or 'skipped_duplicate' — both are success. Ack 200 so Stripe
    // stops retrying (a deduped duplicate must not look like a failure).
    return NextResponse.json({ received: true, result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Webhook handler failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { NEEDS_REVIEW_TO, reviewEmail } from "@/lib/billing/season-purchase";

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
  purchaseId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A purchaseId that is present but malformed must NOT fall into the legacy
// (no-purchase) path, which provisions on its own terms. The nil uuid matches
// no purchase, so process_checkout_event credits the payment and flags it.
const NO_SUCH_PURCHASE = "00000000-0000-0000-0000-000000000000";

function readMeta(session: Stripe.Checkout.Session): CheckoutMeta | null {
  const orgId = session.metadata?.orgId;
  const plan = session.metadata?.plan;
  const rawQty = Number(session.metadata?.quantity ?? "1");
  const upgradeOnly = session.metadata?.upgradeOnly === "true";
  const rawPurchase = session.metadata?.purchaseId;
  if (!orgId || (plan !== "pro" && plan !== "elite")) return null;
  return {
    orgId,
    plan,
    // Passed as sent: the purchase path flags anything but 1, and the legacy
    // path treats it as plan-only. Never mapped onto 2 (removed in 0069).
    quantity: Number.isInteger(rawQty) ? rawQty : 0,
    upgradeOnly,
    purchaseId:
      rawPurchase === undefined || rawPurchase === ""
        ? null
        : UUID_RE.test(rawPurchase)
          ? rawPurchase
          : NO_SUCH_PURCHASE,
  };
}

type RpcResult = {
  result?: string;
  outcome?: string | null;
  purchase_id?: string | null;
  kind?: string | null;
  needs_review?: boolean;
  review_reason?: string | null;
};

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
  const { orgId, plan, quantity, upgradeOnly, purchaseId } = meta;

  try {
    const admin = createAdminClient();

    // Comp guard (Chunk B): a manually-comped org must never be touched by the
    // billing path. A comped org should never have a live checkout, but if one
    // somehow fires, ack it (so Stripe stops retrying) and no-op — never call
    // the RPC, never overwrite the comp's plan, never provision a season. The
    // flag is independent of plan: a "never let billing touch this row" marker.
    const { data: orgProfile, error: compErr } = await admin
      .from("profiles")
      .select("comped, org_name, email")
      .eq("id", orgId)
      .maybeSingle();
    const profile = orgProfile as unknown as {
      comped: boolean;
      org_name: string | null;
      email: string | null;
    } | null;
    const comped = profile?.comped;
    if (comped === true) {
      console.log(
        `[stripe webhook] skipped checkout event ${event.id} for comped org ${orgId}`,
      );
      return NextResponse.json({ received: true, result: "skipped_comped" });
    }
    // FAIL CLOSED — mirror the checkout route: proceed ONLY on a confirmed
    // not-comped read. A read error or missing row leaves comp status unknown,
    // so refuse rather than fall through to the RPC and risk overwriting a
    // comp's plan / provisioning a season. Return 500 (not 200) so Stripe
    // RETRIES — the retry's read likely succeeds; a one-time read error must
    // never permanently skip a real paying customer.
    if (compErr || comped !== false) {
      console.error("[comp-guard webhook]", {
        compErr,
        orgId,
        eventId: event.id,
      });
      return NextResponse.json(
        { error: "Could not verify account billing status." },
        { status: 500 },
      );
    }

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
        p_purchase_id: purchaseId,
      } as never,
    );

    if (rpcErr) {
      // Transient failure: the transaction rolled back, so event.id was NOT
      // recorded. Return 500 so Stripe retries — the retry re-runs cleanly.
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    // A payment that did not do what was bought is flagged in the database
    // and emailed to FieldSlate at once. The event is already claimed, so a
    // failed send is LOGGED with everything in it, never retried by making
    // Stripe redeliver (a redelivery is skipped_duplicate and sends nothing);
    // the flagged row stays queryable (season_purchases.needs_review).
    const r = (result ?? {}) as RpcResult;
    if (r.needs_review) {
      const mail = reviewEmail({
        leagueName: profile?.org_name || profile?.email || orgId,
        orgId,
        kind: r.kind ?? "unknown",
        outcome: r.outcome ?? null,
        reason: r.review_reason ?? "unknown",
        amountCents: typeof session.amount_total === "number" ? session.amount_total : null,
        currency: session.currency ?? null,
        purchaseId: r.purchase_id ?? null,
        sessionId: session.id,
        eventId: event.id,
      });
      try {
        const sent = await sendEmail(NEEDS_REVIEW_TO, mail.subject, mail.html, mail.text);
        if (!sent.ok) {
          console.error("[stripe webhook] needs_review email NOT sent", { error: sent.error, ...mail });
        }
      } catch (err) {
        console.error("[stripe webhook] needs_review email threw", { err, ...mail });
      }
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

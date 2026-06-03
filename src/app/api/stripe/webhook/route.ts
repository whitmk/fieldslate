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
};

function readMeta(session: Stripe.Checkout.Session): CheckoutMeta | null {
  const orgId = session.metadata?.orgId;
  const plan = session.metadata?.plan;
  const quantity = Number(session.metadata?.quantity ?? "1");
  if (!orgId || (plan !== "pro" && plan !== "elite")) return null;
  return { orgId, plan, quantity: quantity === 2 ? 2 : 1 };
}

// Build a blank active-season row, seeding sport/season label from an existing
// season when available so the new row matches the org's setup.
function blankSeason(
  orgId: string,
  seed: { sport: string | null; season: string | null } | undefined,
) {
  return {
    owner_id: orgId,
    name: "New Season",
    sport: seed?.sport ?? "baseball",
    season: seed?.season ?? "",
    status: "active",
    archived_at: null,
  };
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
  const { orgId, plan, quantity } = meta;

  try {
    const admin = createAdminClient();

    // Capture the PRE-update plan: distinguishes a first upgrade (Free → paid)
    // from an existing paid org buying an extra season.
    const { data: profileRow } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", orgId)
      .single();
    const wasPaid =
      profileRow?.plan === "pro" || profileRow?.plan === "elite";

    // Apply the new plan tier to the org.
    const { error: planErr } = await admin
      .from("profiles")
      .update({ plan } as never)
      .eq("id", orgId);
    if (planErr) {
      return NextResponse.json({ error: planErr.message }, { status: 500 });
    }

    if (quantity === 2) {
      // First upgrade buying two seasons: the org's single existing (Free)
      // active season becomes the 1st paid season, and we add one more.
      const { data: existing } = await admin
        .from("leagues")
        .select("id, sport, season")
        .eq("owner_id", orgId)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(1);
      const seed = existing?.[0] as
        | { id: string; sport: string | null; season: string | null }
        | undefined;

      // "Convert" the existing season. Seasons carry no per-tier column — the
      // tier lives on profiles.plan (already updated above), so the conversion
      // is org-level; we touch updated_at to record the conversion moment.
      if (seed) {
        await admin
          .from("leagues")
          .update({ updated_at: new Date().toISOString() } as never)
          .eq("id", seed.id);
      }

      // Provision the second season.
      const { error: insErr } = await admin
        .from("leagues")
        .insert(blankSeason(orgId, seed) as never);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    } else if (quantity === 1 && wasPaid) {
      // Existing paid org adding one more season.
      const { data: existing } = await admin
        .from("leagues")
        .select("sport, season")
        .eq("owner_id", orgId)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(1);
      const seed = existing?.[0] as
        | { sport: string | null; season: string | null }
        | undefined;

      const { error: insErr } = await admin
        .from("leagues")
        .insert(blankSeason(orgId, seed) as never);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }
    // quantity === 1 && !wasPaid (Free → paid via the marketing/post-signup
    // path): the plan update alone converts the org's single existing season
    // into its paid season — no new season row needed.

    // TODO Item 13 (follow-up): make this idempotent (dedupe on event.id /
    // session.id) so a Stripe re-delivery can't create duplicate seasons.

    return NextResponse.json({ received: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Webhook handler failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

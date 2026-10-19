import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, listMemberships } from "@/lib/orgs/context";
import { SITE_URL } from "@/lib/site";
import type { Plan } from "@/lib/plan/limits";
import type { PaidTier } from "@/lib/billing/prices";
import {
  PURCHASE_KINDS,
  billingManagedText,
  upgradeKindFor,
  type PurchaseKind,
} from "@/lib/billing/season-purchase";
import { startPurchaseCheckout, type SeasonFields } from "@/lib/billing/start-checkout";

// Server-only: starts a Stripe Checkout for ONE season purchase (0111).
//
// WHO IS BUYING, FOR WHICH ORG, WHAT AND AT WHAT PRICE is decided here and in
// the database — never by the request body. The body names only the KIND of
// purchase (and, for a season, its name and dates; for a tier choice, the
// tier). begin_season_purchase decides whether that kind is allowed for the
// league's plan, comp flag and active seasons, and which tier it is; the
// route then checks the live Stripe price against the config before opening
// a session. Before 0111 the body's `plan` set the tier (a Pro league could
// buy an Elite season and get its existing season upgraded free).
// Harness: npm run sim:stripe-checkout-auth (+ :mutants).
export const runtime = "nodejs";

type Body = {
  kind?: unknown;
  tier?: unknown;
  season?: unknown;
  orgId?: unknown;
};

const SEASON_KINDS: readonly PurchaseKind[] = ["add_season", "first_season"];

function seasonFrom(raw: unknown): SeasonFields | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    name: str(r.name),
    sport: str(r.sport),
    seasonLabel: typeof r.seasonLabel === "string" && r.seasonLabel.trim() ? r.seasonLabel : null,
    startDate: str(r.startDate),
    endDate: str(r.endDate),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  // Signed in, or nothing — checked before the body is even read.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to start a checkout." }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requested = body.kind;
  if (requested !== "upgrade" && !PURCHASE_KINDS.includes(requested as PurchaseKind)) {
    return NextResponse.json(
      { error: "This page is out of date — refresh it and try again." },
      { status: 400 },
    );
  }
  const tier: PaidTier | null = body.tier === "pro" || body.tier === "elite" ? body.tier : null;
  const bodyOrgId = typeof body.orgId === "string" ? body.orgId : null;

  // The org being bought for: the one the caller is acting under, and only if
  // they are really a member. getCurrentOrgId falls back to the user's own id
  // when memberships can't be read — a fallback that must never reach Stripe.
  const memberships = await listMemberships(supabase, user.id);
  const orgId = await getCurrentOrgId(supabase, user.id, memberships);
  if (!memberships.some((m) => m.org_id === orgId)) {
    return NextResponse.json(
      { error: "We couldn't confirm your league membership — please sign in again." },
      { status: 403 },
    );
  }
  // The page names the org it showed; a switch in another tab must not put a
  // payment somewhere the buyer didn't see.
  if (bodyOrgId !== null && bodyOrgId !== orgId) {
    return NextResponse.json(
      { error: "You switched leagues since this page loaded — refresh and try again." },
      { status: 409 },
    );
  }

  // Comp guard: a complimentary league never reaches Stripe. FAIL CLOSED — a
  // session starts ONLY on a confirmed not-comped read. begin_season_purchase
  // refuses comped leagues too; this check keeps Stripe out even if it didn't.
  const admin = createAdminClient();
  const { data: orgProfile, error: compErr } = await admin
    .from("profiles")
    .select("comped, pending_promo, plan")
    .eq("id", orgId)
    .maybeSingle();
  const profileRow = orgProfile as unknown as {
    comped: boolean;
    pending_promo: string | null;
    plan: Plan;
  } | null;
  const comped = profileRow?.comped;
  if (comped === true) {
    return NextResponse.json(
      { error: billingManagedText(), code: "billing_managed" },
      { status: 403 },
    );
  }
  if (compErr || comped !== false || !profileRow) {
    console.error("[comp-guard]", { compErr, orgId, orgProfile });
    return NextResponse.json(
      { error: "Could not verify account billing status — please try again." },
      { status: 503 },
    );
  }

  // "upgrade" (the feature-lock screens) becomes a concrete kind from the
  // league's state as read HERE, never from the request.
  let kind: PurchaseKind;
  if (requested === "upgrade") {
    if (!tier) {
      return NextResponse.json({ error: "Choose Pro or Elite." }, { status: 400 });
    }
    const { count, error: countErr } = await supabase
      .from("leagues")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", orgId)
      .is("archived_at", null);
    if (countErr || count === null) {
      return NextResponse.json(
        { error: "Could not read your seasons — please try again." },
        { status: 503 },
      );
    }
    const k = upgradeKindFor(profileRow.plan, count, tier);
    if (!k) {
      return NextResponse.json(
        { error: "Your league already has this plan." },
        { status: 409 },
      );
    }
    kind = k;
  } else {
    kind = requested as PurchaseKind;
  }

  const season = SEASON_KINDS.includes(kind) ? seasonFrom(body.season) : null;
  if (SEASON_KINDS.includes(kind) && (!season || !DATE_RE.test(season.startDate) || !DATE_RE.test(season.endDate))) {
    return NextResponse.json({ error: "Enter a start date and an end date." }, { status: 400 });
  }

  // Return URLs are built HERE from SITE_URL. A season purchase lands on its
  // own page, which waits for the webhook; an upgrade or a signup lands on the
  // dashboard as before.
  const successUrl = (purchaseId: string) =>
    SEASON_KINDS.includes(kind)
      ? `${SITE_URL}/dashboard/purchases/${purchaseId}`
      : kind === "signup"
        ? `${SITE_URL}/dashboard?welcome=true`
        : `${SITE_URL}/dashboard?upgraded=true`;
  const cancelUrl = SEASON_KINDS.includes(kind)
    ? `${SITE_URL}/dashboard/leagues/new`
    : `${SITE_URL}/dashboard`;

  const result = await startPurchaseCheckout({
    supabase,
    orgId,
    kind,
    tier,
    season,
    pendingPromo: profileRow.pending_promo,
    successUrl,
    cancelUrl,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, field: result.field ?? null },
      { status: result.status },
    );
  }
  return NextResponse.json({ url: result.url, purchaseId: result.purchaseId });
}

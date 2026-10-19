// Server-only. ONE way a checkout starts, shared by /api/stripe/checkout and
// the signup callback (/api/auth/callback):
//
//   1. begin_season_purchase (0111) — the DATABASE decides what this league
//      may buy and at which tier, and writes the pending purchase row. The
//      caller's own Supabase session makes the call, so is_org_member is real.
//   2. verifySeasonPrice — the live Stripe Price must charge exactly the
//      configured amount; otherwise NO session (the purchase is abandoned).
//   3. createCheckoutSession — quantity 1, purchaseId in metadata.
//   4. attach_purchase_session — records the Stripe session id.
//
// Any failure after (1) marks the purchase abandoned, so a row never waits
// for a session that was never opened.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createCheckoutSession, verifySeasonPrice, type CheckoutParams } from "@/lib/stripe";
import { resolvePromoCoupon } from "@/lib/promo";
import type { PaidTier } from "./prices";
import { purchaseErrorMessage, type PurchaseKind } from "./season-purchase";

export type SeasonFields = {
  name: string;
  sport: string;
  seasonLabel: string | null;
  startDate: string;
  endDate: string;
};

export type StartCheckoutInput = {
  supabase: SupabaseClient;
  orgId: string;
  kind: PurchaseKind;
  /** Only read by first_season / convert_free / signup; the DB ignores it otherwise. */
  tier: PaidTier | null;
  season: SeasonFields | null;
  pendingPromo: string | null;
  successUrl: (purchaseId: string) => string;
  cancelUrl: string;
};

export type StartCheckoutResult =
  | { ok: true; url: string; purchaseId: string }
  | { ok: false; status: number; code: string; field?: string | null; error: string };

type BeginReply =
  | { purchase_id: string; kind: PurchaseKind; tier: PaidTier; upgrade_only: boolean }
  | { error: string; field?: string; allowed?: string; plan?: string };

function refusal(status: number, code: string, field?: string | null): StartCheckoutResult {
  return { ok: false, status, code, field: field ?? null, error: purchaseErrorMessage(code, field) };
}

export async function startPurchaseCheckout(i: StartCheckoutInput): Promise<StartCheckoutResult> {
  const { data, error } = await i.supabase.rpc(
    "begin_season_purchase" as never,
    {
      p_org_id: i.orgId,
      p_kind: i.kind,
      p_tier: i.tier,
      p_name: i.season?.name ?? null,
      p_sport: i.season?.sport ?? null,
      p_season_label: i.season?.seasonLabel ?? null,
      p_start_date: i.season?.startDate ?? null,
      p_end_date: i.season?.endDate ?? null,
    } as never,
  );
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("not_org_member")) return refusal(403, "not_org_member");
    console.error("[start-checkout] begin_season_purchase failed", { error, orgId: i.orgId, kind: i.kind });
    return refusal(500, "begin_failed");
  }
  const reply = data as BeginReply | null;
  if (!reply || "error" in reply) {
    const code = reply?.error ?? "begin_failed";
    const status = code === "billing_managed" ? 403 : code === "kind_not_allowed" ? 409 : 400;
    return refusal(status, code, reply && "field" in reply ? reply.field : null);
  }

  const purchaseId = reply.purchase_id;
  const abandon = async () => {
    const { error: e } = await i.supabase.rpc(
      "attach_purchase_session" as never,
      { p_purchase_id: purchaseId, p_session_id: null } as never,
    );
    if (e) console.error("[start-checkout] could not mark purchase abandoned", { e, purchaseId });
  };

  // The live price must be what the screen showed — or nothing is opened.
  const price = await verifySeasonPrice(reply.tier, reply.upgrade_only);
  if (!price.ok) {
    console.error("[start-checkout] Stripe price does not match the config — no session", {
      reason: price.reason,
      tier: reply.tier,
      upgradeOnly: reply.upgrade_only,
      purchaseId,
    });
    await abandon();
    return refusal(503, "price_unavailable");
  }

  // A bad promo must never block a purchase: unknown → no coupon (the session
  // shows the typed promo-code field), and a coupon Stripe rejects gets ONE
  // retry without it.
  const couponId = (await resolvePromoCoupon(i.pendingPromo)) ?? undefined;
  const params: Omit<CheckoutParams, "couponId"> = {
    plan: reply.tier,
    quantity: 1,
    upgradeOnly: reply.upgrade_only,
    orgId: i.orgId,
    purchaseId,
    successUrl: i.successUrl(purchaseId),
    cancelUrl: i.cancelUrl,
  };
  let session: { url: string; id: string };
  try {
    try {
      session = await createCheckoutSession({ ...params, couponId });
    } catch (couponErr) {
      if (!couponId) throw couponErr;
      console.error("[start-checkout] coupon checkout failed — retrying without coupon", {
        err: couponErr,
        orgId: i.orgId,
        couponId,
      });
      session = await createCheckoutSession(params);
    }
  } catch (err) {
    console.error("[start-checkout] createCheckoutSession failed", { err, purchaseId });
    await abandon();
    return refusal(500, "session_failed");
  }

  const { error: attachErr } = await i.supabase.rpc(
    "attach_purchase_session" as never,
    { p_purchase_id: purchaseId, p_session_id: session.id } as never,
  );
  if (attachErr) {
    // The session is valid and the purchase is still pending, so payment
    // works; only the stored session id is missing. Log, don't block.
    console.error("[start-checkout] could not record the session id", { attachErr, purchaseId });
  }

  return { ok: true, url: session.url, purchaseId };
}

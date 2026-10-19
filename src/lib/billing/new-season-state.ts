// Server-side read of everything "New season" needs to pick a screen
// (newSeasonScreen): the league's plan and comp flag, its active seasons,
// and its unused season credits. Read with the CALLER's session — every
// row is one their membership already lets them read.
//
// FAILS CLOSED: any read that fails returns an error, never a guess. A credit
// count that silently read as 0 would send a league that already paid for a
// season to checkout again.
//
// A paid signup can come back from Stripe before its webhook lands. Until it
// does the league is still Free with nothing active, so the free form would
// show — and the payment's credit would then sit unused. So a pending signup
// purchase is checked against STRIPE (the checkout session's own status):
// complete → awaitingSignupPurchaseId, and the flow waits. A pending row alone
// isn't enough — the person may have left checkout without paying. A Stripe
// read that fails fails the whole load, like every other read here.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlan } from "@/lib/plan/limits";
import { getStripe } from "@/lib/stripe";
import {
  PENDING_PURCHASE_TTL_MS,
  signupAwaitingWebhook,
  type NewSeasonState,
} from "./season-purchase";

export async function loadNewSeasonState(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ ok: true; state: NewSeasonState } | { ok: false; error: string }> {
  const fail = { ok: false as const, error: "Couldn’t load your league’s seasons. Refresh the page to try again." };

  const nowMs = Date.now();
  const [profileRes, seasonsRes, creditsRes, signupsRes] = await Promise.all([
    supabase.from("profiles").select("plan, comped").eq("id", orgId).maybeSingle(),
    supabase
      .from("leagues")
      .select("id, name, created_at")
      .eq("owner_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("season_purchases" as never)
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "credited")
      .is("league_id", null),
    supabase
      .from("season_purchases" as never)
      .select("id, kind, status, stripe_session_id, created_at")
      .eq("org_id", orgId)
      .eq("kind", "signup")
      .eq("status", "pending")
      .gte("created_at", new Date(nowMs - PENDING_PURCHASE_TTL_MS).toISOString())
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
  ]);

  const profile = profileRes.data as { plan: unknown; comped: boolean | null } | null;
  if (profileRes.error || !profile || !isPlan(profile.plan)) return fail;
  if (seasonsRes.error || !seasonsRes.data) return fail;
  if (creditsRes.error || creditsRes.count === null) return fail;
  if (signupsRes.error || !signupsRes.data) return fail;

  type SignupRow = { id: string; kind: string; status: string; stripe_session_id: string | null; created_at: string };
  let awaitingSignupPurchaseId: string | null = null;
  for (const r of signupsRes.data as unknown as SignupRow[]) {
    if (!r.stripe_session_id) continue;
    let sessionStatus: string | null;
    try {
      const session = await getStripe().checkout.sessions.retrieve(r.stripe_session_id);
      sessionStatus = session.status ?? null;
    } catch {
      return fail;
    }
    if (signupAwaitingWebhook(r, sessionStatus, nowMs)) {
      awaitingSignupPurchaseId = r.id;
      break;
    }
  }

  const seasons = seasonsRes.data as { id: string; name: string }[];
  return {
    ok: true,
    state: {
      plan: profile.plan,
      comped: profile.comped === true,
      activeCount: seasons.length,
      creditCount: creditsRes.count,
      activeSeasonName: seasons[0]?.name ?? null,
      awaitingSignupPurchaseId,
    },
  };
}

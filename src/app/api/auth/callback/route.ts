import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startPurchaseCheckout } from "@/lib/billing/start-checkout";
import { SITE_URL } from "@/lib/site";

// Auth redirect target for both email confirmation (signup) and password
// reset. Exchanges the PKCE code for a session, then — for a paid signup —
// reads profiles.pending_plan and bounces the now-authenticated user straight
// into Stripe checkout. A Free signup (pending_plan null) just lands on `next`.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Read the tier the user chose at signup. plan is included only to avoid
      // re-initiating checkout if the webhook already flipped the tier (in
      // which case pending_plan is already null — this is belt-and-suspenders).
      const { data: profile } = await supabase
        .from("profiles")
        .select("pending_plan, plan, pending_promo")
        .eq("id", data.user.id)
        .single();

      const typedProfile = profile as
        | { pending_plan: string | null; pending_promo: string | null }
        | null;
      const pending = typedProfile?.pending_plan;
      const pendingPromo = typedProfile?.pending_promo;

      if (pending === "pro" || pending === "elite") {
        // A paid signup has no season yet, so its payment becomes a SEASON
        // CREDIT (0111, kind 'signup'): the webhook raises the plan and the
        // first season the user creates uses the credit. Same path as every
        // other purchase — begin_season_purchase, the live price check, the
        // session — via startPurchaseCheckout. An unknown/expired promo
        // never blocks the signup.
        const result = await startPurchaseCheckout({
          supabase,
          orgId: data.user.id,
          kind: "signup",
          tier: pending,
          season: null,
          pendingPromo: pendingPromo ?? null,
          successUrl: () => `${SITE_URL}/dashboard?welcome=true`,
          cancelUrl: `${SITE_URL}/dashboard`,
        });
        if (result.ok) return NextResponse.redirect(result.url);
        // Stripe misconfigured / transient failure — don't strand the user
        // on an error page. Send them to the dashboard, where the
        // "complete setup" CTA (pending_plan still set) lets them retry.
        console.error("[auth-callback] checkout start failed", {
          code: result.code,
          userId: data.user.id,
          pending,
        });
        return NextResponse.redirect(`${origin}${next}`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}

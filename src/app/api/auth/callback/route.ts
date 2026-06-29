import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/lib/stripe";

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
        // Auto-apply the INTERLEAGUE promo coupon when the user arrived via an
        // interleague invite link (?promo=INTERLEAGUE → pending_promo). A
        // missing coupon env var must NEVER block a paid signup — log and
        // proceed without the discount.
        let couponId: string | undefined;
        if (pendingPromo?.toUpperCase() === "INTERLEAGUE") {
          couponId = process.env.STRIPE_INTERLEAGUE_COUPON_ID;
          if (!couponId) {
            console.error("[promo] INTERLEAGUE coupon id not configured");
          }
        }
        try {
          // quantity:1 — the plan's single included season. The webhook flips
          // the tier and provisions NO season; the user creates their first
          // season manually in the dashboard.
          const { url } = await createCheckoutSession({
            plan: pending,
            quantity: 1,
            orgId: data.user.id,
            couponId,
            successUrl: `${origin}/dashboard?welcome=true`,
            cancelUrl: `${origin}/dashboard`,
          });
          return NextResponse.redirect(url);
        } catch (err) {
          // Stripe misconfigured / transient failure — don't strand the user
          // on an error page. Send them to the dashboard, where the
          // "complete setup" CTA (pending_plan still set) lets them retry.
          // Log it so a systemic checkout-start failure (e.g. every paid
          // signup) isn't invisible — the redirect behavior is unchanged.
          console.error("[auth-callback] checkout start failed", {
            err,
            userId: data.user.id,
            pending,
          });
          return NextResponse.redirect(`${origin}${next}`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}

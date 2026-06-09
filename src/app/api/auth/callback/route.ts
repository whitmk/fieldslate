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
        .select("pending_plan, plan")
        .eq("id", data.user.id)
        .single();

      const pending = (profile as { pending_plan: string | null } | null)
        ?.pending_plan;

      if (pending === "pro" || pending === "elite") {
        try {
          // quantity:1 — the plan's single included season. The webhook flips
          // the tier and provisions NO season; the user creates their first
          // season manually in the dashboard.
          const { url } = await createCheckoutSession({
            plan: pending,
            quantity: 1,
            orgId: data.user.id,
            successUrl: `${origin}/dashboard?welcome=true`,
            cancelUrl: `${origin}/dashboard`,
          });
          return NextResponse.redirect(url);
        } catch {
          // Stripe misconfigured / transient failure — don't strand the user
          // on an error page. Send them to the dashboard, where the
          // "complete setup" CTA (pending_plan still set) lets them retry.
          return NextResponse.redirect(`${origin}${next}`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}

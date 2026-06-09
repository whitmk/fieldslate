import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Dedicated password-reset callback. Kept separate from /api/auth/callback so
// its redirect URL is a static, query-string-free path that the Supabase
// redirect-URL allowlist can match with an exact entry (no wildcards). It does
// only one thing: exchange the recovery code for a session, then hand off to
// the reset-password page. No pending_plan logic, no `next` param, no checkout.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL("/reset-password", origin));
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}

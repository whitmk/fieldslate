import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Dedicated password-reset callback. Kept separate from /api/auth/callback so
// its redirect URL is a static, query-string-free path that the Supabase
// redirect-URL allowlist can match with an exact entry (no wildcards). It does
// only one thing: verify the recovery token_hash to establish a session, then
// hand off to the reset-password page. No pending_plan logic, no checkout.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (token_hash && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as EmailOtpType });
    if (!error) {
      return NextResponse.redirect(new URL("/reset-password", origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback_failed", origin));
}

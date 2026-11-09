import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINK_TOKEN } from "@/lib/officials-signup/page";

// The official's page data (0124, official_signup_page). The token is the
// credential (only its sha256 is stored); the reply is THIS official's games
// and the open spots, never another official's name. No caching; a read
// error → 503, never an empty page.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  if (!LINK_TOKEN.test(params.token)) return NextResponse.json({ status: "unknown" }, { headers: NO_STORE });
  const { data, error } = await createAdminClient().rpc("official_signup_page" as never, { p_token: params.token } as never);
  if (error) {
    console.error("[officials signup] read failed:", error.message);
    return NextResponse.json({ status: "error" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  return NextResponse.json(data, { headers: NO_STORE });
}

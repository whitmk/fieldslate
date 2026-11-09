import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINK_TOKEN } from "@/lib/volunteers/public-server";

// The volunteer's own sign-ups (0121, volunteer_manage_page). The token is
// the credential (only its sha256 is stored); the reply is THIS volunteer's
// spots and name, nobody else's. No caching; a read error → 503.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  if (!LINK_TOKEN.test(params.token)) return NextResponse.json({ status: "unknown" }, { headers: NO_STORE });
  const { data, error } = await createAdminClient().rpc("volunteer_manage_page" as never, { p_token: params.token } as never);
  if (error) {
    console.error("[volunteer manage] read failed:", error.message);
    return NextResponse.json({ status: "error" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  return NextResponse.json(data, { headers: NO_STORE });
}

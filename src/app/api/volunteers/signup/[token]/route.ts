import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINK_TOKEN, seasonParam } from "@/lib/volunteers/public-server";

// The public sign-up page's data (0121, volunteer_signup_page). The reply
// holds spot COUNTS only — never a name or an email. No caching: counts must
// be current. A failed read is a 503 (the page says it couldn't load), never
// an empty list of spots.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: Request, { params }: { params: { token: string } }) {
  if (!LINK_TOKEN.test(params.token)) {
    return NextResponse.json({ status: "unknown" }, { headers: NO_STORE });
  }
  const season = seasonParam(new URL(request.url).searchParams.get("season"));
  const { data, error } = await createAdminClient().rpc(
    "volunteer_signup_page" as never,
    { p_token: params.token, p_season_id: season } as never,
  );
  if (error) {
    console.error("[volunteer signup] page read failed:", error.message);
    return NextResponse.json({ status: "error" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  return NextResponse.json(data, { headers: NO_STORE });
}

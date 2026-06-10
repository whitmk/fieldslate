// Sets the fs_season_id cookie that getCurrentSeasonId() reads on every
// server component render — the season analogue of /api/orgs/select. The
// cookie write is rejected unless the season is an ACTIVE season of the
// caller's current org — defense in depth, since getCurrentSeasonId also
// validates at read time and silently falls back on stale values.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { SEASON_COOKIE_NAME } from "@/lib/seasons/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { season_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const seasonId = typeof body.season_id === "string" ? body.season_id : "";
  if (!seasonId) {
    return NextResponse.json({ error: "season_id is required." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const currentOrgId = await getCurrentOrgId(supabase, user.id);

  // The season must belong to the CURRENT org and be active — an archived
  // (or another org's) season can't become the selection.
  const { data: season } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", seasonId)
    .eq("owner_id", currentOrgId)
    .is("archived_at", null)
    .maybeSingle();

  if (!season) {
    return NextResponse.json(
      { error: "That season isn't an active season in your organization." },
      { status: 403 },
    );
  }

  cookies().set(SEASON_COOKIE_NAME, seasonId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // 1 year — the cookie just stores a preference; the server validates
    // it against the org's active seasons on every read anyway.
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true, season_id: seasonId });
}

// Sets the fs_org_id cookie that getCurrentOrgId() reads on every server
// component render. The cookie is rejected if the caller isn't actually a
// member of the requested org — defense in depth, since getCurrentOrgId
// also validates against the membership list at read time.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE_NAME } from "@/lib/orgs/context";
import { SEASON_COOKIE_NAME } from "@/lib/seasons/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { org_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  if (!orgId) {
    return NextResponse.json({ error: "org_id is required." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Membership check — RLS would already prevent a non-member from seeing
  // that org's data, but we also reject the cookie write so the switcher
  // never silently "succeeds" on an org the user isn't in.
  const { data: membership } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { error: "You are not a member of that organization." },
      { status: 403 },
    );
  }

  cookies().set(ORG_COOKIE_NAME, orgId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // 1 year — the cookie just stores a preference; the server validates
    // membership on every read anyway.
    maxAge: 60 * 60 * 24 * 365,
  });

  // Season selection can't survive an org switch — season ids from the old
  // org are meaningless in the new one. getCurrentSeasonId would silently
  // fall back anyway; clearing makes the reset deterministic.
  cookies().delete(SEASON_COOKIE_NAME);

  return NextResponse.json({ ok: true, org_id: orgId });
}

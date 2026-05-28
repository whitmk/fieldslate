// POST /api/org-invite/accept — finalizes an email invitation. The accept
// page (/org-invite/[token]) calls this after the user signs in. Sets the
// fs_org_id cookie to the new org so the post-redirect render lands in it.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE_NAME } from "@/lib/orgs/context";

export const runtime = "nodejs";

const RPC_ERROR_MAP: Record<string, { status: number; message: string }> = {
  not_authenticated: {
    status: 401,
    message: "Sign in to accept the invitation.",
  },
  invitation_not_found: {
    status: 404,
    message: "We couldn't find that invitation. The link may have been mistyped.",
  },
  invitation_not_pending: {
    status: 409,
    message: "This invitation is no longer pending.",
  },
  invitation_expired: {
    status: 410,
    message:
      "This invitation has expired. Ask the inviter to send a new one.",
  },
  email_mismatch: {
    status: 403,
    message:
      "This invitation was sent to a different email address than the one you're signed in with.",
  },
  tier_cap_reached: {
    status: 402,
    message:
      "The organization is at its plan's admin limit. Ask the owner to upgrade.",
  },
};

export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!token) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc(
    "accept_org_invitation" as never,
    { p_token: token } as never,
  );

  if (error) {
    const tag = error.message?.trim() ?? "";
    const mapped = RPC_ERROR_MAP[tag];
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json(
      { error: "Could not accept invitation." },
      { status: 500 },
    );
  }

  const result = data as { org_id: string; org_name: string };

  // Land the user inside the newly-joined org by default.
  cookies().set(ORG_COOKIE_NAME, result.org_id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({
    ok: true,
    org_id: result.org_id,
    org_name: result.org_name,
  });
}

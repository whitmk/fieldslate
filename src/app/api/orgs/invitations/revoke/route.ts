// POST /api/orgs/invitations/revoke — owner-only.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RPC_ERROR_MAP: Record<string, { status: number; message: string }> = {
  not_authenticated: { status: 401, message: "You need to sign in." },
  not_org_owner: {
    status: 403,
    message: "Only the owner can manage invitations.",
  },
  invitation_not_found: {
    status: 404,
    message: "Invitation not found.",
  },
};

export async function POST(request: Request) {
  let body: { invitation_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const invitationId =
    typeof body.invitation_id === "string" ? body.invitation_id : "";
  if (!invitationId) {
    return NextResponse.json(
      { error: "invitation_id is required." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const { error } = await supabase.rpc(
    "revoke_org_invitation" as never,
    { p_invitation_id: invitationId } as never,
  );

  if (error) {
    const tag = error.message?.trim() ?? "";
    const mapped = RPC_ERROR_MAP[tag];
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json(
      { error: "Could not revoke invitation." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

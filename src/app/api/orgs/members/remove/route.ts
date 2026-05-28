// POST /api/orgs/members/remove — owner-only. Delegates the auth + role
// checks to the remove_org_member RPC.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";

export const runtime = "nodejs";

const RPC_ERROR_MAP: Record<string, { status: number; message: string }> = {
  not_authenticated: { status: 401, message: "You need to sign in." },
  not_org_owner: {
    status: 403,
    message: "Only the owner can remove admins.",
  },
  not_member: { status: 404, message: "That person is not a member." },
  cannot_remove_owner: {
    status: 400,
    message: "The owner can't be removed.",
  },
};

export async function POST(request: Request) {
  let body: { user_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userIdToRemove = typeof body.user_id === "string" ? body.user_id : "";
  if (!userIdToRemove) {
    return NextResponse.json({ error: "user_id is required." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const currentOrgId = await getCurrentOrgId(supabase, user.id);

  const { error } = await supabase.rpc(
    "remove_org_member" as never,
    { p_org_id: currentOrgId, p_user_id: userIdToRemove } as never,
  );

  if (error) {
    const tag = error.message?.trim() ?? "";
    const mapped = RPC_ERROR_MAP[tag];
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json(
      { error: "Could not remove member." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

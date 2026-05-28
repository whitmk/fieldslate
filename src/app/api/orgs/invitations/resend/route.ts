// POST /api/orgs/invitations/resend — owner-only. Cycles the token, pushes
// the expiry, and re-sends the invitation email.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { buildEmailInviteEmail } from "@/lib/orgs/admin-invite-email";

export const runtime = "nodejs";

const RPC_ERROR_MAP: Record<string, { status: number; message: string }> = {
  not_authenticated: { status: 401, message: "You need to sign in." },
  not_org_owner: {
    status: 403,
    message: "Only the owner can manage invitations.",
  },
  invitation_not_found: { status: 404, message: "Invitation not found." },
  invitation_not_pending: {
    status: 400,
    message: "Only pending invitations can be resent.",
  },
};

function originFrom(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    new URL(req.url).origin ??
    "https://thefieldslate.com"
  );
}

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
  const { data, error } = await supabase.rpc(
    "resend_org_invitation" as never,
    { p_invitation_id: invitationId } as never,
  );

  if (error) {
    const tag = error.message?.trim() ?? "";
    const mapped = RPC_ERROR_MAP[tag];
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json(
      { error: "Could not resend invitation." },
      { status: 500 },
    );
  }

  const result = data as {
    invitation_id: string;
    token: string;
    email: string;
    org_name: string;
    inviter_name: string;
    expires_at: string;
  };

  const origin = originFrom(request);
  const acceptUrl = `${origin.replace(/\/$/, "")}/org-invite/${result.token}`;
  const { subject, html, text } = buildEmailInviteEmail({
    recipientEmail: result.email,
    orgName: result.org_name,
    inviterName: result.inviter_name,
    acceptUrl,
    expiresAt: result.expires_at,
  });
  const send = await sendEmail(result.email, subject, html, text);
  if (!send.ok) {
    return NextResponse.json(
      { ok: true, email_warning: send.error },
      { status: 207 },
    );
  }
  return NextResponse.json({ ok: true });
}

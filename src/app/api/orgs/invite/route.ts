// POST /api/orgs/invite — owner-only org-admin invitation.
// Delegates the routing decision (direct-add vs email-invite) and the
// tier-cap check to the invite_admin RPC; this handler just composes and
// sends the appropriate Resend email.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { sendEmail } from "@/lib/email";
import {
  buildDirectAddEmail,
  buildEmailInviteEmail,
} from "@/lib/orgs/admin-invite-email";

export const runtime = "nodejs";

// Maps the short error tags the SQL RPC raises (errcode P0001) into the
// HTTP status + user-facing message we want the UI to render.
const RPC_ERROR_MAP: Record<string, { status: number; message: string }> = {
  not_authenticated: {
    status: 401,
    message: "You need to sign in to invite admins.",
  },
  not_org_owner: {
    status: 403,
    message: "Only the owner can invite admins.",
  },
  invalid_email: { status: 400, message: "Enter a valid email address." },
  already_member: {
    status: 409,
    message: "That person is already a member of this organization.",
  },
  already_invited: {
    status: 409,
    message: "There's already a pending invitation for that email.",
  },
  tier_cap_reached: {
    status: 402,
    message:
      "You've reached your plan's admin limit. Upgrade to add more admins.",
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
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const currentOrgId = await getCurrentOrgId(supabase, user.id);

  const { data, error } = await supabase.rpc(
    "invite_admin" as never,
    { p_org_id: currentOrgId, p_email: email } as never,
  );

  if (error) {
    const tag = error.message?.trim() ?? "";
    const mapped = RPC_ERROR_MAP[tag];
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json(
      { error: "Could not send invitation." },
      { status: 500 },
    );
  }

  const result = data as
    | {
        kind: "direct_add";
        email: string;
        org_name: string;
        inviter_name: string;
      }
    | {
        kind: "email_invite";
        invitation_id: string;
        token: string;
        email: string;
        org_name: string;
        inviter_name: string;
        expires_at: string;
      };

  const origin = originFrom(request);

  if (result.kind === "direct_add") {
    const { subject, html, text } = buildDirectAddEmail({
      recipientEmail: result.email,
      orgName: result.org_name,
      inviterName: result.inviter_name,
      dashboardUrl: `${origin.replace(/\/$/, "")}/dashboard`,
    });
    // Email failure shouldn't undo the membership — the admin is in either way,
    // and the org owner can re-notify out of band if Resend is misconfigured.
    await sendEmail(result.email, subject, html, text);
    return NextResponse.json({
      kind: "direct_add",
      email: result.email,
    });
  }

  // email_invite path
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
    // The invite row exists; surface the email failure but leave the row in
    // place so the owner can hit "Resend" rather than re-typing the address.
    return NextResponse.json(
      {
        kind: "email_invite",
        email: result.email,
        invitation_id: result.invitation_id,
        email_warning: send.error,
      },
      { status: 207 },
    );
  }

  return NextResponse.json({
    kind: "email_invite",
    email: result.email,
    invitation_id: result.invitation_id,
  });
}

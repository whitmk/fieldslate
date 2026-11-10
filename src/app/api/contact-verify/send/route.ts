import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { sendEmail } from "@/lib/email";
import { runSend } from "@/lib/contact-verify/rules";

// Save a new league contact email (or resend for the one waiting) and email it
// a confirmation link (0126). Every rule is runSend's
// (src/lib/contact-verify/rules.ts):
//   1. the signed-in user, else 401; the body's org must be the one they're
//      acting under, else 409;
//   2. contact_verify_begin AS THE USER (member, feature, Elite, address
//      shape, rate limits — the database decides);
//   3. contact_verify_take with the SERVICE ROLE — the only way to mint the
//      link, so an admin's browser can never see a token it could confirm
//      itself (the admin client is used for that one call, after 1 and 2);
//   4. the email goes to the address take returned, from FieldSlate's own
//      address with no reply-to.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const supabase = createClient();
  let raw: unknown = null;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const result = await runSend(raw, {
    userId: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    currentOrgId: (userId) => getCurrentOrgId(supabase, userId),
    begin: async (b) => {
      const { data, error } = await supabase.rpc(
        "contact_verify_begin" as never,
        { p_org_id: b.orgId, p_kind: b.kind, p_email: b.email } as never,
      );
      return { data, error: error ? { message: error.message } : null };
    },
    take: async (orgId, kind) => {
      const { data, error } = await createAdminClient().rpc(
        "contact_verify_take" as never,
        { p_org_id: orgId, p_kind: kind } as never,
      );
      return { data, error: error ? { message: error.message } : null };
    },
    send: async (to, mail) => {
      const r = await sendEmail(to, mail.subject, mail.html, mail.text);
      if (!r.ok) console.error("[contact verify] send failed:", r.error);
      return { ok: r.ok };
    },
  });
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

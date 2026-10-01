import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import {
  RATE_LIMIT_MESSAGE,
  clientAddress,
  isHoneypotFilled,
  isRateLimited,
} from "@/lib/forms/spam";
import {
  DEMO_INBOX,
  buildDemoEmail,
  validateDemoRequest,
} from "@/lib/forms/demo-request";

// POST /api/demo-request — the "Request a demo" form's server half.
//
// ORDER MATTERS, and each step is deliberate:
//   1. Spam check first (shared with the contact form). A honeypot hit is
//      answered with a normal-looking success and NOTHING below runs. A rate
//      limit trip answers 429 with a friendly message.
//   2. Validate on the server with the same lib the form uses.
//   3. INSERT the row FIRST, through the service-role admin client — the row
//      is the durable copy; the email can be resent, a lost answer cannot.
//   4. Send the notification to hello@ with reply-to set to the requester.
//   5. Record email_sent / email_error on the row.
//   6. The user sees success if EITHER the insert or the send worked. Only
//      when both fail is an error shown. A failed send with a saved row logs
//      "[demo-request] email failed" so it can be grepped and resent by hand.
//
// Nothing here puts an answer in a URL, and no confirmation email goes to
// the requester.

export const runtime = "nodejs";

const BOTH_FAILED =
  "We couldn't save your request right now. Please email hello@thefieldslate.com and we'll set up a time by hand.";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // 1. Spam — before anything is read, saved or sent.
  if (isHoneypotFilled(body as Record<string, unknown>)) {
    return NextResponse.json({ ok: true });
  }
  if (isRateLimited(clientAddress(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  // 2. Validate.
  const v = validateDemoRequest(body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  const data = v.data;

  // 3. Insert first.
  let rowId: string | null = null;
  let insertError: string | null = null;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
    const { data: row, error } = await admin
      .from("demo_requests")
      .insert({ ...data })
      .select("id")
      .single();
    if (error) insertError = error.message;
    else rowId = row.id;
  } catch (err) {
    insertError = err instanceof Error ? err.message : String(err);
  }
  if (insertError) {
    console.error("[demo-request] insert failed:", insertError);
  }

  // 4. Send, whether or not the insert worked.
  const mail = buildDemoEmail(data, SITE_URL);
  const sent = await sendEmail(DEMO_INBOX, mail.subject, mail.html, mail.text, {
    replyTo: data.email,
  });
  if (!sent.ok) {
    console.error(
      "[demo-request] email failed:",
      sent.error,
      rowId ? `(saved as row ${rowId})` : "(row NOT saved either)",
    );
  }

  // 5. Record the outcome on the row.
  if (rowId && admin) {
    const { error } = await admin
      .from("demo_requests")
      .update({
        email_sent: sent.ok,
        email_error: sent.ok ? null : sent.error.slice(0, 2000),
      })
      .eq("id", rowId);
    if (error) {
      console.error("[demo-request] row update failed:", error.message, `(row ${rowId})`);
    }
  }

  // 6. Outcome for the user.
  if (insertError && !sent.ok) {
    return NextResponse.json({ error: BOTH_FAILED }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { drainOutbox } from "@/lib/volunteers/outbox-drain";
import { renderVolunteerEmail } from "@/lib/volunteers/email-templates";

// Sends the volunteer outbox (migration 0120). Called by Vercel Cron every 5
// minutes (vercel.json — needs the Pro plan) with
// `Authorization: Bearer $CRON_SECRET`. 0121 adds a signed-in ping after a
// game move so a move's email doesn't wait for the cron.
//
// FAILS CLOSED: no CRON_SECRET configured → 503 and nothing is taken; a wrong
// or missing bearer → 401. The reply is counts only — never an address.
// service_role reaches the outbox ONLY through volunteer_outbox_take /
// volunteer_outbox_finish (it holds no table privilege).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

function bearerMatches(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503, headers: NO_STORE });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const admin = createAdminClient();
  const summary = await drainOutbox({
    envFrom: process.env.RESEND_FROM_EMAIL,
    take: async (limit) => {
      const { data, error } = await admin.rpc("volunteer_outbox_take" as never, { p_limit: limit } as never);
      return error ? { ok: false, error: error.message } : { ok: true, rows: data };
    },
    finish: async ({ id, ok, resendId, error, retry }) => {
      const { error: rpcErr } = await admin.rpc(
        "volunteer_outbox_finish" as never,
        { p_id: id, p_ok: ok, p_resend_id: resendId, p_error: error, p_retry: retry } as never,
      );
      return rpcErr ? { ok: false, error: rpcErr.message } : { ok: true };
    },
    send: ({ to, subject, html, text, from, replyTo, idempotencyKey }) =>
      sendEmail(to, subject, html, text, { from, replyTo, idempotencyKey }),
    render: renderVolunteerEmail,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.error(m),
  });

  return NextResponse.json(summary, { status: summary.error ? 500 : 200, headers: NO_STORE });
}

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runVolunteerDrain } from "@/lib/volunteers/drain-runner";

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

  const summary = await runVolunteerDrain();

  return NextResponse.json(summary, { status: summary.error ? 500 : 200, headers: NO_STORE });
}

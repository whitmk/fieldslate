import { NextResponse } from "next/server";
import { cronRefusal } from "@/lib/outbound-email/cron-auth";
import { runOfficialsDrain } from "@/lib/officials-signup/drain-runner";

// Sends the officials outbox (0124). Vercel Cron every 5 minutes (vercel.json)
// with `Authorization: Bearer $CRON_SECRET`. FAILS CLOSED (cronRefusal). The
// reply is counts only — never an address.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const refused = cronRefusal(process.env.CRON_SECRET, request.headers.get("authorization"));
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status, headers: NO_STORE });
  const summary = await runOfficialsDrain();
  return NextResponse.json(summary, { status: summary.error ? 500 : 200, headers: NO_STORE });
}

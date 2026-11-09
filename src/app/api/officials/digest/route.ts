import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronRefusal } from "@/lib/outbound-email/cron-auth";
import { runOfficialsDrain } from "@/lib/officials-signup/drain-runner";

// The coordinator's daily digest of games officials took (decision 8). Vercel
// Cron once a day (vercel.json, 15:00 UTC — 8 AM Pacific in summer, 7 AM in
// winter): queue one digest per season with unreported self-claims
// (official_digest_queue), then send. FAILS CLOSED like the drain.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const refused = cronRefusal(process.env.CRON_SECRET, request.headers.get("authorization"));
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status, headers: NO_STORE });
  const { data, error } = await createAdminClient().rpc("official_digest_queue" as never);
  if (error) {
    console.error("[officials digest] queue failed:", error.message);
    return NextResponse.json({ error: "queue failed" }, { status: 500, headers: NO_STORE });
  }
  const summary = await runOfficialsDrain();
  return NextResponse.json({ queued: data, ...summary }, { status: summary.error ? 500 : 200, headers: NO_STORE });
}

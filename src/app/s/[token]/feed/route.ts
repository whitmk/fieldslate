// GET /s/<token>.ics (rewritten here by next.config.mjs) — every published
// game in the league as one calendar subscription.
//
// Same behavior as the team feed (/calendar/<token>.ics): a temporary problem
// is 503 + Retry-After so calendar apps keep their last copy, never an empty
// calendar that would wipe every game from a parent's phone; no shared
// caching; no indexing.

import { NextResponse } from "next/server";
import { FEED_HEADERS } from "@/lib/calendar/links";
import { buildLeagueCalendarIcs } from "@/lib/public-schedule/league-ics";
import { feedRefusal, parseToken } from "@/lib/public-schedule/links";
import { readPublicSchedule } from "@/lib/public-schedule/read";

export const dynamic = "force-dynamic";
// Second guard on the Data Cache (the first is the no-store client):
// force-dynamic alone does not stop Next caching this route's fetches.
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

function refuse(r: ReturnType<typeof feedRefusal>): NextResponse {
  const headers: Record<string, string> = { ...FEED_HEADERS, "Content-Type": "text/plain; charset=utf-8" };
  if (r.retryAfterSeconds) headers["Retry-After"] = String(r.retryAfterSeconds);
  return new NextResponse(r.message + "\n", { status: r.status, headers });
}

export async function GET(
  _request: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  const token = parseToken(params.token);
  if (!token) return refuse(feedRefusal("unknown"));

  const result = await readPublicSchedule(token);
  if (result.status !== "ok") return refuse(feedRefusal(result.status));

  const built = buildLeagueCalendarIcs(result, new Date().toISOString());
  if (!built.ok) {
    console.error("[league feed] builder refused:", built.error);
    return refuse(feedRefusal("error"));
  }
  // Nothing published (no current season, or no dated games): temporary.
  if (built.eventCount === 0) return refuse(feedRefusal("nothing_published"));

  return new NextResponse(built.ics, {
    status: 200,
    headers: {
      ...FEED_HEADERS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="league-schedule.ics"',
    },
  });
}

// GET /calendar/<token>.ics — a team's calendar feed.
//
// Anonymous by design: a parent's calendar app has no session. The token is
// the whole credential; the database function derives everything else and
// returns no team data unless the answer is 'ok' (migration 0099). This
// route adds nothing to that: it maps the reader's status to an HTTP answer
// (src/lib/calendar/links.ts) and turns an 'ok' payload into .ics text
// (src/lib/calendar/team-calendar-ics.ts).
//
// Every response carries FEED_HEADERS: no shared caching (a regenerated link
// must stop working on the next request) and no indexing.

import { NextResponse } from "next/server";
import { createNoStoreClient } from "@/lib/supabase/no-store";
import { buildTeamCalendarIcs, type TeamCalendarInput } from "@/lib/calendar/team-calendar-ics";
import {
  FEED_HEADERS,
  feedRefusalFor,
  parseTokenParam,
  type ReaderStatus,
} from "@/lib/calendar/links";

export const dynamic = "force-dynamic";
// Second guard on the Data Cache (the first is the no-store client):
// force-dynamic alone does not stop Next caching this route's fetches.
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

function refuse(status: Exclude<ReaderStatus, "ok">): NextResponse {
  const r = feedRefusalFor(status);
  const headers: Record<string, string> = { ...FEED_HEADERS, "Content-Type": "text/plain; charset=utf-8" };
  if (r.retryAfterSeconds) headers["Retry-After"] = String(r.retryAfterSeconds);
  return new NextResponse(r.message + "\n", { status: r.httpStatus, headers });
}

function unavailable(): NextResponse {
  return new NextResponse("Couldn't load this calendar right now. Please try again later.\n", {
    status: 503,
    headers: { ...FEED_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  const token = parseTokenParam(params.token);
  if (!token) return refuse("unknown");

  // A plain anon client — no cookies, no session. The function is granted to
  // anon and takes only the token. no-store, ALWAYS: without it Next kept the
  // first answer for a token for a year (see no-store.ts).
  const supabase = createNoStoreClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase.rpc("get_team_calendar_by_token", { p_token: token });
  if (error || !data || typeof data !== "object") {
    console.error("[calendar feed] reader failed:", error?.message ?? "no data");
    return unavailable();
  }

  const payload = data as { status: ReaderStatus };
  if (payload.status !== "ok") {
    return refuse(payload.status);
  }

  const built = buildTeamCalendarIcs(payload as unknown as TeamCalendarInput);
  if (!built.ok) {
    // A configuration fault (unsupported zone, unreadable stamp) — log it,
    // never put it on the wire.
    console.error("[calendar feed] builder refused:", built.error);
    return unavailable();
  }

  return new NextResponse(built.ics, {
    status: 200,
    headers: {
      ...FEED_HEADERS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="schedule.ics"',
    },
  });
}

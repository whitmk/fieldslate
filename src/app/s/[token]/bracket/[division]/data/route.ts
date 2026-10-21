// GET /s/<token>/bracket/<division>/data — the public bracket page's data, as
// JSON (get_league_bracket_by_token, 0116).
//
// The page is a client shell that fetches this, so the HTTP answer — and
// therefore what the edge caches — is decided here: every reader answer is
// cached at the edge for 60 seconds, a failed read is 503 + no-store (the
// public schedule's rules, src/lib/public-schedule/links.ts). A result reaches
// visitors within a minute; the page refetches every minute while visible.

import { NextResponse } from "next/server";
import { dataResponseInit } from "@/lib/public-schedule/links";
import { readPublicBracket } from "@/lib/public-bracket/read";

export const dynamic = "force-dynamic";
// Second guard on the Data Cache (the first is the no-store client):
// force-dynamic alone does not stop Next caching this route's fetches.
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { token: string; division: string } },
): Promise<NextResponse> {
  const result = await readPublicBracket(params.token, params.division);
  const init = dataResponseInit(result.status === "error" ? "error" : "answer");
  return new NextResponse(JSON.stringify(result), init);
}

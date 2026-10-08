// GET /s/<token>/data — the public league schedule's data, as JSON.
//
// The page (/s/<token>) is a client shell that fetches this, so the HTTP
// answer — and therefore what the edge caches — is decided here, in one
// place: every reader answer is cached at the edge for 60 seconds; a failed
// read is 503 + no-store (src/lib/public-schedule/links.ts). Filters run in
// the browser, so one cached response serves every filter.

import { NextResponse } from "next/server";
import { dataResponseInit } from "@/lib/public-schedule/links";
import { readPublicSchedule } from "@/lib/public-schedule/read";

export const dynamic = "force-dynamic";
// Second guard on the Data Cache (the first is the no-store client):
// force-dynamic alone does not stop Next caching this route's fetches.
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  const result = await readPublicSchedule(params.token);
  const init = dataResponseInit(result.status === "error" ? "error" : "answer");
  return new NextResponse(JSON.stringify(result), init);
}

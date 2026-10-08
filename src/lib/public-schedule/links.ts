// Public league schedule — URLs, the embed code, and the HTTP answer for each
// outcome. Pure; the routes, the page and the Settings card all call these so
// they can never disagree about a URL or a cache header.
//
// CACHING (the whole rule):
//   * A READER ANSWER (ok, unknown, off, plan) is cached at the edge for 60
//     seconds and never in the browser: `public, max-age=0, s-maxage=60`.
//     Turning the page off, resetting the link, or a rainout reaches visitors
//     within a minute.
//   * A FAILED READ is `no-store` with status 503. A cached failure would
//     serve "couldn't load" for a minute after the database recovered; worse,
//     a cached EMPTY answer would look like a real schedule with no games.
//     Mutant PM5 in the sim gives the error path the ok headers.
//
// URLS ARE BUILT FROM SITE_URL (www) — CLAUDE.md, canonical domain.

import { SITE_URL } from "@/lib/site";
import { TOKEN_RE } from "./types";

export const PUBLIC_SCHEDULE_PATH = "/s";

/** The edge-cache rule for a reader answer. */
export const CACHE_READER_ANSWER = "public, max-age=0, s-maxage=60";
/** The rule for a failed read. */
export const CACHE_NEVER = "private, no-store";

export function parseToken(param: string | undefined): string | null {
  return param && TOKEN_RE.test(param) ? param : null;
}

/** The .ics route's segment is "<token>.ics". */
export function parseFeedToken(param: string | undefined): string | null {
  if (!param || !param.endsWith(".ics")) return null;
  return parseToken(param.slice(0, -".ics".length));
}

export function publicScheduleUrl(token: string): string {
  return `${SITE_URL}${PUBLIC_SCHEDULE_PATH}/${token}`;
}

export function publicScheduleFeedUrls(token: string): { https: string; webcal: string } {
  const https = `${SITE_URL}${PUBLIC_SCHEDULE_PATH}/${token}.ics`;
  return { https, webcal: https.replace(/^https:\/\//, "webcal://") };
}

export const EMBED_HEIGHT_PX = 700;

/** The code an admin pastes into their site builder. Fixed height; the page
 *  scrolls inside the frame. The title is what a screen reader announces. */
export function embedCode(token: string, orgName: string | null): string {
  const title = `${orgName?.trim() || "League"} games`.replace(/"/g, "&quot;");
  return `<iframe src="${publicScheduleUrl(token)}?embed=1" title="${title}" width="100%" height="${EMBED_HEIGHT_PX}" style="border:0" loading="lazy"></iframe>`;
}

export type ResponseInit = { status: number; headers: Record<string, string> };

/** Headers for the page's data route. `outcome` is "answer" for every reader
 *  answer and "error" for a failed read. */
export function dataResponseInit(outcome: "answer" | "error"): ResponseInit {
  const base = { "Content-Type": "application/json; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" };
  if (outcome === "error") {
    return { status: 503, headers: { ...base, "Cache-Control": CACHE_NEVER, "Retry-After": "60" } };
  }
  return { status: 200, headers: { ...base, "Cache-Control": CACHE_READER_ANSWER } };
}

export type FeedAnswer =
  | { kind: "ics" }
  | { kind: "refuse"; status: number; message: string; retryAfterSeconds?: number };

/** What the all-games .ics feed answers for a non-calendar outcome. A
 *  temporary condition is 503 + Retry-After so a calendar app keeps its last
 *  copy instead of wiping every game from a parent's phone. */
export function feedRefusal(
  outcome: "unknown" | "off" | "plan" | "nothing_published" | "error",
): Exclude<FeedAnswer, { kind: "ics" }> {
  switch (outcome) {
    case "unknown":
      return { kind: "refuse", status: 404, message: "This calendar link isn't recognized." };
    case "off":
    case "plan":
      return { kind: "refuse", status: 410, message: "This league has turned off its public schedule." };
    case "nothing_published":
      return {
        kind: "refuse",
        status: 503,
        retryAfterSeconds: 3600,
        message: "This league has no published games right now. Your calendar will update when it does.",
      };
    case "error":
      return {
        kind: "refuse",
        status: 503,
        retryAfterSeconds: 300,
        message: "Couldn't load this calendar right now. Please try again later.",
      };
  }
}

// Team calendar feed — the URL, the webcal twin, the coach message, and the
// HTTP answer for each reader status. Pure; the route and the admin dialog
// both call these so the two can never disagree about a URL or a status.
//
// URLS ARE BUILT FROM SITE_URL (www). The bare domain 307-redirects, and
// calendar clients do not reliably follow a redirect on a subscription URL.
// The webcal:// form is the SAME URL with the scheme swapped: iPhone, iPad
// and Mac open it straight into "Subscribe". Google Calendar and Outlook take
// the https:// form via "add from URL".

import { SITE_URL } from "@/lib/site";

export const CALENDAR_HELP_PATH = "/help/calendar";

export type ReaderStatus =
  | "ok"
  | "unknown"
  | "revoked"
  | "off"
  | "expired"
  | "plan"
  | "unlocked";

const TOKEN_RE = /^[0-9a-f]{64}$/;

/** The route's dynamic segment is "<token>.ics". Anything else is null. */
export function parseTokenParam(param: string | undefined): string | null {
  if (!param || !param.endsWith(".ics")) return null;
  const token = param.slice(0, -".ics".length);
  return TOKEN_RE.test(token) ? token : null;
}

export function calendarFeedPath(token: string): string {
  return `/calendar/${token}.ics`;
}

export function calendarUrls(token: string): { https: string; webcal: string } {
  const https = `${SITE_URL}${calendarFeedPath(token)}`;
  return { https, webcal: https.replace(/^https:\/\//, "webcal://") };
}

export function calendarHelpUrl(): string {
  return `${SITE_URL}${CALENDAR_HELP_PATH}`;
}

/** Headers on EVERY feed response, success or not: never cached by a shared
 *  cache (a regenerated link must die on the next request, and a CDN copy
 *  would keep serving it) and never indexed. */
export const FEED_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export type FeedRefusal = {
  httpStatus: number;
  message: string;
  /** Present only for a TEMPORARY condition, so a calendar app keeps its
   *  last good copy and tries again later. */
  retryAfterSeconds?: number;
};

/** What a non-ok reader status becomes on the wire. Plain sentences: the
 *  reader is a phone's calendar app or a person pasting the URL into a
 *  browser; neither wants a code. */
export function feedRefusalFor(status: Exclude<ReaderStatus, "ok">): FeedRefusal {
  switch (status) {
    case "unknown":
      return { httpStatus: 404, message: "This calendar link isn't recognized." };
    case "revoked":
      return {
        httpStatus: 410,
        message: "This calendar link was replaced. Ask your league for the current link.",
      };
    case "off":
      return { httpStatus: 410, message: "This team's calendar has been turned off by the league." };
    case "expired":
      return { httpStatus: 410, message: "This season has ended, so its calendar is no longer available." };
    case "plan":
      return { httpStatus: 403, message: "This league's plan doesn't include calendar feeds." };
    case "unlocked":
      // A draft: the admin unlocked the schedule to edit it. Temporary by
      // design — the calendar app should hold what it has and check back.
      return {
        httpStatus: 503,
        retryAfterSeconds: 3600,
        message: "This schedule is being edited. Your calendar will update once it's published again.",
      };
  }
}

/** The message a coach pastes into the family email. Both links, because the
 *  webcal one is one tap on an iPhone and the https one is what Google
 *  Calendar and Outlook ask for. */
export function coachMessage(input: {
  teamName: string;
  orgName: string | null;
  seasonName: string | null;
  token: string;
}): string {
  const { https, webcal } = calendarUrls(input.token);
  const who = [input.orgName?.trim(), input.teamName.trim()].filter(Boolean).join(" ");
  const season = input.seasonName?.trim() ? ` for ${input.seasonName.trim()}` : "";
  return [
    `Add the ${who} game schedule${season} to your phone's calendar. It updates itself when games move.`,
    ``,
    `iPhone or Mac — tap this link, then tap Subscribe:`,
    webcal,
    ``,
    `Google Calendar, Android or Outlook — add this address as a calendar "from URL" (Google Calendar needs this done from a computer at calendar.google.com; it then shows on your phone):`,
    https,
    ``,
    `Step-by-step instructions: ${calendarHelpUrl()}`,
    ``,
    `Calendar apps refresh on their own schedule, so same-day changes like rainouts will still come from the league.`,
  ].join("\n");
}

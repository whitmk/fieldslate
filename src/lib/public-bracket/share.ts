// Sharing a playoff bracket's public page — the URLs, whether the Playoffs
// card may copy its link (and the one line saying why not), the scores switch
// words, the public schedule's "Bracket →" rule and the Settings card's added
// sentences. Pure. Approved mockup: docs/mockups/public-bracket.html.
//
// THE DATABASE IS THE AUTHORITY: get_league_bracket_by_token (0116) refuses
// every case below on its own. These rules only decide what the admin sees
// before copying, and must refuse at least what the reader refuses.

import { SITE_URL } from "@/lib/site";
import { PUBLIC_SCHEDULE_PATH } from "@/lib/public-schedule/links";

/** The page's path (relative — the public schedule links to it). */
export function bracketPath(token: string, divisionId: string): string {
  return `${PUBLIC_SCHEDULE_PATH}/${token}/bracket/${divisionId}`;
}

/** The link the Playoffs card copies — always www (SITE_URL). */
export function publicBracketUrl(token: string, divisionId: string): string {
  return `${SITE_URL}${bracketPath(token, divisionId)}`;
}

/** Double elimination is not shareable yet (decided 2026-10-20). */
export function formatShareable(format: string): boolean {
  return format !== "double_elimination";
}

export type ShareInput = {
  plan: string | null;
  /** The org's public schedule link: null = none made yet; "unreadable" =
   *  the read failed (never shown as "off"). */
  link: { token: string; enabled: boolean } | null | "unreadable";
  /** The card's bracket (Stage 1 of a pair). */
  status: string;
  format: string;
  divisionName: string;
  /** null = couldn't read it. */
  divisionLocked: boolean | null;
};

export type ShareState =
  | { canCopy: true; url: string }
  | { canCopy: false; why: string; fix: { label: string; href: string } | null };

/** Whether the card may copy its link, else the ONE line saying why — in the
 *  order an admin can act on: plan, the public page, draft, format, lock. */
export function shareState(i: ShareInput, divisionId: string, seasonId: string): ShareState {
  if (i.plan !== "pro" && i.plan !== "elite") {
    return { canCopy: false, why: "Public pages are on the Pro and Elite plans.", fix: null };
  }
  if (i.link === "unreadable") {
    return { canCopy: false, why: "Couldn't check your public schedule link, so the link isn't offered.", fix: null };
  }
  if (!i.link || !i.link.enabled) {
    return {
      canCopy: false,
      why: "The public schedule is off, so bracket links don't work.",
      fix: { label: "Turn it on in Settings", href: "/dashboard/settings" },
    };
  }
  if (i.status === "draft") {
    return { canCopy: false, why: "A draft bracket isn't public. Generate its games to share it.", fix: null };
  }
  if (!formatShareable(i.format)) {
    return { canCopy: false, why: "Double elimination brackets can't be shared yet.", fix: null };
  }
  if (i.divisionLocked !== true) {
    return {
      canCopy: false,
      why:
        i.divisionLocked === null
          ? `Couldn't check whether ${i.divisionName}'s schedule is locked, so the link isn't offered.`
          : `${i.divisionName}'s schedule isn't locked, so its bracket isn't public yet.`,
      fix: i.divisionLocked === null ? null : { label: "Lock it on the season page", href: `/dashboard/leagues/${seasonId}` },
    };
  }
  return { canCopy: true, url: publicBracketUrl(i.link.token, divisionId) };
}

/** The scores switch shows for a bracket that can ever be public: not a
 *  draft, not double elimination. */
export function scoresSwitchShown(status: string, format: string): boolean {
  return status !== "draft" && formatShareable(format);
}

export const SHARE_WORDS = {
  label: "Public page",
  copy: "Copy public link",
  open: "Open ↗",
  copied: "Link copied",
  copyFailed: "Couldn't copy. The link is:",
  scores: "Show scores publicly",
  scoresOff: "Scores are hidden on the public page. It shows who won and who moves on.",
  saved: "Saved",
  saveFailed: "Couldn't save. Try again.",
} as const;

/** The public schedule's "Bracket →" on a playoff row: only for a shareable
 *  format (the schedule already lists only locked, non-draft brackets). */
export const BRACKET_LINK_TEXT = "Bracket →";

/** Settings → Public schedule, added sentences (mockup screen 7). */
export const SETTINGS_OFF_ALSO_BRACKETS = "Turning this off also turns off every playoff bracket link.";
export const SETTINGS_RESET_ALSO_BRACKETS = "Playoff bracket links stop working too — copy them again from the Playoffs page.";

/** What set_playoff_public_scores answered: saved (and the value now held),
 *  or not. A reply that doesn't confirm is never "saved". */
export function scoresSaveOutcome(data: unknown, error: unknown, asked: boolean): { ok: true; show: boolean } | { ok: false } {
  if (error || !data || typeof data !== "object") return { ok: false };
  const r = data as { committed?: unknown; show_scores?: unknown };
  if (r.committed !== true || r.show_scores !== asked) return { ok: false };
  return { ok: true, show: asked };
}

// Every sentence about a season held open for its volunteer sign-ups
// (0121 part 4, option b — approved 2026-11-08). Pure; surfaces render these
// verbatim: the season page's banner, the Seasons list tag and the archive
// confirm.
//
// Archiving deletes a season's volunteer names, emails and sign-ups (the
// archive wipe), and unarchiving does not bring them back.

import { fmtSeasonDate } from "./end-date";

export const HOLD_BANNER_ACTION = "Archive it when you're done with them.";

/** The season page's banner — only for a season the auto-archive held. */
export function holdBannerLine(endDate: string | null): string {
  const ended = endDate ? `This season ended ${fmtSeasonDate(endDate)}. ` : "";
  return `${ended}It's still open because it has volunteer sign-ups — archiving deletes volunteer names, emails and sign-ups. ${HOLD_BANNER_ACTION}`;
}

/** The Seasons list tag on a held season. */
export const HOLD_LIST_TAG = "Open: volunteer sign-ups";

/** What the archive confirm knows about the season's sign-ups. */
export type ArchiveSignupsState = "checking" | "none" | "has" | "unknown";

export const ARCHIVE_WITH_SIGNUPS_LINE =
  "This season has volunteer sign-ups. Archiving deletes every volunteer's name, email and sign-ups for it, and unarchiving won't bring them back.";

export const ARCHIVE_SIGNUPS_UNKNOWN_LINE =
  "We couldn't check whether this season has volunteer sign-ups. If it does, archiving deletes them, and unarchiving won't bring them back.";

/** The archive confirm's extra line, or null when there's nothing to say. */
export function archiveSignupsLine(state: ArchiveSignupsState): string | null {
  if (state === "has") return ARCHIVE_WITH_SIGNUPS_LINE;
  if (state === "unknown") return ARCHIVE_SIGNUPS_UNKNOWN_LINE;
  return null;
}

/** The confirm button. Decided 2026-11-08: with sign-ups it says what it does. */
export function archiveButtonLabel(state: ArchiveSignupsState): string {
  return state === "has" ? "Archive and delete sign-ups" : "Archive season";
}

/** Read volunteer_archive_holds' reply for one season. */
export function archiveSignupsState(seasonId: string, reply: { data: unknown; error: unknown }): ArchiveSignupsState {
  if (reply.error || !Array.isArray(reply.data) || !reply.data.every((x) => typeof x === "string")) return "unknown";
  return (reply.data as string[]).includes(seasonId) ? "has" : "none";
}

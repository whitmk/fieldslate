// "Create new link" + "Copy" in the edit-official modal (2026-11-09).
//
// WHY TWO BUTTONS: Safari lets a page write the clipboard only while it is
// still handling the click. The old single button awaited official_issue_link
// first and wrote the clipboard after the reply came back, by which time
// Safari no longer counted the click, so it refused the copy. Now one button
// makes the link and shows it in a field; a separate Copy button writes the
// clipboard as the FIRST thing its click does, with nothing awaited before it.
//
// Pure: no React, no DOM beyond the clipboard object it is handed.

import { officialLinkUrl } from "./page";
import * as W from "./words";

export type IssueOutcome = { ok: true; url: string } | { ok: false; line: string };

/** Reads official_issue_link's reply. Anything but a 64-hex token is a
 *  failure — the old link was only revoked if the call succeeded, and a
 *  failed call rolls back, so "the old one still works" is true. */
export function issueLinkOutcome(data: unknown, error: { message?: string } | null): IssueOutcome {
  const token = (data as { token?: unknown } | null)?.token;
  if (error || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, line: W.adminErrorLine(error?.message, W.LINK_FAILED) };
  }
  return { ok: true, url: officialLinkUrl(token) };
}

export type ClipboardLike = { writeText(text: string): Promise<void> } | undefined | null;

/** Call DIRECTLY from the Copy button's click handler. The clipboard write is
 *  the first statement and nothing is awaited before it, so Safari still sees
 *  the click. Never throws: a missing clipboard or a refusal is "refused",
 *  and the caller keeps the link on screen in its selectable field. */
export function copyLink(url: string, clipboard: ClipboardLike): Promise<"copied" | "refused"> {
  let write: Promise<void>;
  try {
    if (!clipboard) return Promise.resolve("refused");
    write = clipboard.writeText(url);
  } catch {
    return Promise.resolve("refused");
  }
  return write.then(
    () => "copied" as const,
    () => "refused" as const,
  );
}

/** The line under the field after a copy attempt. */
export function copyResultLine(result: "copied" | "refused"): { ok: boolean; line: string } {
  return result === "copied" ? { ok: true, line: W.LINK_COPIED } : { ok: false, line: W.LINK_COPY_REFUSED };
}

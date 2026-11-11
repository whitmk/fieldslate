// Whether officials are emailed when their games change (0130), and the
// sentences that say so: the Settings toggle and the Officials page line.
// Pure apart from the one read (official_notice_state, members).
//
// The four gates live in the database (official_notice_on): Elite, the
// officials feature, a CONFIRMED officials contact email, and the league's
// setting (default on). This module only words the answer.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type NoticeState = {
  elite: boolean;
  feature: boolean;
  contactConfirmed: boolean;
  notify: boolean;
  on: boolean;
};

export const NOTICE_TOGGLE_LABEL = "Email officials when their games move or are rained out";
export const NOTICE_TOGGLE_HINT =
  "Each official gets one email covering their changed games, about 10 minutes after the change. If a change puts an official in two places at once, or on a date they can't work, your officials contact is emailed too. Nobody is taken off a game.";
export const NOTICE_NEEDS_CONTACT = "Needs a confirmed officials contact email.";
export const NOTICE_SAVE_FAILED = "Couldn't save. Try again.";
export const NOTICE_UNREADABLE = "Couldn't check whether officials are emailed when games change.";

const PAGE_OFF = "Officials aren't emailed when games change.";

/** The reply, or null when it can't be read. */
export function parseNoticeState(raw: unknown): NoticeState | null {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const keys = ["elite", "feature", "contact_confirmed", "notify", "on"] as const;
  if (keys.some((k) => typeof r[k] !== "boolean")) return null;
  return {
    elite: r.elite as boolean,
    feature: r.feature as boolean,
    contactConfirmed: r.contact_confirmed as boolean,
    notify: r.notify as boolean,
    on: r.on as boolean,
  };
}

/** The Officials page's one line, or null when there is nothing to say.
 *  Not Elite or the feature off: the page says nothing (the page is Elite,
 *  and a league with officials switched off sends no officials email). */
export function noticeOffLine(s: NoticeState | null): string | null {
  if (s === null) return NOTICE_UNREADABLE;
  if (s.on || !s.elite || !s.feature) return null;
  if (!s.contactConfirmed) return `${PAGE_OFF} Confirm an officials contact email in Settings to turn this on.`;
  if (!s.notify) return `${PAGE_OFF} Turn it on in Settings, under Officials sign-up.`;
  return null;
}

export async function loadNoticeState(
  supabase: SupabaseClient<Database>,
  orgId: string,
  where: string,
): Promise<NoticeState | null> {
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in the hand-maintained types (0130)
    "official_notice_state",
    { p_org_id: orgId },
  );
  if (error) {
    console.error(`[${where}] officials notice state read failed:`, error.message);
    return null;
  }
  return parseNoticeState(data);
}

// ── Youth officials entered before the parent's-email label ─────────────────
// Since 0124 (2026-11-09) a youth official's one email field is labelled
// "Parent or guardian email". One entered before then saw a plain "Email",
// so their row might hold the child's own address — and game-change emails
// go there. The Officials list shows this line on such a row (none existed
// with an email on 2026-11-10; the line is for any that appear).
export const YOUTH_EMAIL_CHECK = "Check that this is a parent's or guardian's email.";
const PARENT_LABEL_FROM = Date.UTC(2026, 10, 10); // the day after 0124 shipped, to be safe

export function youthEmailCheck(o: { designation: string; email: string | null; created_at?: string | null }): string | null {
  if (o.designation !== "youth" || !o.email || !o.email.trim() || !o.created_at) return null;
  const at = Date.parse(o.created_at);
  return Number.isFinite(at) && at < PARENT_LABEL_FROM ? YOUTH_EMAIL_CHECK : null;
}

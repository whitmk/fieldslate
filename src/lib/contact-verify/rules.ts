// League contact email verification (0126) — every rule and sentence the
// Settings field, the send route and the confirm page use. Pure: no React, no
// I/O, no clock (the caller passes "now"). Shared by the volunteer and
// officials cards, so it imports NEITHER feature's code (sim:volunteer-leaks
// U1 walks it).
//
// The model: the settings table's contact_email only ever holds a CONFIRMED
// address; a new one waits in contact_email_verifications until the link sent
// to it is clicked. See supabase/migrations/0126_contact_email_verification.sql.

import { SITE_URL } from "@/lib/site";

export const CONTACT_KINDS = ["volunteers", "official_signup"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export function isContactKind(v: unknown): v is ContactKind {
  return typeof v === "string" && (CONTACT_KINDS as readonly string[]).includes(v);
}

/** What the feature is called in sentences ("volunteer sign-ups"). */
export const KIND_LABEL: Record<ContactKind, string> = {
  volunteers: "volunteer sign-ups",
  official_signup: "officials sign-up",
};

export const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

// ── The state the card reads (contact_verify_state) ────────────────────────
export type Pending = {
  email: string;
  sentAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  resendAfter: string | null;
  sendsLeftToday: number;
};
export type ContactState = { contactEmail: string | null; switchOn: boolean; pending: Pending | null };

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

/** The state reply, or null when it isn't whole — the field then says it
 *  couldn't check, never "nothing waiting". */
export function readContactState(raw: unknown): ContactState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.switch_on !== "boolean" || !("contact_email" in r) || !("pending" in r)) return null;
  if (r.contact_email !== null && typeof r.contact_email !== "string") return null;
  let pending: Pending | null = null;
  if (r.pending !== null) {
    const p = r.pending as Record<string, unknown>;
    if (!p || typeof p !== "object" || !str(p.email) || typeof p.expired !== "boolean" || typeof p.sends_left_today !== "number") {
      return null;
    }
    pending = {
      email: p.email as string,
      sentAt: str(p.sent_at),
      expiresAt: str(p.expires_at),
      expired: p.expired,
      resendAfter: str(p.resend_after),
      sendsLeftToday: p.sends_left_today,
    };
  }
  return { contactEmail: (r.contact_email as string | null) ?? null, switchOn: r.switch_on, pending };
}

// ── The field ───────────────────────────────────────────────────────────────
export const IN_USE = "In use";
export const CONFIRMED_TAG = "Confirmed";
export const NO_CONTACT = "No confirmed contact email yet.";
export const SAVE_AND_SEND = "Save and send link";
export const RESEND = "Resend link";
export const SEND_FIRST = "Send confirmation link";
export const CANCEL_PENDING = "Cancel";
export const CHECK_AGAIN = "I've confirmed it — check again";
export const REMOVE_CONTACT = "Remove";
export const REMOVE_WHILE_ON = "Turn sign-up off before removing the contact email.";
export const STATE_FAILED = "Couldn't check whether an address is waiting to be confirmed. Reload to try again.";
export const NEEDS_CONFIRMED = "Confirm a contact email first.";
export const CONFIRM_RULE =
  "A new address isn't used until someone clicks the link we email to it. Until then, emails keep using the address in use.";

/** "Nov 16" in the viewer's browser — formatted by the caller after mount. */
export type DateFmt = (iso: string) => string;

/** The waiting address's lines, decided here so the sim drives them. */
export function pendingLines(p: Pending, fmt: DateFmt): { title: string; detail: string; tone: "amber" | "red" } {
  if (!p.sentAt) {
    return { title: `Not confirmed yet: ${p.email}`, detail: "No link has been sent to it yet. Send one to confirm it.", tone: "amber" };
  }
  if (p.expired || !p.expiresAt) {
    return { title: `Not confirmed: ${p.email}`, detail: "The confirmation link expired. Send a new one.", tone: "red" };
  }
  return {
    title: `Waiting for confirmation: ${p.email}`,
    detail: `We emailed a link to it. It works once, until ${fmt(p.expiresAt)}.`,
    tone: "amber",
  };
}

/** Whether Resend can be pressed now, and why not. */
export function resendBlocked(p: Pending, nowMs: number): string | null {
  if (p.sendsLeftToday <= 0) return "That's 5 links today. Try again tomorrow.";
  if (p.resendAfter && Date.parse(p.resendAfter) > nowMs) return "You can send another link in a minute.";
  return null;
}

/** Whether "Save and send link" can be pressed for this draft. */
export function saveDraftAllowed(draft: string, state: ContactState | null): boolean {
  const d = draft.trim().toLowerCase();
  if (!d) return false;
  if (state?.contactEmail && state.contactEmail.toLowerCase() === d) return false;
  return true;
}

/** The sign-up switch's "can't turn on" line, or null. Off is always allowed. */
export function switchBlocked(switchOn: boolean, confirmedContact: string | null): string | null {
  if (switchOn) return null;
  return confirmedContact ? null : NEEDS_CONFIRMED;
}

// ── Replies → sentences ─────────────────────────────────────────────────────
const ERROR_LINES: Record<string, string> = {
  invalid_email: "That isn't an email address we can send to.",
  no_pending: "There's no address waiting to be confirmed.",
  too_soon: "You can send another link in a minute.",
  too_many: "That's 5 links today. Try again tomorrow.",
  plan_required: "This is part of the Elite plan.",
  contact_required: REMOVE_WHILE_ON,
  not_authorized: "You don't have access to this league's settings.",
  feature_off: "This feature isn't turned on for your league.",
  switched_league: "You switched leagues in another tab. Reload this page.",
  not_signed_in: "Your session ended. Sign in again.",
  send_failed: "We couldn't send the email. Try Resend in a minute.",
  not_sent: "Nothing was sent. Try again.",
};
export const SOMETHING_WRONG = "Something went wrong. Nothing was changed. Try again.";

/** A refusal key (or a Postgres message that contains one) → its sentence. */
export function errorLine(keyOrMessage: string | null | undefined): string {
  if (!keyOrMessage) return SOMETHING_WRONG;
  if (ERROR_LINES[keyOrMessage]) return ERROR_LINES[keyOrMessage];
  const hit = Object.keys(ERROR_LINES).find((k) => keyOrMessage.includes(k));
  return hit ? ERROR_LINES[hit] : SOMETHING_WRONG;
}

export function sentLine(email: string): string {
  return `We sent a confirmation link to ${email}. It isn't used until it's confirmed.`;
}
export const ALREADY_CONFIRMED = "That address is already confirmed and in use.";
export const CANCELLED = "Cancelled. The link we sent no longer works.";
export const REMOVED = "Contact email removed.";

/** The send route's JSON reply → what the field shows. */
export function sendOutcome(status: number, body: unknown): { ok: boolean; line: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (status === 200 && b.status === "sent" && typeof b.email === "string") return { ok: true, line: sentLine(b.email) };
  if (status === 200 && b.status === "already_confirmed") return { ok: true, line: ALREADY_CONFIRMED };
  return { ok: false, line: errorLine(typeof b.error === "string" ? b.error : null) };
}

// ── The send route's flow (driven by the sim with fakes) ────────────────────
export type SendBody = { orgId: string; kind: ContactKind; email: string | null };

export function parseSendBody(raw: unknown): SendBody | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.orgId !== "string" || !isContactKind(r.kind)) return null;
  if (r.email !== undefined && r.email !== null && typeof r.email !== "string") return null;
  const email = typeof r.email === "string" && r.email.trim() ? r.email.trim() : null;
  return { orgId: r.orgId, kind: r.kind, email };
}

export type SendDeps = {
  userId: () => Promise<string | null>;
  currentOrgId: (userId: string) => Promise<string>;
  /** contact_verify_begin, AS THE SIGNED-IN USER. */
  begin: (b: SendBody) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** contact_verify_take, service role. */
  take: (orgId: string, kind: ContactKind) => Promise<{ data: unknown; error: { message: string } | null }>;
  send: (to: string, email: { subject: string; html: string; text: string }) => Promise<{ ok: boolean }>;
};

/** The whole send: who → which org → begin (as the user) → take (server) →
 *  email the address TAKE returned (never the request's). */
export async function runSend(raw: unknown, deps: SendDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const userId = await deps.userId();
  if (!userId) return { status: 401, body: { error: "not_signed_in" } };
  const b = parseSendBody(raw);
  if (!b) return { status: 400, body: { error: "bad_request" } };
  if ((await deps.currentOrgId(userId)) !== b.orgId) return { status: 409, body: { error: "switched_league" } };

  const begun = await deps.begin(b);
  if (begun.error) return { status: 400, body: { error: errorKey(begun.error.message) } };
  const bs = (begun.data as { status?: unknown } | null)?.status;
  if (bs === "already_confirmed") return { status: 200, body: { status: "already_confirmed" } };
  if (bs !== "requested") return { status: 500, body: { error: "not_sent" } };

  const taken = await deps.take(b.orgId, b.kind);
  const t = (taken.data ?? {}) as Record<string, unknown>;
  if (taken.error || t.status !== "ok" || typeof t.token !== "string" || !TOKEN_SHAPE.test(t.token) || typeof t.email !== "string") {
    return { status: 500, body: { error: "not_sent" } };
  }
  const mail = confirmEmail({
    kind: b.kind,
    token: t.token,
    leagueName: typeof t.league_name === "string" ? t.league_name : null,
  });
  const sent = await deps.send(t.email, mail);
  if (!sent.ok) return { status: 502, body: { error: "send_failed" } };
  return { status: 200, body: { status: "sent", email: t.email } };
}

/** The refusal key inside a Postgres error message, or "unknown". */
export function errorKey(message: string): string {
  return Object.keys(ERROR_LINES).find((k) => message.includes(k)) ?? "unknown";
}

// ── The email ───────────────────────────────────────────────────────────────
export function confirmUrl(token: string): string {
  return `${SITE_URL}/confirm-email/${token}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function leagueText(name: string | null): string {
  const n = (name ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
  return n || "your league";
}

/** Sent from FieldSlate's own address, with NO reply-to (the address isn't
 *  confirmed — that's the point). */
export function confirmEmail(a: { kind: ContactKind; token: string; leagueName: string | null }) {
  const league = leagueText(a.leagueName);
  const url = confirmUrl(a.token);
  const what = KIND_LABEL[a.kind];
  const subject = `Confirm the contact email for ${league}`;
  const text = [
    `Someone at ${league} entered this address as the contact email for ${what} on FieldSlate.`,
    `Replies from volunteers or officials, and league notices, would come here.`,
    ``,
    `To confirm it, open this link (it works once, for 7 days):`,
    url,
    ``,
    `If you didn't expect this, ignore it — nothing changes unless the link is opened and confirmed.`,
  ].join("\n");
  const html = `<p>Someone at ${esc(league)} entered this address as the contact email for ${esc(what)} on FieldSlate. Replies from volunteers or officials, and league notices, would come here.</p>
<p><a href="${url}">Confirm this address</a> — the link works once, for 7 days.</p>
<p>If you didn't expect this, ignore it. Nothing changes unless the link is opened and confirmed.</p>`;
  return { subject, html, text };
}

// ── The confirm page ────────────────────────────────────────────────────────
export type ConfirmView =
  | { kind: "ask"; title: string; detail: string; button: string }
  | { kind: "done"; title: string; detail: string }
  | { kind: "gone"; title: string; detail: string }
  | { kind: "error"; title: string; detail: string };

export const CONFIRM_BUTTON = "Confirm this address";
const GONE: ConfirmView = {
  kind: "gone",
  title: "This link isn't working",
  detail: "It may have been used already, or a newer link was sent. Ask your league to send a new one from Settings.",
};
const EXPIRED: ConfirmView = {
  kind: "gone",
  title: "This link expired",
  detail: "Confirmation links work for 7 days. Ask your league to send a new one from Settings.",
};
export const LOAD_FAILED: ConfirmView = {
  kind: "error",
  title: "We couldn't load this right now",
  detail: "Nothing was changed. Try again in a minute.",
};

/** peek's reply (GET) or confirm's reply (POST) → what the page shows. */
export function confirmView(raw: unknown): ConfirmView {
  const r = (raw ?? {}) as Record<string, unknown>;
  const league = leagueText(typeof r.league_name === "string" ? r.league_name : null);
  const what = isContactKind(r.kind) ? KIND_LABEL[r.kind] : null;
  if (r.status === "ok" && typeof r.email === "string" && what) {
    return {
      kind: "ask",
      title: `Confirm ${r.email}`,
      detail: `${league} wants to use ${r.email} as its contact email for ${what} on FieldSlate. Replies and league notices will come here.`,
      button: CONFIRM_BUTTON,
    };
  }
  if (r.status === "confirmed" && typeof r.email === "string" && what) {
    return { kind: "done", title: "Confirmed", detail: `${r.email} is now ${league}'s contact email for ${what}. You can close this page.` };
  }
  if (r.status === "expired") return EXPIRED;
  if (r.status === "unknown") return GONE;
  return LOAD_FAILED;
}

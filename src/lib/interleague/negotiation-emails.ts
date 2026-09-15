// Emails for negotiating an interleague game's time.
//
// Pure builders (no sending): each returns { subject, html, text }. Routes send
// them and CHECK the result — a negotiation step whose email silently failed is
// a dead end, because the other league's only way in is the link inside it.
//
// Wording rule: a game that is not yet agreed is never called a "reschedule".
// Nothing has been scheduled yet; the leagues are settling on a time.
//
// All absolute links use SITE_URL (CLAUDE.md).

import { SITE_URL } from "@/lib/site";

export type EmailParts = { subject: string; html: string; text: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wall-clock formatting from the ISO substrings — never parses the instant.
 *  "Tue, Sep 29, 2026, 5:00 PM". */
export function fmtWhen(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-").map(Number);
  const [hourStr, minStr] = iso.replace(" ", "T").substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const weekday = WEEKDAYS[new Date(year, month - 1, day, 12).getDay()];
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${weekday}, ${MONTHS[month - 1]} ${day}, ${year}, ${h12}:${minStr} ${period}`;
}

export function scheduleUrl(scheduleToken: string): string {
  return `${SITE_URL}/schedule/${encodeURIComponent(scheduleToken)}`;
}
export function respondUrl(requestToken: string): string {
  return `${SITE_URL}/reschedule/${encodeURIComponent(requestToken)}`;
}
export function dashboardUrl(): string {
  return `${SITE_URL}/dashboard/interleague`;
}

type Row = { label: string; value: string; strong?: boolean };

function layout(p: {
  kicker: string;
  title: string;
  intro: string;
  rows: Row[];
  button?: { href: string; label: string };
  footnote?: string;
}): string {
  const rows = p.rows
    .map(
      (r, i) =>
        `<tr><td style="padding:8px 12px;${i < p.rows.length - 1 ? "border-bottom:1px solid #eee;" : ""}color:#6b7280;width:35%;">${escapeHtml(r.label)}</td><td style="padding:8px 12px;${i < p.rows.length - 1 ? "border-bottom:1px solid #eee;" : ""}${r.strong ? "font-weight:600;" : ""}">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="${SITE_URL}/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(p.kicker)}</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">${escapeHtml(p.title)}</h1>
      <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55;">${escapeHtml(p.intro)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px;border:1px solid #eee;border-radius:6px;overflow:hidden;"><tbody>${rows}</tbody></table>
      ${
        p.button
          ? `<div style="margin:24px 0 4px;"><a href="${p.button.href}" style="display:inline-block;background:#22C55E;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">${escapeHtml(p.button.label)}</a></div>
      <p style="margin:14px 0 0;color:#9ca3af;font-size:12px;">Or paste this link in your browser:<br/><a href="${p.button.href}" style="color:#22C55E;word-break:break-all;">${escapeHtml(p.button.href)}</a></p>`
          : ""
      }
      ${p.footnote ? `<p style="margin:18px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">${escapeHtml(p.footnote)}</p>` : ""}
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">FieldSlate · Scheduling for youth sports leagues.</p>
    </div>
  </div>
</body></html>`;
}

function textOf(p: { title: string; intro: string; rows: Row[]; link?: string; footnote?: string }): string {
  return [
    p.title,
    "",
    p.intro,
    "",
    ...p.rows.map((r) => `${r.label}: ${r.value}`),
    ...(p.link ? ["", p.link] : []),
    ...(p.footnote ? ["", p.footnote] : []),
    "",
    "— FieldSlate",
  ].join("\n");
}

export type NegotiationGame = {
  /** Matchup from the PARTNER's side: "{their team} vs {our team}". */
  matchup: string;
  division: string;
  /** The field, as the partner should read it (qualified label, or their field). */
  field: string | null;
  /** The time the game was first offered at. */
  originalIso: string;
  /** The partner's standing proposal, if any. */
  partnerProposalIso: string | null;
};

/** To the PARTNER: the host suggests a different time for a game not yet agreed. */
export function hostProposalEmail(p: {
  hostLeague: string;
  game: NegotiationGame;
  proposedIso: string;
  note: string | null;
  round: number;
  requestToken: string;
}): EmailParts {
  const subject = `${p.hostLeague} suggested a different time: ${p.game.matchup}`;
  const title = `${p.hostLeague} suggested a different time`;
  const intro = `${p.game.matchup} (${p.game.division}) isn't confirmed yet. ${p.hostLeague} can't make the time you proposed and has suggested another.`;
  const rows: Row[] = [
    { label: `${p.hostLeague}'s time`, value: fmtWhen(p.proposedIso), strong: true },
    ...(p.game.partnerProposalIso ? [{ label: "You proposed", value: fmtWhen(p.game.partnerProposalIso) }] : []),
    { label: "First offered", value: fmtWhen(p.game.originalIso) },
    ...(p.game.field ? [{ label: "Field", value: p.game.field }] : []),
    ...(p.note ? [{ label: "Note", value: p.note }] : []),
    { label: "Round", value: String(p.round) },
  ];
  const footnote =
    "Accept their time to confirm the game, suggest another time, or decline — declining keeps your own proposal in front of them.";
  const link = respondUrl(p.requestToken);
  return {
    subject,
    html: layout({ kicker: "A different time", title, intro, rows, button: { href: link, label: "Respond" }, footnote }),
    text: textOf({ title, intro, rows, link: `Respond: ${link}`, footnote }),
  };
}

/** To the PARTNER: the host withdrew its suggested time. */
export function hostWithdrewEmail(p: {
  hostLeague: string;
  game: NegotiationGame;
  withdrawnIso: string;
  scheduleToken: string | null;
}): EmailParts {
  const subject = `${p.hostLeague} withdrew its suggested time: ${p.game.matchup}`;
  const title = `${p.hostLeague} withdrew its suggested time`;
  const intro = `${p.hostLeague} is no longer suggesting ${fmtWhen(p.withdrawnIso)} for ${p.game.matchup} (${p.game.division}). The game still isn't confirmed — ${p.hostLeague} will come back to you${p.game.partnerProposalIso ? " about your proposal" : ""}.`;
  const rows: Row[] = [
    ...(p.game.partnerProposalIso ? [{ label: "You proposed", value: fmtWhen(p.game.partnerProposalIso), strong: true }] : []),
    { label: "First offered", value: fmtWhen(p.game.originalIso) },
    ...(p.game.field ? [{ label: "Field", value: p.game.field }] : []),
  ];
  const link = p.scheduleToken ? scheduleUrl(p.scheduleToken) : null;
  return {
    subject,
    html: layout({
      kicker: "Suggestion withdrawn",
      title,
      intro,
      rows,
      button: link ? { href: link, label: "View your schedule" } : undefined,
    }),
    text: textOf({ title, intro, rows, link: link ? `Your schedule: ${link}` : undefined }),
  };
}

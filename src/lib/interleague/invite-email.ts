// Shared invite-email builder. Used by both the initial-send route
// (api/interleague/invites POST) and the resend route — keep them rendering
// identical content so the recipient sees the same email regardless of whether
// it's the first or a repeat delivery.

import { SITE_URL } from "@/lib/site";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildInviteEmail(params: {
  inviteUrl: string;
  // The sending LEAGUE (profiles.org_name, falling back to the admin's name
  // when org_name is unset) — the recipient is choosing whether to play a
  // league, not a person.
  senderOrgName: string;
  // The admin's personal name, shown only as a "Sent by" signature line (and
  // only when it differs from the org name).
  senderPersonalName: string | null;
  seasonLabel: string;
  orgName: string;
  personalNote: string | null;
  games: { divisionName: string; gameCount: number }[];
}): { html: string; text: string } {
  const {
    inviteUrl,
    senderOrgName,
    senderPersonalName,
    seasonLabel,
    orgName,
    personalNote,
    games,
  } = params;

  const signature =
    senderPersonalName && senderPersonalName.trim() !== senderOrgName.trim()
      ? senderPersonalName.trim()
      : null;

  const totalGames = games.reduce((sum, g) => sum + g.gameCount, 0);

  const gameRows = games
    .map(
      (g) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(g.divisionName)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${g.gameCount}</td>
    </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="${SITE_URL}/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Interleague invite</p>
    </div>

    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        You've been invited to schedule interleague games with ${escapeHtml(senderOrgName)}
      </h1>
      <p style="margin:0 0 20px;color:#4b5563;font-size:14px;line-height:1.55;">
        ${escapeHtml(senderOrgName)} is using FieldSlate to plan the <strong>${escapeHtml(seasonLabel)}</strong> season and would like to schedule interleague games with <strong>${escapeHtml(orgName)}</strong>.
      </p>

      ${
        personalNote
          ? `<div style="margin:0 0 20px;padding:14px 16px;background:#f9fafb;border-left:3px solid #22C55E;border-radius:4px;">
        <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Personal note</p>
        <p style="margin:0;color:#0C1F3F;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(personalNote)}</p>
      </div>`
          : ""
      }

      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0C1F3F;">Proposed games</p>
      ${
        games.length === 0
          ? `<p style="margin:0 0 20px;color:#6b7280;font-size:14px;">No divisions configured for interleague play yet.</p>`
          : `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;background:#f9fafb;">
            <th style="padding:8px 12px;border-bottom:1px solid #eee;">Division</th>
            <th style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">Games</th>
          </tr>
        </thead>
        <tbody>${gameRows}
          <tr style="background:#f9fafb;">
            <td style="padding:8px 12px;font-weight:600;color:#0C1F3F;">Total</td>
            <td style="padding:8px 12px;text-align:right;font-weight:700;color:#0C1F3F;">${totalGames}</td>
          </tr>
        </tbody>
      </table>`
      }

      <div style="margin:24px 0 4px;">
        <a href="${inviteUrl}" style="display:inline-block;background:#22C55E;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">View invite</a>
      </div>
      <p style="margin:14px 0 0;color:#9ca3af;font-size:12px;">
        Or paste this link into your browser:<br/>
        <a href="${inviteUrl}" style="color:#22C55E;word-break:break-all;">${escapeHtml(inviteUrl)}</a>
      </p>
      ${
        signature
          ? `<p style="margin:14px 0 0;color:#9ca3af;font-size:12px;">Sent by ${escapeHtml(signature)} for ${escapeHtml(senderOrgName)}.</p>`
          : ""
      }
    </div>

    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.5;">
        FieldSlate is a scheduling tool for youth sports leagues. No account required to respond to this invite.
      </p>
      <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;">
        Curious about FieldSlate for your own league?
        <a href="${SITE_URL}/signup?promo=INTERLEAGUE&amp;utm_source=invite&amp;utm_medium=email" style="color:#22C55E;text-decoration:none;font-weight:600;">Try your first season for 20% off</a>.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `You've been invited to schedule interleague games with ${senderOrgName}.`,
    "",
    `${senderOrgName} is using FieldSlate to plan the ${seasonLabel} season and would like to schedule interleague games with ${orgName}.`,
    "",
    personalNote ? `Personal note:\n${personalNote}\n` : "",
    "Proposed games:",
    ...(games.length === 0
      ? ["  (none configured)"]
      : games.map((g) => `  • ${g.divisionName}: ${g.gameCount}`)),
    "",
    `View invite: ${inviteUrl}`,
    signature ? `\nSent by ${signature} for ${senderOrgName}.` : "",
    "",
    "— FieldSlate, a scheduling tool for youth sports leagues.",
    `Curious about FieldSlate for your own league? Try your first season for 20% off: ${SITE_URL}/signup?promo=INTERLEAGUE`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { html, text };
}

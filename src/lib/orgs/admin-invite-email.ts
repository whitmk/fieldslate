// Shared email builders for org-admin invitations. Two flavors:
//   - direct-add notification ("you've been added to {org}")
//   - email-invite with accept link ("you've been invited to help manage {org}")
// Both are intentionally short and plain — no game-schedule preview, no
// per-org branding.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shellHtml(headlineLabel: string, body: string): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="https://thefieldslate.com/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(headlineLabel)}</p>
    </div>
    <div style="padding:28px;">${body}</div>
    <div style="padding:18px 28px;background:#f9fafb;border-top:1px solid #eee;font-size:12px;color:#6b7280;">
      FieldSlate · Youth sports league scheduling
    </div>
  </div>
</body></html>`;
}

export function buildDirectAddEmail(params: {
  recipientEmail: string;
  orgName: string;
  inviterName: string;
  dashboardUrl: string;
}): { subject: string; html: string; text: string } {
  const { orgName, inviterName, dashboardUrl } = params;

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
      You've been added to ${escapeHtml(orgName)}
    </h1>
    <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.55;">
      ${escapeHtml(inviterName)} added you as an admin on FieldSlate. You can
      now manage seasons, divisions, schedules, and venues for
      <strong>${escapeHtml(orgName)}</strong> alongside your own organization.
    </p>
    <p style="margin:0 0 20px;color:#4b5563;font-size:14px;line-height:1.55;">
      Switch between organizations using the dropdown next to your avatar in
      the FieldSlate header.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#22C55E;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        Open FieldSlate
      </a>
    </p>
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
      Didn't expect this? Reply to this email and we'll sort it out.
    </p>
  `;

  const text = `You've been added to ${orgName} on FieldSlate.

${inviterName} added you as an admin. You can now manage seasons, divisions,
schedules, and venues for ${orgName} alongside your own organization.

Switch between organizations using the dropdown next to your avatar in the
FieldSlate header.

Open FieldSlate: ${dashboardUrl}

Didn't expect this? Reply to this email and we'll sort it out.`;

  return {
    subject: `${inviterName} added you to ${orgName} on FieldSlate`,
    html: shellHtml("Added as admin", body),
    text,
  };
}

export function buildEmailInviteEmail(params: {
  recipientEmail: string;
  orgName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: string; // ISO
}): { subject: string; html: string; text: string } {
  const { orgName, inviterName, acceptUrl, expiresAt } = params;

  const expiresHuman = (() => {
    try {
      return new Date(expiresAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "in 14 days";
    }
  })();

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
      ${escapeHtml(inviterName)} invited you to help manage ${escapeHtml(orgName)}
    </h1>
    <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.55;">
      FieldSlate is a scheduling tool for youth sports leagues.
      ${escapeHtml(inviterName)} would like you to join
      <strong>${escapeHtml(orgName)}</strong> as an admin so you can help
      manage seasons, divisions, and schedules.
    </p>
    <p style="margin:0 0 8px;color:#4b5563;font-size:14px;line-height:1.55;">
      Click the button below to accept. You'll be able to sign in with an
      existing FieldSlate account or create a new one — either way, the
      invitation will be tied to this email address.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#22C55E;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        Accept invitation
      </a>
    </p>
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
      This invitation expires on <strong>${escapeHtml(expiresHuman)}</strong>.
    </p>
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
      Didn't expect this? You can safely ignore the email — nothing happens
      unless you accept.
    </p>
  `;

  const text = `${inviterName} invited you to help manage ${orgName} on FieldSlate.

FieldSlate is a scheduling tool for youth sports leagues. ${inviterName}
would like you to join ${orgName} as an admin so you can help manage seasons,
divisions, and schedules.

Accept the invitation: ${acceptUrl}

The link expires on ${expiresHuman}. Didn't expect this? You can safely
ignore the email — nothing happens unless you accept.`;

  return {
    subject: `${inviterName} invited you to ${orgName} on FieldSlate`,
    html: shellHtml("Admin invitation", body),
    text,
  };
}

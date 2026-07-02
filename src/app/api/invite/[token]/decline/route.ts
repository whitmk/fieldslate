import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { validateNote } from "@/lib/validation/text-length";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

type DeclineRpcReturn = {
  invite_id: string;
  deleted_games: number;
  reason: string | null;
  sender_email: string | null;
  sender_name: string | null;
  org_name: string | null;
  season_name: string | null;
  season_label: string | null;
  recipient_email: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDeclineEmail(params: {
  senderName: string;
  orgName: string;
  seasonLabelDisplay: string;
  reason: string | null;
  deletedGames: number;
  dashboardUrl: string;
}): { html: string; text: string; subject: string } {
  const {
    senderName,
    orgName,
    seasonLabelDisplay,
    reason,
    deletedGames,
    dashboardUrl,
  } = params;

  const subject = `${orgName} declined your interleague invitation`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="${SITE_URL}/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Invite declined</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        ${escapeHtml(orgName)} declined your interleague invitation
      </h1>
      <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55;">
        Hi ${escapeHtml(senderName)} — ${escapeHtml(orgName)} declined the interleague invitation for <strong>${escapeHtml(seasonLabelDisplay)}</strong>.
        ${deletedGames > 0 ? `The ${deletedGames} pending interleague game${deletedGames === 1 ? "" : "s"} against them ${deletedGames === 1 ? "has" : "have"} been removed from your schedule.` : ""}
      </p>
      ${
        reason
          ? `<div style="margin:0 0 18px;padding:12px 14px;background:#f9fafb;border-left:3px solid #ef4444;border-radius:4px;">
        <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Reason</p>
        <p style="margin:0;color:#0C1F3F;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(reason)}</p>
      </div>`
          : ""
      }
      <div style="margin:24px 0 4px;">
        <a href="${dashboardUrl}" style="display:inline-block;background:#0C1F3F;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Open Interleague dashboard</a>
      </div>
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        FieldSlate · Scheduling for youth sports leagues.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `${orgName} declined your interleague invitation for ${seasonLabelDisplay}.`,
    deletedGames > 0
      ? `${deletedGames} pending interleague game${deletedGames === 1 ? "" : "s"} ${deletedGames === 1 ? "has" : "have"} been removed from your schedule.`
      : "",
    reason ? `\nReason:\n${reason}` : "",
    "",
    `Open Interleague dashboard: ${dashboardUrl}`,
    "",
    "— FieldSlate",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { html, text, subject };
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  let body: { reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const reasonCheck = validateNote(body.reason);
  if (!reasonCheck.ok) {
    return NextResponse.json({ error: reasonCheck.error }, { status: 400 });
  }
  const reason = reasonCheck.value;

  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "decline_interleague_invite",
    { p_token: params.token, p_reason: reason },
  );

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("invite_not_found")) {
      return NextResponse.json(
        { error: "This invite link is no longer valid." },
        { status: 404 },
      );
    }
    if (msg.includes("invite_not_pending")) {
      return NextResponse.json(
        { error: "This invite has already been responded to." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: msg || "Failed to decline invite." },
      { status: 500 },
    );
  }

  const result = data as DeclineRpcReturn | null;
  if (!result) {
    return NextResponse.json(
      { error: "Failed to decline invite." },
      { status: 500 },
    );
  }

  if (result.sender_email) {
    const seasonLabelDisplay = result.season_label
      ? `${result.season_name ?? ""}${result.season_label ? ` · ${result.season_label}` : ""}`.trim() ||
        "your season"
      : result.season_name ?? "your season";

    const origin = SITE_URL;
    const dashboardUrl = `${origin.replace(/\/$/, "")}/dashboard/interleague`;

    const { html, text, subject } = buildDeclineEmail({
      senderName: result.sender_name?.trim() || result.sender_email,
      orgName: result.org_name ?? "The invited org",
      seasonLabelDisplay,
      reason: result.reason,
      deletedGames: result.deleted_games,
      dashboardUrl,
    });

    await sendEmail(result.sender_email, subject, html, text);
  }

  return NextResponse.json({ ok: true });
}

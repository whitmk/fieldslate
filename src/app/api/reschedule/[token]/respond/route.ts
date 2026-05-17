import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

type Action = "accept" | "decline" | "counter";

function isAction(s: unknown): s is Action {
  return s === "accept" || s === "decline" || s === "counter";
}

function isoLooksValid(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\+\d{2}:\d{2})?$/.test(s);
}

function normalizeWallClockIso(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00+00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return `${s}+00:00`;
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtIso(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-").map(Number);
  const [hourStr, minStr] = iso.substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);
  const dateStr = new Date(year, month - 1, day, 12).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${dateStr}, ${h12}:${String(min).padStart(2, "0")} ${period}`;
}

function rpcError(msg: string) {
  if (msg.includes("request_not_found"))
    return { status: 404, error: "This reschedule request is no longer valid." };
  if (msg.includes("request_not_pending"))
    return { status: 409, error: "This reschedule request has already been resolved." };
  if (msg.includes("invalid_proposal"))
    return { status: 400, error: "Provide a valid proposed date and time." };
  return { status: 500, error: msg || "Failed to submit response." };
}

function buildHtmlEmail(params: {
  title: string;
  intro: string;
  rows: { label: string; value: string }[];
  dashboardUrl: string;
}): string {
  const { title, intro, rows, dashboardUrl } = params;
  const tableRows = rows
    .map(
      (r) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;width:35%;">${escapeHtml(r.label)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">FieldSlate</p>
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Reschedule update</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">${escapeHtml(title)}</h1>
      <p style="margin:0 0 12px;color:#4b5563;font-size:14px;line-height:1.55;">${escapeHtml(intro)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0 0;border:1px solid #eee;border-radius:6px;overflow:hidden;"><tbody>${tableRows}</tbody></table>
      <div style="margin:24px 0 4px;">
        <a href="${dashboardUrl}" style="display:inline-block;background:#0C1F3F;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Open Interleague dashboard</a>
      </div>
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">FieldSlate · Scheduling for youth sports leagues.</p>
    </div>
  </div>
</body></html>`;
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  let body: {
    action?: unknown;
    scheduled_at?: unknown;
    venue_name?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isAction(body.action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const supabase = createClient();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    new URL(request.url).origin ??
    "https://thefieldslate.com";
  const baseOrigin = origin.replace(/\/$/, "");
  const dashboardUrl = `${baseOrigin}/dashboard/interleague`;

  if (body.action === "accept") {
    const { data, error } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in generated types
      "accept_reschedule_request_by_token",
      { p_token: params.token },
    );
    if (error) {
      const e = rpcError(error.message ?? "");
      return NextResponse.json({ error: e.error }, { status: e.status });
    }
    type Result = {
      old_scheduled_at: string;
      new_scheduled_at: string;
      proposed_venue_name: string | null;
      old_venue_name: string | null;
      is_away: boolean;
      home_team: string;
      external_team: string | null;
      sender_email: string | null;
      sender_name: string | null;
      org_name: string | null;
      division: string | null;
      season_name: string | null;
      season_label: string | null;
    };
    const r = data as Result | null;
    if (r && r.sender_email) {
      const orgName = r.org_name ?? "the recipient";
      const matchup = r.is_away
        ? `${r.home_team} AT ${orgName}${r.external_team ? ` (${r.external_team})` : ""}`
        : `${r.home_team} vs ${r.external_team ?? "TBD"}`;
      const html = buildHtmlEmail({
        title: `${orgName} accepted your reschedule request`,
        intro: `${matchup} (${r.division ?? "—"}) has been moved.`,
        rows: [
          { label: "Old time", value: fmtIso(r.old_scheduled_at) },
          { label: "New time", value: fmtIso(r.new_scheduled_at) },
          ...(r.proposed_venue_name
            ? [{ label: "Venue", value: r.proposed_venue_name }]
            : []),
        ],
        dashboardUrl,
      });
      await sendEmail(
        r.sender_email,
        `Reschedule accepted: ${matchup}`,
        html,
        `${orgName} accepted your reschedule request for ${matchup}.\nNew time: ${fmtIso(r.new_scheduled_at)}\nDashboard: ${dashboardUrl}`,
      );
    }
    return NextResponse.json({ ok: true, action: "accept" });
  }

  if (body.action === "decline") {
    const { data, error } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in generated types
      "decline_reschedule_request_by_token",
      { p_token: params.token },
    );
    if (error) {
      const e = rpcError(error.message ?? "");
      return NextResponse.json({ error: e.error }, { status: e.status });
    }
    type Result = {
      game_scheduled_at: string;
      is_away: boolean;
      home_team: string;
      external_team: string | null;
      sender_email: string | null;
      sender_name: string | null;
      org_name: string | null;
      division: string | null;
    };
    const r = data as Result | null;
    if (r && r.sender_email) {
      const orgName = r.org_name ?? "the recipient";
      const matchup = r.is_away
        ? `${r.home_team} AT ${orgName}${r.external_team ? ` (${r.external_team})` : ""}`
        : `${r.home_team} vs ${r.external_team ?? "TBD"}`;
      const html = buildHtmlEmail({
        title: `${orgName} declined your reschedule request`,
        intro: `${matchup} (${r.division ?? "—"}) will stay at its current time.`,
        rows: [{ label: "Scheduled", value: fmtIso(r.game_scheduled_at) }],
        dashboardUrl,
      });
      await sendEmail(
        r.sender_email,
        `Reschedule declined: ${matchup}`,
        html,
        `${orgName} declined your reschedule request for ${matchup}. It stays at ${fmtIso(r.game_scheduled_at)}.\nDashboard: ${dashboardUrl}`,
      );
    }
    return NextResponse.json({ ok: true, action: "decline" });
  }

  // counter
  const rawWhen = typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
  const rawVenue =
    typeof body.venue_name === "string" ? body.venue_name.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!rawWhen || !isoLooksValid(rawWhen)) {
    return NextResponse.json(
      { error: "Provide a valid proposed date and time." },
      { status: 400 },
    );
  }
  const normalized = normalizeWallClockIso(rawWhen);
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "counter_reschedule_request_by_token",
    {
      p_token: params.token,
      p_proposed_scheduled_at: normalized,
      p_proposed_venue_name: rawVenue || null,
      p_note: note || null,
    },
  );
  if (error) {
    const e = rpcError(error.message ?? "");
    return NextResponse.json({ error: e.error }, { status: e.status });
  }
  type Result = {
    proposed_scheduled_at: string;
    proposed_venue_name: string | null;
    note: string | null;
    is_away: boolean;
    home_team: string;
    external_team: string | null;
    sender_email: string | null;
    sender_name: string | null;
    org_name: string | null;
    division: string | null;
  };
  const r = data as Result | null;
  if (r && r.sender_email) {
    const orgName = r.org_name ?? "the recipient";
    const matchup = r.is_away
      ? `${r.home_team} AT ${orgName}${r.external_team ? ` (${r.external_team})` : ""}`
      : `${r.home_team} vs ${r.external_team ?? "TBD"}`;
    const html = buildHtmlEmail({
      title: `${orgName} suggested a different time`,
      intro: `${matchup} (${r.division ?? "—"}) — they'd like a different time than what you proposed. Review and accept, counter, or decline from your dashboard.`,
      rows: [
        { label: "Their proposal", value: fmtIso(r.proposed_scheduled_at) },
        ...(r.proposed_venue_name
          ? [{ label: "Venue", value: r.proposed_venue_name }]
          : []),
        ...(r.note ? [{ label: "Note", value: r.note }] : []),
      ],
      dashboardUrl,
    });
    await sendEmail(
      r.sender_email,
      `Reschedule counter-proposal: ${matchup}`,
      html,
      `${orgName} counter-proposed for ${matchup}.\nProposed: ${fmtIso(r.proposed_scheduled_at)}${r.proposed_venue_name ? `\nVenue: ${r.proposed_venue_name}` : ""}${r.note ? `\nNote: ${r.note}` : ""}\nReview at ${dashboardUrl}`,
    );
  }
  return NextResponse.json({ ok: true, action: "counter" });
}

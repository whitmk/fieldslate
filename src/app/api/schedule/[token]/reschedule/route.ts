import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

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

export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  let body: {
    game_id?: unknown;
    scheduled_at?: unknown;
    venue_name?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const gameId = typeof body.game_id === "string" ? body.game_id.trim() : "";
  const rawWhen = typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
  const venueName =
    typeof body.venue_name === "string" ? body.venue_name.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!gameId) {
    return NextResponse.json({ error: "Missing game_id." }, { status: 400 });
  }
  if (!rawWhen || !isoLooksValid(rawWhen)) {
    return NextResponse.json(
      { error: "Provide a valid proposed date and time." },
      { status: 400 },
    );
  }
  const normalized = normalizeWallClockIso(rawWhen);

  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "create_reschedule_request_by_schedule_token",
    {
      p_schedule_token: params.token,
      p_game_id: gameId,
      p_proposed_scheduled_at: normalized,
      p_proposed_venue_name: venueName || null,
      p_note: note || null,
    },
  );
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("schedule_not_found")) {
      return NextResponse.json(
        { error: "This schedule link is no longer valid." },
        { status: 404 },
      );
    }
    if (msg.includes("game_not_found")) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }
    if (msg.includes("game_not_on_schedule")) {
      return NextResponse.json(
        { error: "That game isn't part of this schedule." },
        { status: 403 },
      );
    }
    if (msg.includes("game_not_reschedulable")) {
      return NextResponse.json(
        { error: "This game can't be rescheduled right now." },
        { status: 409 },
      );
    }
    if (msg.includes("game_in_past")) {
      return NextResponse.json(
        { error: "This game is in the past." },
        { status: 409 },
      );
    }
    if (msg.includes("invalid_proposal")) {
      return NextResponse.json(
        { error: "Provide a valid proposed date and time." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: msg || "Failed to send request." },
      { status: 500 },
    );
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
    season_name: string | null;
    season_label: string | null;
  };
  const r = data as Result | null;

  // Email the FieldSlate admin — they'll review in their dashboard.
  if (r && r.sender_email) {
    const orgName = r.org_name ?? "the other org";
    const matchup = r.is_away
      ? `${r.home_team} AT ${orgName}${r.external_team ? ` (${r.external_team})` : ""}`
      : `${r.home_team} vs ${r.external_team ?? "TBD"}`;
    const seasonLabel = r.season_label
      ? `${r.season_name ?? ""}${r.season_label ? ` · ${r.season_label}` : ""}`.trim() ||
        "your season"
      : r.season_name ?? "your season";

    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
      new URL(request.url).origin ??
      "https://thefieldslate.com";
    const dashboardUrl = `${origin.replace(/\/$/, "")}/dashboard/interleague`;

    const subject = `Reschedule request from ${orgName}: ${matchup}`;
    const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="https://thefieldslate.com/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Reschedule request</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        ${escapeHtml(orgName)} asked to move a game
      </h1>
      <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55;">
        ${escapeHtml(matchup)} (${escapeHtml(r.division ?? "—")}, ${escapeHtml(seasonLabel)}) — they&apos;d like to reschedule. Review and respond from your Interleague dashboard.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <tbody>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;width:35%;">Proposed</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(fmtIso(r.proposed_scheduled_at))}</td></tr>
          ${r.proposed_venue_name ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;">Proposed venue</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(r.proposed_venue_name)}</td></tr>` : ""}
          ${r.note ? `<tr><td style="padding:8px 12px;color:#6b7280;">Note</td><td style="padding:8px 12px;">${escapeHtml(r.note)}</td></tr>` : ""}
        </tbody>
      </table>
      <div style="margin:24px 0 4px;">
        <a href="${dashboardUrl}" style="display:inline-block;background:#0C1F3F;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Review request</a>
      </div>
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">FieldSlate · Scheduling for youth sports leagues.</p>
    </div>
  </div>
</body></html>`;
    const text = [
      `${orgName} asked to reschedule ${matchup} (${seasonLabel}).`,
      `Proposed: ${fmtIso(r.proposed_scheduled_at)}`,
      r.proposed_venue_name ? `Proposed venue: ${r.proposed_venue_name}` : "",
      r.note ? `Note: ${r.note}` : "",
      "",
      `Review: ${dashboardUrl}`,
    ]
      .filter((l) => l !== "")
      .join("\n");
    await sendEmail(r.sender_email, subject, html, text);
  }

  return NextResponse.json({ ok: true });
}

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
  { params }: { params: { id: string } },
) {
  let body: {
    scheduled_at?: unknown;
    venue_name?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawWhen = typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
  const venueName =
    typeof body.venue_name === "string" ? body.venue_name.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!rawWhen || !isoLooksValid(rawWhen)) {
    return NextResponse.json(
      { error: "Provide a valid proposed date and time." },
      { status: 400 },
    );
  }
  const normalized = normalizeWallClockIso(rawWhen);

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Load + authorize the game.
  type FetchRow = {
    id: string;
    league_id: string;
    interleague_org_id: string | null;
    is_away: boolean;
    status: string;
    scheduled_at: string;
    external_team_name: string | null;
    proposed_venue_name: string | null;
    home_team: { name: string; division: { name: string } | null } | null;
    interleague_org: { name: string } | null;
    league: { id: string; name: string; season: string | null; owner_id: string } | null;
    venue: { name: string } | null;
  };
  const { data: gameRaw, error: gameErr } = await supabase
    .from("games")
    .select(
      `id, league_id, interleague_org_id, is_away, status, scheduled_at,
       external_team_name, proposed_venue_name,
       home_team:teams!home_team_id(name, division:divisions(name)),
       interleague_org:interleague_orgs(name),
       league:leagues(id, name, season, owner_id),
       venue:venues(name)`,
    )
    .eq("id", params.id)
    .single();

  if (gameErr || !gameRaw) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  const game = gameRaw as unknown as FetchRow;
  if (!game.league || game.league.owner_id !== user.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!game.interleague_org_id) {
    return NextResponse.json(
      { error: "Only interleague games can be rescheduled this way." },
      { status: 400 },
    );
  }
  if (game.status !== "scheduled") {
    return NextResponse.json(
      { error: "This game can't be rescheduled right now." },
      { status: 409 },
    );
  }
  if (new Date(game.scheduled_at).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "This game is in the past." },
      { status: 409 },
    );
  }

  // Create the request row, then flip the game.
  const { data: reqRow, error: insertErr } = await supabase
    .from("interleague_reschedule_requests")
    .insert([
      {
        game_id: game.id,
        requested_by_user_id: user.id,
        proposed_scheduled_at: normalized,
        proposed_venue_name: venueName || null,
        note: note || null,
      },
    ])
    .select("id, token")
    .single();
  if (insertErr || !reqRow) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create request." },
      { status: 500 },
    );
  }

  const { error: updErr } = await supabase
    .from("games")
    .update({ status: "reschedule_pending" } as never)
    .eq("id", game.id);
  if (updErr) {
    // Roll back the request to keep state consistent.
    await supabase
      .from("interleague_reschedule_requests")
      .delete()
      .eq("id", reqRow.id);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Look up recipient email via the most recent accepted invite for this
  // (org, season).
  const { data: inviteRow } = await supabase
    .from("interleague_invites")
    .select("recipient_email")
    .eq("interleague_org_id", game.interleague_org_id)
    .eq("season_id", game.league_id)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const recipientEmail = inviteRow?.recipient_email ?? null;

  // Sender name (for email greeting).
  const { data: profileRaw } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();
  const senderName =
    profileRaw?.full_name?.trim() ||
    profileRaw?.email ||
    user.email ||
    "A FieldSlate admin";

  if (recipientEmail) {
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
      new URL(request.url).origin ??
      "https://thefieldslate.com";
    const baseOrigin = origin.replace(/\/$/, "");
    const rescheduleUrl = `${baseOrigin}/reschedule/${reqRow.token}`;

    const homeTeam = game.home_team?.name ?? "Home";
    const externalTeam = game.external_team_name ?? "your team";
    const division = game.home_team?.division?.name ?? "—";
    const seasonLabel = game.league?.season
      ? `${game.league.name} · ${game.league.season}`
      : game.league?.name ?? "the season";
    // Matchup framed from recipient's perspective (their team listed first).
    const matchup = `${externalTeam} vs ${homeTeam}`;

    const subject = `Reschedule request: ${matchup} — ${seasonLabel}`;

    const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">FieldSlate</p>
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Reschedule request</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        ${escapeHtml(senderName)} asked to move a game
      </h1>
      <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55;">
        ${escapeHtml(matchup)} (${escapeHtml(division)}, ${escapeHtml(seasonLabel)}) — they&apos;d like to reschedule. Review the change and accept, counter-propose, or decline.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <tbody>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;width:35%;">Current</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(fmtIso(game.scheduled_at))}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;">Proposed</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(fmtIso(normalized))}</td></tr>
          ${venueName ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;">Proposed venue</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(venueName)}</td></tr>` : ""}
          ${note ? `<tr><td style="padding:8px 12px;color:#6b7280;">Note</td><td style="padding:8px 12px;">${escapeHtml(note)}</td></tr>` : ""}
        </tbody>
      </table>
      <div style="margin:24px 0 4px;">
        <a href="${rescheduleUrl}" style="display:inline-block;background:#22C55E;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Respond</a>
      </div>
      <p style="margin:14px 0 0;color:#9ca3af;font-size:12px;">
        Or paste this link in your browser:<br/>
        <a href="${rescheduleUrl}" style="color:#22C55E;word-break:break-all;">${escapeHtml(rescheduleUrl)}</a>
      </p>
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">FieldSlate · Scheduling for youth sports leagues.</p>
    </div>
  </div>
</body></html>`;

    const text = [
      `${senderName} asked to reschedule ${matchup} (${seasonLabel}).`,
      `Current: ${fmtIso(game.scheduled_at)}`,
      `Proposed: ${fmtIso(normalized)}`,
      venueName ? `Proposed venue: ${venueName}` : "",
      note ? `Note: ${note}` : "",
      "",
      `Respond: ${rescheduleUrl}`,
    ]
      .filter((l) => l !== "")
      .join("\n");

    await sendEmail(recipientEmail, subject, html, text);
  }

  return NextResponse.json({ ok: true, request_id: reqRow.id });
}

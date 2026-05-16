import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

function buildInviteEmail(params: {
  inviteUrl: string;
  senderName: string;
  seasonLabel: string;
  orgName: string;
  personalNote: string | null;
  games: { divisionName: string; gameCount: number }[];
}): { html: string; text: string } {
  const { inviteUrl, senderName, seasonLabel, orgName, personalNote, games } =
    params;

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
      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">FieldSlate</p>
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Interleague invite</p>
    </div>

    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        You've been invited to schedule interleague games with ${escapeHtml(senderName)}
      </h1>
      <p style="margin:0 0 20px;color:#4b5563;font-size:14px;line-height:1.55;">
        ${escapeHtml(senderName)} is using FieldSlate to plan the <strong>${escapeHtml(seasonLabel)}</strong> season and would like to schedule interleague games with <strong>${escapeHtml(orgName)}</strong>.
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
    </div>

    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.5;">
        FieldSlate is a scheduling tool for youth sports leagues. No account required to respond to this invite.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `You've been invited to schedule interleague games with ${senderName}.`,
    "",
    `${senderName} is using FieldSlate to plan the ${seasonLabel} season and would like to schedule interleague games with ${orgName}.`,
    "",
    personalNote ? `Personal note:\n${personalNote}\n` : "",
    "Proposed games:",
    ...(games.length === 0
      ? ["  (none configured)"]
      : games.map((g) => `  • ${g.divisionName}: ${g.gameCount}`)),
    "",
    `View invite: ${inviteUrl}`,
    "",
    "— FieldSlate, a scheduling tool for youth sports leagues.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { html, text };
}

export async function POST(request: Request) {
  let body: {
    interleague_org_id?: unknown;
    season_id?: unknown;
    recipient_email?: unknown;
    personal_note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orgId =
    typeof body.interleague_org_id === "string" ? body.interleague_org_id : "";
  const seasonId = typeof body.season_id === "string" ? body.season_id : "";
  const recipientEmail =
    typeof body.recipient_email === "string"
      ? body.recipient_email.trim()
      : "";
  const personalNote =
    typeof body.personal_note === "string" && body.personal_note.trim()
      ? body.personal_note.trim()
      : null;

  if (!orgId) {
    return NextResponse.json(
      { error: "interleague_org_id is required." },
      { status: 400 },
    );
  }
  if (!seasonId) {
    return NextResponse.json(
      { error: "season_id is required." },
      { status: 400 },
    );
  }
  if (!isValidEmail(recipientEmail)) {
    return NextResponse.json(
      { error: "Enter a valid recipient email address." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Load org (RLS confirms ownership)
  const { data: orgRaw, error: orgErr } = await supabase
    .from("interleague_orgs")
    .select("id, name")
    .eq("id", orgId)
    .single();
  if (orgErr || !orgRaw) {
    return NextResponse.json(
      { error: "Interleague org not found." },
      { status: 404 },
    );
  }

  // Load season (RLS confirms ownership)
  const { data: seasonRaw, error: seasonErr } = await supabase
    .from("leagues")
    .select("id, name, season")
    .eq("id", seasonId)
    .single();
  if (seasonErr || !seasonRaw) {
    return NextResponse.json(
      { error: "Season not found." },
      { status: 404 },
    );
  }

  // Load sender profile name (fallback to email)
  const { data: profileRaw } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();
  const senderName =
    (profileRaw?.full_name && profileRaw.full_name.trim()) ||
    profileRaw?.email ||
    user.email ||
    "A FieldSlate admin";

  // Load division/game proposals for this org, scoped to this season.
  // Two-step: divisions for the season, then their interleague game counts.
  const { data: divsRaw, error: divsErr } = await supabase
    .from("divisions")
    .select("id, name")
    .eq("league_id", seasonId);
  if (divsErr) {
    return NextResponse.json({ error: divsErr.message }, { status: 500 });
  }
  const divisions = (divsRaw ?? []) as { id: string; name: string }[];
  const divisionIds = divisions.map((d) => d.id);

  let games: { divisionName: string; gameCount: number }[] = [];
  if (divisionIds.length > 0) {
    const { data: gamesRaw, error: gamesErr } = await supabase
      .from("division_interleague_games")
      .select("division_id, game_count")
      .eq("interleague_org_id", orgId)
      .in("division_id", divisionIds);
    if (gamesErr) {
      return NextResponse.json({ error: gamesErr.message }, { status: 500 });
    }
    const byId = new Map(divisions.map((d) => [d.id, d.name]));
    games = ((gamesRaw ?? []) as { division_id: string; game_count: number }[])
      .map((g) => ({
        divisionName: byId.get(g.division_id) ?? "Division",
        gameCount: g.game_count,
      }))
      .filter((g) => g.gameCount > 0)
      .sort((a, b) => a.divisionName.localeCompare(b.divisionName));
  }

  // Generate token and insert invite record
  const token = generateToken();
  const { data: inviteRaw, error: insertErr } = await supabase
    .from("interleague_invites")
    .insert([
      {
        token,
        sender_user_id: user.id,
        interleague_org_id: orgId,
        season_id: seasonId,
        recipient_email: recipientEmail,
        personal_note: personalNote,
      },
    ])
    .select("id, token, created_at")
    .single();

  if (insertErr || !inviteRaw) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create invite record." },
      { status: 500 },
    );
  }

  // Build invite URL
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    new URL(request.url).origin ??
    "https://thefieldslate.com";
  const inviteUrl = `${origin.replace(/\/$/, "")}/invite/${token}`;

  const seasonLabel = seasonRaw.season
    ? `${seasonRaw.name} · ${seasonRaw.season}`
    : seasonRaw.name;

  const { html, text } = buildInviteEmail({
    inviteUrl,
    senderName,
    seasonLabel,
    orgName: orgRaw.name,
    personalNote,
    games,
  });

  const subject = `Interleague invite from ${senderName} — ${seasonLabel}`;
  const result = await sendEmail(recipientEmail, subject, html, text);

  if (!result.ok) {
    // Roll back the invite row so we don't leave orphaned pending invites
    await supabase.from("interleague_invites").delete().eq("id", inviteRaw.id);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, invite: inviteRaw });
}

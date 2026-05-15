import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ScheduleGame = {
  id: string;
  scheduled_at: string;
  league: { name: string; season: string | null } | null;
  home_team: {
    name: string;
    division: { name: string } | null;
  } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

type AssignmentRow = {
  role: string;
  game: ScheduleGame | null;
};

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

function fmtDate(scheduled_at: string): string {
  const d = new Date(scheduled_at);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(scheduled_at: string): string {
  const d = new Date(scheduled_at);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildEmailHtml(params: {
  umpireName: string;
  designationLabel: string;
  rows: AssignmentRow[];
}): string {
  const { umpireName, designationLabel, rows } = params;
  const tableRows = rows
    .map((r) => {
      const g = r.game;
      if (!g) return "";
      const matchup = `${g.home_team?.name ?? "TBD"} vs ${g.away_team?.name ?? "TBD"}`;
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(fmtDate(g.scheduled_at))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(fmtTime(g.scheduled_at))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(r.role)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(matchup)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;">${escapeHtml(g.home_team?.division?.name ?? "—")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;">${escapeHtml(g.venue?.name ?? "—")}</td>
      </tr>`;
    })
    .join("");

  const seasonName = rows[0]?.game?.league?.name ?? "";

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;max-width:720px;margin:0 auto;padding:24px;">
  <div style="border-bottom:2px solid #22C55E;padding-bottom:16px;margin-bottom:16px;">
    <p style="margin:0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;">Umpire schedule</p>
    <h1 style="margin:4px 0 0;font-size:24px;">${escapeHtml(umpireName)}</h1>
    <p style="margin:4px 0 0;color:#666;font-size:14px;">${escapeHtml(designationLabel)}${seasonName ? ` · ${escapeHtml(seasonName)}` : ""}</p>
  </div>
  ${
    rows.length === 0
      ? `<p style="color:#666;">No games assigned yet.</p>`
      : `<table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr style="text-align:left;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">
        <th style="padding:8px 12px;border-bottom:1px solid #ddd;">Date</th>
        <th style="padding:8px 12px;border-bottom:1px solid #ddd;">Time</th>
        <th style="padding:8px 12px;border-bottom:1px solid #ddd;">Role</th>
        <th style="padding:8px 12px;border-bottom:1px solid #ddd;">Matchup</th>
        <th style="padding:8px 12px;border-bottom:1px solid #ddd;">Division</th>
        <th style="padding:8px 12px;border-bottom:1px solid #ddd;">Venue</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>`
  }
  <p style="margin-top:24px;color:#888;font-size:12px;">Sent from FieldSlate. Times are local.</p>
</body></html>`;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Email is not configured. Set RESEND_API_KEY (and optionally RESEND_FROM_EMAIL) in your environment.",
      },
      { status: 503 },
    );
  }

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
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

  // Load umpire — RLS scopes to the owner's seasons.
  const { data: umpireRaw, error: umpireErr } = await supabase
    .from("umpires")
    .select("id, name, designation")
    .eq("id", params.id)
    .single();

  if (umpireErr || !umpireRaw) {
    return NextResponse.json(
      { error: umpireErr?.message ?? "Umpire not found." },
      { status: 404 },
    );
  }
  const umpire = umpireRaw as {
    id: string;
    name: string;
    designation: string;
  };

  // Load this umpire's assignments + their games.
  const { data: assignsRaw, error: assignsErr } = await supabase
    .from("game_umpires")
    .select(
      `role,
       game:games(
         id, scheduled_at,
         league:leagues(name, season),
         home_team:teams!home_team_id(name, division:divisions(name)),
         away_team:teams!away_team_id(name),
         venue:venues(name)
       )`,
    )
    .eq("umpire_id", umpire.id);

  if (assignsErr) {
    return NextResponse.json({ error: assignsErr.message }, { status: 500 });
  }

  const rows = ((assignsRaw as unknown as AssignmentRow[] | null) ?? [])
    .filter((r) => r.game)
    .sort((a, b) => {
      const aT = new Date(a.game!.scheduled_at).getTime();
      const bT = new Date(b.game!.scheduled_at).getTime();
      return aT - bT;
    });

  const designationLabel =
    umpire.designation === "adult" ? "Adult umpire" : "Youth umpire";

  const html = buildEmailHtml({
    umpireName: umpire.name,
    designationLabel,
    rows,
  });

  const resend = new Resend(apiKey);
  const sendRes = await resend.emails.send({
    from: fromAddress,
    to: email,
    subject: `Umpire schedule — ${umpire.name}`,
    html,
  });

  if (sendRes.error) {
    return NextResponse.json(
      { error: sendRes.error.message ?? "Failed to send email." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

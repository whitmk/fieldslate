import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isElite } from "@/lib/plan/limits";

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

function fmtDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export async function POST(
  request: Request,
  { params }: { params: { teamId: string } },
) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  if (!apiKey) {
    return NextResponse.json(
      { error: "Email is not configured. Set RESEND_API_KEY in your environment." },
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
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Snack Shack is an Elite feature — gate the external email send server-side.
  const orgId = await getCurrentOrgId(supabase, user.id);
  const plan = await getOrgPlan(orgId);
  if (!isElite(plan)) {
    return NextResponse.json(
      { error: "Snack Shack is an Elite feature." },
      { status: 403 },
    );
  }

  const { data: teamRaw, error: teamErr } = await supabase
    .from("teams")
    .select("name")
    .eq("id", params.teamId)
    .single();

  if (teamErr || !teamRaw) {
    return NextResponse.json({ error: "Team not found." }, { status: 404 });
  }

  const teamName = (teamRaw as { name: string }).name;

  const { data: blocksRaw, error: blocksErr } = await supabase
    .from("snack_shack_blocks")
    .select(
      "date, start_time, end_time, snack_shack_settings(leagues(name, season))",
    )
    .eq("assigned_team_id", params.teamId)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (blocksErr) {
    return NextResponse.json({ error: blocksErr.message }, { status: 500 });
  }

  type BlockRow = {
    date: string;
    start_time: string;
    end_time: string;
    snack_shack_settings: {
      leagues: { name: string; season: string | null } | null;
    } | null;
  };

  const blocks = (blocksRaw as unknown as BlockRow[]) ?? [];

  const firstLeague = blocks[0]?.snack_shack_settings?.leagues;
  const seasonName = firstLeague
    ? `${firstLeague.name}${firstLeague.season ? ` · ${firstLeague.season}` : ""}`
    : "";

  const tableRows = blocks
    .map(
      (b) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(fmtDate(b.date))}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(fmtTime(b.start_time))} – ${escapeHtml(fmtTime(b.end_time))}</td>
    </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;max-width:720px;margin:0 auto;padding:24px;">
  <div style="border-bottom:2px solid #22C55E;padding-bottom:16px;margin-bottom:16px;">
    <p style="margin:0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;">Snack Shack Schedule</p>
    <h1 style="margin:4px 0 0;font-size:24px;">${escapeHtml(teamName)}</h1>
    ${seasonName ? `<p style="margin:4px 0 0;color:#666;font-size:14px;">${escapeHtml(seasonName)}</p>` : ""}
  </div>
  ${
    blocks.length === 0
      ? `<p style="color:#666;">No snack shack blocks assigned.</p>`
      : `<table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr style="text-align:left;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">
        <th style="padding:8px 12px;border-bottom:1px solid #ddd;">Date</th>
        <th style="padding:8px 12px;border-bottom:1px solid #ddd;">Time</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>`
  }
  <p style="margin-top:24px;color:#888;font-size:12px;">Sent from FieldSlate.</p>
</body></html>`;

  const resend = new Resend(apiKey);
  const sendRes = await resend.emails.send({
    from: fromAddress,
    to: email,
    subject: `Snack Shack Schedule — ${teamName}${seasonName ? ` · ${seasonName}` : ""}`,
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

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

type TeamGroup = {
  division_id: string;
  division_name: string;
  teams: string[];
};

type SlotPick = {
  venue_id: string;
  venue_name: string;
  iso: string;
  date: string;
  time: string;
};

type AcceptRpcReturn = {
  invite_id: string;
  response_id: string;
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

function fmtSlot(s: SlotPick): string {
  const d = new Date(s.iso);
  const dateStr = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr}, ${timeStr} · ${s.venue_name}`;
}

function buildAcceptanceEmail(params: {
  senderName: string;
  orgName: string;
  seasonLabelDisplay: string;
  teamGroups: TeamGroup[];
  slots: SlotPick[];
  dashboardUrl: string;
}): { html: string; text: string; subject: string } {
  const { senderName, orgName, seasonLabelDisplay, teamGroups, slots, dashboardUrl } =
    params;

  const teamRows = teamGroups
    .map(
      (g) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(g.division_name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(g.teams.join(", ") || "—")}</td>
    </tr>`,
    )
    .join("");

  const slotRows = slots
    .map(
      (s) => `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(fmtSlot(s))}</td>
    </tr>`,
    )
    .join("");

  const subject = `${orgName} accepted your interleague invite — ${seasonLabelDisplay}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">FieldSlate</p>
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Invite accepted</p>
    </div>

    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        ${escapeHtml(orgName)} accepted your interleague invite
      </h1>
      <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55;">
        Hi ${escapeHtml(senderName)} — ${escapeHtml(orgName)} just responded to your interleague invite for the <strong>${escapeHtml(seasonLabelDisplay)}</strong> season.
      </p>

      <p style="margin:18px 0 6px;font-size:13px;font-weight:600;color:#0C1F3F;">Their teams</p>
      ${
        teamGroups.length === 0
          ? `<p style="margin:0 0 14px;color:#6b7280;font-size:14px;">No teams provided.</p>`
          : `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;background:#f9fafb;">
            <th style="padding:8px 12px;border-bottom:1px solid #eee;">Division</th>
            <th style="padding:8px 12px;border-bottom:1px solid #eee;">Teams</th>
          </tr>
        </thead>
        <tbody>${teamRows}</tbody>
      </table>`
      }

      <p style="margin:18px 0 6px;font-size:13px;font-weight:600;color:#0C1F3F;">Slot preferences (${slots.length})</p>
      ${
        slots.length === 0
          ? `<p style="margin:0 0 14px;color:#6b7280;font-size:14px;">No slot preferences submitted — you may need to follow up directly.</p>`
          : `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 18px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <tbody>${slotRows}</tbody>
      </table>`
      }

      <div style="margin:24px 0 4px;">
        <a href="${dashboardUrl}" style="display:inline-block;background:#22C55E;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Open Interleague dashboard</a>
      </div>
      <p style="margin:14px 0 0;color:#9ca3af;font-size:12px;">
        Next step: pair these slots with games on your schedule.
      </p>
    </div>

    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        FieldSlate · Scheduling for youth sports leagues.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `${orgName} accepted your interleague invite for ${seasonLabelDisplay}.`,
    "",
    "Their teams:",
    ...(teamGroups.length === 0
      ? ["  (none provided)"]
      : teamGroups.map((g) => `  • ${g.division_name}: ${g.teams.join(", ") || "—"}`)),
    "",
    `Slot preferences (${slots.length}):`,
    ...(slots.length === 0
      ? ["  (none submitted)"]
      : slots.map((s) => `  • ${fmtSlot(s)}`)),
    "",
    `Open Interleague dashboard: ${dashboardUrl}`,
    "",
    "— FieldSlate",
  ].join("\n");

  return { html, text, subject };
}

function sanitizeTeamGroups(raw: unknown): TeamGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      if (!g || typeof g !== "object") return null;
      const o = g as Record<string, unknown>;
      const division_id = typeof o.division_id === "string" ? o.division_id : null;
      const division_name = typeof o.division_name === "string" ? o.division_name : null;
      const teamsRaw = o.teams;
      if (!division_id || !division_name || !Array.isArray(teamsRaw)) return null;
      const teams = teamsRaw
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      return { division_id, division_name, teams };
    })
    .filter((g): g is TeamGroup => g !== null);
}

function sanitizeSlots(raw: unknown): SlotPick[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      const venue_id = typeof o.venue_id === "string" ? o.venue_id : null;
      const venue_name = typeof o.venue_name === "string" ? o.venue_name : null;
      const iso = typeof o.iso === "string" ? o.iso : null;
      const date = typeof o.date === "string" ? o.date : null;
      const time = typeof o.time === "string" ? o.time : null;
      if (!venue_id || !venue_name || !iso || !date || !time) return null;
      return { venue_id, venue_name, iso, date, time };
    })
    .filter((s): s is SlotPick => s !== null);
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  let body: { team_names?: unknown; selected_slots?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const teamGroups = sanitizeTeamGroups(body.team_names);
  const slots = sanitizeSlots(body.selected_slots);

  // Sanity: at least one team name per division-group must be present
  const hasEmptyTeam = teamGroups.some(
    (g) => g.teams.length === 0 || g.teams.some((t) => t.length === 0),
  );
  if (teamGroups.length === 0 || hasEmptyTeam) {
    return NextResponse.json(
      { error: "Please fill in a team name for every game." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "accept_interleague_invite",
    {
      p_token: params.token,
      p_team_names: teamGroups,
      p_selected_slots: slots,
    },
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
      { error: msg || "Failed to accept invite." },
      { status: 500 },
    );
  }

  const result = data as AcceptRpcReturn | null;
  if (!result) {
    return NextResponse.json(
      { error: "Failed to accept invite." },
      { status: 500 },
    );
  }

  // Notification email is best-effort: failure here shouldn't roll back the accept.
  if (result.sender_email) {
    const seasonLabelDisplay = result.season_label
      ? `${result.season_name ?? ""}${result.season_label ? ` · ${result.season_label}` : ""}`.trim() ||
        "your season"
      : result.season_name ?? "your season";

    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
      new URL(request.url).origin ??
      "https://thefieldslate.com";
    const dashboardUrl = `${origin.replace(/\/$/, "")}/dashboard/interleague`;

    const { html, text, subject } = buildAcceptanceEmail({
      senderName: result.sender_name?.trim() || result.sender_email,
      orgName: result.org_name ?? "the invited org",
      seasonLabelDisplay,
      teamGroups,
      slots,
      dashboardUrl,
    });

    await sendEmail(result.sender_email, subject, html, text);
  }

  return NextResponse.json({ ok: true });
}

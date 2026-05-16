import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

type GameResponse = {
  game_id: string;
  team_name: string;
  action: "accept" | "counter";
  venue_name?: string | null;
  proposed_scheduled_at?: string | null;
};

type AcceptRpcReturn = {
  invite_id: string;
  response_id: string;
  total: number;
  accepted: number;
  countered: number;
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

// Wall-clock UTC formatting (matches src/lib/utils/game-time.ts): read the
// literal date/time substrings without `new Date()`-driven timezone shifts.
function fmtIso(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-").map(Number);
  const [hourStr, minStr] = iso.substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);
  const dateStr = new Date(year, month - 1, day, 12).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  const timeStr = `${h12}:${String(min).padStart(2, "0")} ${period}`;
  return `${dateStr}, ${timeStr}`;
}

function sanitizeResponses(raw: unknown): GameResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: GameResponse[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const game_id = typeof o.game_id === "string" ? o.game_id : null;
    const team_name = typeof o.team_name === "string" ? o.team_name.trim() : "";
    if (!game_id || !team_name) continue;
    const action: "accept" | "counter" =
      o.action === "counter" ? "counter" : "accept";
    const venue_name =
      typeof o.venue_name === "string" && o.venue_name.trim()
        ? o.venue_name.trim()
        : null;
    const proposed_scheduled_at =
      typeof o.proposed_scheduled_at === "string" &&
      o.proposed_scheduled_at.trim()
        ? o.proposed_scheduled_at.trim()
        : null;
    out.push({ game_id, team_name, action, venue_name, proposed_scheduled_at });
  }
  return out;
}

function buildAcceptanceEmail(params: {
  senderName: string;
  orgName: string;
  seasonLabelDisplay: string;
  responses: GameResponse[];
  total: number;
  accepted: number;
  countered: number;
  dashboardUrl: string;
}): { html: string; text: string; subject: string } {
  const {
    senderName,
    orgName,
    seasonLabelDisplay,
    responses,
    total,
    accepted,
    countered,
    dashboardUrl,
  } = params;

  const acceptedRows = responses
    .filter((r) => r.action === "accept")
    .map(
      (r) => `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(r.team_name)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#6b7280;">${
          r.venue_name ? escapeHtml(r.venue_name) : "—"
        }</td>
      </tr>`,
    )
    .join("");

  const counterRows = responses
    .filter((r) => r.action === "counter")
    .map(
      (r) => `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(r.team_name)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${
          r.proposed_scheduled_at ? escapeHtml(fmtIso(r.proposed_scheduled_at)) : "—"
        }</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#6b7280;">${
          r.venue_name ? escapeHtml(r.venue_name) : "—"
        }</td>
      </tr>`,
    )
    .join("");

  const subject =
    countered > 0
      ? `${orgName} responded to your interleague invite — ${countered} counter-proposal${countered === 1 ? "" : "s"}`
      : `${orgName} accepted your interleague invite — ${seasonLabelDisplay}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">FieldSlate</p>
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Invite response</p>
    </div>

    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        ${escapeHtml(orgName)} responded to your invite
      </h1>
      <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55;">
        Hi ${escapeHtml(senderName)} — ${escapeHtml(orgName)} just submitted their response for <strong>${escapeHtml(seasonLabelDisplay)}</strong>:
        ${accepted} accepted, ${countered} counter-proposed (of ${total} game${total === 1 ? "" : "s"}).
      </p>

      ${
        acceptedRows
          ? `<p style="margin:18px 0 6px;font-size:13px;font-weight:600;color:#22C55E;">Accepted (${accepted})</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
          <thead>
            <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;background:#f9fafb;">
              <th style="padding:8px 12px;border-bottom:1px solid #eee;">Their team</th>
              <th style="padding:8px 12px;border-bottom:1px solid #eee;">Their venue (away)</th>
            </tr>
          </thead>
          <tbody>${acceptedRows}</tbody>
        </table>`
          : ""
      }

      ${
        counterRows
          ? `<p style="margin:18px 0 6px;font-size:13px;font-weight:600;color:#d97706;">Counter-proposed (${countered}) — needs your review</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
          <thead>
            <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;background:#f9fafb;">
              <th style="padding:8px 12px;border-bottom:1px solid #eee;">Their team</th>
              <th style="padding:8px 12px;border-bottom:1px solid #eee;">Proposed time</th>
              <th style="padding:8px 12px;border-bottom:1px solid #eee;">Proposed venue</th>
            </tr>
          </thead>
          <tbody>${counterRows}</tbody>
        </table>`
          : ""
      }

      <div style="margin:24px 0 4px;">
        <a href="${dashboardUrl}" style="display:inline-block;background:#22C55E;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Open Interleague dashboard</a>
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
    `${orgName} responded to your invite for ${seasonLabelDisplay}.`,
    `Accepted: ${accepted}, counter-proposed: ${countered} (of ${total}).`,
    "",
    ...(responses.length > 0
      ? [
          "Responses:",
          ...responses.map((r) => {
            const verb = r.action === "accept" ? "accepted" : "counter-proposed";
            const extra = [
              r.proposed_scheduled_at ? `proposed: ${fmtIso(r.proposed_scheduled_at)}` : null,
              r.venue_name ? `venue: ${r.venue_name}` : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `  • ${r.team_name} — ${verb}${extra ? ` (${extra})` : ""}`;
          }),
        ]
      : []),
    "",
    `Open Interleague dashboard: ${dashboardUrl}`,
    "",
    "— FieldSlate",
  ].join("\n");

  return { html, text, subject };
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  let body: { responses?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const responses = sanitizeResponses(body.responses);
  if (responses.length === 0) {
    return NextResponse.json(
      { error: "Please respond to at least one game with a team name." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "accept_interleague_invite",
    { p_token: params.token, p_responses: responses },
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
      { error: msg || "Failed to submit response." },
      { status: 500 },
    );
  }

  const result = data as AcceptRpcReturn | null;
  if (!result) {
    return NextResponse.json(
      { error: "Failed to submit response." },
      { status: 500 },
    );
  }

  if (result.sender_email) {
    const seasonLabelDisplay =
      result.season_label
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
      responses,
      total: result.total,
      accepted: result.accepted,
      countered: result.countered,
      dashboardUrl,
    });

    await sendEmail(result.sender_email, subject, html, text);
  }

  return NextResponse.json({
    ok: true,
    accepted: result.accepted,
    countered: result.countered,
    total: result.total,
  });
}

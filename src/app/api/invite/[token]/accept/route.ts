import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import {
  validateVenueName,
  validateTeamName,
} from "@/lib/validation/text-length";

export const runtime = "nodejs";

type GameResponse = {
  game_id: string;
  team_name: string;
  action: "accept" | "counter" | "decline";
  venue_name?: string | null;
  proposed_scheduled_at?: string | null;
};

type AcceptRpcReturn = {
  invite_id: string;
  response_id: string;
  total: number;
  accepted: number;
  countered: number;
  declined: number;
  sender_email: string | null;
  sender_name: string | null;
  sender_org_name: string | null;
  org_name: string | null;
  season_name: string | null;
  season_label: string | null;
  recipient_email: string;
  schedule_token: string | null;
};

type ScheduleGame = {
  id: string;
  scheduled_at: string;
  is_away: boolean;
  external_team_name: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string };
  division: { name: string };
  venue: { name: string; location: { name: string } | null } | null;
};

type SchedulePayload = {
  sender: { full_name: string | null; email: string | null } | null;
  org: { name: string } | null;
  season: { name: string; season: string | null } | null;
  games: ScheduleGame[];
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

type SanitizedResponses =
  | { ok: true; responses: GameResponse[] }
  | { ok: false; error: string };

function sanitizeResponses(raw: unknown): SanitizedResponses {
  if (!Array.isArray(raw)) return { ok: true, responses: [] };
  const out: GameResponse[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const game_id = typeof o.game_id === "string" ? o.game_id : null;
    if (!game_id) continue;
    const action: "accept" | "counter" | "decline" =
      o.action === "decline"
        ? "decline"
        : o.action === "counter"
          ? "counter"
          : "accept";
    const teamCheck = validateTeamName(o.team_name);
    if (!teamCheck.ok) return { ok: false, error: teamCheck.error };
    const team_name = teamCheck.value ?? "";
    // Decline doesn't require a team name; accept/counter do.
    if (action !== "decline" && !team_name) continue;
    const venueCheck = validateVenueName(o.venue_name);
    if (!venueCheck.ok) return { ok: false, error: venueCheck.error };
    const proposed_scheduled_at =
      typeof o.proposed_scheduled_at === "string" &&
      o.proposed_scheduled_at.trim()
        ? o.proposed_scheduled_at.trim()
        : null;
    out.push({
      game_id,
      team_name,
      action,
      venue_name: venueCheck.value,
      proposed_scheduled_at,
    });
  }
  return { ok: true, responses: out };
}

function buildAcceptanceEmail(params: {
  senderName: string;
  orgName: string;
  seasonLabelDisplay: string;
  responses: GameResponse[];
  total: number;
  accepted: number;
  countered: number;
  declined: number;
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
    declined,
    dashboardUrl,
  } = params;

  const declinedCount = responses.filter((r) => r.action === "decline").length;

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

  // None of these may read as an incoming invite — the sender already knows
  // they invited this org; the news is the response.
  const subject =
    countered > 0
      ? `${orgName} responded — ${countered} counter-proposal${countered === 1 ? "" : "s"} to review`
      : declined > 0 && accepted === 0
        ? `${orgName} declined your interleague games — ${seasonLabelDisplay}`
        : `${orgName} accepted — interleague schedule confirmed for ${seasonLabelDisplay}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="${SITE_URL}/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Invite response</p>
    </div>

    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        ${escapeHtml(orgName)} responded to your invite
      </h1>
      <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55;">
        Hi ${escapeHtml(senderName)} — ${escapeHtml(orgName)} just submitted their response for <strong>${escapeHtml(seasonLabelDisplay)}</strong>:
        ${accepted} accepted, ${countered} counter-proposed, ${declined} declined (of ${total} game${total === 1 ? "" : "s"}).
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

      ${
        declinedCount > 0
          ? `<p style="margin:18px 0 6px;font-size:13px;font-weight:600;color:#ef4444;">Declined (${declinedCount})</p>
        <p style="margin:0 0 18px;color:#6b7280;font-size:14px;">These games have been removed from your schedule.</p>`
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
    `Accepted: ${accepted}, counter-proposed: ${countered}, declined: ${declined} (of ${total}).`,
    "",
    ...(responses.length > 0
      ? [
          "Responses:",
          ...responses.map((r) => {
            const verb =
              r.action === "accept"
                ? "accepted"
                : r.action === "decline"
                  ? "declined"
                  : "counter-proposed";
            const extra = [
              r.proposed_scheduled_at ? `proposed: ${fmtIso(r.proposed_scheduled_at)}` : null,
              r.venue_name ? `venue: ${r.venue_name}` : null,
            ]
              .filter(Boolean)
              .join(", ");
            const label =
              r.action === "decline" ? "(no team specified)" : r.team_name;
            return `  • ${label} — ${verb}${extra ? ` (${extra})` : ""}`;
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

function buildRecipientConfirmationEmail(params: {
  // The sending LEAGUE (profiles.org_name via the RPC, falling back to the
  // admin's name) — the recipient scheduled games with a league, not a person.
  senderOrgName: string;
  orgName: string;
  seasonLabelDisplay: string;
  games: ScheduleGame[];
  counteredCount: number;
  scheduleUrl: string;
}): { html: string; text: string; subject: string } {
  const {
    senderOrgName,
    orgName,
    seasonLabelDisplay,
    games,
    counteredCount,
    scheduleUrl,
  } = params;

  const subject = `Your interleague schedule with ${senderOrgName}`;

  const gameRows = games
    .map((g) => {
      const recipientIsHome = g.is_away;
      const venue = g.venue ? qualifiedVenueLabel(g.venue) : g.proposed_venue_name ?? "TBD";
      const matchup = `${g.external_team_name ?? "Your team"} vs ${g.home_team.name}`;
      const tag = recipientIsHome ? "HOME" : "AWAY";
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#0C1F3F;font-weight:600;width:30%;">${escapeHtml(fmtIso(g.scheduled_at))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(matchup)}<div style="color:#9ca3af;font-size:12px;margin-top:2px;">${escapeHtml(g.division.name)} · ${escapeHtml(venue)}</div></td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:0.5px;background:${recipientIsHome ? "#dcfce7" : "#dbeafe"};color:${recipientIsHome ? "#16a34a" : "#2563eb"};">${tag}</span></td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="${SITE_URL}/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Interleague schedule</p>
    </div>

    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        Your interleague schedule with ${escapeHtml(senderOrgName)}
      </h1>
      <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.55;">
        Thanks for responding! Here are your interleague games against
        ${escapeHtml(senderOrgName)}&apos;s teams for <strong>${escapeHtml(seasonLabelDisplay)}</strong>.
      </p>

      ${
        games.length === 0
          ? `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;">No games are confirmed yet${
              counteredCount > 0
                ? ` — your counter-proposals are pending ${escapeHtml(senderOrgName)}&apos;s confirmation.`
                : "."
            }</p>`
          : `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <tbody>${gameRows}</tbody>
      </table>`
      }

      ${
        counteredCount > 0
          ? `<p style="margin:0 0 18px;padding:10px 14px;background:#fef3c7;border-left:3px solid #d97706;border-radius:4px;color:#92400e;font-size:13px;">
        ${counteredCount} of your responses suggested a different time —
        ${escapeHtml(senderOrgName)} will review and confirm those separately.
        You&apos;ll see them on the live schedule once resolved.
      </p>`
          : ""
      }

      <div style="margin:24px 0 4px;">
        <a href="${scheduleUrl}" style="display:inline-block;background:#22C55E;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">View live schedule</a>
      </div>
      <p style="margin:14px 0 0;color:#6b7280;font-size:12px;line-height:1.55;">
        Bookmark this link to always see the latest schedule — it updates
        automatically if any game is rescheduled.
        <br/><a href="${scheduleUrl}" style="color:#22C55E;word-break:break-all;">${escapeHtml(scheduleUrl)}</a>
      </p>
    </div>

    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.5;">
        FieldSlate is a scheduling tool for youth sports leagues.
      </p>
      <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;">
        Curious about FieldSlate for ${escapeHtml(orgName)}?
        <a href="${SITE_URL}/signup?promo=INTERLEAGUE&amp;utm_source=invite&amp;utm_medium=email" style="color:#22C55E;text-decoration:none;font-weight:600;">Try your first season for 20% off</a>.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `Your interleague schedule with ${senderOrgName} — ${seasonLabelDisplay}`,
    "",
    ...(games.length === 0
      ? [
          counteredCount > 0
            ? `No games are confirmed yet — your counter-proposals are pending ${senderOrgName}'s confirmation.`
            : "No games are confirmed yet.",
        ]
      : [
          "Confirmed games:",
          ...games.map((g) => {
            const recipientIsHome = g.is_away;
            const venue = g.venue ? qualifiedVenueLabel(g.venue) : g.proposed_venue_name ?? "TBD";
            return `  • ${fmtIso(g.scheduled_at)} — ${g.external_team_name ?? "Your team"} vs ${g.home_team.name} (${recipientIsHome ? "HOME" : "AWAY"}, ${venue})`;
          }),
        ]),
    "",
    counteredCount > 0
      ? `${counteredCount} of your responses suggested a different time — ${senderOrgName} will review and confirm those separately.`
      : "",
    "",
    `View live schedule: ${scheduleUrl}`,
    "Bookmark this link to always see the latest schedule.",
    "",
    "— FieldSlate, a scheduling tool for youth sports leagues.",
    `Curious about FieldSlate for ${orgName}? Try your first season for 20% off: ${SITE_URL}/signup?promo=INTERLEAGUE`,
  ]
    .filter((l) => l !== "")
    .join("\n");

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

  const sanitized = sanitizeResponses(body.responses);
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }
  const responses = sanitized.responses;
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

  const seasonLabelDisplay =
    result.season_label
      ? `${result.season_name ?? ""}${result.season_label ? ` · ${result.season_label}` : ""}`.trim() ||
        "your season"
      : result.season_name ?? "your season";

  const origin = SITE_URL;
  const baseOrigin = origin.replace(/\/$/, "");
  const dashboardUrl = `${baseOrigin}/dashboard/interleague`;

  // Notify the FieldSlate admin (sender) — best-effort.
  if (result.sender_email) {
    const { html, text, subject } = buildAcceptanceEmail({
      senderName: result.sender_name?.trim() || result.sender_email,
      orgName: result.org_name ?? "the invited org",
      seasonLabelDisplay,
      responses,
      total: result.total,
      accepted: result.accepted,
      countered: result.countered,
      declined: result.declined ?? 0,
      dashboardUrl,
    });

    await sendEmail(result.sender_email, subject, html, text);
  }

  // Confirmation email to the non-FieldSlate admin (recipient) with the live
  // schedule link. Only sent when we have both an email and a token — best-effort.
  if (result.recipient_email && result.schedule_token) {
    const scheduleUrl = `${baseOrigin}/schedule/${result.schedule_token}`;
    // Lead with the sending LEAGUE; fail-soft to the admin's name (then email)
    // when the profile has no org_name.
    const senderDisplay =
      result.sender_org_name?.trim() ||
      result.sender_name?.trim() ||
      result.sender_email ||
      "the FieldSlate admin";

    // Pull the freshly-confirmed games via the public schedule RPC.
    const { data: scheduleRaw } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in generated types
      "get_interleague_schedule_by_token",
      { p_token: result.schedule_token },
    );
    const scheduleData = (scheduleRaw as SchedulePayload | null) ?? null;
    const games: ScheduleGame[] = scheduleData?.games ?? [];

    const { html, text, subject } = buildRecipientConfirmationEmail({
      senderOrgName: senderDisplay,
      orgName: result.org_name ?? "your league",
      seasonLabelDisplay,
      games,
      counteredCount: result.countered,
      scheduleUrl,
    });

    await sendEmail(result.recipient_email, subject, html, text);
  }

  return NextResponse.json({
    ok: true,
    accepted: result.accepted,
    countered: result.countered,
    declined: result.declined ?? 0,
    total: result.total,
  });
}

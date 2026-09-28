import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import type { RecipientCounteredGame } from "@/lib/interleague/recipient-schedule";
import {
  buildAcceptanceEmail,
  buildRecipientConfirmationEmail,
  sanitizeResponses,
  type AcceptRpcReturn,
  type ScheduleGame,
  type SchedulePayload,
} from "@/lib/interleague/invite-response-emails";

export const runtime = "nodejs";

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
    const counteredGames: RecipientCounteredGame[] = scheduleData?.countered_games ?? [];

    const { html, text, subject } = buildRecipientConfirmationEmail({
      senderOrgName: senderDisplay,
      orgName: result.org_name ?? "your league",
      seasonLabelDisplay,
      games,
      counteredCount: result.countered,
      counteredGames,
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

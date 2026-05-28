import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { gateRescheduleVenue } from "@/lib/venues/reschedule-gate";
import {
  validateVenueName,
  validateNote,
} from "@/lib/validation/text-length";

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

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Load the request + game + league for authorization + email payloads.
  type FetchRow = {
    id: string;
    game_id: string;
    proposed_scheduled_at: string;
    proposed_venue_name: string | null;
    status: string;
    requested_by_user_id: string | null;
    game: {
      id: string;
      league_id: string;
      interleague_org_id: string | null;
      is_away: boolean;
      scheduled_at: string;
      external_team_name: string | null;
      proposed_venue_name: string | null;
      home_team: { name: string; division: { name: string } | null } | null;
      interleague_org: { name: string } | null;
      league: { id: string; name: string; season: string | null; owner_id: string } | null;
      venue: { name: string } | null;
    } | null;
  };
  const { data: reqRaw, error: reqErr } = await supabase
    .from("interleague_reschedule_requests")
    .select(
      `id, game_id, proposed_scheduled_at, proposed_venue_name, status,
       requested_by_user_id,
       game:games(
         id, league_id, interleague_org_id, is_away, scheduled_at,
         external_team_name, proposed_venue_name,
         home_team:teams!home_team_id(name, division:divisions(name)),
         interleague_org:interleague_orgs(name),
         league:leagues(id, name, season, owner_id),
         venue:venues(name)
       )`,
    )
    .eq("id", params.id)
    .single();

  if (reqErr || !reqRaw) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  const req = reqRaw as unknown as FetchRow;
  // RLS (is_org_member on the underlying tables) gates the SELECT above —
  // a user without access wouldn't see the request row to begin with. We
  // still guard against missing joins for typing/defensive reasons.
  if (!req.game || !req.game.league) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (req.status !== "pending") {
    return NextResponse.json(
      { error: "This request has already been resolved." },
      { status: 409 },
    );
  }

  // Look up recipient email for any outbound notification.
  const { data: inviteRow } = await supabase
    .from("interleague_invites")
    .select("recipient_email")
    .eq("interleague_org_id", req.game.interleague_org_id ?? "")
    .eq("season_id", req.game.league_id)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const recipientEmail = inviteRow?.recipient_email ?? null;

  const orgName = req.game.interleague_org?.name ?? "the other org";
  const homeTeam = req.game.home_team?.name ?? "Home";
  const externalTeam = req.game.external_team_name ?? "their team";
  const division = req.game.home_team?.division?.name ?? "—";
  const seasonLabel = req.game.league.season
    ? `${req.game.league.name} · ${req.game.league.season}`
    : req.game.league.name;
  const matchup = req.game.is_away
    ? `${homeTeam} AT ${orgName}${req.game.external_team_name ? ` (${req.game.external_team_name})` : ""}`
    : `${homeTeam} vs ${externalTeam}`;
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    new URL(request.url).origin ??
    "https://thefieldslate.com";
  const baseOrigin = origin.replace(/\/$/, "");

  if (body.action === "accept") {
    const oldIso = req.game.scheduled_at;
    const newIso = req.proposed_scheduled_at;

    // Venue-hours gate: accepting moves game.scheduled_at to newIso but
    // doesn't change venue_id. Validate the existing venue at the new time.
    const acceptGate = await gateRescheduleVenue(supabase, {
      gameId: req.game.id,
      scheduledAtIso: newIso,
    });
    if (!acceptGate.ok) {
      return NextResponse.json(acceptGate.body, { status: acceptGate.status });
    }

    const { error: updGameErr } = await supabase
      .from("games")
      .update({
        scheduled_at: newIso,
        proposed_venue_name: req.proposed_venue_name ?? req.game.proposed_venue_name,
        status: "scheduled",
      } as never)
      .eq("id", req.game.id);
    if (updGameErr) {
      return NextResponse.json({ error: updGameErr.message }, { status: 500 });
    }
    const { error: updReqErr } = await supabase
      .from("interleague_reschedule_requests")
      .update({ status: "accepted" } as never)
      .eq("id", req.id);
    if (updReqErr) {
      return NextResponse.json({ error: updReqErr.message }, { status: 500 });
    }

    if (recipientEmail) {
      const subject = `Reschedule accepted: ${matchup}`;
      const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="https://thefieldslate.com/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Reschedule accepted</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">Your reschedule request was accepted</h1>
      <p style="margin:0 0 12px;color:#4b5563;font-size:14px;">${escapeHtml(matchup)} (${escapeHtml(division)}, ${escapeHtml(seasonLabel)}) has moved.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0 0;border:1px solid #eee;border-radius:6px;overflow:hidden;"><tbody>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;width:35%;">Old time</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(fmtIso(oldIso))}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b7280;">New time</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(fmtIso(newIso))}</td></tr>
      </tbody></table>
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">FieldSlate · Scheduling for youth sports leagues.</p>
    </div>
  </div>
</body></html>`;
      const text = `Your reschedule request for ${matchup} was accepted.\nOld time: ${fmtIso(oldIso)}\nNew time: ${fmtIso(newIso)}`;
      await sendEmail(recipientEmail, subject, html, text);
    }
    return NextResponse.json({ ok: true, action: "accept" });
  }

  if (body.action === "decline") {
    // Mark request declined, return the game to 'scheduled' if no other pending.
    const { error: updReqErr } = await supabase
      .from("interleague_reschedule_requests")
      .update({ status: "declined" } as never)
      .eq("id", req.id);
    if (updReqErr) {
      return NextResponse.json({ error: updReqErr.message }, { status: 500 });
    }
    const { count: pendingLeft } = await supabase
      .from("interleague_reschedule_requests")
      .select("id", { count: "exact", head: true })
      .eq("game_id", req.game.id)
      .eq("status", "pending");
    if (!pendingLeft) {
      await supabase
        .from("games")
        .update({ status: "scheduled" } as never)
        .eq("id", req.game.id);
    }

    if (recipientEmail) {
      const subject = `Reschedule declined: ${matchup}`;
      const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="https://thefieldslate.com/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Reschedule declined</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">Your reschedule request was declined</h1>
      <p style="margin:0 0 12px;color:#4b5563;font-size:14px;">
        ${escapeHtml(matchup)} (${escapeHtml(division)}, ${escapeHtml(seasonLabel)}) will stay at ${escapeHtml(fmtIso(req.game.scheduled_at))}.
      </p>
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">FieldSlate · Scheduling for youth sports leagues.</p>
    </div>
  </div>
</body></html>`;
      const text = `Your reschedule request for ${matchup} was declined. It stays at ${fmtIso(req.game.scheduled_at)}.`;
      await sendEmail(recipientEmail, subject, html, text);
    }
    return NextResponse.json({ ok: true, action: "decline" });
  }

  // counter: mark old declined, create new admin→external request with token.
  const rawWhen = typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
  const venueCheck = validateVenueName(body.venue_name);
  if (!venueCheck.ok) {
    return NextResponse.json({ error: venueCheck.error }, { status: 400 });
  }
  const rawVenue = venueCheck.value ?? "";
  const noteCheck = validateNote(body.note);
  if (!noteCheck.ok) {
    return NextResponse.json({ error: noteCheck.error }, { status: 400 });
  }
  const note = noteCheck.value ?? "";
  if (!rawWhen || !isoLooksValid(rawWhen)) {
    return NextResponse.json(
      { error: "Provide a valid proposed date and time." },
      { status: 400 },
    );
  }
  const normalized = normalizeWallClockIso(rawWhen);

  // Venue-hours gate for the admin's counter-proposal. Stores a new
  // admin→external request row but doesn't change the game record's
  // scheduled_at, so we skip the existing-venue check and only validate
  // the proposed name (if it resolves to one of OUR venues).
  const counterGate = await gateRescheduleVenue(supabase, {
    gameId: req.game.id,
    scheduledAtIso: normalized,
    proposedVenueName: rawVenue || null,
    skipExistingVenueCheck: true,
  });
  if (!counterGate.ok) {
    return NextResponse.json(counterGate.body, { status: counterGate.status });
  }

  const { error: declErr } = await supabase
    .from("interleague_reschedule_requests")
    .update({ status: "declined" } as never)
    .eq("id", req.id);
  if (declErr) {
    return NextResponse.json({ error: declErr.message }, { status: 500 });
  }

  const { data: newReq, error: insertErr } = await supabase
    .from("interleague_reschedule_requests")
    .insert([
      {
        game_id: req.game.id,
        requested_by_user_id: user.id,
        proposed_scheduled_at: normalized,
        proposed_venue_name: rawVenue || null,
        note: note || null,
      },
    ])
    .select("id, token")
    .single();
  if (insertErr || !newReq) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create counter-proposal." },
      { status: 500 },
    );
  }

  if (recipientEmail) {
    const rescheduleUrl = `${baseOrigin}/reschedule/${newReq.token}`;
    const subject = `Counter-proposal: ${matchup} — ${seasonLabel}`;
    const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="https://thefieldslate.com/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Counter-proposal</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">A different time was proposed</h1>
      <p style="margin:0 0 12px;color:#4b5563;font-size:14px;">For ${escapeHtml(matchup)} (${escapeHtml(division)}, ${escapeHtml(seasonLabel)}).</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px;border:1px solid #eee;border-radius:6px;overflow:hidden;"><tbody>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;width:35%;">Proposed</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(fmtIso(normalized))}</td></tr>
        ${rawVenue ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;">Proposed venue</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(rawVenue)}</td></tr>` : ""}
        ${note ? `<tr><td style="padding:8px 12px;color:#6b7280;">Note</td><td style="padding:8px 12px;">${escapeHtml(note)}</td></tr>` : ""}
      </tbody></table>
      <div style="margin:24px 0 4px;">
        <a href="${rescheduleUrl}" style="display:inline-block;background:#22C55E;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">Respond</a>
      </div>
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">FieldSlate · Scheduling for youth sports leagues.</p>
    </div>
  </div>
</body></html>`;
    const text = `Counter-proposal for ${matchup}.\nProposed: ${fmtIso(normalized)}\nRespond: ${rescheduleUrl}`;
    await sendEmail(recipientEmail, subject, html, text);
  }

  return NextResponse.json({ ok: true, action: "counter", request_id: newReq.id });
}

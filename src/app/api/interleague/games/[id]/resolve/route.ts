import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

type Action = "accept_proposal" | "keep_original" | "edit" | "decline";

type GameRow = {
  id: string;
  league_id: string;
  home_team_id: string;
  interleague_org_id: string | null;
  is_away: boolean;
  status: string;
  scheduled_at: string;
  external_team_name: string | null;
  proposed_scheduled_at: string | null;
  proposed_venue_name: string | null;
  venue_id: string | null;
};

function isAction(s: unknown): s is Action {
  return (
    s === "accept_proposal" ||
    s === "keep_original" ||
    s === "edit" ||
    s === "decline"
  );
}

// Wall-clock UTC formatting (matches src/lib/utils/game-time.ts).
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
  const timeStr = `${h12}:${String(min).padStart(2, "0")} ${period}`;
  return `${dateStr}, ${timeStr}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isoLooksValid(s: string): boolean {
  // Accept "YYYY-MM-DDTHH:MM:00+00:00" or "YYYY-MM-DDTHH:MM" (we'll normalise)
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\+\d{2}:\d{2})?$/.test(s);
}

function normalizeWallClockIso(s: string): string {
  // "YYYY-MM-DDTHH:MM" → "YYYY-MM-DDTHH:MM:00+00:00"
  // "YYYY-MM-DDTHH:MM:00" → "YYYY-MM-DDTHH:MM:00+00:00"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00+00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return `${s}+00:00`;
  return s;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  let body: {
    action?: unknown;
    scheduled_at?: unknown;
    venue_name?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isAction(body.action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  const action: Action = body.action;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Load game with surrounding context for validation + email.
  type FetchRow = GameRow & {
    home_team: { name: string; division: { name: string } | null } | null;
    interleague_org: { name: string } | null;
    league: { id: string; name: string; season: string | null; owner_id: string } | null;
    venue: { name: string } | null;
  };
  const { data: gameRaw, error: gameErr } = await supabase
    .from("games")
    .select(
      `id, league_id, home_team_id, interleague_org_id, is_away, status, scheduled_at,
       external_team_name, proposed_scheduled_at, proposed_venue_name, venue_id,
       home_team:teams!home_team_id(name, division:divisions(name)),
       interleague_org:interleague_orgs(name),
       league:leagues(id, name, season, owner_id),
       venue:venues(name)`
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
  if (game.status !== "pending_interleague") {
    return NextResponse.json(
      { error: "This game is no longer pending." },
      { status: 409 },
    );
  }
  if (!game.interleague_org_id) {
    return NextResponse.json(
      { error: "This game isn't an interleague game." },
      { status: 400 },
    );
  }

  // Decline branches out entirely — the row is deleted and the email is different.
  if (action === "decline") {
    const { error: delErr } = await supabase
      .from("games")
      .delete()
      .eq("id", game.id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    // Notify the recipient (best-effort).
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

    if (recipientEmail) {
      const orgName = game.interleague_org?.name ?? "your league";
      const ourTeam = game.home_team?.name ?? "Our team";
      const theirTeam = game.external_team_name ?? "Your team";
      const division = game.home_team?.division?.name ?? "";
      const seasonLabel = game.league?.season
        ? `${game.league.name} · ${game.league.season}`
        : game.league?.name ?? "the season";
      const originalTime = fmtIso(game.scheduled_at);
      const matchup = game.is_away
        ? `${ourTeam} AT ${orgName} (${theirTeam})`
        : `${ourTeam} vs ${theirTeam}`;

      const subject = `Counter-proposal declined: ${matchup}`;

      const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="https://thefieldslate.com/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Game declined</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        Your counter-proposal was declined
      </h1>
      <p style="margin:0 0 12px;color:#4b5563;font-size:14px;line-height:1.55;">
        ${escapeHtml(matchup)} (${escapeHtml(seasonLabel)}) couldn&apos;t be rescheduled to your suggested time. The game has been removed from the schedule.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0 0;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <tbody>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;width:30%;">Division</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(division || "—")}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Originally proposed</td><td style="padding:8px 12px;">${escapeHtml(originalTime)}</td></tr>
        </tbody>
      </table>
      <p style="margin:18px 0 0;color:#6b7280;font-size:13px;">
        If you&apos;d like to schedule this game again, reach out to the league
        admin directly.
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
        `Your counter-proposal for ${matchup} was declined.`,
        `The game has been removed from the schedule.`,
        division ? `Division: ${division}` : "",
        `Originally proposed: ${originalTime}`,
        "",
        "— FieldSlate",
      ]
        .filter((l) => l !== "")
        .join("\n");

      await sendEmail(recipientEmail, subject, html, text);
    }

    return NextResponse.json({ ok: true });
  }

  // Build the update based on action.
  let updatePayload: {
    scheduled_at?: string;
    status: "scheduled";
    proposed_scheduled_at: null;
    proposed_venue_name?: string | null;
  };

  if (action === "accept_proposal") {
    if (!game.proposed_scheduled_at) {
      return NextResponse.json(
        { error: "There's no time proposal to accept on this game." },
        { status: 400 },
      );
    }
    updatePayload = {
      scheduled_at: game.proposed_scheduled_at,
      status: "scheduled",
      proposed_scheduled_at: null,
    };
  } else if (action === "keep_original") {
    updatePayload = {
      status: "scheduled",
      proposed_scheduled_at: null,
    };
  } else {
    // edit
    const rawWhen = typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
    const rawVenue =
      typeof body.venue_name === "string" ? body.venue_name.trim() : "";
    if (!rawWhen || !isoLooksValid(rawWhen)) {
      return NextResponse.json(
        { error: "Provide a valid date and time." },
        { status: 400 },
      );
    }
    updatePayload = {
      scheduled_at: normalizeWallClockIso(rawWhen),
      status: "scheduled",
      proposed_scheduled_at: null,
    };
    if (game.is_away) {
      // Away games need a venue; reuse the existing one if the admin didn't change it.
      const finalVenue =
        rawVenue || game.proposed_venue_name || "";
      if (!finalVenue) {
        return NextResponse.json(
          { error: "Away games need a venue name." },
          { status: 400 },
        );
      }
      updatePayload.proposed_venue_name = finalVenue;
    }
  }

  const { error: updateErr } = await supabase
    .from("games")
    .update(updatePayload as never)
    .eq("id", game.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Notification email to the recipient (best-effort).
  // Pull the most recent accepted invite for this org+season for the email.
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

  if (recipientEmail) {
    const orgName = game.interleague_org?.name ?? "your league";
    const ourTeam = game.home_team?.name ?? "Our team";
    const theirTeam = game.external_team_name ?? "Your team";
    const division = game.home_team?.division?.name ?? "";
    const finalIso = updatePayload.scheduled_at ?? game.scheduled_at;
    const finalVenue = game.is_away
      ? (updatePayload.proposed_venue_name ?? game.proposed_venue_name ?? "your venue")
      : (game.venue?.name ?? "TBD");
    const matchup = game.is_away
      ? `${ourTeam} AT ${orgName} (${theirTeam})`
      : `${ourTeam} vs ${theirTeam}`;
    const seasonLabel = game.league?.season
      ? `${game.league.name} · ${game.league.season}`
      : game.league?.name ?? "the season";

    const subject = `Confirmed: ${matchup} on ${fmtIso(finalIso)}`;

    const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:24px 28px;">
      <img src="https://thefieldslate.com/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Game confirmed</p>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0C1F3F;">
        ${escapeHtml(matchup)}
      </h1>
      <p style="margin:0 0 12px;color:#4b5563;font-size:14px;">
        Your counter-proposal for the ${escapeHtml(seasonLabel)} season has been resolved.
        The final details are below.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0 0;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <tbody>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;width:30%;">Division</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(division || "—")}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b7280;">Date &amp; time</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(fmtIso(finalIso))}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Venue</td><td style="padding:8px 12px;">${escapeHtml(finalVenue)}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="padding:18px 28px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        FieldSlate · Scheduling for youth sports leagues.
      </p>
      <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;">
        Curious about FieldSlate for your own league?
        <a href="https://thefieldslate.com/?utm_source=invite&amp;utm_medium=email&amp;promo=INTERLEAGUE" style="color:#22C55E;text-decoration:none;font-weight:600;">Try it free</a>
        — use code <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0C1F3F;">INTERLEAGUE</span> for 20% off your first season.
      </p>
    </div>
  </div>
</body></html>`;

    const text = [
      `${matchup} — confirmed`,
      "",
      `Date & time: ${fmtIso(finalIso)}`,
      `Venue: ${finalVenue}`,
      division ? `Division: ${division}` : "",
      "",
      "— FieldSlate",
      "Curious about FieldSlate for your own league? Use code INTERLEAGUE for 20% off your first season at https://thefieldslate.com",
    ]
      .filter((l) => l !== "")
      .join("\n");

    await sendEmail(recipientEmail, subject, html, text);
  }

  return NextResponse.json({ ok: true });
}

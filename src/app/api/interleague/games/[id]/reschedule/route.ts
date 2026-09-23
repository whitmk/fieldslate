import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { gateVenueProposal } from "@/lib/venues/availability";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { SITE_URL } from "@/lib/site";
import {
  validateVenueName,
  validateNote,
} from "@/lib/validation/text-length";
import { gateRescheduleVenue } from "@/lib/venues/reschedule-gate";
import { gateRescheduleOccupancy } from "@/lib/venues/occupancy-gate";
import { lockRefusal } from "@/lib/interleague/lock-gate";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import { decideHostProposal, proposalRound, type RequestLite } from "@/lib/interleague/negotiation";
import { hostProposalEmail, respondUrl } from "@/lib/interleague/negotiation-emails";

// Two branches, decided by decideHostProposal (src/lib/interleague/negotiation.ts):
//
//   status 'scheduled'            → the ORIGINAL reschedule request on a confirmed
//                                   game. Unchanged: free-text venue gate, request
//                                   row, game flipped to reschedule_pending, the
//                                   existing email.
//   status 'pending_interleague'  → "Propose a different time" on a game the
//   (with a partner response)       partner counter-proposed. The game STAYS
//                                   pending_interleague (never reschedule_pending —
//                                   countsAsScheduledGame does not list it). Runs the
//                                   division-lock gate, the venue-hours gate and the
//                                   0088 occupancy gate on the proposed time, closes
//                                   the partner's own outstanding counter-back, and
//                                   CHECKS the email result: the partner's only way
//                                   to answer is the link in that email.

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
  const venueCheck = validateVenueName(body.venue_name);
  if (!venueCheck.ok) {
    return NextResponse.json({ error: venueCheck.error }, { status: 400 });
  }
  const venueName = venueCheck.value ?? "";
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

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const currentOrgId = await getCurrentOrgId(supabase, user.id);

  // Load + authorize the game. We also pull the home team's division
  // settings (game_duration) so we can validate the proposed time against
  // venue hours when the proposed venue is one of ours.
  type FetchRow = {
    id: string;
    league_id: string;
    interleague_org_id: string | null;
    is_away: boolean;
    status: string;
    scheduled_at: string;
    external_team_name: string | null;
    proposed_venue_name: string | null;
    proposed_scheduled_at: string | null;
    venue_id: string | null;
    home_team: {
      name: string;
      division: { name: string; settings: unknown; locked: boolean | null } | null;
    } | null;
    interleague_org: { name: string } | null;
    league: { id: string; name: string; season: string | null; owner_id: string } | null;
    venue: { name: string; location: { name: string } | null } | null;
  };
  const { data: gameRaw, error: gameErr } = await supabase
    .from("games")
    .select(
      `id, league_id, interleague_org_id, is_away, status, scheduled_at,
       external_team_name, proposed_venue_name, proposed_scheduled_at, venue_id,
       home_team:teams!home_team_id(name, division:divisions(name, settings, locked)),
       interleague_org:interleague_orgs(name),
       league:leagues(id, name, season, owner_id),
       venue:venues(name, location:locations(name))`,
    )
    .eq("id", params.id)
    .single();

  if (gameErr || !gameRaw) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  const game = gameRaw as unknown as FetchRow;
  // RLS (is_org_member on leagues) is the gatekeeper: the SELECT above
  // returns null for users without access to game.league. We still guard
  // against a missing league join for typing/defensive reasons.
  if (!game.league) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!game.interleague_org_id) {
    return NextResponse.json(
      { error: "Only interleague games can be rescheduled this way." },
      { status: 400 },
    );
  }
  const partnerName = game.interleague_org?.name ?? "the other league";

  // Outstanding requests matter only to the pending branch; the scheduled
  // branch never read them and still doesn't. FAIL CLOSED: an unreadable list
  // could hide a proposal already out with the partner.
  let requests: (RequestLite & { id: string })[] = [];
  if (game.status === "pending_interleague") {
    const { data: reqRows, error: reqRowsErr } = await supabase
      .from("interleague_reschedule_requests")
      .select("id, status, requested_by_user_id")
      .eq("game_id", game.id);
    if (reqRowsErr || !reqRows) {
      return NextResponse.json(
        { error: "We couldn't check this game's outstanding proposals, so nothing was sent. Please try again." },
        { status: 500 },
      );
    }
    requests = reqRows as (RequestLite & { id: string })[];
  }

  const decision = decideHostProposal(game, requests, normalized, Date.now(), partnerName);
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }
  if (decision.branch === "pending_counter") {
    return proposeOnPendingGame({ supabase, user, game, requests, normalized, venueName, note, partnerName });
  }

  // ── Schedule lock ────────────────────────────────────────────────────────
  // The pending branch has gated on this since 0091; the scheduled branch never
  // did. Proposing a new time is our own admin acting on a locked division, and
  // the 0082 trigger permits every write this branch makes (a `status` update
  // plus a row in another table), so this route gate is the only enforcement.
  const lock = lockRefusal(
    {
      divisionName: game.home_team?.division?.name ?? null,
      locked: game.home_team?.division?.locked ?? null,
    },
    "rescheduleInterleague",
  );
  if (lock) return NextResponse.json(lock.body, { status: lock.status });

  // ── Venue-hours gate ─────────────────────────────────────────────────────
  // The endpoint accepts `venue_name` as free text — the proposed venue
  // might be the OTHER org's venue (which we don't track). We only enforce
  // hours when the proposed venue resolves to one we own AND the game is a
  // home game. Away games + unmatched free-text labels skip the gate.
  if (venueName && !game.is_away) {
    const { data: matchedVenue } = await supabase
      .from("venues")
      .select("name, availability, availability_configured")
      .eq("owner_id", currentOrgId)
      .ilike("name", venueName)
      .maybeSingle();

    if (matchedVenue) {
      const settings = (game.home_team?.division?.settings ?? {}) as {
        game_duration?: number;
      };
      const durationMin = Number(settings.game_duration ?? 0);
      const gate = gateVenueProposal(matchedVenue, normalized, durationMin);
      if (!gate.ok) {
        return NextResponse.json(gate.body, { status: gate.status });
      }
    }
  }

  // ── Occupancy gate ───────────────────────────────────────────────────────
  // The hours check above proves our field is OPEN at the proposed time; this
  // proves it is not already TAKEN. The pending branch has run it since 0091;
  // this branch never did.
  //
  // WHY A PROPOSAL IS GATED AT ALL — THE RULE, so a future change keeps the
  // line in the same place:
  //   * every path that WRITES a time gates occupancy (both accept paths do);
  //   * a HOST-SIDE proposal gates too, because the admin is ours and a time
  //     our own field cannot take costs the partner a round trip and an email;
  //   * a PARTNER-SIDE proposal gates HOURS ONLY — never occupancy. It writes
  //     no time, its refusal would leak our bookings to an anonymous token
  //     holder, and occupancy now is not occupancy at the host's later accept.
  // The gate keys its own skip on venue_id, so an away game needs no branch.
  const occupancy = await gateRescheduleOccupancy(supabase, {
    gameId: game.id,
    scheduledAtIso: normalized,
  });
  if (!occupancy.ok) {
    return NextResponse.json(occupancy.body, { status: occupancy.status });
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
    const origin = SITE_URL;
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
      <img src="${SITE_URL}/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
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

// ── Pending branch: "Propose a different time" ──────────────────────────────

async function proposeOnPendingGame(p: {
  supabase: ReturnType<typeof createClient>;
  user: { id: string; email?: string | null };
  game: {
    id: string;
    league_id: string;
    interleague_org_id: string | null;
    is_away: boolean;
    scheduled_at: string;
    external_team_name: string | null;
    proposed_venue_name: string | null;
    proposed_scheduled_at: string | null;
    home_team: { name: string; division: { name: string; locked: boolean | null } | null } | null;
    league: { owner_id: string } | null;
    venue: { name: string; location: { name: string } | null } | null;
  };
  requests: (RequestLite & { id: string })[];
  normalized: string;
  venueName: string;
  note: string;
  partnerName: string;
}) {
  const { supabase, user, game, requests, normalized, venueName, note, partnerName } = p;

  // Schedule lock: the same actor-based gate the resolve route applies. A host
  // proposal is our side of interleague on this division. Wording now comes
  // from division-lock.ts — this branch's sentence CHANGES (it used to say
  // "to change interleague games"), which is deliberate: both host-proposal
  // branches now say the same thing, because they are the same action.
  const pendingLock = lockRefusal(
    {
      divisionName: game.home_team?.division?.name ?? null,
      locked: game.home_team?.division?.locked ?? null,
    },
    "rescheduleInterleague",
  );
  if (pendingLock) return NextResponse.json(pendingLock.body, { status: pendingLock.status });

  // Away games (the partner hosts) must name a field; home games keep ours.
  const proposedVenue = game.is_away ? venueName || game.proposed_venue_name || "" : "";
  if (game.is_away && !proposedVenue) {
    return NextResponse.json({ error: "Away games need the host field's name." }, { status: 400 });
  }

  // Venue-hours gate, then the 0088 occupancy gate, on the PROPOSED time —
  // exactly as the respond route's accept does. Both skip a game with no field
  // of ours (keyed inside each gate).
  const hours = await gateRescheduleVenue(supabase, {
    gameId: game.id,
    scheduledAtIso: normalized,
    proposedVenueName: game.is_away ? proposedVenue : null,
  });
  if (!hours.ok) return NextResponse.json(hours.body, { status: hours.status });
  const occupancy = await gateRescheduleOccupancy(supabase, { gameId: game.id, scheduledAtIso: normalized });
  if (!occupancy.ok) return NextResponse.json(occupancy.body, { status: occupancy.status });

  // The partner's own outstanding counter-back is answered by this proposal.
  const partnerOpen = requests.filter((r) => r.status === "pending" && r.requested_by_user_id === null);
  if (partnerOpen.length > 0) {
    const { error: closeErr } = await supabase
      .from("interleague_reschedule_requests")
      .update({ status: "declined" } as never)
      .in("id", partnerOpen.map((r) => r.id));
    if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: 500 });
  }

  const { data: reqRow, error: insertErr } = await supabase
    .from("interleague_reschedule_requests")
    .insert([
      {
        game_id: game.id,
        requested_by_user_id: user.id,
        proposed_scheduled_at: normalized,
        proposed_venue_name: game.is_away ? proposedVenue : null,
        note: note || null,
      },
    ])
    .select("id, token")
    .single();
  if (insertErr || !reqRow) {
    return NextResponse.json({ error: insertErr?.message ?? "Failed to send your proposal." }, { status: 500 });
  }
  // The game is deliberately NOT updated: it stays pending_interleague.

  const round = proposalRound(requests.length + 1);
  const link = respondUrl(reqRow.token);

  const [{ data: inviteRow }, { data: ownerProfile }] = await Promise.all([
    supabase
      .from("interleague_invites")
      .select("recipient_email")
      .eq("interleague_org_id", game.interleague_org_id ?? "")
      .eq("season_id", game.league_id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("org_name, full_name, email")
      .eq("id", game.league?.owner_id ?? "")
      .maybeSingle(),
  ]);
  const recipientEmail = (inviteRow as { recipient_email: string } | null)?.recipient_email ?? null;
  const owner = ownerProfile as { org_name: string | null; full_name: string | null; email: string | null } | null;
  const hostLeague =
    owner?.org_name?.trim() || owner?.full_name?.trim() || owner?.email || user.email || "The host league";

  if (!recipientEmail) {
    return NextResponse.json({
      ok: true,
      request_id: reqRow.id,
      round,
      email: { sent: false, error: `No contact email is on file for ${partnerName}.`, respond_url: link },
    });
  }

  const mail = hostProposalEmail({
    hostLeague,
    game: {
      matchup: `${game.external_team_name ?? "Your team"} vs ${game.home_team?.name ?? "TBD"}`,
      division: game.home_team?.division?.name ?? "—",
      field: game.is_away ? proposedVenue : game.venue ? qualifiedVenueLabel(game.venue) : null,
      originalIso: game.scheduled_at,
      partnerProposalIso: game.proposed_scheduled_at,
    },
    proposedIso: normalized,
    note: note || null,
    round,
    requestToken: reqRow.token,
  });
  const sent = await sendEmail(recipientEmail, mail.subject, mail.html, mail.text);
  return NextResponse.json({
    ok: true,
    request_id: reqRow.id,
    round,
    email: sent.ok
      ? { sent: true }
      : { sent: false, error: sent.error ?? "The email didn't send.", respond_url: link },
  });
}

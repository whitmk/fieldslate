import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { gateRescheduleVenue } from "@/lib/venues/reschedule-gate";
import { gateRescheduleOccupancy } from "@/lib/venues/occupancy-gate";
import { lockRefusal } from "@/lib/interleague/lock-gate";
import { SITE_URL } from "@/lib/site";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import {
  openHostProposal,
  partnerRowsOnResolve,
  resolveRefusal,
  type RequestLite,
} from "@/lib/interleague/negotiation";
import { hostWithdrewEmail, resolvedEmail } from "@/lib/interleague/negotiation-emails";

export const runtime = "nodejs";

type Action = "accept_proposal" | "keep_original" | "edit" | "decline" | "withdraw_proposal";

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
    s === "decline" ||
    s === "withdraw_proposal"
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
    home_team: {
      name: string;
      division: { name: string; locked: boolean | null } | null;
    } | null;
    interleague_org: { name: string } | null;
    league: { id: string; name: string; season: string | null; owner_id: string } | null;
    venue: { name: string; location: { name: string } | null } | null;
  };
  const { data: gameRaw, error: gameErr } = await supabase
    .from("games")
    .select(
      `id, league_id, home_team_id, interleague_org_id, is_away, status, scheduled_at,
       external_team_name, proposed_scheduled_at, proposed_venue_name, venue_id,
       home_team:teams!home_team_id(name, division:divisions(name, locked)),
       interleague_org:interleague_orgs(name),
       league:leagues(id, name, season, owner_id),
       venue:venues(name, location:locations(name))`
    )
    .eq("id", params.id)
    .single();

  if (gameErr || !gameRaw) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  const game = gameRaw as unknown as FetchRow;
  // RLS (is_org_member on leagues) gates the SELECT above — for users
  // without access the load returns null and we already returned 404. We
  // still guard against a missing league join for typing/defensive reasons.
  if (!game.league) {
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

  // ── Schedule lock (0080/0082) ────────────────────────────────────────────
  // This gate is ACTOR-based and lives HERE, not in the trigger, and that is
  // deliberate — verified against the live DB 2026-07-23: BOTH branches of
  // this route already pass the trigger on a locked division.
  //   * accept writes only scheduled_at / status / proposed_scheduled_at /
  //     proposed_venue_name — every one of them is in the trigger's allowlist.
  //   * decline deletes a `pending_interleague` row, which the trigger's
  //     carve-out permits.
  // Those permissions exist so an anonymous PARTNER can accept or decline
  // under a lock without being stranded. Our own admin resolving is the same
  // row shape — the only difference is WHO is acting — so the trigger cannot
  // tell them apart and the distinction has to be drawn where the actor is
  // known: this authenticated route.
  //
  // Consequence to be honest about: this stops the product's resolve path
  // completely (it is the only one the UI uses), but it is NOT a database
  // guarantee the way blocked INSERTs and DELETEs are. A caller issuing the
  // same UPDATE directly under RLS would still succeed.
  // Wording lives in division-lock.ts with every other locked sentence; this
  // refactor is byte-identical to the literal that used to sit here, pinned by
  // [B-resolve-byte-identical] in sim:reschedule-gate-gaps.
  const resolveLock = lockRefusal(
    {
      divisionName: game.home_team?.division?.name ?? null,
      locked: game.home_team?.division?.locked ?? null,
    },
    "resolveInterleague",
  );
  if (resolveLock) return NextResponse.json(resolveLock.body, { status: resolveLock.status });

  // ── Outstanding proposals on this game (0091) ───────────────────────────
  // The host's own outstanding "different time" blocks every action that
  // would SET the time (resolveRefusal); the partner's outstanding counter-back
  // is closed by those actions (partnerRowsOnResolve). FAIL CLOSED: an
  // unreadable list could hide a proposal the partner is still considering.
  const { data: reqRowsRaw, error: reqRowsErr } = await supabase
    .from("interleague_reschedule_requests")
    .select("id, status, requested_by_user_id, proposed_scheduled_at")
    .eq("game_id", game.id);
  if (reqRowsErr || !reqRowsRaw) {
    return NextResponse.json(
      { error: "We couldn't check this game's outstanding proposals, so nothing was changed. Please try again." },
      { status: 500 },
    );
  }
  const reqRows = reqRowsRaw as (RequestLite & { id: string; proposed_scheduled_at: string })[];
  const partnerName = game.interleague_org?.name ?? "the other league";
  const refusal = resolveRefusal(action, reqRows, partnerName);
  if (refusal) {
    return NextResponse.json({ error: refusal }, { status: 409 });
  }

  // Withdraw the host's own outstanding proposal. The game stays pending with
  // the partner's proposal standing; the partner is told, and the token they
  // hold now shows "already resolved".
  if (action === "withdraw_proposal") {
    const open = openHostProposal(reqRows)!;
    const { error: wErr } = await supabase
      .from("interleague_reschedule_requests")
      .update({ status: "declined" } as never)
      .eq("id", open.id)
      .eq("status", "pending");
    if (wErr) {
      return NextResponse.json({ error: wErr.message }, { status: 500 });
    }
    const { data: inv } = await supabase
      .from("interleague_invites")
      .select("recipient_email, schedule_token")
      .eq("interleague_org_id", game.interleague_org_id)
      .eq("season_id", game.league_id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const invite = inv as { recipient_email: string; schedule_token: string | null } | null;
    const { data: ownerRaw } = await supabase
      .from("profiles")
      .select("org_name, full_name, email")
      .eq("id", game.league.owner_id)
      .maybeSingle();
    const owner = ownerRaw as { org_name: string | null; full_name: string | null; email: string | null } | null;
    const hostLeague = owner?.org_name?.trim() || owner?.full_name?.trim() || owner?.email || "The host league";
    if (!invite?.recipient_email) {
      return NextResponse.json({
        ok: true,
        email: { sent: false, error: `No contact email is on file for ${partnerName}.` },
      });
    }
    const mail = hostWithdrewEmail({
      hostLeague,
      game: {
        matchup: `${game.external_team_name ?? "Your team"} vs ${game.home_team?.name ?? "TBD"}`,
        division: game.home_team?.division?.name ?? "—",
        field: game.is_away ? game.proposed_venue_name : game.venue ? qualifiedVenueLabel(game.venue) : null,
        originalIso: game.scheduled_at,
        partnerProposalIso: game.proposed_scheduled_at,
      },
      withdrawnIso: open.proposed_scheduled_at,
      scheduleToken: invite.schedule_token,
    });
    const sent = await sendEmail(invite.recipient_email, mail.subject, mail.html, mail.text);
    return NextResponse.json({
      ok: true,
      email: sent.ok ? { sent: true } : { sent: false, error: sent.error },
    });
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
      <img src="${SITE_URL}/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
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

      const sent = await sendEmail(recipientEmail, subject, html, text);
      // CHECKED: the game is already removed; if this email didn't go, the
      // partner has no way to learn it, so the host is told to tell them.
      return NextResponse.json({
        ok: true,
        email: sent.ok ? { sent: true } : { sent: false, error: sent.error },
      });
    }

    return NextResponse.json({
      ok: true,
      email: { sent: false, error: `No contact email is on file for ${partnerName}.` },
    });
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

  // Venue-hours gate. Runs BEFORE the update so a failed gate never leaves
  // a partial write. `keep_original` doesn't move scheduled_at, so skip;
  // both other actions write a new scheduled_at. The body's `venue_name`
  // here is only consumed for away games' display label and never moves
  // `venue_id`, so the gate's existing-venue check (on the already-assigned
  // venue) is the meaningful guard for home games.
  if (updatePayload.scheduled_at) {
    const gate = await gateRescheduleVenue(supabase, {
      gameId: game.id,
      scheduledAtIso: updatePayload.scheduled_at,
    });
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
  }

  // Venue-OCCUPANCY gate. The hours check above only proves the field is OPEN;
  // this proves it is not already TAKEN. Runs before the update so a rejection
  // never leaves a partial write. Skipped automatically when the game has no
  // venue_id (nothing to contend for) — that decision lives in the gate, keyed
  // on the venue and not on is_away.
  //
  // THIS RUNS FOR `keep_original` TOO, which is why it sits OUTSIDE the
  // `updatePayload.scheduled_at` branch above. `keep_original` moves no time —
  // it flips pending_interleague -> scheduled — but that flip IS a placement:
  // the game was only ever PROPOSED, and another game can have taken the field
  // at that time while it sat pending. So the check runs against the time
  // already on the row. (The hours gate stays scoped to the time-moving
  // actions: the game's existing time was already validated against the venue's
  // hours when it was created, and re-gating it here would start refusing
  // resolves for hours that changed after the fact — a different decision.)
  const occupancyIso = updatePayload.scheduled_at ?? game.scheduled_at;
  const occupancy = await gateRescheduleOccupancy(supabase, {
    gameId: game.id,
    scheduledAtIso: occupancyIso,
  });
  if (!occupancy.ok) {
    return NextResponse.json(occupancy.body, { status: occupancy.status });
  }

  // Close the partner's outstanding counter-back BEFORE settling the time. If
  // the game update below then fails, the game is still pending with the
  // partner's proposal standing in games.proposed_* — consistent. The reverse
  // order could leave a pending partner row on a game already scheduled.
  const partnerRowStatus = partnerRowsOnResolve(action);
  const partnerOpen = reqRows.filter((r) => r.status === "pending" && r.requested_by_user_id === null);
  if (partnerRowStatus && partnerOpen.length > 0) {
    const { error: closeErr } = await supabase
      .from("interleague_reschedule_requests")
      .update({ status: partnerRowStatus } as never)
      .in("id", partnerOpen.map((r) => r.id));
    if (closeErr) {
      return NextResponse.json({ error: closeErr.message }, { status: 500 });
    }
  }

  const { error: updateErr } = await supabase
    .from("games")
    .update(updatePayload as never)
    .eq("id", game.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Notification email to the partner. ONE email per outcome (resolvedEmail):
  // it used to be a single "Confirmed … your counter-proposal has been
  // resolved" message for accept_proposal, keep_original AND edit, with no
  // link — so a partner whose time was rejected in favour of a brand-new one
  // was told only that things were "resolved". Now it says which happened and
  // links the live schedule. The send is CHECKED: the time is already saved,
  // and a partner who never hears about it has no other way to find out.
  const { data: inviteRow } = await supabase
    .from("interleague_invites")
    .select("recipient_email, schedule_token")
    .eq("interleague_org_id", game.interleague_org_id)
    .eq("season_id", game.league_id)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const invite = inviteRow as { recipient_email: string; schedule_token: string | null } | null;
  if (!invite?.recipient_email) {
    return NextResponse.json({
      ok: true,
      email: { sent: false, error: `No contact email is on file for ${partnerName}.` },
    });
  }

  const { data: ownerRaw } = await supabase
    .from("profiles")
    .select("org_name, full_name, email")
    .eq("id", game.league.owner_id)
    .maybeSingle();
  const owner = ownerRaw as { org_name: string | null; full_name: string | null; email: string | null } | null;
  const hostLeague = owner?.org_name?.trim() || owner?.full_name?.trim() || owner?.email || "The host league";

  const finalIso = updatePayload.scheduled_at ?? game.scheduled_at;
  const mail = resolvedEmail({
    action,
    hostLeague,
    game: {
      matchup: `${game.external_team_name ?? "Your team"} vs ${game.home_team?.name ?? "TBD"}`,
      division: game.home_team?.division?.name ?? "—",
      field: game.is_away
        ? (updatePayload.proposed_venue_name ?? game.proposed_venue_name ?? null)
        : game.venue ? qualifiedVenueLabel(game.venue) : null,
      originalIso: game.scheduled_at,
      partnerProposalIso: game.proposed_scheduled_at,
    },
    finalIso,
    scheduleToken: invite.schedule_token,
  });
  const sent = await sendEmail(invite.recipient_email, mail.subject, mail.html, mail.text);
  return NextResponse.json({
    ok: true,
    email: sent.ok ? { sent: true } : { sent: false, error: sent.error },
  });
}

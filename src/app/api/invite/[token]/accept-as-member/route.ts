// POST /api/invite/[token]/accept-as-member — Interleague Case A: a SIGNED-IN
// league accepts an invite onto its own schedule.
//
// The anonymous route (../accept) is untouched. This one runs under the
// caller's own session, calls the 0097 wrapper RPC (one transaction: the
// host half through the unchanged anon token function + our contact card +
// our game rows under our own RLS), then sends the same two emails the
// anonymous route sends. Nothing here dedups or writes rows itself.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import { logActivity } from "@/lib/activity-log";
import type { RecipientCounteredGame } from "@/lib/interleague/recipient-schedule";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import {
  buildAcceptanceEmail,
  buildRecipientConfirmationEmail,
  type AcceptRpcReturn,
  type GameResponse,
  type ScheduleGame,
  type SchedulePayload,
} from "@/lib/interleague/invite-response-emails";
import {
  memberErrorResponse,
  type MemberGameInput,
} from "@/lib/interleague/signed-in-accept";

export const runtime = "nodejs";

type MemberRpcReturn = AcceptRpcReturn & {
  league_id: string;
  partner_org_id: string;
  partner_org_name: string;
  created: number;
  created_game_ids: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeGames(raw: unknown): { ok: true; games: MemberGameInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "games must be a list." };
  const out: MemberGameInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const game_id = typeof o.game_id === "string" && UUID.test(o.game_id) ? o.game_id : null;
    if (!game_id) return { ok: false, error: "Each game needs a valid game_id." };
    const action: MemberGameInput["action"] =
      o.action === "decline" ? "decline" : o.action === "counter" ? "counter" : "accept";
    const item: MemberGameInput = { game_id, action };
    if (action !== "decline") {
      if (typeof o.team_id !== "string" || !UUID.test(o.team_id)) {
        return { ok: false, error: "Pick your team for every game you accept or counter." };
      }
      item.team_id = o.team_id;
      if (typeof o.venue_id === "string" && o.venue_id) {
        if (!UUID.test(o.venue_id)) return { ok: false, error: "Invalid venue." };
        item.venue_id = o.venue_id;
      }
      if (typeof o.proposed_scheduled_at === "string" && o.proposed_scheduled_at.trim()) {
        item.proposed_scheduled_at = o.proposed_scheduled_at.trim();
      }
    }
    out.push(item);
  }
  return { ok: true, games: out };
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  let body: { league_id?: unknown; games?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const leagueId =
    typeof body.league_id === "string" && UUID.test(body.league_id) ? body.league_id : "";
  if (!leagueId) {
    return NextResponse.json({ error: "Pick the season to add the games to." }, { status: 400 });
  }
  const sanitized = sanitizeGames(body.games);
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }
  const games = sanitized.games;
  if (!games.some((g) => g.action !== "decline")) {
    return NextResponse.json(
      { error: "Accept or counter at least one game, or decline the whole invite." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to accept onto your schedule." }, { status: 401 });
  }

  // Names for the host's email rows (the RPC resolves its own; these are for
  // wording only, read under our RLS BEFORE the write so a failure here is
  // just a plain error, never a half-done accept).
  const teamIds = Array.from(new Set(games.map((g) => g.team_id).filter((x): x is string => !!x)));
  const venueIds = Array.from(new Set(games.map((g) => g.venue_id).filter((x): x is string => !!x)));
  const [teamRes, venueRes] = await Promise.all([
    teamIds.length
      ? supabase.from("teams").select("id, name").in("id", teamIds).eq("league_id", leagueId)
      : Promise.resolve({ data: [], error: null }),
    venueIds.length
      ? supabase.from("venues").select("id, name, location:locations(name)").in("id", venueIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (teamRes.error) {
    return NextResponse.json({ error: teamRes.error.message }, { status: 500 });
  }
  if (venueRes.error) {
    return NextResponse.json({ error: venueRes.error.message }, { status: 500 });
  }
  const teamName = new Map(
    ((teamRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]),
  );
  const venueLabel = new Map(
    ((venueRes.data ?? []) as unknown as { id: string; name: string; location: { name: string } | null }[]).map(
      (v) => [v.id, qualifiedVenueLabel(v)],
    ),
  );

  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types
    "accept_interleague_invite_as_member",
    { p_token: params.token, p_league_id: leagueId, p_games: games },
  );
  if (error) {
    const mapped = memberErrorResponse(error.message);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
  const result = data as MemberRpcReturn | null;
  if (!result) {
    return NextResponse.json({ error: "Failed to submit response." }, { status: 500 });
  }

  const seasonLabelDisplay = result.season_label
    ? `${result.season_name ?? ""}${result.season_label ? ` · ${result.season_label}` : ""}`.trim() ||
      "your season"
    : result.season_name ?? "your season";
  const baseOrigin = SITE_URL.replace(/\/$/, "");
  const dashboardUrl = `${baseOrigin}/dashboard/interleague`;

  // The host's response email — the same builder as the anonymous route.
  const responses: GameResponse[] = games.map((g) => ({
    game_id: g.game_id,
    team_name: g.action === "decline" ? "" : (g.team_id && teamName.get(g.team_id)) || "",
    action: g.action,
    venue_name: g.venue_id ? venueLabel.get(g.venue_id) ?? null : null,
    proposed_scheduled_at: g.proposed_scheduled_at ?? null,
  }));
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

  // Confirmation to the invite's address with the live-schedule link, exactly
  // as the anonymous flow sends it — the inbox the host chose still hears back.
  if (result.recipient_email && result.schedule_token) {
    const scheduleUrl = `${baseOrigin}/schedule/${result.schedule_token}`;
    const senderDisplay =
      result.sender_org_name?.trim() ||
      result.sender_name?.trim() ||
      result.sender_email ||
      "the FieldSlate admin";
    const { data: scheduleRaw } = await supabase.rpc(
      // @ts-expect-error — RPC isn't in generated types
      "get_interleague_schedule_by_token",
      { p_token: result.schedule_token },
    );
    const scheduleData = (scheduleRaw as SchedulePayload | null) ?? null;
    const scheduleGames: ScheduleGame[] = scheduleData?.games ?? [];
    const counteredGames: RecipientCounteredGame[] = scheduleData?.countered_games ?? [];
    const { html, text, subject } = buildRecipientConfirmationEmail({
      senderOrgName: senderDisplay,
      orgName: result.org_name ?? "your league",
      seasonLabelDisplay,
      games: scheduleGames,
      counteredCount: result.countered,
      counteredGames,
      scheduleUrl,
    });
    await sendEmail(result.recipient_email, subject, html, text);
  }

  // Our activity log records the event; best-effort, never blocks the response.
  await logActivity(
    leagueId,
    null,
    "interleague_invite_accepted",
    `Accepted ${result.created} interleague game${result.created === 1 ? "" : "s"} with ${result.partner_org_name} from their invite link${
      result.countered > 0 ? ` (${result.countered} countered, not added)` : ""
    }`,
  );

  return NextResponse.json({
    ok: true,
    accepted: result.accepted,
    countered: result.countered,
    declined: result.declined ?? 0,
    total: result.total,
    created: result.created,
    partner_org_name: result.partner_org_name,
    league_id: result.league_id,
  });
}

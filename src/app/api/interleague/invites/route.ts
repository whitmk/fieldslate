import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { buildInviteEmail } from "@/lib/interleague/invite-email";
import { getCurrentOrgId } from "@/lib/orgs/context";

export const runtime = "nodejs";

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function POST(request: Request) {
  let body: {
    interleague_org_id?: unknown;
    season_id?: unknown;
    recipient_email?: unknown;
    personal_note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orgId =
    typeof body.interleague_org_id === "string" ? body.interleague_org_id : "";
  const seasonId = typeof body.season_id === "string" ? body.season_id : "";
  const recipientEmail =
    typeof body.recipient_email === "string"
      ? body.recipient_email.trim()
      : "";
  const personalNote =
    typeof body.personal_note === "string" && body.personal_note.trim()
      ? body.personal_note.trim()
      : null;

  if (!orgId) {
    return NextResponse.json(
      { error: "interleague_org_id is required." },
      { status: 400 },
    );
  }
  if (!seasonId) {
    return NextResponse.json(
      { error: "season_id is required." },
      { status: 400 },
    );
  }
  if (!isValidEmail(recipientEmail)) {
    return NextResponse.json(
      { error: "Enter a valid recipient email address." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const currentOrgId = await getCurrentOrgId(supabase, user.id);

  // Load org (RLS confirms ownership)
  const { data: orgRaw, error: orgErr } = await supabase
    .from("interleague_orgs")
    .select("id, name")
    .eq("id", orgId)
    .single();
  if (orgErr || !orgRaw) {
    return NextResponse.json(
      { error: "Interleague org not found." },
      { status: 404 },
    );
  }

  // Load season (RLS confirms ownership)
  const { data: seasonRaw, error: seasonErr } = await supabase
    .from("leagues")
    .select("id, name, season")
    .eq("id", seasonId)
    .single();
  if (seasonErr || !seasonRaw) {
    return NextResponse.json(
      { error: "Season not found." },
      { status: 404 },
    );
  }

  // Load sender profile name (fallback to email)
  const { data: profileRaw } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();
  const senderName =
    (profileRaw?.full_name && profileRaw.full_name.trim()) ||
    profileRaw?.email ||
    user.email ||
    "A FieldSlate admin";

  // Block the send if the admin hasn't generated the season schedule yet —
  // the public invite page renders the pre-generated pending_interleague games,
  // and there'd be nothing to show.
  const { count: pendingCount, error: pendingErr } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("league_id", seasonId)
    .eq("interleague_org_id", orgId)
    .eq("status", "pending_interleague");
  if (pendingErr) {
    return NextResponse.json({ error: pendingErr.message }, { status: 500 });
  }
  if (!pendingCount || pendingCount === 0) {
    return NextResponse.json(
      {
        error:
          "Generate the season's game schedule first to create proposed interleague games.",
      },
      { status: 400 },
    );
  }

  // Load division/game proposals for this org (used only in the invite email
  // preview now — actual game rows the recipient sees come from games table).
  // Count actual pending_interleague rows per division to match what the
  // recipient will see on the invite landing page.
  const { data: divsRaw, error: divsErr } = await supabase
    .from("divisions")
    .select("id, name")
    .eq("league_id", seasonId);
  if (divsErr) {
    return NextResponse.json({ error: divsErr.message }, { status: 500 });
  }
  const divisions = (divsRaw ?? []) as { id: string; name: string }[];

  let games: { divisionName: string; gameCount: number }[] = [];
  if (divisions.length > 0) {
    const { data: gamesRaw, error: gamesErr } = await supabase
      .from("games")
      .select("home_team:teams!home_team_id(division_id)")
      .eq("interleague_org_id", orgId)
      .eq("league_id", seasonId)
      .eq("status", "pending_interleague");
    if (gamesErr) {
      return NextResponse.json({ error: gamesErr.message }, { status: 500 });
    }
    const byId = new Map(divisions.map((d) => [d.id, d.name]));
    const counts = new Map<string, number>();
    for (const g of (gamesRaw ?? []) as {
      home_team: { division_id: string | null } | null;
    }[]) {
      const divId = g.home_team?.division_id;
      if (!divId) continue;
      counts.set(divId, (counts.get(divId) ?? 0) + 1);
    }
    games = Array.from(counts.entries())
      .map(([divisionId, gameCount]) => ({
        divisionName: byId.get(divisionId) ?? "Division",
        gameCount,
      }))
      .filter((g) => g.gameCount > 0)
      .sort((a, b) => a.divisionName.localeCompare(b.divisionName));
  }

  // Generate token and insert invite record.
  // sender_user_id is set to the ORG (currentOrgId), not the individual user
  // who clicked send. Migration 0049's interleague_invites RLS gates on
  // is_org_member(sender_user_id), so anyone in the inviting org can see and
  // manage these — necessary now that admins (not just the owner) can send
  // invites. (Migration 0048 made org_id = the owner's user id.)
  const token = generateToken();
  const { data: inviteRaw, error: insertErr } = await supabase
    .from("interleague_invites")
    .insert([
      {
        token,
        sender_user_id: currentOrgId,
        interleague_org_id: orgId,
        season_id: seasonId,
        recipient_email: recipientEmail,
        personal_note: personalNote,
      },
    ])
    .select("id, token, created_at")
    .single();

  if (insertErr || !inviteRaw) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create invite record." },
      { status: 500 },
    );
  }

  // Build invite URL
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    new URL(request.url).origin ??
    "https://thefieldslate.com";
  const inviteUrl = `${origin.replace(/\/$/, "")}/invite/${token}`;

  const seasonLabel = seasonRaw.season
    ? `${seasonRaw.name} · ${seasonRaw.season}`
    : seasonRaw.name;

  const { html, text } = buildInviteEmail({
    inviteUrl,
    senderName,
    seasonLabel,
    orgName: orgRaw.name,
    personalNote,
    games,
  });

  const subject = `Interleague invite from ${senderName} — ${seasonLabel}`;
  const result = await sendEmail(recipientEmail, subject, html, text);

  if (!result.ok) {
    // Roll back the invite row so we don't leave orphaned pending invites
    await supabase.from("interleague_invites").delete().eq("id", inviteRaw.id);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, invite: inviteRaw });
}

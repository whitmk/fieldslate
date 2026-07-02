import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { buildInviteEmail } from "@/lib/interleague/invite-email";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

// Resend an existing pending invite using its original token. We do not mint a
// new token — the recipient's link must stay the same so a forwarded email
// keeps working.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const inviteId = params.id;
  if (!inviteId) {
    return NextResponse.json({ error: "Invite id required." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // RLS scopes to the sender's invites. Pull the columns the email needs.
  const { data: inviteRaw, error: inviteErr } = await supabase
    .from("interleague_invites")
    .select(
      "id, token, status, recipient_email, personal_note, interleague_org_id, season_id",
    )
    .eq("id", inviteId)
    .single();

  if (inviteErr || !inviteRaw) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  if (inviteRaw.status !== "pending") {
    return NextResponse.json(
      { error: "Only pending invites can be resent." },
      { status: 400 },
    );
  }

  const [orgRes, seasonRes, profileRes] = await Promise.all([
    supabase
      .from("interleague_orgs")
      .select("id, name")
      .eq("id", inviteRaw.interleague_org_id)
      .single(),
    supabase
      .from("leagues")
      .select("id, name, season")
      .eq("id", inviteRaw.season_id)
      .single(),
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single(),
  ]);

  if (orgRes.error || !orgRes.data) {
    return NextResponse.json(
      { error: "Interleague org not found." },
      { status: 404 },
    );
  }
  if (seasonRes.error || !seasonRes.data) {
    return NextResponse.json({ error: "Season not found." }, { status: 404 });
  }

  const senderName =
    (profileRes.data?.full_name && profileRes.data.full_name.trim()) ||
    profileRes.data?.email ||
    user.email ||
    "A FieldSlate admin";

  // Rebuild the games preview from current state. If the schedule has since
  // changed, the resent email reflects what the recipient will actually see
  // on the invite landing page.
  const { data: divsRaw, error: divsErr } = await supabase
    .from("divisions")
    .select("id, name")
    .eq("league_id", inviteRaw.season_id);
  if (divsErr) {
    return NextResponse.json({ error: divsErr.message }, { status: 500 });
  }
  const divisions = (divsRaw ?? []) as { id: string; name: string }[];

  let games: { divisionName: string; gameCount: number }[] = [];
  if (divisions.length > 0) {
    const { data: gamesRaw, error: gamesErr } = await supabase
      .from("games")
      .select("home_team:teams!home_team_id(division_id)")
      .eq("interleague_org_id", inviteRaw.interleague_org_id)
      .eq("league_id", inviteRaw.season_id)
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

  const origin = SITE_URL;
  const inviteUrl = `${origin.replace(/\/$/, "")}/invite/${inviteRaw.token}`;

  const seasonLabel = seasonRes.data.season
    ? `${seasonRes.data.name} · ${seasonRes.data.season}`
    : seasonRes.data.name;

  const { html, text } = buildInviteEmail({
    inviteUrl,
    senderName,
    seasonLabel,
    orgName: orgRes.data.name,
    personalNote: inviteRaw.personal_note,
    games,
  });

  const subject = `Interleague invite from ${senderName} — ${seasonLabel}`;
  const result = await sendEmail(inviteRaw.recipient_email, subject, html, text);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}

// What a partner league (the recipient, on a token — never logged in) sees for
// each of its interleague games, and the words used to say it.
//
// Pure: no directive, no Supabase. The public schedule page, the invite page's
// "already accepted" screen and the acceptance confirmation email all render
// from these functions, and scripts/sim/recipient-schedule-sim.ts drives them.
//
// Data comes from get_interleague_schedule_by_token (migration 0090):
//   games           — CONFIRMED games: status 'scheduled' or 'reschedule_pending'
//   countered_games — 'pending_interleague' games the recipient answered with a
//                     different time/field that the host has not resolved yet
// See that migration's header for why exactly these, and why nothing else.

import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";

export type ConfirmedStatus = "scheduled" | "reschedule_pending";

export type RecipientVenue = { name: string; location: { name: string } | null } | null;

export type RecipientConfirmedGame = {
  id: string;
  status: ConfirmedStatus;
  scheduled_at: string;
  is_away: boolean;
  external_team_name: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string };
  division: { name: string };
  venue: RecipientVenue;
};

export type RecipientCounteredGame = {
  id: string;
  status: "pending_interleague";
  scheduled_at: string;
  proposed_scheduled_at: string | null;
  proposed_venue_name: string | null;
  is_away: boolean;
  external_team_name: string | null;
  home_team: { name: string };
  division: { name: string };
  venue: RecipientVenue;
};

export type RecipientSender = {
  full_name: string | null;
  email: string | null;
  org_name?: string | null;
} | null;

/** The HOST league's name, for "waiting on …". Fail-soft like every email site:
 *  org_name → full name → email → literal. Never the payload's `org`, which is
 *  the RECIPIENT's own org (CLAUDE.md naming trap). */
export function hostLeagueLabel(sender: RecipientSender): string {
  return (
    sender?.org_name?.trim() ||
    sender?.full_name?.trim() ||
    sender?.email?.trim() ||
    "the host league"
  );
}

/** Badge for a confirmed game, or null for a plain scheduled one. */
export function confirmedGameBadge(status: string): string | null {
  return status === "reschedule_pending" ? "Change requested" : null;
}

/** "Request reschedule" is offered only on a plain scheduled game in the
 *  future — the RPC behind it refuses anything else, so offering it on a
 *  game with a request already outstanding would only produce an error. */
export function canRequestReschedule(
  game: { status: string; scheduled_at: string },
  nowMs: number,
): boolean {
  return game.status === "scheduled" && new Date(game.scheduled_at).getTime() > nowMs;
}

function when(iso: string): string {
  return `${fmtGameDate(iso)} at ${fmtGameTime(iso)}`;
}

/** The lines shown for one countered game. */
export function counteredGameLines(
  game: RecipientCounteredGame,
  hostLabel: string,
): { yourProposal: string; original: string; status: string } {
  const parts: string[] = [];
  if (game.proposed_scheduled_at) parts.push(when(game.proposed_scheduled_at));
  if (game.is_away && game.proposed_venue_name) parts.push(game.proposed_venue_name);
  return {
    yourProposal: parts.length > 0 ? `You proposed ${parts.join(" · ")}` : "You proposed a change",
    original: `Originally ${when(game.scheduled_at)}`,
    status: `Waiting on ${hostLabel} to respond`,
  };
}

/** Body of the invite page's "already accepted" screen. */
export function acceptedInviteBody(p: {
  acceptedOn: string;
  scheduledCount: number;
  counteredCount: number;
  hostLabel: string;
  hasScheduleLink: boolean;
}): string {
  const n = p.scheduledCount;
  const c = p.counteredCount;
  const scheduled = `${n} game${n === 1 ? " is" : "s are"} scheduled.`;
  const countered =
    c > 0
      ? ` ${c} game${c === 1 ? "" : "s"} you proposed a different time for ${c === 1 ? "is" : "are"} waiting on ${p.hostLabel}.`
      : "";
  const where = p.hasScheduleLink
    ? " Your live schedule shows every game and where each one stands."
    : ` Ask ${p.hostLabel} to resend the live schedule link.`;
  return `This invitation was accepted on ${p.acceptedOn}. ${scheduled}${countered}${where}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The confirmation email's section for countered games: WHICH games and WHAT
 *  was proposed, not just a count. Empty strings when there are none. */
export function counteredEmailSection(
  games: RecipientCounteredGame[],
  hostLabel: string,
): { html: string; text: string } {
  if (games.length === 0) return { html: "", text: "" };
  const rows = games.map((g) => {
    const l = counteredGameLines(g, hostLabel);
    const matchup = `${g.external_team_name ?? "Your team"} vs ${g.home_team.name}`;
    return { matchup, division: g.division.name, ...l };
  });
  const html = `<p style="margin:18px 0 6px;font-size:13px;font-weight:600;color:#92400e;">Waiting on ${escapeHtml(hostLabel)} (${games.length})</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px;border:1px solid #fde68a;border-radius:6px;overflow:hidden;background:#fffbeb;">
        <tbody>${rows
          .map(
            (r) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #fde68a;">${escapeHtml(r.matchup)}<div style="color:#92400e;font-size:12px;margin-top:2px;">${escapeHtml(r.yourProposal)} · ${escapeHtml(r.original)}</div><div style="color:#9ca3af;font-size:12px;margin-top:2px;">${escapeHtml(r.division)}</div></td></tr>`,
          )
          .join("")}</tbody>
      </table>`;
  const text = [
    `Waiting on ${hostLabel}:`,
    ...rows.map((r) => `  • ${r.matchup} — ${r.yourProposal} (${r.original})`),
  ].join("\n");
  return { html, text };
}

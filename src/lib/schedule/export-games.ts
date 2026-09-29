// Which games an export contains, and who is home — the ONE place both CSV
// exports (generic games CSV, Sports Connect CSV) decide it.
//
// Extracted verbatim from buildSportsConnectCsv so the generic CSV follows the
// same rules without a second copy that can drift. A format builder owns ONLY
// its columns, date/time formats and quoting; it never filters games, resolves
// a team name, or swaps home/away itself.
//
// Rules (unchanged from the Sports Connect builder):
// - Included: every game the shared countsAsScheduledGame predicate counts —
//   i.e. everything EXCEPT `cancelled` (which is also what a rained-out game
//   is) and `pending_interleague` (an unagreed proposal, whether or not the
//   partner has countered). scheduled, reschedule_pending, completed and any
//   other status are included.
// - Order: wall-clock start, then OUR team's name, then id (deterministic
//   across identical start times).
// - Partner name: external_team_name (trimmed) → away team's name → "TBD".
// - is_away interleague games swap sides: `games` always stores OUR team as
//   home_team_id and flags the true host with is_away, but an export must
//   report the real host.
// - partnerFieldName is the partner's free-typed field, offered for is_away
//   games ONLY — so a stale counter-proposal venue can never surface on a
//   home game. Blank when unknown.

import { countsAsScheduledGame } from "@/lib/venues/game-days";

export type ExportGame = {
  id: string;
  scheduled_at: string; // ISO wall-clock, e.g. "2026-10-24T09:00:00+00:00"
  status: string;
  is_away: boolean | null;
  external_team_name: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  venue: { name: string; location: { name: string } | null } | null;
};

export type ExportGameRow = {
  id: string;
  scheduledAt: string;
  /** The real host — the partner on an is_away game. */
  homeName: string;
  awayName: string;
  /** Our venue's bare name; "" when the game has no venue of ours. */
  venueName: string;
  /** The venue's park/complex; "" when it has none. */
  locationName: string;
  /** The partner's field (free text), is_away games only; "" when unknown. */
  partnerFieldName: string;
};

export function normalizeExportGames(games: ExportGame[]): ExportGameRow[] {
  const counting = games.filter((g) => countsAsScheduledGame(g.status));

  const sorted = [...counting].sort((a, b) => {
    const t = a.scheduled_at.substring(0, 16).localeCompare(b.scheduled_at.substring(0, 16));
    if (t !== 0) return t;
    const h = (a.home_team?.name ?? "").localeCompare(b.home_team?.name ?? "");
    if (h !== 0) return h;
    return a.id.localeCompare(b.id);
  });

  return sorted.map((g) => {
    const ourTeam = g.home_team?.name ?? "TBD";
    const partner = g.external_team_name?.trim() || (g.away_team?.name ?? "TBD");
    const [homeName, awayName] = g.is_away ? [partner, ourTeam] : [ourTeam, partner];
    return {
      id: g.id,
      scheduledAt: g.scheduled_at,
      homeName,
      awayName,
      venueName: g.venue?.name?.trim() ?? "",
      locationName: g.venue?.location?.name?.trim() ?? "",
      partnerFieldName: g.is_away ? g.proposed_venue_name?.trim() ?? "" : "",
    };
  });
}

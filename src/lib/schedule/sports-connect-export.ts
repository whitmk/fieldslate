// Sports Connect import CSV builder.
//
// Produces the exact column set of the Sports Connect schedule-import
// template (verified against a real sample, 2026-07-23):
//   SortOrder,RoundNo,HomeTeam,AwayTeam,MatchDate,StartTime,EndTime,Location,Field
//   1,1,Red,Blue,11/9/2011,13:00,16:15,McCurry Park,Field 1
//
// Pure and client-timezone-safe: every date/time is read from the stored ISO
// wall-clock SUBSTRING (house convention — see game-days.ts header), never by
// parsing the instant. Kept out of the modal so it can be exercised directly.
//
// Column semantics:
// - SortOrder: 1..N after sorting by wall-clock start, then home name, then
//   id (deterministic across identical start times).
// - RoundNo: calendar-week grouping via the shared weekKeyFromIsoDate
//   (Monday-start weeks). First week containing an exported game = round 1,
//   next week containing one = round 2 — gap weeks are skipped, not counted.
//   KNOWN LIMITATION: a rainout makeup carries the round of the week it was
//   MOVED TO, not its original week — the original date is not stored
//   anywhere (rainout reschedule overwrites scheduled_at in place; the
//   activity log is prose; interleague_reschedule_requests stores only the
//   proposed new time). Revisit only if original-date storage is added.
// - EndTime: start + game_duration. buffer_minutes is between-game spacing,
//   never part of play length — do not add it.
// - Location / Field split by whether the venue has a LOCATION (park/complex):
//   * venue HAS a location  → Location = location name, Field = venue name.
//   * venue has NO location  → Location = venue name,   Field = blank
//     (today's exact behavior, byte-for-byte — every venue is location-less
//     until an org adopts locations, so this is what every current export
//     produces).
//   The venue stays the atomic bookable unit; location is a grouping label.
//   Never stub a Field value when there is no location — a blank Field is
//   correct, and a venue with no location is the common case.
// - is_away interleague games swap columns (partner org's team is HomeTeam):
//   the games table always stores OUR team as home_team_id and flags the
//   true home side with is_away (verified against live rows 2026-07-23), but
//   a Home/Away CSV must report the real host. Accepted interleague games
//   carry external_team_name (the accept RPC requires it); the null-name
//   "TBD" fallback covers legacy pre-invite-flow rows and the rainout
//   status-flip path — both real in production, rendered as the panel does.
// - Location for is_away games falls back to proposed_venue_name (the
//   partner's field — venue_id is NULL on every away row). Gated on is_away
//   to match the schedule panel's display rule, so a stale counter-proposal
//   venue can never surface on a home game. Blank/whitespace names fall
//   through the same as blank partner names (venues.name is NOT NULL but
//   has no non-blank CHECK). is_away games carry no venue row, so they never
//   get a Field value — Field stays blank exactly as today.

import { countsAsScheduledGame, weekKeyFromIsoDate } from "@/lib/venues/game-days";
import type { createClient } from "@/lib/supabase/client";

export type SportsConnectGame = {
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

export type SportsConnectResult =
  | { ok: true; csv: string; rowCount: number }
  | { ok: false; error: string };

export type SportsConnectFetchClient = ReturnType<typeof createClient>;

/** The SINGLE games fetch both export surfaces use (the league-page picker
 *  modal and the /dashboard/export page). Shared so the column list can't
 *  drift between surfaces — a divergent select would change names/locations
 *  even with one builder. No status filter here: the builder applies the
 *  shared countsAsScheduledGame predicate. */
export async function fetchSportsConnectGames(
  supabase: SportsConnectFetchClient,
  divisionId: string,
): Promise<{ ok: true; games: SportsConnectGame[] } | { ok: false; error: string }> {
  const { data: teamData, error: teamErr } = await supabase
    .from("teams")
    .select("id")
    .eq("division_id", divisionId);
  if (teamErr) return { ok: false, error: teamErr.message };
  const teamIds = ((teamData ?? []) as { id: string }[]).map((t) => t.id);
  if (teamIds.length === 0) return { ok: true, games: [] };

  const { data, error } = await supabase
    .from("games")
    .select(`id, scheduled_at, status, is_away, external_team_name, proposed_venue_name,
      home_team:teams!home_team_id(name),
      away_team:teams!away_team_id(name),
      venue:venues(name, location:locations(name))`)
    .in("home_team_id", teamIds)
    .order("scheduled_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, games: (data ?? []) as unknown as SportsConnectGame[] };
}

export const SPORTS_CONNECT_HEADER =
  "SortOrder,RoundNo,HomeTeam,AwayTeam,MatchDate,StartTime,EndTime,Location,Field";

/** Quote a field only when it needs it (comma, quote, or newline) — the
 *  template sample is unquoted, so gratuitous quoting risks a naive importer. */
function csvField(val: string): string {
  return /[",\r\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
}

/** M/D/YYYY, no leading zeros (template format: 11/9/2011). */
function fmtMatchDate(iso: string): string {
  const [y, m, d] = iso.substring(0, 10).split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`;
}

/** 24-hour HH:MM from minutes-since-midnight, wrapped at 24h. (A game whose
 *  end crosses midnight would show the wrapped time — venue windows make
 *  that unreachable in practice.) */
function fmtHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function startMinutes(iso: string): number {
  const [h, m] = iso.substring(11, 16).split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

export function buildSportsConnectCsv(
  games: SportsConnectGame[],
  gameDurationMinutes: unknown,
  divisionName: string,
): SportsConnectResult {
  // Fail LOUD on a missing/non-positive game length: EndTime == StartTime is
  // silently wrong data landing in a customer's system.
  const duration = Number(gameDurationMinutes);
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      ok: false,
      error:
        `Can't export "${divisionName}": its game duration is missing or invalid ` +
        `(${String(gameDurationMinutes)}). Set a game length in the division's ` +
        `Playing Schedule settings, then export again.`,
    };
  }

  const counting = games.filter((g) => countsAsScheduledGame(g.status));

  const sorted = [...counting].sort((a, b) => {
    const t = a.scheduled_at.substring(0, 16).localeCompare(b.scheduled_at.substring(0, 16));
    if (t !== 0) return t;
    const h = (a.home_team?.name ?? "").localeCompare(b.home_team?.name ?? "");
    if (h !== 0) return h;
    return a.id.localeCompare(b.id);
  });

  // Distinct game-bearing weeks, in order → round numbers.
  const weekKeys = Array.from(new Set(sorted.map((g) => weekKeyFromIsoDate(g.scheduled_at)))).sort();
  const roundByWeek = new Map(weekKeys.map((wk, i) => [wk, i + 1]));

  const rows = sorted.map((g, i) => {
    const ourTeam = g.home_team?.name ?? "TBD";
    const partner = g.external_team_name?.trim() || (g.away_team?.name ?? "TBD");
    const [homeName, awayName] = g.is_away ? [partner, ourTeam] : [ourTeam, partner];
    const start = startMinutes(g.scheduled_at);
    // Location / Field split (see header). A venue with a location fills BOTH;
    // a venue without one keeps today's behavior (Location = venue, Field
    // blank); an is_away row has no venue, so Location falls back to
    // proposed_venue_name and Field stays blank — all byte-for-byte as before
    // for the no-location case.
    const venueName = g.venue?.name?.trim() ?? "";
    const locationName = g.venue?.location?.name?.trim() ?? "";
    let location: string;
    let field: string;
    if (venueName && locationName) {
      location = locationName;
      field = venueName;
    } else if (venueName) {
      location = venueName;
      field = "";
    } else {
      location = g.is_away ? g.proposed_venue_name?.trim() ?? "" : "";
      field = "";
    }
    return [
      String(i + 1),
      String(roundByWeek.get(weekKeyFromIsoDate(g.scheduled_at)) ?? 0),
      homeName,
      awayName,
      fmtMatchDate(g.scheduled_at),
      fmtHHMM(start),
      fmtHHMM(start + duration),
      location,
      field,
    ]
      .map(csvField)
      .join(",");
  });

  return {
    ok: true,
    csv: [SPORTS_CONNECT_HEADER, ...rows].join("\r\n") + "\r\n",
    rowCount: rows.length,
  };
}

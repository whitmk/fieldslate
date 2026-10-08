// The shape get_league_schedule_by_token (migration 0105) returns. Every key
// here is one the reader names; nothing else can arrive. Never widen these
// types with a key the reader does not emit — the reader is the guard on what
// leaves the database, and a type that promises more invites code that reads
// it from somewhere else.

export type PublicVenue = {
  name: string;
  location: { name: string } | null;
  /** The field's street address, else its park's; trimmed, blank as null. */
  address: string | null;
  /** True when the field's park is marked as one of the league's own. */
  home_park: boolean;
} | null;

export type PublicGame = {
  id: string;
  /** Wall-clock text with a literal +00 — never parse it as an instant. */
  scheduled_at: string;
  status: string;
  is_away: boolean | null;
  interleague: boolean;
  division_id: string | null;
  home_team_id: string;
  away_team_id: string | null;
  external_team_name: string | null;
  /** The partner's field, away interleague games only. */
  proposed_venue_name: string | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  venue: PublicVenue;
};

export type PublicPlayoffGame = {
  id: string;
  playoff_id: string;
  format: string;
  division_id: string;
  round: string;
  game_number: number;
  scheduled_date: string | null;
  /** "HH:MM" or null. */
  start_time: string | null;
  status: string;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
  venue: PublicVenue;
};

export type PublicDivision = { id: string; name: string; game_duration: unknown };
export type PublicTeam = { id: string; name: string; division_id: string | null };

export type PublicSeason = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  divisions: PublicDivision[];
  /** Names of divisions that are not locked — not published yet. */
  unpublished: string[];
  teams: PublicTeam[];
  games: PublicGame[];
  playoff_games: PublicPlayoffGame[];
};

export type PublicScheduleOk = {
  status: "ok";
  org: { name: string | null; timezone: string };
  /** Today in the ORG's timezone (YYYY-MM-DD), computed by the database. */
  today: string;
  seasons: PublicSeason[];
};

export type PublicScheduleRefusal = { status: "unknown" | "off" | "plan" };

export type PublicScheduleResult = PublicScheduleOk | PublicScheduleRefusal;

/** What the data route answers. `error` = the read failed; it is never
 *  cached and the page renders "couldn't load", never an empty schedule. */
export type PublicScheduleResponse = PublicScheduleResult | { status: "error" };

export const TOKEN_RE = /^[0-9a-f]{64}$/;

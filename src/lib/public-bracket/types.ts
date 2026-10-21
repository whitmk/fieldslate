// The shape get_league_bracket_by_token (migration 0116) returns. Every key
// here is one the reader names; nothing else can arrive. Never widen these
// types with a key the reader does not emit — the reader is the guard on what
// leaves the database.

export type PublicBracketGame = {
  id: string;
  round: string;
  /** The bracket POSITION (advancement keys on it); never shown — see
   *  bracket-labels `gameNumbering`. */
  game_number: number;
  series_game: number;
  /** The series' length (1 for a single game). The reader leaves not-needed
   *  games out, so it can't be counted from the rows. */
  series_length: number;
  scheduled_date: string | null;
  /** "HH:MM" or null. */
  start_time: string | null;
  status: string;
  seed_home: number | null;
  seed_away: number | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
  winner_id: string | null;
  /** Null whenever the bracket's "Show scores publicly" is off. */
  home_score: number | null;
  away_score: number | null;
  venue: { name: string; location: { name: string } | null } | null;
};

export type PublicBracket = {
  id: string;
  stage: number;
  format: string;
  advance_count: number | null;
  show_scores: boolean;
  games: PublicBracketGame[];
};

export type PublicBracketOk = {
  status: "ok";
  org: { name: string | null; timezone: string };
  /** Today in the ORG's timezone (YYYY-MM-DD), computed by the database. */
  today: string;
  season: { id: string; name: string };
  division: { id: string; name: string };
  /** Stage 1 first; a two-stage setup has two. */
  brackets: PublicBracket[];
};

/** Refusals that name the division (its name is already public on the
 *  schedule). */
export type PublicBracketNamed = {
  status: "unpublished" | "no_bracket" | "not_shareable";
  division: { name: string };
};

export type PublicBracketRefusal = { status: "unknown" | "off" | "plan" | "unavailable" };

export type PublicBracketResult = PublicBracketOk | PublicBracketNamed | PublicBracketRefusal;

/** What the data route answers. `error` = the read failed; it is never
 *  cached and the page renders "couldn't load", never an empty bracket. */
export type PublicBracketResponse = PublicBracketResult | { status: "error" };

/** A division id as the URL carries it. Anything else is answered
 *  `unavailable` without touching the database. */
export const DIVISION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

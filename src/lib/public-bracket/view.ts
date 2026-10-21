// The public bracket page (/s/<token>/bracket/<division>) — every decision and
// every sentence, pure (no React, no DOM, no clock). The page renders these
// VERBATIM with the SAME presentation pieces as the Playoffs page
// (bracket-pieces.tsx, series-card.tsx), with no buttons and no daylight.
// Approved mockup: docs/mockups/public-bracket.html (2026-10-20).
//
// Scores: the reader sends none for a bracket whose "Show scores publicly" is
// off, so the cards simply have no numbers; the winner (bold + trophy) and
// advancement still show. Nothing here or on the page says scores are hidden.

import { slotName, type Side } from "@/lib/playoffs/bracket-labels";
import { playoffRoundTitle } from "@/lib/playoffs/playoff-result";
import { isSeriesRound, roundTitle, seriesLengthOf } from "@/lib/playoffs/series-names";
import { NOT_NEEDED } from "@/lib/playoffs/series";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import type { PublicBracket, PublicBracketOk, PublicBracketResponse } from "./types";

/** An undated game on the public page (the admin card says "No date yet"). */
export const UNDATED_PUBLIC = "Date TBD";

/** Refetch while the tab is visible. */
export const REFRESH_MS = 60_000;

/** Below this width the page opens on the list; at or above, the bracket. */
export const PHONE_MAX_WIDTH = 640;

/** The view the page opens on for a viewport width (read after mount). */
export function openingMode(width: number): "bracket" | "list" {
  return width < PHONE_MAX_WIDTH ? "list" : "bracket";
}

/** A game as the pieces read it (bracket-pieces BracketGame), built from the
 *  reader's answer. */
export type PublicRow = {
  id: string;
  playoff_id: string;
  round: string;
  game_number: number;
  series_game: number;
  status: string;
  winner_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  seed_home: number | null;
  seed_away: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  venue_name: string | null;
  winner_name: string | null;
  home_score: number | null;
  away_score: number | null;
};

export function toRows(b: PublicBracket): PublicRow[] {
  const rows: PublicRow[] = b.games.map((g) => ({
    id: g.id,
    playoff_id: b.id,
    round: g.round,
    game_number: g.game_number,
    series_game: g.series_game,
    status: g.status,
    winner_id: g.winner_id,
    home_team_id: g.home_team?.id ?? null,
    away_team_id: g.away_team?.id ?? null,
    scheduled_date: g.scheduled_date,
    start_time: g.start_time,
    seed_home: g.seed_home,
    seed_away: g.seed_away,
    home_team_name: g.home_team?.name ?? null,
    away_team_name: g.away_team?.name ?? null,
    // The field with its park, as on the public schedule ("Monroe Complex — Andrews").
    venue_name: g.venue ? qualifiedVenueLabel(g.venue) : null,
    winner_name:
      g.winner_id && g.winner_id === g.home_team?.id ? g.home_team.name
        : g.winner_id && g.winner_id === g.away_team?.id ? g.away_team.name
          : null,
    // The reader already sent null when scores are off; this is the second lock.
    home_score: b.show_scores ? g.home_score : null,
    away_score: b.show_scores ? g.away_score : null,
  }));
  // The reader leaves a series' not-needed games out, so the shared series
  // rules (length, "best of", the standing, "If needed") would count a 2–0
  // best-of-3 as a best-of-2. Put them back as NOT-NEEDED rows with no teams,
  // date or field, from the reader's series_length. The page counts them and
  // draws no card or list row for them (hideNotNeeded / notShown).
  for (const g of b.games) {
    if (g.series_game !== 1 || g.series_length <= 1) continue;
    const present = new Set(rows.filter((r) => r.round === g.round && r.game_number === g.game_number).map((r) => r.series_game));
    for (let k = 2; k <= g.series_length; k++) {
      if (present.has(k)) continue;
      rows.push({
        id: `${g.id}-not-needed-${k}`, playoff_id: b.id, round: g.round, game_number: g.game_number, series_game: k,
        status: NOT_NEEDED, winner_id: null, home_team_id: null, away_team_id: null, scheduled_date: null, start_time: null,
        seed_home: null, seed_away: null, home_team_name: null, away_team_name: null, venue_name: null, winner_name: null,
        home_score: null, away_score: null,
      });
    }
  }
  return rows;
}

/** A row the page draws (a rebuilt not-needed game is counted, never drawn). */
export function shown(r: PublicRow): boolean {
  return r.status !== NOT_NEEDED;
}

/** A slot's text: "4 · Mets" on a seeded Stage 2 slot, else the team, else
 *  "Winner of Game N" / "Seed N" / "TBD" (the one label rule). */
export function slotText(g: PublicRow, side: Side, bracket: PublicRow[], format: string, showSeeds: boolean): string {
  const seed = side === "home" ? g.seed_home : g.seed_away;
  const team = side === "home" ? g.home_team_name : g.away_team_name;
  if (showSeeds && team && seed != null) return `${seed} · ${team}`;
  return slotName(team, g, side, bracket, format);
}

/** A round's heading — the tree's: "Semifinals · best of 3" for a series round. */
export function roundHeading(round: string, games: PublicRow[]): string {
  const row = games.find((g) => g.round === round);
  if (row && isSeriesRound(round, games)) return `${roundTitle(round, games)} · best of ${seriesLengthOf(row, games)}`;
  return playoffRoundTitle(round, games);
}

export function pageTitle(divisionName: string): string {
  return `${divisionName} Playoffs`;
}

export function isTwoStage(data: PublicBracketOk): boolean {
  return data.brackets.some((b) => b.stage === 2);
}

export function formatLine(data: PublicBracketOk): string {
  if (isTwoStage(data)) return "Round robin, then bracket";
  const f = data.brackets[0]?.format;
  return f === "round_robin" ? "Round robin" : "Single elimination";
}

/** Two-stage: the page opens on Stage 2 once any bracket slot has a team. */
export function defaultStage(data: PublicBracketOk): 1 | 2 {
  const s2 = data.brackets.find((b) => b.stage === 2);
  return s2 && s2.games.some((g) => g.home_team || g.away_team) ? 2 : 1;
}

export function advanceLine(count: number | null): string | null {
  return count && count >= 2 ? `Top ${count} move on to the bracket.` : null;
}

export const SEEDING_PENDING = "The bracket fills in when the league sets the seeds after the round robin.";

/** A round robin's sit-outs per round: every team of the stage that has no
 *  game in that round, A–Z. */
export function sitOuts(games: PublicRow[]): Map<string, string[]> {
  const teams = new Map<string, string>();
  for (const g of games) {
    if (g.home_team_id && g.home_team_name) teams.set(g.home_team_id, g.home_team_name);
    if (g.away_team_id && g.away_team_name) teams.set(g.away_team_id, g.away_team_name);
  }
  const out = new Map<string, string[]>();
  const rounds = [...new Set(games.map((g) => g.round))];
  for (const r of rounds) {
    const playing = new Set(games.filter((g) => g.round === r).flatMap((g) => [g.home_team_id, g.away_team_id]));
    out.set(r, [...teams].filter(([id]) => !playing.has(id)).map(([, name]) => name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return out;
}

export function sitOutLine(names: string[]): string | null {
  return names.length ? `Sits out: ${names.join(", ")}` : null;
}

/** "2:41 PM" — the viewer's clock, for the stale line only (read after a
 *  successful load, never during render). */
export function clockLabel(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function staleLine(asOf: string): string {
  return `Couldn't refresh. Showing results as of ${asOf}.`;
}

export const LOADING_TITLE = "Loading the bracket…";

/** The state card for every answer that is not a bracket. `allGames` = offer
 *  "See all games" (the public schedule); `retry` = offer "Try again". */
export function stateCopy(r: Exclude<PublicBracketResponse, PublicBracketOk>): {
  title: string;
  body: string;
  allGames: boolean;
  retry: boolean;
} {
  switch (r.status) {
    case "error":
      return {
        title: "We couldn't load the bracket right now",
        body: "This is a problem on our side, not a change to the games. Try again in a few minutes.",
        allGames: false,
        retry: true,
      };
    case "unknown":
      return { title: "This link isn't recognized", body: "Check the link with your league — it may have been replaced.", allGames: false, retry: false };
    case "off":
    case "plan":
      return {
        title: "This bracket isn't available",
        body: "This league has turned off its public schedule. Check the league's website or ask your coach.",
        allGames: false,
        retry: false,
      };
    case "unavailable":
      return {
        title: "This bracket isn't available",
        body: "The league may have moved on to a new season. Check the league's website or ask your coach.",
        allGames: true,
        retry: false,
      };
    case "unpublished":
      return {
        title: `${r.division.name} isn't published yet`,
        body: "The league hasn't published this division's schedule. Check back soon.",
        allGames: true,
        retry: false,
      };
    case "no_bracket":
      return {
        title: `No bracket for ${r.division.name} yet`,
        body: "The league hasn't set up playoffs for this division. Check back soon.",
        allGames: true,
        retry: false,
      };
    case "not_shareable":
      return {
        title: "This bracket can't be shown here yet",
        body: "The league's games are still on the full schedule.",
        allGames: true,
        retry: false,
      };
  }
}

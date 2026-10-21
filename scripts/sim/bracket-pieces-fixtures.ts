// Fixture brackets and the admin glue for the bracket-pieces golden
// (bracket-pieces-sim.ts). API-neutral: it builds the games and the functions
// BracketView hands its pieces (labels, shown numbers, series info, the
// championship round, a daylight flag per game) the way BracketView builds
// them, so a render of the pieces can be compared with the golden recorded
// from the pre-split tree (2026-10-20, step 2 of the public bracket page).
//
// The glue is a COPY of BracketView's, on purpose: the golden pins what the
// PIECES render for given inputs. BracketView's own glue is pinned by the
// existing source greps (bracket-print S3/S7, playoff-series FN11, …).
import type { DaylightFlag } from "../../src/lib/daylight/flags";
import { gameLabel, gameNumbering, slotName, type Side } from "../../src/lib/playoffs/bracket-labels";
import { playoffRoundTitle } from "../../src/lib/playoffs/playoff-result";
import {
  NOT_NEEDED,
  SERIES_TAG_TEXT,
  gameHasResult,
  seriesGameActions,
  seriesGameTag,
  seriesGamesOf,
  seriesHeadline,
} from "../../src/lib/playoffs/series";
import { isFinalRound, isSeriesGame } from "../../src/lib/playoffs/series-names";
import { doubleElim, playedFour, roundRobin, seriesMockup, seriesSixteen, singleElim } from "./bracket-print-fixtures";
import type { PrintGame } from "../../src/lib/playoffs/bracket-print";
import type { GameWithTeams } from "../../src/components/playoffs/bracket-view";

// The admin game shape (bracket-view's GameWithTeams): the stored row plus
// names and the field's lights. Fixture rows carry every key the pieces read.
export type FixtureGame = GameWithTeams;

export type Case = {
  name: string;
  format: string;
  showSeeds: boolean;
  games: FixtureGame[];
};

function widen(games: PrintGame[], seeds = false): FixtureGame[] {
  return games.map((g, i) => ({
    ...g,
    playoff_id: "p",
    league_id: "l",
    division_id: "d",
    venue_id: g.venue_name ? "v" : null,
    venue_has_lights: g.venue_name ? i % 2 === 0 : null,
    winner_name: g.winner_id ? (g.winner_id === g.home_team_id ? g.home_team_name : g.away_team_name) : null,
    seed_home: seeds && g.home_team_id ? Number(g.home_team_id.slice(1)) : null,
    seed_away: seeds && g.away_team_id ? Number(g.away_team_id.slice(1)) : null,
    series_game: g.series_game ?? 1,
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  }) as unknown as FixtureGame);
}

export function cases(): Case[] {
  return [
    { name: "se8", format: "single_elimination", showSeeds: false, games: widen(singleElim(8, 4)) },
    { name: "se11-byes", format: "single_elimination", showSeeds: false, games: widen(singleElim(11, 6)) },
    { name: "played4", format: "single_elimination", showSeeds: false, games: widen(playedFour()) },
    { name: "se8-seeds", format: "single_elimination", showSeeds: true, games: widen(singleElim(8, 7), true) },
    { name: "series-majors-6", format: "single_elimination", showSeeds: false, games: widen(seriesMockup()) },
    { name: "series-16", format: "single_elimination", showSeeds: false, games: widen(seriesSixteen()) },
    { name: "rr5", format: "round_robin", showSeeds: false, games: widen(roundRobin(5)) },
    { name: "de8", format: "double_elimination", showSeeds: false, games: widen(doubleElim(8)) },
  ];
}

/** Every third dated game carries a daylight flag (alternating kinds), so
 *  both the chip and its absence are rendered. */
export function flagFor(g: FixtureGame, index: number): DaylightFlag | null {
  if (!g.scheduled_date || index % 3 !== 1) return null;
  return {
    kind: index % 2 ? "near" : "after",
    minutes: 10 + (index % 7),
    date: g.scheduled_date,
    sunsetMin: 1100,
    endMin: 1110,
    startByMin: 900,
  };
}

const ROUND_ORDER: Record<string, number> = {
  "WB-R1": 10, "WB-R2": 11, "WB-R3": 12, "WB-R4": 13,
  "WB-F": 20,
  "LB-R1": 30, "LB-R2": 31, "LB-R3": 32, "LB-R4": 33,
  "LB-R5": 34, "LB-R6": 35, "LB-R7": 36, "LB-R8": 37,
  "LB-F": 40,
  "GF": 50, "GF-R": 51,
};
function getRoundOrder(round: string): number {
  if (round in ROUND_ORDER) return ROUND_ORDER[round];
  const m = round.match(/^(RR|R|SF|F)(\d*)/);
  if (!m) return 99;
  if (m[1] === "F") return 50;
  if (m[1] === "SF") return 40;
  return parseInt(m[2] || "0");
}

const TONE: Record<string, string> = {
  gray: "bg-gray-100 text-gray-600",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-[#22C55E]/10 text-[#15803d]",
};

/** BracketView's glue for one bracket. */
export function glue(c: Case) {
  const games = c.games;
  const numbering = gameNumbering(games);
  const numberOf = (g: FixtureGame) => numbering(g.game_number);
  const names = new Map<string, string>();
  for (const g of games) {
    if (g.home_team_id && g.home_team_name) names.set(g.home_team_id, g.home_team_name);
    if (g.away_team_id && g.away_team_name) names.set(g.away_team_id, g.away_team_name);
  }
  const teamName = (id: string) => names.get(id) ?? "TBD";
  const labelOf = (g: FixtureGame, side: Side) => {
    const seed = side === "home" ? g.seed_home : g.seed_away;
    const team = side === "home" ? g.home_team_name : g.away_team_name;
    if (c.showSeeds && team && seed != null) return `${seed} · ${team}`;
    return slotName(side === "home" ? g.home_team_name : g.away_team_name, g, side, games, c.format);
  };
  const seriesInfo = (g: FixtureGame) => {
    if (!isSeriesGame(g, games)) return null;
    const sgames = seriesGamesOf(g, games);
    const tag = seriesGameTag(g, sgames);
    const latest = [...sgames].reverse().find(gameHasResult);
    let chip: { text: string; className: string } | null = null;
    if (latest && latest.id === g.id) {
      const h = seriesHeadline(sgames, teamName);
      chip = { text: h.text, className: TONE[h.tone] };
    } else if (tag === "next" || tag === "if_needed" || tag === "not_needed") {
      chip = { text: SERIES_TAG_TEXT[tag], className: tag === "if_needed" ? TONE.amber : TONE.gray };
    }
    return {
      label: gameLabel(g, games),
      chip,
      notNeeded: g.status === NOT_NEEDED || tag === "not_needed",
      actions: seriesGameActions(g, sgames),
    };
  };
  const roundMap = new Map<string, FixtureGame[]>();
  for (const g of games) {
    if (!roundMap.has(g.round)) roundMap.set(g.round, []);
    roundMap.get(g.round)!.push(g);
  }
  const rounds = [...roundMap.entries()].sort(([a], [b]) => getRoundOrder(a) - getRoundOrder(b));
  const lastRound = rounds[rounds.length - 1]?.[0] ?? null;
  const championshipRound =
    new Set(["F", "GF"]).has(lastRound ?? "") || (lastRound !== null && isFinalRound(lastRound, games)) ? lastRound : null;
  const index = new Map(games.map((g, i) => [g.id, i]));
  const flagOf = (g: FixtureGame) => flagFor(g, index.get(g.id) ?? 0);
  const roundName = (g: FixtureGame) => playoffRoundTitle(g.round, games);
  return { games, numberOf, teamName, labelOf, seriesInfo, rounds, championshipRound, flagOf, roundName };
}

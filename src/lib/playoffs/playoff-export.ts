// The Playoffs export's Sports Connect CSV and the schedule print's labels —
// PURE (no Supabase, no React, no clock), so `npm run sim:playoff-export`
// drives exactly what the modal downloads.
//
// END TIME (fixed 2026-10-20, approved mockup screen 13): start + the
// division's `game_duration`, read as the projected key
// (`game_duration:settings->game_duration`, never the settings blob). A
// division with no usable length gets a BLANK end time and the modal says so
// (`noDurationNote`) — it used to be start + a hardcoded 90 minutes.
//
// EMPTY SLOTS: every slot reads what the bracket shows (slotName): the team,
// else "Seed N" (an unseeded two-stage Stage 2), "Winner of Game N" or "TBD".
// A dated game is exported even before its teams are known.
//
// SERIES (0114, approved mockup 9): in a bracket with a series round every
// game is titled by name — "Round 1 · Game 1", "Semifinal 1 · Game 2 of 3",
// "(if needed)" from the results (seriesGameTag) — and a series game whose
// teams aren't both known names no home team ("Bears and Winner of Semifinal
// 1"). NOT-NEEDED games are not exported (exportableGames). A bracket with no
// series exports exactly as before.

import { slotName, type Side } from "@/lib/playoffs/bracket-labels";
import { planSettingsFromDivision } from "@/lib/playoffs/bracket-plan";
import { playoffRoundTitle } from "@/lib/playoffs/playoff-result";
import { rrGameLabel } from "@/lib/playoffs/two-stage";
import { gameLabel } from "@/lib/playoffs/bracket-labels";
import { NOT_NEEDED, outboundMatchup, seriesGameTag, seriesGamesOf } from "@/lib/playoffs/series";
import { isSeriesGame, isSeriesRound, roundTitle } from "@/lib/playoffs/series-names";

export type ExportGame = {
  id: string;
  playoff_id: string;
  round: string;
  game_number: number;
  scheduled_date: string | null;
  start_time: string | null;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  winner_id: string | null;
  seed_home?: number | null;
  seed_away?: number | null;
  venue_name: string | null;
  /** 0114: which game of its series; absent or 1 for a single game. */
  series_game?: number;
};

/** A two-stage pair's ids; null for an ordinary bracket. */
export type ExportPair = { stage1Id: string; stage2Id: string } | null;

/** The division's game length in minutes, or null when it isn't set or
 *  isn't usable — then End is left blank, never guessed. */
export function exportDuration(rawGameDuration: unknown): number | null {
  const s = planSettingsFromDivision({ game_duration: rawGameDuration });
  return s.durationDefaulted ? null : s.durationMin;
}

export function noDurationNote(divisionName: string): string {
  return `${divisionName} has no game length set, so End is blank in this file. Set it on the division to fill it in.`;
}

/** A game's round as the export and the schedule print name it. In a
 *  two-stage pair the round robin reads "Round robin · RR Game 13" and the
 *  bracket "Bracket · Round 1", so "Game N" always means the bracket. `own`
 *  is the game's whole bracket: a single elimination's last round is always
 *  the Final (playoffRoundTitle). */
export function exportRound(
  g: Pick<ExportGame, "playoff_id" | "round" | "game_number">,
  pair: ExportPair,
  own: ReadonlyArray<Pick<ExportGame, "round" | "game_number">>,
): string {
  if (pair && g.playoff_id === pair.stage1Id) return `Round robin · ${rrGameLabel(g.game_number)}`;
  if (pair && g.playoff_id === pair.stage2Id) return `Bracket · ${playoffRoundTitle(g.round, own)}`;
  return playoffRoundTitle(g.round, own);
}

/** The games an export or schedule print lists: every one but a NOT-NEEDED
 *  series game (0114). */
export function exportableGames<G extends Pick<ExportGame, "status">>(games: G[]): G[] {
  return games.filter((g) => g.status !== NOT_NEEDED);
}

function ownBracket(g: Pick<ExportGame, "playoff_id">, all: ExportGame[]): ExportGame[] {
  return all.filter((x) => x.playoff_id === g.playoff_id);
}

function bracketHasSeries(own: ExportGame[]): boolean {
  return [...new Set(own.map((x) => x.round))].some((r) => isSeriesRound(r, own));
}

/** The round-and-game part of a title. A bracket with a series names every
 *  game ("Round 1 · Game 1", "Semifinal 1 · Game 2 of 3 (if needed)");
 *  otherwise it is exportRound, unchanged. `all` must still hold the
 *  not-needed games — they decide the series' length and its tags. */
export function exportGameName(g: ExportGame, all: ExportGame[], pair: ExportPair): string {
  const own = ownBracket(g, all);
  if ((pair && g.playoff_id === pair.stage1Id) || !bracketHasSeries(own)) return exportRound(g, pair, own);
  const prefix = pair && g.playoff_id === pair.stage2Id ? "Bracket · " : "";
  if (!isSeriesGame(g, own)) return `${prefix}${roundTitle(g.round, own)} · ${gameLabel(g, own)}`;
  const ifNeeded = seriesGameTag(g, seriesGamesOf(g, own)) === "if_needed" ? " (if needed)" : "";
  return `${prefix}${gameLabel(g, own)}${ifNeeded}`;
}

/** The matchup part: "Mets vs Expos", or "Bears and Winner of Semifinal 1"
 *  for a series game whose teams aren't both known (no home team named). */
export function exportMatchup(g: ExportGame, all: ExportGame[], pair: ExportPair, format: string): string {
  const own = ownBracket(g, all);
  return outboundMatchup(exportSlot(g, "home", all, pair, format), exportSlot(g, "away", all, pair, format), {
    seriesGame: isSeriesGame(g, own),
    homeIsTeam: !!g.home_team_id,
    awayIsTeam: !!g.away_team_id,
  });
}

/** The format a game's own bracket uses (for its empty-slot labels). */
export function exportFormat(g: Pick<ExportGame, "playoff_id">, pair: ExportPair, format: string): string {
  if (pair && g.playoff_id === pair.stage1Id) return "round_robin";
  if (pair && g.playoff_id === pair.stage2Id) return "single_elimination";
  return format;
}

/** A slot's text, from the game's own bracket. */
export function exportSlot(g: ExportGame, side: Side, all: ExportGame[], pair: ExportPair, format: string): string {
  const own = all.filter((x) => x.playoff_id === g.playoff_id);
  return slotName(side === "home" ? g.home_team_name : g.away_team_name, g, side, own, exportFormat(g, pair, format));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** "2026-11-14" → "11/14/2026". */
export function csvDate(d: string): string {
  const [y, mo, day] = d.split("-");
  return `${mo}/${day}/${y}`;
}

/** "09:00" → "09:00 AM". */
export function csvTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${pad2(h % 12 || 12)}:${pad2(m)} ${h >= 12 ? "PM" : "AM"}`;
}

/** "09:00" + 120 → "11:00 AM" (wraps past midnight). */
export function csvTimePlus(t: string, mins: number): string {
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  return `${pad2(nh % 12 || 12)}:${pad2(total % 60)} ${nh >= 12 ? "PM" : "AM"}`;
}

function csvEscape(val: string): string {
  return `"${val.replace(/"/g, '""')}"`;
}

/** The Sports Connect CSV: every DATED game, by date then time. The columns
 *  are unchanged; End and the empty-slot text are what changed. */
export function buildPlayoffCsv(
  games: ExportGame[],
  opts: { divisionName: string; durationMin: number | null; pair: ExportPair; format: string },
): string {
  const header = ["Start_Date", "Start_Time", "End_Date", "End_Time", "Title", "Location", "Event_Type"]
    .map(csvEscape)
    .join(",");
  const rows = exportableGames(games)
    .filter((g) => g.scheduled_date)
    .sort(
      (a, b) =>
        a.scheduled_date!.localeCompare(b.scheduled_date!) ||
        (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
        a.game_number - b.game_number,
    )
    .map((g) => {
      const date = csvDate(g.scheduled_date!);
      const start = g.start_time ? csvTime(g.start_time) : "";
      const end = g.start_time && opts.durationMin !== null ? csvTimePlus(g.start_time, opts.durationMin) : "";
      const title =
        `${opts.divisionName} Playoffs - ${exportGameName(g, games, opts.pair)}: ` +
        exportMatchup(g, games, opts.pair, opts.format);
      return [date, start, date, end, title, g.venue_name ?? "", "Game"].map(csvEscape).join(",");
    });
  return [header, ...rows].join("\r\n");
}

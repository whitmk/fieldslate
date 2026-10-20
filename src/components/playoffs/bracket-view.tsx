"use client";

import { useState, useEffect, useCallback } from "react";
import { CalendarDays, List, Trophy, Clock, ClipboardEdit, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EnterResultModal } from "@/components/playoffs/enter-result-modal";
import { EditPlayoffGameModal } from "@/components/playoffs/edit-playoff-game-modal";
import { playoffRoundLabel, resultButtonShown } from "@/lib/playoffs/playoff-result";
import { gameLabel, gameNumbering, slotName, slotWon, type Side } from "@/lib/playoffs/bracket-labels";
import {
  SCREEN_GROUP,
  SCREEN_TREE,
  groupCardTexts,
  groupHeight,
  groupedTreeLayout,
  singleElimLayout,
  type PlacedItem,
} from "@/lib/playoffs/bracket-print";
import { SeriesGroup, TONE_CHIP } from "@/components/playoffs/series-card";
import {
  NOT_NEEDED,
  SERIES_TAG_TEXT,
  gameHasResult,
  seriesGameActions,
  seriesGameTag,
  seriesChampionLine,
  seriesGamesOf,
  seriesGroupTitle,
  seriesHeadline,
} from "@/lib/playoffs/series";
import { isSeriesGame, isSeriesRound, roundTitle, seriesLengthOf } from "@/lib/playoffs/series-names";
import { useDaylight } from "@/components/daylight/use-daylight";
import { DaylightChip, DaylightStatusLine } from "@/components/daylight/daylight-pieces";
import type { DaylightFlag } from "@/lib/daylight/flags";

/** A game's daylight flag (admin-only; the print never reads this). */
type FlagOf = (game: GameWithTeams) => DaylightFlag | null;

/** A slot's text: the team, else "Winner of Game N" / "TBD" (bracket-labels). */
type LabelOf = (game: GameWithTeams, side: Side) => string;
/** The game's SHOWN number (bracket-labels `gameNumbering`), never game_number. */
type NumberOf = (game: GameWithTeams) => number;
import type { PlayoffGame } from "@/types/database";

export interface GameWithTeams extends PlayoffGame {
  home_team_name: string | null;
  away_team_name: string | null;
  venue_name: string | null;
  /** The field's lights (0109); null when the game has no field. */
  venue_has_lights: boolean | null;
  winner_name: string | null;
  home_score: number | null;
  away_score: number | null;
}

interface Props {
  playoffId: string;
  leagueId: string;
  divisionId: string;
  divisionName: string;
  format: string;
  /** The playoff's playing days — the edit modal's "doesn't play on …" notice. */
  playingDays: string[];
  /** Two-stage Stage 2: show each seeded team's seed number beside its name. */
  showSeeds?: boolean;
  /** Called after a result or a game's time is saved, so a parent (the
   *  two-stage card) can reload what depends on it. */
  onChanged?: () => void;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtDate(d: string | null) {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}/${y}`;
}
function fmtTime(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${pad2(m)} ${period}`;
}

// ─── Round ordering / labelling ───────────────────────────────────────────────

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

// Round names come from the shared, pure label (the result confirm uses it too).
const roundLabel = playoffRoundLabel;

const CHAMPIONSHIP_ROUNDS = new Set(["F", "GF"]);

// ─── Game card ────────────────────────────────────────────────────────────────

// The card's geometry is SCREEN_TREE (bracket-print.ts): the tree layout
// places cards and lines with those numbers, so the bands below have fixed
// heights that match them — h-10 when/where, h-8 rows, h-8 actions.
const CARD_W = SCREEN_TREE.cardW;

function GameCard({
  game,
  isChampionship,
  labelOf,
  numberOf,
  flagOf,
  onEnterResult,
  onEdit,
}: {
  game: GameWithTeams;
  isChampionship: boolean;
  labelOf: LabelOf;
  numberOf: NumberOf;
  flagOf: FlagOf;
  onEnterResult: () => void;
  onEdit: () => void;
}) {
  const homeWon = slotWon(game.winner_id, game.home_team_id);
  const awayWon = slotWon(game.winner_id, game.away_team_id);
  const bothTeams = !!game.home_team_id && !!game.away_team_id;
  const isDone = game.status === "completed";
  const daylight = flagOf(game);

  return (
    <div style={{ width: CARD_W }}>
      <div
        className="flex flex-col overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm"
        style={{ height: SCREEN_TREE.cardH }}
      >
        {/* When and where — shown for every game, so an unplaced (TBD) game
            reads "No date yet" instead of hiding the gap. */}
        <div className="h-10 flex-none border-b border-gray-100 px-2.5 py-1 text-[10px] leading-4">
          {game.scheduled_date ? (
            <p className="truncate text-gray-500">
              Game {numberOf(game)} · {fmtDate(game.scheduled_date)}
              {game.start_time ? ` · ${fmtTime(game.start_time)}` : ""}
            </p>
          ) : (
            <p className="truncate italic text-amber-600">Game {numberOf(game)} · No date yet</p>
          )}
          <p className="truncate text-gray-500">{game.venue_name ?? ""}</p>
        </div>

        <TeamRow
          name={labelOf(game, "home")}
          away={false}
          won={homeWon}
          tbd={!game.home_team_id}
          score={game.home_score}
          isDone={isDone}
        />
        <div className="h-px flex-none bg-gray-100" />
        <TeamRow
          name={labelOf(game, "away")}
          away
          won={awayWon}
          tbd={!game.away_team_id}
          score={game.away_score}
          isDone={isDone}
        />

        <div className="flex h-8 flex-none items-center border-t border-gray-100 px-2">
          {resultButtonShown(bothTeams, isDone) && (
            <button
              onClick={onEnterResult}
              className="flex flex-1 items-center justify-center gap-1 rounded-md py-0.5 text-[10px] font-medium text-[#0C1F3F] hover:bg-gray-50"
            >
              <ClipboardEdit className="h-3 w-3" />
              {isDone ? "Edit result" : "Enter result"}
            </button>
          )}
          {!isDone && (
            <button
              onClick={onEdit}
              aria-label="Set date, time and field"
              title="Set date, time and field"
              className="flex flex-1 items-center justify-center gap-1 rounded-md py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-50 hover:text-[#0C1F3F]"
            >
              <CalendarClock className="h-3 w-3" />
              {game.scheduled_date ? "Move" : "Set time"}
            </button>
          )}
        </div>
      </div>

      {/* Daylight chip (admin-only) — BELOW the card like the champion banner,
          so it never moves the rows and never hides the field name (the card
          is 200px wide). A flagged game is never completed, so the two never
          stack. */}
      {daylight && (
        <div className="mt-1 flex justify-center">
          <DaylightChip flag={daylight} variant="bracket" />
        </div>
      )}

      {/* Champion banner — BELOW the card, so it never moves the rows the
          tree's lines point at. */}
      {isChampionship && isDone && (
        <div className="mt-1 flex items-center justify-center gap-1 rounded-md bg-amber-50 px-2 py-1">
          <Trophy className="h-3 w-3 text-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">
            Champion: {homeWon ? game.home_team_name : game.away_team_name}
          </span>
        </div>
      )}
    </div>
  );
}

// Two-tone card, matching the print (bracket-print.ts PRINT_COLORS.awayRowBg):
// the away (second) row is a light field green, the home row white. Row colour
// NEVER marks a winner — the winner is bold text + the trophy.
const AWAY_ROW_BG = "bg-[#e6f4ea]";

// Exported for the series group's stacked game cards (series-card.tsx), which
// are this card's rows; `struck` is a not-needed series game.
export function TeamRow({
  name,
  won,
  tbd,
  score,
  isDone,
  away,
  struck = false,
}: {
  name: string;
  won: boolean;
  tbd: boolean;
  score: number | null;
  isDone: boolean;
  away: boolean;
  struck?: boolean;
}) {
  return (
    <div className={`flex h-8 flex-none items-center gap-2 px-2.5 ${away ? AWAY_ROW_BG : "bg-white"}`}>
      <span
        className={`flex-1 truncate text-xs ${
          tbd ? "italic text-gray-600" : won ? "font-bold text-[#0C1F3F]" : "text-gray-800"
        }${struck ? " line-through" : ""}`}
      >
        {name}
      </span>
      {isDone && score != null && (
        <span className={`text-xs tabular-nums ${won ? "font-bold text-[#0C1F3F]" : "font-semibold text-gray-600"}`}>
          {score}
        </span>
      )}
      {won && <Trophy className="h-3 w-3 flex-shrink-0 text-[#0C1F3F]" />}
    </div>
  );
}

// ─── List view row ────────────────────────────────────────────────────────────

/** A game of a series in the list (0114): its name, its chip and what it
 *  offers — all from series.ts. Null for a single game. */
type ListSeries = {
  label: string;
  chip: { text: string; className: string } | null;
  notNeeded: boolean;
  actions: { result: boolean; edit: boolean; move: boolean };
} | null;

function ListGameRow({
  game,
  isChampionship,
  labelOf,
  numberOf,
  flagOf,
  series,
  onEnterResult,
  onEdit,
}: {
  game: GameWithTeams;
  isChampionship: boolean;
  labelOf: LabelOf;
  numberOf: NumberOf;
  flagOf: FlagOf;
  series: ListSeries;
  onEnterResult: () => void;
  onEdit: () => void;
}) {
  const bothTeams = !!game.home_team_id && !!game.away_team_id;
  const isDone = game.status === "completed";
  const notNeeded = series?.notNeeded ?? false;
  const showMove = series ? series.actions.move : !isDone;
  const showResult = series ? series.actions.result || series.actions.edit : resultButtonShown(bothTeams, isDone);
  const homeWon = slotWon(game.winner_id, game.home_team_id);
  const awayWon = slotWon(game.winner_id, game.away_team_id);
  const daylight = flagOf(game);

  return (
    <div className={`flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0 ${notNeeded ? "opacity-70" : ""}`}>
      <span className="w-5 text-center text-xs font-semibold text-gray-300">{series ? "" : numberOf(game)}</span>

      <div className="min-w-0 flex-1">
        {isDone ? (
          <p className="text-sm font-medium text-gray-900">
            <span className={homeWon ? "font-semibold text-[#0C1F3F]" : "text-gray-500"}>
              {game.home_team_name ?? "TBD"}
            </span>
            {game.home_score != null && (
              <span className={`ml-1 tabular-nums ${homeWon ? "font-semibold text-[#0C1F3F]" : "text-gray-400"}`}>
                {game.home_score}
              </span>
            )}
            <span className="mx-1.5 text-gray-300">–</span>
            {game.away_score != null && (
              <span className={`mr-1 tabular-nums ${awayWon ? "font-semibold text-[#0C1F3F]" : "text-gray-400"}`}>
                {game.away_score}
              </span>
            )}
            <span className={awayWon ? "font-semibold text-[#0C1F3F]" : "text-gray-500"}>
              {game.away_team_name ?? "TBD"}
            </span>
          </p>
        ) : (
          <p className={`text-sm font-medium ${notNeeded ? "text-gray-400 line-through" : !bothTeams ? "italic text-gray-400" : "text-gray-900"}`}>
            {`${labelOf(game, "home")} vs ${labelOf(game, "away")}`}
          </p>
        )}
        <p className={`text-xs text-gray-400 ${notNeeded ? "line-through" : ""}`}>{series ? series.label : roundLabel(game.round)}</p>
        {series?.chip && (
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${series.chip.className}`}>
            {series.chip.text}
          </span>
        )}
        {daylight && (
          <div className="mt-1">
            <DaylightChip flag={daylight} variant="bracket" />
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-0.5">
        {game.scheduled_date ? (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <CalendarDays className="h-3 w-3" />
            {fmtDate(game.scheduled_date)}
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-600">No date yet</span>
        )}
        {game.start_time && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Clock className="h-3 w-3" />
            {fmtTime(game.start_time)}
          </span>
        )}
      </div>

      {game.venue_name && (
        <span className="hidden max-w-[120px] truncate text-xs text-gray-400 sm:block">
          {game.venue_name}
        </span>
      )}

      {!series && isChampionship && isDone && (
        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
          <Trophy className="h-3 w-3" />
          Champion
        </span>
      )}

      {!series && !isChampionship && isDone && (
        <span className="rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-xs font-medium text-[#22C55E]">
          Final
        </span>
      )}

      {showMove && (
        <button
          onClick={onEdit}
          aria-label="Set date, time and field"
          title="Set date, time and field"
          className="flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <CalendarClock className="h-3.5 w-3.5" />
        </button>
      )}

      {showResult && (
        <button
          onClick={onEnterResult}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <ClipboardEdit className="h-3 w-3" />
          {isDone ? "Edit" : "Result"}
        </button>
      )}
    </div>
  );
}

// ─── Bracket tree (single / double elimination) ───────────────────────────────

function BracketTree({
  games,
  championshipRound,
  labelOf,
  numberOf,
  flagOf,
  teamName,
  onEnterResult,
  onEdit,
}: {
  games: GameWithTeams[];
  championshipRound: string | null;
  labelOf: LabelOf;
  numberOf: NumberOf;
  flagOf: FlagOf;
  teamName: (id: string) => string;
  onEnterResult: (game: GameWithTeams) => void;
  onEdit: (game: GameWithTeams) => void;
}) {
  if (games.length === 0) return null;

  // The print's layout with the screen's dimensions: cards by bracket
  // position (round 1 beside the slot it feeds, byes leave gaps), one line per
  // advancing game into the exact row it fills (singleElimTarget). With a
  // series round (0114) each series is a GROUP of stacked game cards
  // (series-card.tsx), its height estimated by groupHeight(SCREEN_GROUP) and
  // placed by its middle, where its lines leave and enter (groupedTreeLayout).
  const withSeries = games.some((g) => (g.series_game ?? 1) >= 2);
  const L = withSeries
    ? groupedTreeLayout(games, SCREEN_TREE, (first, series) =>
        groupHeight(
          SCREEN_GROUP,
          seriesGroupTitle(first, games),
          seriesHeadline(series, teamName).text,
          groupCardTexts(series).map((t, i) => ({ ...t, flagged: !!flagOf(series[i]) })),
          first.round === championshipRound && seriesChampionLine(series, teamName) !== null,
        ))
    : singleElimLayout(games, SCREEN_TREE);
  const header = (round: string) => {
    if (!withSeries) return roundLabel(round);
    const title = roundTitle(round, games);
    const row = games.find((g) => g.round === round);
    return row && isSeriesRound(round, games) ? `${title} · best of ${seriesLengthOf(row, games)}` : title;
  };
  return (
    <div style={{ position: "relative", height: L.height, width: L.width, minWidth: L.width }}>
      <svg
        width={L.width}
        height={L.height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {L.connectors.map((c) => (
          <polyline
            key={`c-${c.from}`}
            points={c.points.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke="#9ca3af"
            strokeWidth={1.5}
          />
        ))}
      </svg>

      {/* Round headers */}
      {L.rounds.map((round, rIdx) => (
        <div
          key={`hdr-${round}`}
          style={{ position: "absolute", top: 0, left: rIdx * (SCREEN_TREE.cardW + SCREEN_TREE.gap), width: SCREEN_TREE.cardW, textAlign: "center" }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {header(round)}
          </span>
        </div>
      ))}

      {/* Game cards */}
      {L.cards.map((c) => withSeries && isSeriesGame(c.game, games) ? (
        <div
          key={c.game.id}
          style={{ position: "absolute", left: c.x, top: (c as PlacedItem<GameWithTeams>).centre, transform: "translateY(-50%)" }}
        >
          <SeriesGroup
            games={seriesGamesOf(c.game, games)}
            bracket={games}
            width={SCREEN_TREE.cardW}
            isFinal={c.game.round === championshipRound}
            labelOf={labelOf}
            teamName={teamName}
            flagOf={flagOf}
            onResult={onEnterResult}
            onEditResult={onEnterResult}
            onMove={onEdit}
          />
        </div>
      ) : (
        <div key={c.game.id} style={{ position: "absolute", left: c.x, top: c.y }}>
          <GameCard
            game={c.game}
            isChampionship={c.game.round === championshipRound}
            labelOf={labelOf}
            numberOf={numberOf}
            flagOf={flagOf}
            onEnterResult={() => onEnterResult(c.game)}
            onEdit={() => onEdit(c.game)}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Column view (round robin / double elimination) ───────────────────────────

function ColumnView({
  rounds,
  championshipRound,
  labelOf,
  numberOf,
  flagOf,
  onEnterResult,
  onEdit,
}: {
  rounds: [string, GameWithTeams[]][];
  championshipRound: string | null;
  labelOf: LabelOf;
  numberOf: NumberOf;
  flagOf: FlagOf;
  onEnterResult: (game: GameWithTeams) => void;
  onEdit: (game: GameWithTeams) => void;
}) {
  return (
    <div className="flex items-start gap-8">
      {rounds.map(([round, roundGames]) => (
        <div key={round} className="flex flex-col gap-4">
          <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {roundLabel(round)}
          </p>
          <div className="flex flex-col gap-6">
            {roundGames.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                isChampionship={g.round === championshipRound}
                labelOf={labelOf}
                numberOf={numberOf}
                flagOf={flagOf}
                onEnterResult={() => onEnterResult(g)}
                onEdit={() => onEdit(g)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BracketView({ playoffId, leagueId, divisionId, divisionName, format, playingDays, showSeeds, onChanged }: Props) {
  const [games, setGames] = useState<GameWithTeams[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"bracket" | "list">("list");
  const [activeGame, setActiveGame] = useState<GameWithTeams | null>(null);
  const [editingGame, setEditingGame] = useState<GameWithTeams | null>(null);
  // The bracket division's RAW game_duration (projected key, never the whole
  // settings blob) — the daylight flag resolves it with the one rule.
  const [rawDuration, setRawDuration] = useState<unknown>(undefined);
  const daylight = useDaylight({ leagueId });

  const loadGames = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("playoff_games")
      .select(
        `*, home:teams!playoff_games_home_team_id_fkey(name),
         away:teams!playoff_games_away_team_id_fkey(name),
         venue:venues(name, has_lights),
         winner:teams!playoff_games_winner_id_fkey(name)`,
      )
      .eq("playoff_id", playoffId)
      .order("game_number");

    const rows = (data ?? []).map((g: Record<string, unknown>) => ({
      ...(g as PlayoffGame),
      home_team_name: (g.home as { name?: string } | null)?.name ?? null,
      away_team_name: (g.away as { name?: string } | null)?.name ?? null,
      venue_name: (g.venue as { name?: string } | null)?.name ?? null,
      venue_has_lights: (g.venue as { has_lights?: boolean } | null)?.has_lights ?? null,
      winner_name: (g.winner as { name?: string } | null)?.name ?? null,
      home_score: (g.home_score as number | null) ?? null,
      away_score: (g.away_score as number | null) ?? null,
    }));
    setGames(rows);
    const { data: div } = await supabase
      .from("divisions")
      .select("game_duration:settings->game_duration")
      .eq("id", divisionId)
      .maybeSingle();
    setRawDuration((div as { game_duration?: unknown } | null)?.game_duration);
    setLoading(false);
  }, [playoffId, divisionId]);

  useEffect(() => { void loadGames(); }, [loadGames]);

  const flagOf: FlagOf = (g) =>
    g.scheduled_date && g.start_time
      ? daylight.flag({
          date: g.scheduled_date,
          startTime: g.start_time,
          rawDuration,
          venue: g.venue_id ? { has_lights: g.venue_has_lights === true } : null,
          isAway: false,
          status: g.status,
        })
      : null;

  const numbering = gameNumbering(games);
  const numberOf: NumberOf = (g) => numbering(g.game_number);

  const names = new Map<string, string>();
  for (const g of games) {
    if (g.home_team_id && g.home_team_name) names.set(g.home_team_id, g.home_team_name);
    if (g.away_team_id && g.away_team_name) names.set(g.away_team_id, g.away_team_name);
  }
  const teamName = (id: string) => names.get(id) ?? "TBD";

  /** A series game's list info (0114): its name, its chip — the series'
   *  standing on its latest result, else Next / If needed / Not needed — and
   *  what it offers. Null for a single game. */
  const seriesInfo = (g: GameWithTeams): ListSeries => {
    if (!isSeriesGame(g, games)) return null;
    const sgames = seriesGamesOf(g, games);
    const tag = seriesGameTag(g, sgames);
    const latest = [...sgames].reverse().find(gameHasResult);
    let chip: { text: string; className: string } | null = null;
    if (latest && latest.id === g.id) {
      const h = seriesHeadline(sgames, teamName);
      chip = { text: h.text, className: TONE_CHIP[h.tone] };
    } else if (tag === "next" || tag === "if_needed" || tag === "not_needed") {
      chip = { text: SERIES_TAG_TEXT[tag], className: tag === "if_needed" ? TONE_CHIP.amber : TONE_CHIP.gray };
    }
    return {
      label: gameLabel(g, games),
      chip,
      notNeeded: g.status === NOT_NEEDED || tag === "not_needed",
      actions: seriesGameActions(g, sgames),
    };
  };

  const labelOf: LabelOf = (g, side) => {
    // Two-stage Stage 2: a seeded team reads "4 · Mets".
    const seed = side === "home" ? g.seed_home : g.seed_away;
    const team = side === "home" ? g.home_team_name : g.away_team_name;
    if (showSeeds && team && seed != null) return `${seed} · ${team}`;
    return slotName(side === "home" ? g.home_team_name : g.away_team_name, g, side, games, format);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <svg className="h-5 w-5 animate-spin text-gray-300" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!games.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Trophy className="mb-2 h-6 w-6 text-gray-200" />
        <p className="text-sm text-gray-400">No games generated yet.</p>
      </div>
    );
  }

  // Group and sort by round
  const roundMap = new Map<string, GameWithTeams[]>();
  for (const g of games) {
    if (!roundMap.has(g.round)) roundMap.set(g.round, []);
    roundMap.get(g.round)!.push(g);
  }
  const rounds = [...roundMap.entries()].sort(([a], [b]) => getRoundOrder(a) - getRoundOrder(b));

  // The last round is the championship for SE/DE formats
  const lastRound = rounds[rounds.length - 1]?.[0] ?? null;
  const championshipRound = CHAMPIONSHIP_ROUNDS.has(lastRound ?? "") ? lastRound : null;

  const useBracketTree = format === "single_elimination";
  const unplaced = games.filter((g) => !g.scheduled_date && g.status !== NOT_NEEDED).length;

  return (
    <div className="flex flex-col gap-3">
      {unplaced > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            {unplaced} game{unplaced === 1 ? " has" : "s have"} no date, time or field yet. Use the
            calendar button on a game to set one.
          </p>
        </div>
      )}
      {daylight.state && <DaylightStatusLine state={daylight.state} />}
      {/* Header + view toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[#0C1F3F]">{divisionName}</p>
        <div className="flex rounded-lg border border-gray-200 p-0.5">
          <button
            onClick={() => setView("bracket")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === "bracket" ? "bg-[#0C1F3F] text-white" : "text-gray-500 hover:text-gray-700"}`}
          >
            <Trophy className="h-3 w-3" />
            Bracket
          </button>
          <button
            onClick={() => setView("list")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === "list" ? "bg-[#0C1F3F] text-white" : "text-gray-500 hover:text-gray-700"}`}
          >
            <List className="h-3 w-3" />
            List
          </button>
        </div>
      </div>

      {view === "list" ? (
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          {games.map((g) => (
            <ListGameRow
              key={g.id}
              game={g}
              isChampionship={g.round === championshipRound}
              labelOf={labelOf}
              numberOf={numberOf}
              flagOf={flagOf}
              series={seriesInfo(g)}
              onEnterResult={() => setActiveGame(g)}
              onEdit={() => setEditingGame(g)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-gray-50 p-6">
          {useBracketTree ? (
            <BracketTree
              games={games}
              championshipRound={championshipRound}
              labelOf={labelOf}
              numberOf={numberOf}
              flagOf={flagOf}
              teamName={teamName}
              onEnterResult={setActiveGame}
              onEdit={setEditingGame}
            />
          ) : (
            <ColumnView
              rounds={rounds}
              championshipRound={championshipRound}
              labelOf={labelOf}
              numberOf={numberOf}
              flagOf={flagOf}
              onEnterResult={setActiveGame}
              onEdit={setEditingGame}
            />
          )}
        </div>
      )}

      {editingGame && (
        <EditPlayoffGameModal
          game={editingGame}
          roundLabel={isSeriesGame(editingGame, games) ? gameLabel(editingGame, games) : roundLabel(editingGame.round)}
          leagueId={leagueId}
          divisionId={divisionId}
          divisionName={divisionName}
          playingDays={playingDays}
          onClose={() => setEditingGame(null)}
          onSaved={async () => {
            setEditingGame(null);
            setLoading(true);
            await loadGames();
            onChanged?.();
          }}
        />
      )}

      {activeGame && (
        <EnterResultModal
          game={activeGame}
          allGames={games}
          format={format}
          onClose={() => setActiveGame(null)}
          onSaved={async () => {
            setActiveGame(null);
            setLoading(true);
            await loadGames();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

// The playoff bracket's PRESENTATION pieces — the game card, its team rows,
// the list row, the single-elimination tree and the column view (round robin,
// double elimination). Split out of bracket-view.tsx (2026-10-20) so the
// public bracket page (/s/<token>/bracket/<division>) renders the SAME pieces
// with no admin code behind them.
//
// THE RULE FOR THIS FILE: no data access, no modals, no daylight, no admin
// state. Never import @/lib/supabase, a *-modal component or anything under
// daylight here. What only the admin screen has comes in through optional
// props: the buttons as callbacks (absent = no buttons, and a card has no
// action row), and the daylight chip as `chipOf` (a node rendered under a
// card / inside a list row). Every rule and sentence comes from the pure libs
// (bracket-labels, series, series-names, playoff-result, bracket-print).
//
// BracketView (bracket-view.tsx) is the admin wrapper: it loads the games,
// reads daylight, owns the modals, and passes all of it in.

import type { ReactNode } from "react";
import { CalendarDays, Trophy, Clock, ClipboardEdit, CalendarClock } from "lucide-react";
import { playoffRoundLabel, playoffRoundTitle, resultButtonShown } from "@/lib/playoffs/playoff-result";
import { slotWon, type Side } from "@/lib/playoffs/bracket-labels";
import {
  SCREEN_GROUP,
  SCREEN_TREE,
  groupCardTexts,
  groupHeight,
  groupedTreeLayout,
  singleElimLayout,
  type PlacedItem,
} from "@/lib/playoffs/bracket-print";
import { SeriesGroup } from "@/components/playoffs/series-card";
import { seriesChampionLine, seriesGamesOf, seriesGroupTitle, seriesHeadline } from "@/lib/playoffs/series";
import { isSeriesGame, isSeriesRound, roundTitle, seriesLengthOf } from "@/lib/playoffs/series-names";
import type { PlayoffGame } from "@/types/database";

/** A playoff game as the pieces read it: the stored row plus names. */
export interface BracketGame extends PlayoffGame {
  home_team_name: string | null;
  away_team_name: string | null;
  venue_name: string | null;
  winner_name: string | null;
  home_score: number | null;
  away_score: number | null;
}

/** A slot's text: the team, else "Winner of Game N" / "TBD" (bracket-labels). */
export type LabelOf<G extends BracketGame> = (game: G, side: Side) => string;
/** The game's SHOWN number (bracket-labels `gameNumbering`), never game_number. */
export type NumberOf<G extends BracketGame> = (game: G) => number;
/** An admin-only chip for a game (the daylight flag), or null. */
export type ChipOf<G extends BracketGame> = (game: G) => ReactNode;

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

// Round names come from the shared, pure label (the result confirm uses it too).
const roundLabel = playoffRoundLabel;

// ─── Game card ────────────────────────────────────────────────────────────────

// The card's geometry is SCREEN_TREE (bracket-print.ts): the tree layout
// places cards and lines with those numbers, so the bands below have fixed
// heights that match them — h-10 when/where, h-8 rows, h-8 actions.
const CARD_W = SCREEN_TREE.cardW;

function GameCard<G extends BracketGame>({
  game,
  isChampionship,
  labelOf,
  numberOf,
  chipOf,
  onEnterResult,
  onEdit,
}: {
  game: G;
  isChampionship: boolean;
  labelOf: LabelOf<G>;
  numberOf: NumberOf<G>;
  chipOf?: ChipOf<G>;
  /** Both or neither: without them the card has no action row. */
  onEnterResult?: () => void;
  onEdit?: () => void;
}) {
  const homeWon = slotWon(game.winner_id, game.home_team_id);
  const awayWon = slotWon(game.winner_id, game.away_team_id);
  const bothTeams = !!game.home_team_id && !!game.away_team_id;
  const isDone = game.status === "completed";
  const chip = chipOf?.(game);

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

        {onEnterResult && onEdit && (
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
        )}
      </div>

      {/* The admin's chip (the daylight flag) — BELOW the card like the
          champion banner, so it never moves the rows and never hides the
          field name (the card is 200px wide). A flagged game is never
          completed, so the two never stack. */}
      {chip && (
        <div className="mt-1 flex justify-center">
          {chip}
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
export type ListSeries = {
  label: string;
  chip: { text: string; className: string } | null;
  notNeeded: boolean;
  actions: { result: boolean; edit: boolean; move: boolean };
} | null;

export function ListGameRow<G extends BracketGame>({
  game,
  isChampionship,
  labelOf,
  numberOf,
  chipOf,
  series,
  roundName,
  onEnterResult,
  onEdit,
}: {
  game: G;
  isChampionship: boolean;
  labelOf: LabelOf<G>;
  numberOf: NumberOf<G>;
  chipOf?: ChipOf<G>;
  series: ListSeries;
  /** The round's name in this bracket (playoffRoundTitle). */
  roundName: string;
  /** Without them the row offers no buttons. */
  onEnterResult?: () => void;
  onEdit?: () => void;
}) {
  const bothTeams = !!game.home_team_id && !!game.away_team_id;
  const isDone = game.status === "completed";
  const notNeeded = series?.notNeeded ?? false;
  const showMove = series ? series.actions.move : !isDone;
  const showResult = series ? series.actions.result || series.actions.edit : resultButtonShown(bothTeams, isDone);
  const homeWon = slotWon(game.winner_id, game.home_team_id);
  const awayWon = slotWon(game.winner_id, game.away_team_id);
  const chip = chipOf?.(game);

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
        <p className={`text-xs text-gray-400 ${notNeeded ? "line-through" : ""}`}>{series ? series.label : roundName}</p>
        {series?.chip && (
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${series.chip.className}`}>
            {series.chip.text}
          </span>
        )}
        {chip && (
          <div className="mt-1">
            {chip}
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

      {onEdit && showMove && (
        <button
          onClick={onEdit}
          aria-label="Set date, time and field"
          title="Set date, time and field"
          className="flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <CalendarClock className="h-3.5 w-3.5" />
        </button>
      )}

      {onEnterResult && showResult && (
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

export function BracketTree<G extends BracketGame>({
  games,
  championshipRound,
  labelOf,
  numberOf,
  chipOf,
  teamName,
  onEnterResult,
  onEdit,
}: {
  games: G[];
  championshipRound: string | null;
  labelOf: LabelOf<G>;
  numberOf: NumberOf<G>;
  chipOf?: ChipOf<G>;
  teamName: (id: string) => string;
  /** Both or neither: without them no card or group offers a button. */
  onEnterResult?: (game: G) => void;
  onEdit?: (game: G) => void;
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
          groupCardTexts(series).map((t, i) => ({ ...t, flagged: !!chipOf?.(series[i]) })),
          first.round === championshipRound && seriesChampionLine(series, teamName) !== null,
        ))
    : singleElimLayout(games, SCREEN_TREE);
  const header = (round: string) => {
    if (!withSeries) return playoffRoundTitle(round, games);
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
          style={{ position: "absolute", left: c.x, top: (c as PlacedItem<G>).centre, transform: "translateY(-50%)" }}
        >
          <SeriesGroup
            games={seriesGamesOf(c.game, games)}
            bracket={games}
            width={SCREEN_TREE.cardW}
            isFinal={c.game.round === championshipRound}
            labelOf={labelOf}
            teamName={teamName}
            chipOf={chipOf}
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
            chipOf={chipOf}
            onEnterResult={onEnterResult && (() => onEnterResult(c.game))}
            onEdit={onEdit && (() => onEdit(c.game))}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Column view (round robin / double elimination) ───────────────────────────

export function ColumnView<G extends BracketGame>({
  rounds,
  championshipRound,
  labelOf,
  numberOf,
  chipOf,
  onEnterResult,
  onEdit,
}: {
  rounds: [string, G[]][];
  championshipRound: string | null;
  labelOf: LabelOf<G>;
  numberOf: NumberOf<G>;
  chipOf?: ChipOf<G>;
  /** Both or neither: without them no card offers a button. */
  onEnterResult?: (game: G) => void;
  onEdit?: (game: G) => void;
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
                chipOf={chipOf}
                onEnterResult={onEnterResult && (() => onEnterResult(g))}
                onEdit={onEdit && (() => onEdit(g))}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

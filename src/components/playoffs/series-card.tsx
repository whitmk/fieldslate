"use client";

// One GROUP per series on the Playoffs page's tree (approved sketch,
// 2026-10-20 — replaces the one-card-per-series layout): a light dashed
// outline with a header line ("Semifinal 1 · best of 3" left, where the series
// stands right) holding one full game card per game, stacked — the single
// game's card (bracket-view.tsx GameCard / TeamRow) with "Game 2 of 3 · date ·
// time" over the field, both team rows with the score, trophy + bold on the
// winner, the green second row, and the game's own buttons. If-needed games
// say so in their header; not-needed games are greyed and struck through, with
// no buttons. Headers WRAP, never truncate. Every rule and sentence is
// series.ts's; this file only lays them out.
//
// Geometry: the tree sizes slots from groupHeight(SCREEN_GROUP, …) (an
// estimate from the text) and places a group by its middle (bracket-view.tsx),
// so the numbers below must stay in step with SCREEN_GROUP: p-1.5 (6px) inside
// a 1px dashed border; header line leading 18px, 6px under it; 8px between
// cards; a card's header band min h-10 with py-1 and 16px lines; rows h-8 +
// h-px + h-8; action row h-8; a daylight chip mt-1 below its card; the Final's
// banner mt-1.5.
//
// PRESENTATION ONLY (2026-10-20): the public bracket page renders this too.
// No data access, modals or daylight here — the buttons come in as optional
// callbacks (absent = no action row) and the admin's daylight chip as
// `chipOf`, exactly as in bracket-pieces.tsx.

import type { CSSProperties } from "react";
import { CalendarClock, ClipboardEdit, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { TeamRow, type BracketGame } from "@/components/playoffs/bracket-pieces";
import { slotWon, type Side } from "@/lib/playoffs/bracket-labels";
import { SCREEN_GROUP } from "@/lib/playoffs/bracket-print";
import {
  NOT_NEEDED,
  SERIES_TAG_TEXT,
  seriesChampionLine,
  seriesGameActions,
  seriesGameHeader,
  seriesGroupTitle,
  seriesHeadline,
  type HeadlineTone,
} from "@/lib/playoffs/series";

export const TONE_CHIP: Record<HeadlineTone, string> = {
  gray: "bg-gray-100 text-gray-600",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-[#22C55E]/10 text-[#15803d]",
};

export function SeriesGroup<G extends BracketGame>({
  games,
  bracket,
  width,
  isFinal,
  labelOf,
  teamName,
  chipOf,
  onResult,
  onEditResult,
  onMove,
}: {
  /** The games of this series, any order. */
  games: G[];
  bracket: G[];
  width: number;
  isFinal: boolean;
  labelOf: (game: G, side: Side) => string;
  teamName: (id: string) => string;
  /** The admin's chip under a card (the daylight flag), or null. */
  chipOf?: (game: G) => ReactNode;
  /** All three or none: without them no card has an action row. */
  onResult?: (game: G) => void;
  onEditResult?: (game: G) => void;
  onMove?: (game: G) => void;
}) {
  const sorted = [...games].sort((a, b) => (a.series_game ?? 1) - (b.series_game ?? 1));
  const first = sorted[0];
  const headline = seriesHeadline(sorted, teamName);
  const champion = isFinal ? seriesChampionLine(sorted, teamName) : null;

  return (
    <div
      data-series-group
      className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60"
      style={{ width, padding: SCREEN_GROUP.pad }}
    >
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-2"
        style={{ lineHeight: `${SCREEN_GROUP.headerLineH}px`, marginBottom: SCREEN_GROUP.headerGap }}
      >
        <span className="text-[11px] font-bold text-[#0C1F3F]">{seriesGroupTitle(first, bracket)}</span>
        <span className={`rounded-full px-1.5 text-[10px] font-semibold ${TONE_CHIP[headline.tone]}`}>{headline.text}</span>
      </div>

      {sorted.map((g, i) => (
        <SeriesGameCard
          key={g.id}
          game={g}
          series={sorted}
          style={i ? { marginTop: SCREEN_GROUP.cardGap } : undefined}
          labelOf={labelOf}
          chip={chipOf?.(g)}
          onResult={onResult}
          onEditResult={onEditResult}
          onMove={onMove}
        />
      ))}

      {champion && (
        <div className="mt-1.5 flex items-center justify-center gap-1 rounded-md bg-amber-50 px-2 py-1">
          <Trophy className="h-3 w-3 text-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">{champion}</span>
        </div>
      )}
    </div>
  );
}

function SeriesGameCard<G extends BracketGame>({
  game,
  series,
  style,
  labelOf,
  chip,
  onResult,
  onEditResult,
  onMove,
}: {
  game: G;
  series: G[];
  style?: CSSProperties;
  labelOf: (game: G, side: Side) => string;
  chip: ReactNode;
  onResult?: (game: G) => void;
  onEditResult?: (game: G) => void;
  onMove?: (game: G) => void;
}) {
  const h = seriesGameHeader(game, series);
  const acts = seriesGameActions(game, series);
  const isDone = game.status === "completed";
  const struck = h.notNeeded ? "line-through" : "";
  const field = game.scheduled_date && game.venue_name ? game.venue_name : "";

  return (
    <div style={style} data-series-game={game.series_game ?? 1} data-tag={h.tag}>
      <div className={`flex flex-col overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm ${h.notNeeded ? "opacity-50" : ""}`}>
        <div className="min-h-10 flex-none border-b border-gray-100 px-2.5 py-1 text-[10px] leading-4">
          <p className={`break-words text-gray-500 ${struck}`}>
            {h.when}
            {h.ifNeeded && (
              <>
                {" · "}
                <span className="whitespace-nowrap font-semibold text-amber-700">{SERIES_TAG_TEXT.if_needed}</span>
              </>
            )}
          </p>
          <p className={`break-words text-gray-500 ${struck}`}>{field}</p>
        </div>

        <TeamRow
          name={labelOf(game, "home")}
          away={false}
          won={slotWon(game.winner_id, game.home_team_id)}
          tbd={!game.home_team_id}
          score={game.home_score}
          isDone={isDone}
          struck={h.notNeeded}
        />
        <div className="h-px flex-none bg-gray-100" />
        <TeamRow
          name={labelOf(game, "away")}
          away
          won={slotWon(game.winner_id, game.away_team_id)}
          tbd={!game.away_team_id}
          score={game.away_score}
          isDone={isDone}
          struck={h.notNeeded}
        />

        {onResult && onEditResult && onMove && (
          <div className="flex h-8 flex-none items-center border-t border-gray-100 px-2">
            {acts.result && (
              <button
                onClick={() => onResult(game)}
                className="flex flex-1 items-center justify-center gap-1 rounded-md py-0.5 text-[10px] font-medium text-[#0C1F3F] hover:bg-gray-50"
              >
                <ClipboardEdit className="h-3 w-3" />
                Enter result
              </button>
            )}
            {acts.edit && (
              <button
                onClick={() => onEditResult(game)}
                className="flex flex-1 items-center justify-center gap-1 rounded-md py-0.5 text-[10px] font-medium text-[#0C1F3F] hover:bg-gray-50"
              >
                <ClipboardEdit className="h-3 w-3" />
                Edit result
              </button>
            )}
            {acts.move && (
              <button
                onClick={() => onMove(game)}
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

      {/* Below the card, like the single card's: never moves its rows. */}
      {chip && (
        <div className="mt-1 flex justify-center">
          {chip}
        </div>
      )}
    </div>
  );
}

/** True when a series game needs no buttons and reads struck through. */
export function isNotNeeded(g: { status?: string | null }): boolean {
  return g.status === NOT_NEEDED;
}

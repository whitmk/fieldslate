"use client";

// One card per SERIES on the Playoffs page (approved mockup
// docs/mockups/playoff-series.html, screen 3): the series name and where it
// stands, the two teams with their wins, every game with its date and what it
// says (a result, Next, If needed, Not needed), and Result / Edit / Move on
// the games that allow them. Every rule and sentence is series.ts's, rendered
// VERBATIM; this file only lays them out.
//
// Geometry: the top bands are the single card's (bracket-view.tsx GameCard) —
// 1px border, h-10 header, two h-8 team rows around an h-px divider — so the
// tree's lines leave and enter at the same offsets (screenSeriesTree). One h-6
// row per game below them, then the h-8 action row.

import { CalendarClock, ClipboardEdit, Trophy } from "lucide-react";
import type { GameWithTeams } from "@/components/playoffs/bracket-view";
import { DaylightChip } from "@/components/daylight/daylight-pieces";
import type { DaylightFlag } from "@/lib/daylight/flags";
import { slotWon, type Side } from "@/lib/playoffs/bracket-labels";
import { SERIES_GAME_ROW_H } from "@/lib/playoffs/bracket-print";
import {
  NOT_NEEDED,
  SERIES_TAG_TEXT,
  seriesCardActions,
  seriesChampionLine,
  seriesGameTag,
  seriesGameWhen,
  seriesHeadline,
  seriesHomeNote,
  seriesResultText,
  seriesState,
  type HeadlineTone,
} from "@/lib/playoffs/series";
import { seriesName } from "@/lib/playoffs/series-names";

const AWAY_ROW_BG = "bg-[#e6f4ea]";

export const TONE_CHIP: Record<HeadlineTone, string> = {
  gray: "bg-gray-100 text-gray-600",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-[#22C55E]/10 text-[#15803d]",
};

export function SeriesCard({
  games,
  bracket,
  width,
  height,
  isFinal,
  labelOf,
  teamName,
  flagOf,
  onResult,
  onEditResult,
  onMove,
}: {
  /** The games of this series, any order. */
  games: GameWithTeams[];
  bracket: GameWithTeams[];
  width: number;
  /** The tree's card height (screenSeriesTree) — every slot is that tall. */
  height: number;
  isFinal: boolean;
  labelOf: (game: GameWithTeams, side: Side) => string;
  teamName: (id: string) => string;
  flagOf: (game: GameWithTeams) => DaylightFlag | null;
  onResult: (game: GameWithTeams) => void;
  onEditResult: (game: GameWithTeams) => void;
  onMove: (game: GameWithTeams) => void;
}) {
  const sorted = [...games].sort((a, b) => (a.series_game ?? 1) - (b.series_game ?? 1));
  const first = sorted[0];
  const state = seriesState(sorted);
  const headline = seriesHeadline(sorted, teamName);
  const actions = seriesCardActions(sorted);
  const champion = isFinal ? seriesChampionLine(sorted, teamName) : null;
  const flagged = sorted.map(flagOf).find((f): f is DaylightFlag => f !== null) ?? null;

  const winsText = (id: string | null) => (id ? String(state.wins.get(id) ?? 0) : "");

  return (
    <div style={{ width }}>
      <div
        className="flex flex-col overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm"
        style={{ height }}
      >
        <div className="flex h-10 flex-none items-center gap-1.5 border-b border-gray-100 px-2.5">
          <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[#0C1F3F]">{seriesName(first, bracket)}</span>
          <span className={`flex-none truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE_CHIP[headline.tone]}`}>
            {headline.text}
          </span>
        </div>

        <SeriesTeamRow
          name={labelOf(first, "home")}
          tbd={!first.home_team_id}
          wins={winsText(first.home_team_id)}
          won={slotWon(state.winnerId, first.home_team_id)}
          started={state.played > 0}
          away={false}
        />
        <div className="h-px flex-none bg-gray-100" />
        <SeriesTeamRow
          name={labelOf(first, "away")}
          tbd={!first.away_team_id}
          wins={winsText(first.away_team_id)}
          won={slotWon(state.winnerId, first.away_team_id)}
          started={state.played > 0}
          away
        />

        {/* No border: the card's height is the single card's + one h-6 row
            per game (screenSeriesTree); a border here would clip the actions. */}
        <ul className="flex-none">
          {sorted.map((g) => {
            const tag = seriesGameTag(g, sorted);
            const notNeeded = tag === "not_needed";
            const result = tag === "result" ? seriesResultText(g, teamName) : null;
            const home = notNeeded ? null : seriesHomeNote(g, teamName);
            const when = [seriesGameWhen(g), ...(g.venue_name ? [g.venue_name] : []), ...(home ? [home] : [])].join(" · ");
            return (
              <li
                key={g.id}
                data-series-game={g.series_game ?? 1}
                className={`flex items-center gap-1.5 px-2.5 text-[10px] ${notNeeded ? "text-gray-400" : "text-gray-600"}`}
                style={{ height: SERIES_GAME_ROW_H }}
              >
                <span className="w-5 flex-none font-semibold text-gray-500">G{g.series_game ?? 1}</span>
                <span className={`min-w-0 flex-1 truncate ${notNeeded ? "line-through" : ""}`} title={when}>{when}</span>
                {result ? (
                  <span className="flex-none font-semibold text-[#0C1F3F]">{result}</span>
                ) : tag === "next" || tag === "if_needed" || tag === "not_needed" ? (
                  <span
                    className={`flex-none rounded-full px-1.5 py-px text-[9px] font-semibold ${
                      tag === "if_needed" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {SERIES_TAG_TEXT[tag]}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="mt-auto flex h-8 flex-none items-center border-t border-gray-100 px-2">
          {actions.result && (
            <button
              onClick={() => onResult(actions.result as GameWithTeams)}
              className="flex flex-1 items-center justify-center gap-1 rounded-md py-0.5 text-[10px] font-medium text-[#0C1F3F] hover:bg-gray-50"
            >
              <ClipboardEdit className="h-3 w-3" />
              Result
            </button>
          )}
          {actions.edit && (
            <button
              onClick={() => onEditResult(actions.edit as GameWithTeams)}
              aria-label={`Edit game ${actions.edit.series_game ?? 1}'s result`}
              className="flex flex-1 items-center justify-center gap-1 rounded-md py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-50 hover:text-[#0C1F3F]"
            >
              <ClipboardEdit className="h-3 w-3" />
              Edit G{actions.edit.series_game ?? 1}
            </button>
          )}
          {actions.move && (
            <button
              onClick={() => onMove(actions.move as GameWithTeams)}
              aria-label="Set date, time and field"
              title="Set date, time and field"
              className="flex flex-1 items-center justify-center gap-1 rounded-md py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-50 hover:text-[#0C1F3F]"
            >
              <CalendarClock className="h-3 w-3" />
              {actions.move.scheduled_date ? "Move" : "Set time"}
            </button>
          )}
        </div>
      </div>

      {/* Below the card, like the single card's: never moves the rows. */}
      {flagged && (
        <div className="mt-1 flex justify-center">
          <DaylightChip flag={flagged} variant="bracket" />
        </div>
      )}
      {champion && (
        <div className="mt-1 flex items-center justify-center gap-1 rounded-md bg-amber-50 px-2 py-1">
          <Trophy className="h-3 w-3 text-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">{champion}</span>
        </div>
      )}
    </div>
  );
}

function SeriesTeamRow({
  name,
  tbd,
  wins,
  won,
  started,
  away,
}: {
  name: string;
  tbd: boolean;
  wins: string;
  won: boolean;
  started: boolean;
  away: boolean;
}) {
  return (
    <div className={`flex h-8 flex-none items-center gap-2 px-2.5 ${away ? AWAY_ROW_BG : "bg-white"}`}>
      <span className={`flex-1 truncate text-xs ${tbd ? "italic text-gray-600" : won ? "font-bold text-[#0C1F3F]" : "text-gray-800"}`}>
        {name}
      </span>
      {started && !tbd && (
        <span className={`text-xs tabular-nums ${won ? "font-bold text-[#0C1F3F]" : "font-semibold text-gray-600"}`}>{wins}</span>
      )}
      {won && <Trophy className="h-3 w-3 flex-shrink-0 text-[#0C1F3F]" />}
    </div>
  );
}

/** True when a series game needs no buttons and reads struck through. */
export function isNotNeeded(g: { status?: string | null }): boolean {
  return g.status === NOT_NEEDED;
}

"use client";

// The Playoffs page's bracket (admin): loads the games, reads daylight, owns
// the result and edit modals, and hands everything to the presentation pieces
// in bracket-pieces.tsx — which the public bracket page renders too, with no
// buttons and no daylight. Keep admin-only behaviour HERE, never in the pieces.

import { useState, useEffect, useCallback } from "react";
import { List, Trophy, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EnterResultModal } from "@/components/playoffs/enter-result-modal";
import { EditPlayoffGameModal } from "@/components/playoffs/edit-playoff-game-modal";
import { playoffRoundTitle } from "@/lib/playoffs/playoff-result";
import { gameLabel, gameNumbering, slotName } from "@/lib/playoffs/bracket-labels";
import { TONE_CHIP } from "@/components/playoffs/series-card";
import {
  BracketTree,
  ColumnView,
  ListGameRow,
  type BracketGame,
  type ChipOf,
  type LabelOf,
  type ListSeries,
  type NumberOf,
} from "@/components/playoffs/bracket-pieces";
import {
  NOT_NEEDED,
  SERIES_TAG_TEXT,
  gameHasResult,
  seriesGameActions,
  seriesGameTag,
  seriesGamesOf,
  seriesHeadline,
} from "@/lib/playoffs/series";
import { isFinalRound, isSeriesGame } from "@/lib/playoffs/series-names";
import { useDaylight } from "@/components/daylight/use-daylight";
import { DaylightChip, DaylightStatusLine } from "@/components/daylight/daylight-pieces";
import type { DaylightFlag } from "@/lib/daylight/flags";
import type { PlayoffGame } from "@/types/database";

/** A game's daylight flag (admin-only; the print never reads this). */
type FlagOf = (game: GameWithTeams) => DaylightFlag | null;

export interface GameWithTeams extends BracketGame {
  /** The field's lights (0109); null when the game has no field. */
  venue_has_lights: boolean | null;
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

const CHAMPIONSHIP_ROUNDS = new Set(["F", "GF"]);

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

  // The daylight chip the pieces render under a card / inside a list row.
  const chipOf: ChipOf<GameWithTeams> = (g) => {
    const flag = flagOf(g);
    return flag ? <DaylightChip flag={flag} variant="bracket" /> : null;
  };

  const numbering = gameNumbering(games);
  const numberOf: NumberOf<GameWithTeams> = (g) => numbering(g.game_number);

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

  const labelOf: LabelOf<GameWithTeams> = (g, side) => {
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
  // A single elimination's last round is its Final whatever it is stored as
  // (a 2-team bracket's only round is "R1").
  const championshipRound =
    CHAMPIONSHIP_ROUNDS.has(lastRound ?? "") || (lastRound !== null && isFinalRound(lastRound, games)) ? lastRound : null;

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
              chipOf={chipOf}
              series={seriesInfo(g)}
              roundName={playoffRoundTitle(g.round, games)}
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
              chipOf={chipOf}
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
              chipOf={chipOf}
              onEnterResult={setActiveGame}
              onEdit={setEditingGame}
            />
          )}
        </div>
      )}

      {editingGame && (
        <EditPlayoffGameModal
          game={editingGame}
          roundLabel={isSeriesGame(editingGame, games) ? gameLabel(editingGame, games) : playoffRoundTitle(editingGame.round, games)}
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

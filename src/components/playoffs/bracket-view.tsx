"use client";

import { useState, useEffect, useCallback } from "react";
import { CalendarDays, List, Trophy, Clock, ClipboardEdit } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EnterResultModal } from "@/components/playoffs/enter-result-modal";
import type { PlayoffGame } from "@/types/database";

export interface GameWithTeams extends PlayoffGame {
  home_team_name: string | null;
  away_team_name: string | null;
  venue_name: string | null;
  winner_name: string | null;
  home_score: number | null;
  away_score: number | null;
}

interface Props {
  playoffId: string;
  divisionName: string;
  format: string;
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

function roundLabel(round: string): string {
  const map: Record<string, string> = {
    F: "Final", SF: "Semifinals",
    "WB-F": "Winners Final", "LB-F": "Losers Final",
    GF: "Grand Final", "GF-R": "Grand Final (Reset)",
  };
  if (round in map) return map[round];
  if (round.startsWith("RR")) return `Round ${round.slice(2)}`;
  if (round.startsWith("WB-R")) return `Winners Rd ${round.slice(4)}`;
  if (round.startsWith("LB-R")) return `Losers Rd ${round.slice(4)}`;
  if (round.startsWith("R")) return `Round ${round.slice(1)}`;
  return round;
}

const CHAMPIONSHIP_ROUNDS = new Set(["F", "GF"]);

// ─── Game card ────────────────────────────────────────────────────────────────

const CARD_BODY_H = 72;
const CARD_W = 200;

function GameCard({
  game,
  isChampionship,
  onEnterResult,
}: {
  game: GameWithTeams;
  isChampionship: boolean;
  onEnterResult: () => void;
}) {
  const homeWon = game.winner_id === game.home_team_id;
  const awayWon = game.winner_id === game.away_team_id;
  const bothTeams = !!game.home_team_id && !!game.away_team_id;
  const isDone = game.status === "completed";

  return (
    <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm" style={{ width: CARD_W }}>
      {/* Champion banner */}
      {isChampionship && isDone && (
        <div className="flex items-center justify-center gap-1 bg-amber-50 px-2 py-1">
          <Trophy className="h-3 w-3 text-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">
            Champion: {homeWon ? game.home_team_name : game.away_team_name}
          </span>
        </div>
      )}

      <TeamRow
        name={game.home_team_name ?? "TBD"}
        won={homeWon}
        tbd={!game.home_team_id}
        score={game.home_score}
        isDone={isDone}
      />
      <div className="h-px bg-gray-100" />
      <TeamRow
        name={game.away_team_name ?? "TBD"}
        won={awayWon}
        tbd={!game.away_team_id}
        score={game.away_score}
        isDone={isDone}
      />

      {(game.scheduled_date || game.venue_name) && bothTeams && (
        <div className="border-t border-gray-50 px-2.5 py-1.5">
          {game.scheduled_date && (
            <p className="text-[10px] text-gray-400">
              {fmtDate(game.scheduled_date)}
              {game.start_time ? ` · ${fmtTime(game.start_time)}` : ""}
            </p>
          )}
          {game.venue_name && (
            <p className="truncate text-[10px] text-gray-400">{game.venue_name}</p>
          )}
        </div>
      )}

      {bothTeams && (
        <div className="border-t border-gray-50 px-2 py-1.5">
          <button
            onClick={onEnterResult}
            className="flex w-full items-center justify-center gap-1 rounded-md py-0.5 text-[10px] font-medium text-[#0C1F3F] hover:bg-gray-50"
          >
            <ClipboardEdit className="h-3 w-3" />
            {isDone ? "Edit result" : "Enter result"}
          </button>
        </div>
      )}
    </div>
  );
}

function TeamRow({
  name,
  won,
  tbd,
  score,
  isDone,
}: {
  name: string;
  won: boolean;
  tbd: boolean;
  score: number | null;
  isDone: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 px-2.5 py-2 ${won ? "bg-[#22C55E]/5" : ""}`}>
      <span
        className={`flex-1 truncate text-xs ${
          tbd ? "italic text-gray-300" : won ? "font-semibold text-[#0C1F3F]" : "text-gray-700"
        }`}
      >
        {name}
      </span>
      {isDone && score != null && (
        <span className={`text-xs font-semibold tabular-nums ${won ? "text-[#0C1F3F]" : "text-gray-400"}`}>
          {score}
        </span>
      )}
      {won && <Trophy className="h-3 w-3 flex-shrink-0 text-[#22C55E]" />}
    </div>
  );
}

// ─── List view row ────────────────────────────────────────────────────────────

function ListGameRow({
  game,
  idx,
  isChampionship,
  onEnterResult,
}: {
  game: GameWithTeams;
  idx: number;
  isChampionship: boolean;
  onEnterResult: () => void;
}) {
  const bothTeams = !!game.home_team_id && !!game.away_team_id;
  const isDone = game.status === "completed";
  const homeWon = game.winner_id === game.home_team_id;
  const awayWon = game.winner_id === game.away_team_id;

  return (
    <div className="flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0">
      <span className="w-5 text-center text-xs font-semibold text-gray-300">{idx + 1}</span>

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
          <p className={`text-sm font-medium ${!bothTeams ? "italic text-gray-400" : "text-gray-900"}`}>
            {!bothTeams
              ? "TBD vs TBD"
              : `${game.home_team_name ?? "TBD"} vs ${game.away_team_name ?? "TBD"}`}
          </p>
        )}
        <p className="text-xs text-gray-400">{roundLabel(game.round)}</p>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        {game.scheduled_date ? (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <CalendarDays className="h-3 w-3" />
            {fmtDate(game.scheduled_date)}
          </span>
        ) : (
          <span className="text-xs text-gray-300">No date</span>
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

      {isChampionship && isDone && (
        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
          <Trophy className="h-3 w-3" />
          Champion
        </span>
      )}

      {!isChampionship && isDone && (
        <span className="rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-xs font-medium text-[#22C55E]">
          Final
        </span>
      )}

      {bothTeams && (
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

const V_SLOT = 92;
const H_GAP  = 56;

function gameTop(roundIdx: number, gameIdx: number): number {
  const slotH = V_SLOT * Math.pow(2, roundIdx);
  return gameIdx * slotH + slotH / 2 - CARD_BODY_H / 2;
}

function gameCenter(roundIdx: number, gameIdx: number): number {
  return gameTop(roundIdx, gameIdx) + CARD_BODY_H / 2;
}

function BracketTree({
  rounds,
  championshipRound,
  onEnterResult,
}: {
  rounds: [string, GameWithTeams[]][];
  championshipRound: string | null;
  onEnterResult: (game: GameWithTeams) => void;
}) {
  if (rounds.length === 0) return null;

  const r0Count = rounds[0][1].length;
  const totalH = r0Count * V_SLOT;
  const totalW = rounds.length * (CARD_W + H_GAP) - H_GAP;

  return (
    <div style={{ position: "relative", height: totalH, width: totalW, minWidth: totalW }}>
      {/* SVG connector lines */}
      <svg
        width={totalW}
        height={totalH}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {rounds.slice(0, -1).map(([, srcGames], rIdx) => {
          const nextGames = rounds[rIdx + 1][1];
          if (srcGames.length !== nextGames.length * 2) return null;
          return nextGames.map((_, pairIdx) => {
            const g1 = pairIdx * 2;
            const g2 = pairIdx * 2 + 1;
            const xRight = rIdx * (CARD_W + H_GAP) + CARD_W;
            const xMid   = xRight + H_GAP / 2;
            const xNext  = (rIdx + 1) * (CARD_W + H_GAP);
            const y1    = gameCenter(rIdx, g1);
            const y2    = gameCenter(rIdx, g2);
            const yNext = (y1 + y2) / 2;
            return (
              <g key={`c-${rIdx}-${pairIdx}`}>
                <line x1={xRight} y1={y1} x2={xMid} y2={y1} stroke="#e5e7eb" strokeWidth={1.5} />
                <line x1={xRight} y1={y2} x2={xMid} y2={y2} stroke="#e5e7eb" strokeWidth={1.5} />
                <line x1={xMid} y1={y1} x2={xMid} y2={y2} stroke="#e5e7eb" strokeWidth={1.5} />
                <line x1={xMid} y1={yNext} x2={xNext} y2={yNext} stroke="#e5e7eb" strokeWidth={1.5} />
              </g>
            );
          });
        })}
      </svg>

      {/* Round headers */}
      {rounds.map(([round], rIdx) => (
        <div
          key={`hdr-${round}`}
          style={{ position: "absolute", top: 0, left: rIdx * (CARD_W + H_GAP), width: CARD_W, textAlign: "center" }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {roundLabel(round)}
          </span>
        </div>
      ))}

      {/* Game cards */}
      {rounds.map(([, roundGames], rIdx) =>
        roundGames.map((game, gIdx) => (
          <div
            key={game.id}
            style={{
              position: "absolute",
              left: rIdx * (CARD_W + H_GAP),
              top: gameTop(rIdx, gIdx) + 18,
            }}
          >
            <GameCard
              game={game}
              isChampionship={game.round === championshipRound}
              onEnterResult={() => onEnterResult(game)}
            />
          </div>
        ))
      )}
    </div>
  );
}

// ─── Column view (round robin / double elimination) ───────────────────────────

function ColumnView({
  rounds,
  championshipRound,
  onEnterResult,
}: {
  rounds: [string, GameWithTeams[]][];
  championshipRound: string | null;
  onEnterResult: (game: GameWithTeams) => void;
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
                onEnterResult={() => onEnterResult(g)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BracketView({ playoffId, divisionName, format }: Props) {
  const [games, setGames] = useState<GameWithTeams[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"bracket" | "list">("list");
  const [activeGame, setActiveGame] = useState<GameWithTeams | null>(null);

  const loadGames = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("playoff_games")
      .select(
        `*, home:teams!playoff_games_home_team_id_fkey(name),
         away:teams!playoff_games_away_team_id_fkey(name),
         venue:venues(name),
         winner:teams!playoff_games_winner_id_fkey(name)`,
      )
      .eq("playoff_id", playoffId)
      .order("game_number");

    const rows = (data ?? []).map((g: Record<string, unknown>) => ({
      ...(g as PlayoffGame),
      home_team_name: (g.home as { name?: string } | null)?.name ?? null,
      away_team_name: (g.away as { name?: string } | null)?.name ?? null,
      venue_name: (g.venue as { name?: string } | null)?.name ?? null,
      winner_name: (g.winner as { name?: string } | null)?.name ?? null,
      home_score: (g.home_score as number | null) ?? null,
      away_score: (g.away_score as number | null) ?? null,
    }));
    setGames(rows);
    setLoading(false);
  }, [playoffId]);

  useEffect(() => { void loadGames(); }, [loadGames]);

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

  return (
    <div className="flex flex-col gap-3">
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
          {games.map((g, i) => (
            <ListGameRow
              key={g.id}
              game={g}
              idx={i}
              isChampionship={g.round === championshipRound}
              onEnterResult={() => setActiveGame(g)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-gray-50 p-6">
          {useBracketTree ? (
            <BracketTree
              rounds={rounds}
              championshipRound={championshipRound}
              onEnterResult={setActiveGame}
            />
          ) : (
            <ColumnView
              rounds={rounds}
              championshipRound={championshipRound}
              onEnterResult={setActiveGame}
            />
          )}
        </div>
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
          }}
        />
      )}
    </div>
  );
}

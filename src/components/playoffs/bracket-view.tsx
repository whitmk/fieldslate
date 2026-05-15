"use client";

import { useState, useEffect } from "react";
import { CalendarDays, List, Trophy, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PlayoffGame } from "@/types/database";

interface GameWithTeams extends PlayoffGame {
  home_team_name: string | null;
  away_team_name: string | null;
  venue_name: string | null;
  winner_name: string | null;
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

// ─── Game card ────────────────────────────────────────────────────────────────

// Fixed card body height (2 team rows × 36 px) used for connector math.
const CARD_BODY_H = 72;
const CARD_W = 192; // w-48

function GameCard({ game }: { game: GameWithTeams }) {
  const homeWon = game.winner_id === game.home_team_id;
  const awayWon = game.winner_id === game.away_team_id;
  const tbd = !game.home_team_id || !game.away_team_id;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm" style={{ width: CARD_W }}>
      <TeamRow name={game.home_team_name ?? "TBD"} won={homeWon} tbd={!game.home_team_id} />
      <div className="h-px bg-gray-100" />
      <TeamRow name={game.away_team_name ?? "TBD"} won={awayWon} tbd={!game.away_team_id} />
      {(game.scheduled_date || game.venue_name) && !tbd && (
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
    </div>
  );
}

function TeamRow({ name, won, tbd }: { name: string; won: boolean; tbd: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-2.5 py-2 ${won ? "bg-[#22C55E]/5" : ""}`}>
      <span className={`flex-1 truncate text-xs ${tbd ? "italic text-gray-300" : won ? "font-semibold text-[#0C1F3F]" : "text-gray-700"}`}>
        {name}
      </span>
      {won && <Trophy className="h-3 w-3 flex-shrink-0 text-[#22C55E]" />}
    </div>
  );
}

// ─── List view row ────────────────────────────────────────────────────────────

function ListGameRow({ game, idx }: { game: GameWithTeams; idx: number }) {
  const tbd = !game.home_team_id || !game.away_team_id;
  return (
    <div className="flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0">
      <span className="w-5 text-center text-xs font-semibold text-gray-300">{idx + 1}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${tbd ? "italic text-gray-400" : "text-gray-900"}`}>
          {tbd ? "TBD vs TBD" : `${game.home_team_name ?? "TBD"} vs ${game.away_team_name ?? "TBD"}`}
        </p>
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
      {game.winner_id && (
        <span className="rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-xs font-medium text-[#22C55E]">
          Done
        </span>
      )}
    </div>
  );
}

// ─── Bracket tree (single / double elimination) ───────────────────────────────
//
// Layout math:
//   slotH(r) = V_SLOT * 2^r          — vertical slot per game in round r
//   top(r, i) = i * slotH(r) + slotH(r)/2 - CARD_BODY_H/2
//   center_y(r, i) = i * slotH(r) + slotH(r)/2
//
// Connector for pair (2i, 2i+1) in round r → game i in round r+1:
//   x_right = r * (CARD_W + H_GAP) + CARD_W
//   x_mid   = x_right + H_GAP / 2
//   x_left  = (r+1) * (CARD_W + H_GAP)
//   y1      = center_y(r, 2i)
//   y2      = center_y(r, 2i+1)
//   y_next  = (y1 + y2) / 2   [= center_y(r+1, i) by construction]
//
// Lines drawn: horizontal to mid → vertical between → horizontal to next column.

const V_SLOT = 92;   // CARD_BODY_H (72) + 20px gap
const H_GAP  = 56;   // horizontal space between columns (connectors live here)

function gameTop(roundIdx: number, gameIdx: number): number {
  const slotH = V_SLOT * Math.pow(2, roundIdx);
  return gameIdx * slotH + slotH / 2 - CARD_BODY_H / 2;
}

function gameCenter(roundIdx: number, gameIdx: number): number {
  return gameTop(roundIdx, gameIdx) + CARD_BODY_H / 2;
}

function BracketTree({ rounds }: { rounds: [string, GameWithTeams[]][] }) {
  if (rounds.length === 0) return null;

  const r0Count = rounds[0][1].length;
  const totalH = r0Count * V_SLOT;
  const totalW = rounds.length * (CARD_W + H_GAP) - H_GAP;

  return (
    <div style={{ position: "relative", height: totalH, width: totalW, minWidth: totalW }}>

      {/* SVG connector lines — rendered beneath cards */}
      <svg
        width={totalW}
        height={totalH}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {rounds.slice(0, -1).map(([, srcGames], rIdx) => {
          const nextGames = rounds[rIdx + 1][1];
          // Only draw when the source round pairs cleanly into the next
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
                {/* Horizontal from game 1 right edge to midpoint */}
                <line x1={xRight} y1={y1} x2={xMid} y2={y1} stroke="#e5e7eb" strokeWidth={1.5} />
                {/* Horizontal from game 2 right edge to midpoint */}
                <line x1={xRight} y1={y2} x2={xMid} y2={y2} stroke="#e5e7eb" strokeWidth={1.5} />
                {/* Vertical connector between the two horizontals */}
                <line x1={xMid} y1={y1} x2={xMid} y2={y2} stroke="#e5e7eb" strokeWidth={1.5} />
                {/* Horizontal from midpoint to next-round card */}
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
          style={{
            position: "absolute",
            top: 0,
            left: rIdx * (CARD_W + H_GAP),
            width: CARD_W,
            textAlign: "center",
          }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {roundLabel(round)}
          </span>
        </div>
      ))}

      {/* Game cards */}
      {rounds.map(([_round, roundGames], rIdx) =>
        roundGames.map((game, gIdx) => (
          <div
            key={game.id}
            style={{
              position: "absolute",
              left: rIdx * (CARD_W + H_GAP),
              // Offset by 18px to sit below the round header
              top: gameTop(rIdx, gIdx) + 18,
            }}
          >
            <GameCard game={game} />
          </div>
        ))
      )}
    </div>
  );
}

// ─── Column view (round robin / double elimination) ───────────────────────────

function ColumnView({ rounds }: { rounds: [string, GameWithTeams[]][] }) {
  return (
    <div className="flex items-start gap-8">
      {rounds.map(([round, roundGames]) => (
        <div key={round} className="flex flex-col gap-4">
          <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {roundLabel(round)}
          </p>
          <div className="flex flex-col gap-6">
            {roundGames.map((g) => (
              <GameCard key={g.id} game={g} />
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

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("playoff_games")
      .select(
        `*, home:teams!playoff_games_home_team_id_fkey(name),
         away:teams!playoff_games_away_team_id_fkey(name),
         venue:venues(name),
         winner:teams!playoff_games_winner_id_fkey(name)`
      )
      .eq("playoff_id", playoffId)
      .order("game_number")
      .then(({ data }) => {
        const rows = (data ?? []).map((g: Record<string, unknown>) => ({
          ...(g as PlayoffGame),
          home_team_name: (g.home as { name?: string } | null)?.name ?? null,
          away_team_name: (g.away as { name?: string } | null)?.name ?? null,
          venue_name: (g.venue as { name?: string } | null)?.name ?? null,
          winner_name: (g.winner as { name?: string } | null)?.name ?? null,
        }));
        setGames(rows);
        setLoading(false);
      });
  }, [playoffId]);

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
          {games.map((g, i) => <ListGameRow key={g.id} game={g} idx={i} />)}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-gray-50 p-6">
          {useBracketTree
            ? <BracketTree rounds={rounds} />
            : <ColumnView rounds={rounds} />
          }
        </div>
      )}
    </div>
  );
}

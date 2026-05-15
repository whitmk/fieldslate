"use client";

import { createClient } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GameRow {
  id: string;
  round: string;
  game_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
}

export type EnterResultPayload = {
  gameId: string;
  homeScore: number;
  awayScore: number;
};

export type EnterResultOutcome =
  | { success: true }
  | { success: false; error: string };

// ─── Round order (mirrors bracket-view) ──────────────────────────────────────

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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function enterGameResult(
  payload: EnterResultPayload,
  allGames: GameRow[],
  format: string,
): Promise<EnterResultOutcome> {
  const supabase = createClient();

  const game = allGames.find((g) => g.id === payload.gameId);
  if (!game) return { success: false, error: "Game not found." };

  const { homeScore, awayScore } = payload;
  if (homeScore === awayScore) {
    return { success: false, error: "Scores cannot be tied — one team must win." };
  }

  const winnerId = homeScore > awayScore ? game.home_team_id : game.away_team_id;
  if (!winnerId) return { success: false, error: "Winner could not be determined." };

  const { error: updateErr } = await supabase
    .from("playoff_games")
    .update({
      home_score: homeScore,
      away_score: awayScore,
      winner_id: winnerId,
      status: "completed",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", payload.gameId);

  if (updateErr) return { success: false, error: updateErr.message };

  if (format === "single_elimination") {
    await advanceSingleElim(supabase, game, winnerId, allGames);
  }

  return { success: true };
}

// ─── Single-elimination advancement ──────────────────────────────────────────

async function advanceSingleElim(
  supabase: ReturnType<typeof createClient>,
  completedGame: GameRow,
  winnerId: string,
  allGames: GameRow[],
) {
  // Group games by round
  const roundMap = new Map<string, GameRow[]>();
  for (const g of allGames) {
    if (!roundMap.has(g.round)) roundMap.set(g.round, []);
    roundMap.get(g.round)!.push(g);
  }
  for (const games of roundMap.values()) {
    games.sort((a, b) => a.game_number - b.game_number);
  }

  const roundOrder = [...roundMap.keys()].sort((a, b) => getRoundOrder(a) - getRoundOrder(b));
  const roundIdx = roundOrder.indexOf(completedGame.round);

  // Championship — nothing to advance to
  if (roundIdx === -1 || roundIdx === roundOrder.length - 1) return;

  const nextRound = roundOrder[roundIdx + 1];
  const currentRoundGames = roundMap.get(completedGame.round)!;
  const gameIdxInRound = currentRoundGames.findIndex((g) => g.id === completedGame.id);

  const nextRoundGames = roundMap.get(nextRound)!;
  const targetGame = nextRoundGames[Math.floor(gameIdxInRound / 2)];
  if (!targetGame) return;

  const field = gameIdxInRound % 2 === 0 ? "home_team_id" : "away_team_id";
  await supabase
    .from("playoff_games")
    .update({ [field]: winnerId } as never)
    .eq("id", targetGame.id);
}

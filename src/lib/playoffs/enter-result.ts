"use client";

import { createClient } from "@/lib/supabase/client";
import {
  computeDoubleElimAdvancement,
  getRoundOrder,
  type GameRow,
  type SlotWrite,
} from "@/lib/playoffs/double-elim-advancement";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { GameRow } from "@/lib/playoffs/double-elim-advancement";

export type EnterResultPayload = {
  gameId: string;
  homeScore: number;
  awayScore: number;
};

export type EnterResultOutcome =
  | { success: true }
  | { success: false; error: string };

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

  // Double-elim advancement is computed BEFORE the row update so a re-save
  // that would corrupt an already-played downstream game is rejected without
  // writing anything. When the targets are unplayed, the writes overwrite any
  // stale occupants (edit-and-flip-winner is safe).
  let slotWrites: SlotWrite[] = [];
  if (format === "double_elimination") {
    const adv = computeDoubleElimAdvancement(game, winnerId, allGames);
    if ("blocked" in adv) return { success: false, error: adv.blocked };
    slotWrites = adv.writes;
  }

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

  // Apply the double-elim slot writes, grouped so each target game gets one
  // UPDATE (GF-R takes both slots at once).
  const fieldsByGame = new Map<string, Record<string, string | null>>();
  for (const w of slotWrites) {
    if (!fieldsByGame.has(w.gameId)) fieldsByGame.set(w.gameId, {});
    fieldsByGame.get(w.gameId)![w.field] = w.teamId;
  }
  for (const [gameId, fields] of fieldsByGame) {
    const { error } = await supabase
      .from("playoff_games")
      .update(fields as never)
      .eq("id", gameId);
    if (error) return { success: false, error: error.message };
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

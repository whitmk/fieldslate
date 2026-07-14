"use client";

import { createClient } from "@/lib/supabase/client";
import {
  computeDoubleElimAdvancement,
  computeSingleElimAdvancement,
  type GameRow,
  type SlotWrite,
} from "@/lib/playoffs/advancement";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { GameRow } from "@/lib/playoffs/advancement";

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

  // Advancement is computed BEFORE the row update so a re-save that would
  // corrupt an already-played downstream game is rejected without writing
  // anything. When the targets are unplayed, the writes overwrite any stale
  // occupants (edit-and-flip-winner is safe). Round-robin has no advancement.
  let slotWrites: SlotWrite[] = [];
  if (format === "single_elimination" || format === "double_elimination") {
    const adv =
      format === "single_elimination"
        ? computeSingleElimAdvancement(game, winnerId, allGames)
        : computeDoubleElimAdvancement(game, winnerId, allGames);
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

  // Apply the slot writes, grouped so each target game gets one UPDATE
  // (GF-R takes both slots at once).
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

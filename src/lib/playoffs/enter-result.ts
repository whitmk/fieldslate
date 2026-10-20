"use client";

import { createClient } from "@/lib/supabase/client";
import {
  computeDoubleElimAdvancement,
  type GameRow,
  type SlotWrite,
} from "@/lib/playoffs/advancement";
import { DOUBLE_ELIM_EDIT_BLOCKED, enterOutcome, resultPath, type ResultNumbering } from "@/lib/playoffs/playoff-result";

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

// Single elimination and round robin: ONE call to enter_playoff_result (0108),
// which writes the result and the winner's advancement in one transaction,
// refuses when the next game already has a result, checks every write's row
// count and logs it. Success only when the reply is committed for this game.
//
// Double elimination: the original browser path below, unchanged apart from
// the blocked sentence (an untested format is not regressed — decided
// 2026-10-13). It is a KNOWN SECOND IMPLEMENTATION of result entry: two
// unchecked writes, no log, no server-side Elite check. See CLAUDE.md.
export async function enterGameResult(
  payload: EnterResultPayload,
  allGames: GameRow[],
  format: string,
  numbering: ResultNumbering,
): Promise<EnterResultOutcome> {
  if (resultPath(format) === "database") {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("enter_playoff_result" as never, {
      p_game_id: payload.gameId,
      p_home_score: payload.homeScore,
      p_away_score: payload.awayScore,
    } as never);
    const outcome = enterOutcome(data, error, payload.gameId, numbering);
    return outcome.ok ? { success: true } : { success: false, error: outcome.message };
  }
  return enterDoubleElimResultInBrowser(payload, allGames);
}

async function enterDoubleElimResultInBrowser(
  payload: EnterResultPayload,
  allGames: GameRow[],
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
  // occupants (edit-and-flip-winner is safe).
  const adv = computeDoubleElimAdvancement(game, winnerId, allGames);
  if ("blocked" in adv) return { success: false, error: DOUBLE_ELIM_EDIT_BLOCKED };
  const slotWrites: SlotWrite[] = adv.writes;

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

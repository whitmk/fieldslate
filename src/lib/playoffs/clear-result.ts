"use client";

// Clear a playoff result — the I/O half. Every decision and sentence lives in
// playoff-result.ts (pure, `npm run sim:playoff-result`); the database
// function is clear_playoff_result (0108). The preview writes nothing; the
// commit clears the game, removes its winner from the next game and logs it in
// one transaction. There is no other way a result is cleared from the app.

import { createClient } from "@/lib/supabase/client";
import {
  clearCommitOutcome,
  clearPreviewOutcome,
  type ClearPreviewOutcome,
  type ResultNumbering,
  type ResultOutcome,
} from "@/lib/playoffs/playoff-result";

export async function previewClearResult(gameId: string, numbering: ResultNumbering): Promise<ClearPreviewOutcome> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clear_playoff_result" as never, {
    p_game_id: gameId,
    p_commit: false,
  } as never);
  return clearPreviewOutcome(data, error, gameId, numbering);
}

export async function clearResult(gameId: string, numbering: ResultNumbering): Promise<ResultOutcome> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clear_playoff_result" as never, {
    p_game_id: gameId,
    p_commit: true,
  } as never);
  return clearCommitOutcome(data, error, gameId, numbering);
}

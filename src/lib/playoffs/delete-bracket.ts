"use client";

// Delete a playoff bracket — the I/O half. Every decision and sentence lives
// in bracket-delete.ts (pure, `npm run sim:bracket-delete`); the database
// function is delete_playoff_bracket (0107). The preview writes nothing; the
// commit deletes the bracket row (its games cascade) and logs it in one
// transaction. There is no other way a bracket is deleted from the app.

import { createClient } from "@/lib/supabase/client";
import { commitOutcome, parseDeleteCounts, type BracketCounts } from "@/lib/playoffs/bracket-delete";
import type { SeriesGame } from "@/lib/playoffs/series";

/** The confirm's counts. Null means they could not be read — the confirm
 *  says "couldn't count", never zero. */
export async function previewBracketDelete(playoffId: string): Promise<BracketCounts | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("delete_playoff_bracket" as never, {
    p_playoff_id: playoffId,
    p_commit: false,
  } as never);
  if (error) return null;
  return parseDeleteCounts(data);
}

/** The bracket's games, for the confirm's series line (0114). Fail-soft: null
 *  when unreadable, and the confirm keeps its plain lines — the counts it
 *  states always come from the preview above. */
export async function bracketGamesForConfirm(playoffId: string): Promise<SeriesGame[] | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("playoff_games")
    .select("id, round, game_number, series_game, status, home_team_id, away_team_id, winner_id, home_score, away_score")
    .eq("playoff_id", playoffId);
  if (error || !data) return null;
  return data as unknown as SeriesGame[];
}

export async function deleteBracket(
  playoffId: string,
): Promise<{ ok: true; counts: BracketCounts } | { ok: false; message: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("delete_playoff_bracket" as never, {
    p_playoff_id: playoffId,
    p_commit: true,
  } as never);
  const outcome = commitOutcome(data, error, parseDeleteCounts);
  return outcome.ok ? { ok: true, counts: outcome.counts } : { ok: false, message: outcome.message };
}

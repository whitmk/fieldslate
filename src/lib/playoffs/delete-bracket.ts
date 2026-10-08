"use client";

// Delete a playoff bracket — the I/O half. Every decision and sentence lives
// in bracket-delete.ts (pure, `npm run sim:bracket-delete`); the database
// function is delete_playoff_bracket (0107). The preview writes nothing; the
// commit deletes the bracket row (its games cascade) and logs it in one
// transaction. There is no other way a bracket is deleted from the app.

import { createClient } from "@/lib/supabase/client";
import { commitOutcome, parseDeleteCounts, type BracketCounts } from "@/lib/playoffs/bracket-delete";

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

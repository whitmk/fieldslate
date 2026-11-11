// The browser's I/O for 0131's stale-day marks. The rules and words are in
// stale-days.ts (pure); this file only calls the two functions and parses.
// It reads no sign-up data.

import { createClient } from "@/lib/supabase/client";
import { parseStaleState, type StaleState } from "./stale-days";

/** snack_shack_stale_state(season). Throws on an error or a reply that isn't
 *  the expected shape — the caller says "couldn't check", never nothing. */
export async function readStaleState(seasonId: string): Promise<StaleState> {
  const supabase = createClient();
  // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
  const { data, error } = await supabase.rpc("snack_shack_stale_state", { p_season_id: seasonId });
  if (error) throw new Error(error.message);
  const parsed = parseStaleState(data);
  if (!parsed) throw new Error("The snack shack check came back in an unexpected shape.");
  return parsed;
}

/** clear_snack_shack_stale_days(shack, dates | null, before). Returns how many
 *  marks were cleared. Throws on an error. */
export async function clearStaleMarks(snackShackId: string, dates: string[] | null, before: string): Promise<number> {
  const supabase = createClient();
  // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
  const { data, error } = await supabase.rpc("clear_snack_shack_stale_days", {
    p_snack_shack_id: snackShackId,
    p_dates: dates,
    p_before: before,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

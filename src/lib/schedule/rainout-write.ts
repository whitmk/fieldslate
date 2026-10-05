// The ONE write for marking a single game rained out, shared by the four
// surfaces that offer it (division panel cloud, dashboard upcoming-games
// menu, Schedule list, Schedule calendar). Until 2026-10-05 each of them sent
// `games.update({ status: "cancelled" })` and discarded the result, so a
// refused or no-op write still logged "marked as rained out" and refreshed as
// if it had succeeded.
//
// Same pattern as the reschedule picker's save (picker-guard.ts): chain
// `.select("id")` so the row count comes back, and treat ZERO rows as a
// failure — the game changed or was deleted under the admin, and nothing was
// written. The caller writes the activity-log entry and refreshes ONLY on a
// one-row success. What a successful rainout writes is unchanged.
//
// No new database code: this is the same UPDATE, with its result read.

import { createClient } from "@/lib/supabase/client";

/** Shown in the confirm dialog when the write errors or touches no row. */
export const RAINOUT_WRITE_FAILED =
  "Couldn't mark this game as rained out. It may have been changed or deleted — refresh and try again.";

export type RainoutWriteResult =
  | { ok: true }
  | { ok: false; reason: "error" | "zero_rows"; message: string };

type RainoutClient = {
  from: (table: string) => {
    update: (values: unknown) => {
      eq: (column: string, value: string) => {
        select: (columns: string) => PromiseLike<{
          data: { id: string }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

/**
 * `client` exists ONLY so a harness can drive this against a fake (the same
 * seam as autoAssignUmpires). Production callers omit it.
 */
export async function markGameRainedOut(
  gameId: string,
  client?: RainoutClient,
): Promise<RainoutWriteResult> {
  const supabase = (client ?? createClient()) as unknown as RainoutClient;
  const { data, error } = await supabase
    .from("games")
    .update({ status: "cancelled" })
    .eq("id", gameId)
    .select("id");
  if (error) return { ok: false, reason: "error", message: RAINOUT_WRITE_FAILED };
  if ((data ?? []).length !== 1) return { ok: false, reason: "zero_rows", message: RAINOUT_WRITE_FAILED };
  return { ok: true };
}

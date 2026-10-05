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

type RainoutSelect = {
  select: (columns: string) => PromiseLike<{
    data: { id: string }[] | null;
    error: { message: string } | null;
  }>;
};

type RainoutClient = {
  from: (table: string) => {
    update: (values: unknown) => {
      eq: (column: string, value: string) => RainoutSelect;
      in: (column: string, values: string[]) => RainoutSelect;
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

// ── Several games at once ────────────────────────────────────────────────────
// Used by the division panel's bulk rainout and the log-rainout modal's
// multi-game flow. The returned ids say which games actually changed; the
// caller logs ONLY those and tells the admin about the rest. An error
// response counts as nothing saved.

export type BulkRainoutResult = {
  savedIds: string[];
  failedIds: string[];
  /** The request itself failed (network / server error), as opposed to
   *  some rows simply not matching. */
  requestFailed: boolean;
};

export async function markGamesRainedOut(
  gameIds: string[],
  client?: RainoutClient,
): Promise<BulkRainoutResult> {
  if (gameIds.length === 0) return { savedIds: [], failedIds: [], requestFailed: false };
  const supabase = (client ?? createClient()) as unknown as RainoutClient;
  const { data, error } = await supabase
    .from("games")
    .update({ status: "cancelled" })
    .in("id", gameIds)
    .select("id");
  if (error) return { savedIds: [], failedIds: [...gameIds], requestFailed: true };
  const saved = new Set((data ?? []).map((r) => r.id));
  return {
    savedIds: gameIds.filter((id) => saved.has(id)),
    failedIds: gameIds.filter((id) => !saved.has(id)),
    requestFailed: false,
  };
}

/** The sentence for a bulk write that did not save every game. Returns null
 *  when everything saved. */
export function bulkRainoutMessage(saved: number, total: number): string | null {
  if (saved >= total) return null;
  if (total === 1) return RAINOUT_WRITE_FAILED;
  const failed = total - saved;
  if (saved === 0) {
    return `None of the ${total} games could be marked as rained out — they may have been changed or deleted. Refresh and try again.`;
  }
  return `${saved} of ${total} games were marked as rained out. ${failed} couldn't be saved — they may have been changed or deleted. Refresh and try again.`;
}

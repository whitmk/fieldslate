// Data-derived /setup progress — extracted from setup/page.tsx (Chunk 4) so
// dashboard empty states can gate their "Finish setting up your league →"
// links on the same logic. Pure helper (client passed in), same convention
// as src/lib/plan/counts.ts; the caller resolves seasonId (getCurrentSeasonId
// reads cookies, which keeps this function context-free).
//
// Steps: 1 = no venues, 2 = no active season, 3 = no divisions, 4 = some
// division has zero games, 5 = finished. Queries are ordered cheapest-first
// and short-circuit, so fully-empty orgs pay one head-count.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getDivisionGameCounts } from "@/lib/schedule/division-game-counts";

type Client = SupabaseClient<Database>;

/** Step 5 = nothing left for /setup to do. */
export const SETUP_COMPLETE_STEP = 5;

export async function deriveSetupStep(
  supabase: Client,
  orgId: string,
  seasonId: string | null,
): Promise<number> {
  const { count: venueCount } = await supabase
    .from("venues")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", orgId);
  if ((venueCount ?? 0) === 0) return 1;

  if (seasonId === null) return 2;

  const { data: divisionRows } = await supabase
    .from("divisions")
    .select("id")
    .eq("league_id", seasonId);
  const divisionIds = ((divisionRows ?? []) as { id: string }[]).map(
    (d) => d.id,
  );
  if (divisionIds.length === 0) return 3;

  const gameCounts = await getDivisionGameCounts(
    supabase,
    seasonId,
    divisionIds,
  );
  const hasUnscheduled = divisionIds.some(
    (id) => (gameCounts.get(id) ?? 0) === 0,
  );
  return hasUnscheduled ? 4 : SETUP_COMPLETE_STEP;
}

/** The empty-state link gate: anything left to do in /setup? */
export async function isSetupIncomplete(
  supabase: Client,
  orgId: string,
  seasonId: string | null,
): Promise<boolean> {
  return (await deriveSetupStep(supabase, orgId, seasonId)) < SETUP_COMPLETE_STEP;
}

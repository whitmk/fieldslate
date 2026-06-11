// Per-division game counts for a season. games has NO division_id column —
// a division's games are the ones whose HOME team belongs to it, the same
// scoping generateSchedule's delete/count paths use (home_team_id is always
// our team, interleague included).
//
// Two-step on purpose: PostgREST's head+count=exact does not reliably honor
// embedded !inner-join filters (returns pre-filter base-table counts on some
// versions), so fetch team ids first and count with .in() on the base table.
// Pure helper (client passed in) — runs on both the server page and the
// browser client, like the counts in src/lib/plan/counts.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export async function getDivisionGameCounts(
  supabase: Client,
  seasonId: string,
  divisionIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (divisionIds.length === 0) return counts;

  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, division_id")
    .eq("league_id", seasonId);

  const teamIdsByDivision = new Map<string, string[]>();
  for (const t of (teamRows ?? []) as {
    id: string;
    division_id: string | null;
  }[]) {
    if (!t.division_id) continue;
    if (!teamIdsByDivision.has(t.division_id)) {
      teamIdsByDivision.set(t.division_id, []);
    }
    teamIdsByDivision.get(t.division_id)!.push(t.id);
  }

  // Head-counts in parallel — reads only; the sequential rule applies to
  // schedule GENERATION, not to counting.
  await Promise.all(
    divisionIds.map(async (divId) => {
      const teamIds = teamIdsByDivision.get(divId) ?? [];
      if (teamIds.length === 0) {
        counts.set(divId, 0);
        return;
      }
      const { count } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .in("home_team_id", teamIds);
      counts.set(divId, count ?? 0);
    }),
  );

  return counts;
}

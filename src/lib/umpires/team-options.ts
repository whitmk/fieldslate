import { createClient } from "@/lib/supabase/client";

/**
 * Team option for the "Coaches team" selects, carrying the division name so
 * same-named teams in different divisions stay distinguishable.
 */
export type CoachTeamOption = {
  id: string;
  name: string;
  division: { name: string } | null;
};

/** "{team} ({division})", or the bare team name when there is no division. */
export function coachTeamLabel(
  teamName: string,
  divisionName?: string | null,
): string {
  return divisionName ? `${teamName} (${divisionName})` : teamName;
}

/**
 * Coached-team options for a season, sorted by division name then team name
 * (teams without a division last) so same-division teams group together.
 */
export async function fetchCoachTeamOptions(
  supabase: ReturnType<typeof createClient>,
  seasonId: string,
): Promise<CoachTeamOption[]> {
  const { data } = await supabase
    .from("teams")
    .select("id, name, division:divisions(name)")
    .eq("league_id", seasonId);
  const teams = ((data ?? []) as unknown as CoachTeamOption[]);
  return teams.sort((a, b) => {
    const aDiv = a.division?.name ?? null;
    const bDiv = b.division?.name ?? null;
    if (aDiv !== bDiv) {
      if (aDiv === null) return 1;
      if (bDiv === null) return -1;
      const byDivision = aDiv.localeCompare(bDiv);
      if (byDivision !== 0) return byDivision;
    }
    return a.name.localeCompare(b.name);
  });
}

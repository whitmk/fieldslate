import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { AddTeamButton } from "@/components/teams/add-team-button";
import { TeamSnackShackButton } from "@/components/teams/team-snack-shack-button";
import { TeamConstraintsCollapsible } from "@/components/teams/team-constraints-collapsible";
import { TeamConstraintsSection } from "@/components/schedule/team-constraints-section";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import type { Team } from "@/types/database";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { PLAN_LIMITS, isUnlimited, isElite } from "@/lib/plan/limits";
import { planLabel } from "@/lib/plan/labels";
import { getTeamCountForOrg } from "@/lib/plan/counts";
import { isSetupIncomplete } from "@/lib/setup/derive-step";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";

type TeamWithDivision = Team & {
  division: { name: string } | null;
};

export default async function TeamsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Season-scoped (Chunk B1): only the selected season's teams — this also
  // closes the old quirk of archived-season teams leaking into the list. A
  // null season (no active seasons) flows to the existing empty state.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);

  const [{ data: rawSeason }, { data: rawTeams }, { data: rawDivisions }] =
    seasonId
      ? await Promise.all([
          supabase.from("leagues").select("id, name").eq("id", seasonId).maybeSingle(),
          supabase
            .from("teams")
            .select("*, division:divisions(name)")
            .eq("league_id", seasonId)
            .order("name", { ascending: true }),
          supabase
            .from("divisions")
            .select("id, name, league_id")
            .eq("league_id", seasonId)
            .order("name", { ascending: true }),
        ])
      : [{ data: null }, { data: [] }, { data: [] }];

  const season = (rawSeason as { id: string; name: string } | null) ?? null;
  const teams = (rawTeams as TeamWithDivision[] | null) ?? [];
  // The add-team dropdown is locked to the selected season.
  const leagues = season ? [{ id: season.id, name: season.name }] : [];
  const divisions =
    (rawDivisions as { id: string; name: string; league_id: string }[] | null) ??
    [];

  const [plan, teamCount] = await Promise.all([
    getOrgPlan(currentOrgId),
    getTeamCountForOrg(supabase, currentOrgId),
  ]);
  const teamLimit = PLAN_LIMITS[plan].teamsPerOrg;

  // Empty-state /setup link (Chunk 4): own-org owners mid-setup only;
  // derived lazily so the check runs only when the empty state renders.
  const showSetupLink =
    teams.length === 0 &&
    currentOrgId === user!.id &&
    (await isSetupIncomplete(supabase, currentOrgId, seasonId));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
          <p className="mt-1 text-sm text-gray-500">
            {season ? `Teams in ${season.name}.` : "No active season."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isUnlimited(teamLimit) ? (
            <p className="text-xs text-gray-500">
              {/* Free's team cap is org-wide (6); the only finite value is
                  never 1, so the noun is always plural here. */}
              {teamCount} of {teamLimit} teams ·{" "}
              <span className="font-medium text-gray-700">{planLabel(plan)} plan</span>
            </p>
          ) : null}
          <AddTeamButton
            leagues={leagues}
            divisions={divisions}
            teamCount={teamCount}
            teamLimit={teamLimit}
            plan={plan}
          />
        </div>
      </div>

      {/* Team scheduling constraints (0076) — relocated here from the Schedule
          page and tucked behind a default-closed disclosure, placed ABOVE the
          team list so a large roster can't bury it (the same burial that
          motivated moving it off the bottom of the Schedule page). Collapsed by
          default, so it costs only the header bar's height. Elite-gated ENTRY
          UI only; the generator honors existing rows tier-blind, so a downgrade
          hides this section but the constraints stay live (deliberate — the
          officials pattern; see CLAUDE.md "Team game constraints"). The gate
          stays server-side: the collapsible header shows for everyone, and
          expanding reveals the section for Elite or the locked card otherwise. */}
      {seasonId && (
        <TeamConstraintsCollapsible>
          {isElite(plan) ? (
            <TeamConstraintsSection
              divisions={divisions}
              teams={teams
                .filter((t) => !!t.division_id)
                .map((t) => ({
                  id: t.id,
                  name: t.name,
                  division_id: t.division_id as string,
                }))}
            />
          ) : (
            <FeatureLockedCard
              feature="Team scheduling constraints"
              tier="Elite"
            />
          )}
        </TeamConstraintsCollapsible>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Teams</CardTitle>
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Users className="mb-3 h-8 w-8 text-gray-300" />
              <p className="font-medium text-gray-900">No teams yet</p>
              <p className="mt-1 text-sm text-gray-500">
                Add teams to this season to get started.
              </p>
              {showSetupLink && <FinishSetupLink className="mt-3" />}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="pb-3 font-medium text-gray-500">Team</th>
                    {/* Season column dropped — the page is scoped to one
                        season, so it carried the same value on every row. */}
                    <th className="pb-3 font-medium text-gray-500">Division</th>
                    <th className="pb-3 font-medium text-gray-500" />
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 font-medium text-gray-900">{team.name}</td>
                      <td className="py-3 text-gray-600">{team.division?.name ?? "—"}</td>
                      <td className="py-2 text-right">
                        {/* Snack Shack is Elite-only — hide the per-team
                            email/print entry point for non-Elite tiers. */}
                        {isElite(plan) && (
                          <TeamSnackShackButton teamId={team.id} teamName={team.name} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

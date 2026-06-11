import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Layers } from "lucide-react";
import { DivisionBallIcon } from "@/components/divisions/division-ball-icon";
import { AddDivisionButton } from "@/components/divisions/add-division-button";
import type { Division, League } from "@/types/database";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { PLAN_LIMITS, isUnlimited } from "@/lib/plan/limits";
import { planLabel } from "@/lib/plan/labels";
import { getDivisionCount, getTeamCountForOrg } from "@/lib/plan/counts";
import { isSetupIncomplete } from "@/lib/setup/derive-step";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";

type LeagueRow = Pick<League, "id" | "name" | "sport"> & {
  start_date: string | null;
  end_date: string | null;
};

type DivisionWithLeague = Division & { league: LeagueRow };

const STATUS_STYLES: Record<Division["status"], string> = {
  active:   "bg-[#22C55E]/10 text-[#22C55E]",
  draft:    "bg-gray-100 text-gray-500",
  archived: "bg-gray-100 text-gray-400",
};

export default async function DivisionsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Season-scoped: only the selected season's divisions (Chunk B1). A null
  // season (org has no active seasons) flows to the existing empty state.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);

  const { data: rawLeague } = seasonId
    ? await supabase
        .from("leagues")
        .select("id, name, sport, start_date, end_date")
        .eq("id", seasonId)
        .maybeSingle()
    : { data: null };
  const league = (rawLeague as LeagueRow | null) ?? null;

  const { data: rawDivisions } = seasonId
    ? await supabase
        .from("divisions")
        .select("*")
        .eq("league_id", seasonId)
        .order("created_at", { ascending: true })
    : { data: [] };

  const divisions = (rawDivisions ?? []) as Division[];
  const divisionsWithLeague: DivisionWithLeague[] = league
    ? divisions.map((div) => ({ ...div, league }))
    : [];

  const hasAny = divisionsWithLeague.length > 0;

  const [plan, divisionCount, teamCount] = await Promise.all([
    getOrgPlan(currentOrgId),
    getDivisionCount(supabase, currentOrgId),
    getTeamCountForOrg(supabase, currentOrgId),
  ]);
  const divisionLimit = PLAN_LIMITS[plan].divisions;
  const teamLimit = PLAN_LIMITS[plan].teamsPerOrg;

  // Empty-state /setup link (Chunk 4): own-org owners mid-setup only;
  // derived lazily so the check runs only when the empty state renders.
  const showSetupLink =
    !hasAny &&
    currentOrgId === user!.id &&
    (await isSetupIncomplete(supabase, currentOrgId, seasonId));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">Divisions</h1>
          <p className="mt-1 text-sm text-gray-500">
            {league ? `Divisions in ${league.name}.` : "No active season."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isUnlimited(divisionLimit) ? (
            <p className="text-xs text-gray-500">
              {divisionCount} of {divisionLimit}{" "}
              {divisionLimit === 1 ? "division" : "divisions"} ·{" "}
              <span className="font-medium text-gray-700">{planLabel(plan)} plan</span>
            </p>
          ) : null}
          <AddDivisionButton
            leagues={
              league
                ? [
                    {
                      id: league.id,
                      name: league.name,
                      sport: league.sport,
                      start_date: league.start_date,
                      end_date: league.end_date,
                    },
                  ]
                : []
            }
            currentOrgId={currentOrgId}
            divisionCount={divisionCount}
            divisionLimit={divisionLimit}
            teamCount={teamCount}
            teamLimit={teamLimit}
            plan={plan}
          />
        </div>
      </div>

      {!hasAny ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Layers className="mb-4 h-10 w-10 text-gray-300" />
            <h3 className="font-semibold text-gray-900">No divisions yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Create a season and add divisions to get started.
            </p>
            {showSetupLink && <FinishSetupLink className="mt-3" />}
          </CardContent>
        </Card>
      ) : (
        // Single-season view (Chunk B1) — the old grouped-by-season layer is
        // gone; one header for the selected season, then its divisions.
        <section>
          {league && (
            <div className="mb-3 flex items-center gap-2">
              <Link
                href={`/dashboard/leagues/${league.id}`}
                className="text-sm font-semibold text-[#0C1F3F] hover:underline"
              >
                {league.name}
              </Link>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {league.sport}
              </span>
              <span className="text-xs text-gray-400">
                {divisionsWithLeague.length} division
                {divisionsWithLeague.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            {divisionsWithLeague.map((div, idx) => (
              <div
                key={div.id}
                className="flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0"
              >
                <DivisionBallIcon
                  sport={div.league.sport}
                  index={idx}
                  containerClassName="h-8 w-8 rounded-md"
                  iconClassName="h-3.5 w-3.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{div.name}</p>
                  <p className="text-xs text-gray-400">{div.team_count} teams</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[div.status]}`}
                >
                  {div.status}
                </span>
                <Link
                  href={`/dashboard/leagues/${div.league.id}`}
                  className="text-xs text-gray-400 hover:text-[#0C1F3F]"
                >
                  View →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

"use client";

import { DivisionSection } from "@/components/divisions/division-section";
import type { DivisionStat } from "@/app/(dashboard)/dashboard/leagues/[id]/page";
import type { Plan } from "@/lib/plan/limits";

interface Props {
  leagueId: string;
  leagueName: string;
  leagueSport: string;
  divisionStats: DivisionStat[];
  currentOrgId: string;
  teamCount: number;
  teamLimit: number;
  plan: Plan;
}

export function LeagueContent({
  leagueId,
  leagueName,
  leagueSport,
  divisionStats,
  currentOrgId,
  teamCount,
  teamLimit,
  plan,
}: Props) {
  return (
    <DivisionSection
      leagueId={leagueId}
      leagueName={leagueName}
      leagueSport={leagueSport}
      divisionStats={divisionStats}
      currentOrgId={currentOrgId}
      teamCount={teamCount}
      teamLimit={teamLimit}
      plan={plan}
    />
  );
}

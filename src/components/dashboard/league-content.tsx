"use client";

import { DivisionSection } from "@/components/divisions/division-section";
import type { DivisionStat } from "@/app/(dashboard)/dashboard/leagues/[id]/page";

interface Props {
  leagueId: string;
  leagueName: string;
  leagueSport: string;
  divisionStats: DivisionStat[];
  currentOrgId: string;
}

export function LeagueContent({ leagueId, leagueName, leagueSport, divisionStats, currentOrgId }: Props) {
  return (
    <DivisionSection
      leagueId={leagueId}
      leagueName={leagueName}
      leagueSport={leagueSport}
      divisionStats={divisionStats}
      currentOrgId={currentOrgId}
    />
  );
}

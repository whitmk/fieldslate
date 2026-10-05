"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

interface Props {
  teams: { id: string; name: string; division_id: string | null }[];
  selectedId: string;
  selectedDivisionId: string;
}

export function TeamFilter({ teams, selectedId, selectedDivisionId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const visibleTeams = useMemo(() => {
    if (!selectedDivisionId) return teams;
    return teams.filter((t) => t.division_id === selectedDivisionId);
  }, [teams, selectedDivisionId]);

  return (
    <select
      value={selectedId}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value) params.set("team", e.target.value);
        else params.delete("team");
        const qs = params.toString();
        router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
      }}
      className="h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-base text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 sm:w-auto sm:text-sm"
    >
      <option value="">All teams</option>
      {visibleTeams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

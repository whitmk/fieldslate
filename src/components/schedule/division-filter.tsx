"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Props {
  divisions: { id: string; name: string }[];
  selectedId: string;
}

export function DivisionFilter({ divisions, selectedId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      value={selectedId}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value) params.set("division", e.target.value);
        else params.delete("division");
        // Reset the team filter when the division changes — the previously
        // selected team may not belong to the new division.
        params.delete("team");
        const qs = params.toString();
        router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
      }}
      className="h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-base text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 sm:w-auto sm:text-sm"
    >
      <option value="">All divisions</option>
      {divisions.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

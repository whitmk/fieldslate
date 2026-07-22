"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Props {
  venues: { id: string; name: string }[];
  selectedId: string;
}

export function VenueFilter({ venues, selectedId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      value={selectedId}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value) params.set("venue", e.target.value);
        else params.delete("venue");
        const qs = params.toString();
        router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
      }}
      className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
    >
      <option value="">All venues</option>
      {venues.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { LocationOption } from "@/lib/schedule/location-filter";

interface Props {
  locations: LocationOption[];
  selectedId: string;
}

export function LocationFilter({ locations, selectedId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      value={selectedId}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value) params.set("location", e.target.value);
        else params.delete("location");
        // Reset the venue filter when the location changes — the previously
        // selected venue may not belong to the new location.
        params.delete("venue");
        const qs = params.toString();
        router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
      }}
      className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
    >
      <option value="">All locations</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}

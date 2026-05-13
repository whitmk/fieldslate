"use client";

import { useRouter } from "next/navigation";

interface Props {
  divisions: { id: string; name: string }[];
  selectedId: string;
}

export function DivisionFilter({ divisions, selectedId }: Props) {
  const router = useRouter();

  return (
    <select
      value={selectedId}
      onChange={(e) => {
        const val = e.target.value;
        router.push(val ? `/dashboard/schedule?division=${val}` : "/dashboard/schedule");
      }}
      className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
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

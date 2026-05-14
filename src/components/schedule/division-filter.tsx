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
        const params = new URLSearchParams();
        const view = searchParams.get("view");
        if (view) params.set("view", view);
        if (e.target.value) params.set("division", e.target.value);
        const qs = params.toString();
        router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
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

"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export type SeasonOption = {
  id: string;
  name: string;
  season: string | null;
  status: string;
};

interface Props {
  /** All seasons the org has, already sorted (most recent first). */
  seasons: SeasonOption[];
  /** "all" or a season id. */
  selectedValue: string;
}

function seasonLabel(s: SeasonOption): string {
  return s.season ? `${s.name} · ${s.season}` : s.name;
}

export function SeasonSelector({ seasons, selectedValue }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next) {
      params.delete("season");
    } else {
      params.set("season", next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="overview-season" className="text-sm text-gray-500">
        Season
      </label>
      <select
        id="overview-season"
        value={selectedValue}
        onChange={(e) => handleChange(e.target.value)}
        className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
      >
        <option value="all">All seasons</option>
        {seasons.map((s) => (
          <option key={s.id} value={s.id}>
            {seasonLabel(s)}
            {s.status !== "active" ? ` (${s.status})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

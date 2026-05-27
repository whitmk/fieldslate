"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export type SeasonOption = {
  id: string;
  name: string;
  season: string | null;
  status: string;
  /** Source of truth for the archived/active filter. */
  archivedAt: string | null;
};

interface Props {
  /** All seasons the org has, already sorted (most recent first). */
  seasons: SeasonOption[];
  /** "all" or a season id. */
  selectedValue: string;
  /** Whether archived seasons are currently visible in the dropdown. */
  showArchived: boolean;
}

function seasonLabel(s: SeasonOption): string {
  return s.season ? `${s.name} · ${s.season}` : s.name;
}

export function SeasonSelector({ seasons, selectedValue, showArchived }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleSeasonChange(next: string) {
    setParam("season", next ? next : null);
  }

  function handleToggleArchived(next: boolean) {
    // Always toggle showArchived; also clear the season selection if the
    // currently-selected one is about to disappear from the dropdown.
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("showArchived", "1");
    else params.delete("showArchived");

    if (!next && selectedValue !== "all") {
      const sel = seasons.find((s) => s.id === selectedValue);
      if (sel?.archivedAt) {
        params.delete("season"); // selected season will vanish — reset
      }
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // Filter + group: active first; archived only when toggle is on, with a
  // disabled "Archived" group separator and an "[Archived]" suffix on each
  // option for unambiguous identification.
  const activeSeasons = seasons.filter((s) => !s.archivedAt);
  const archivedSeasons = showArchived
    ? seasons.filter((s) => !!s.archivedAt)
    : [];

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <label htmlFor="overview-season" className="text-sm text-gray-500">
          Season
        </label>
        <select
          id="overview-season"
          value={selectedValue}
          onChange={(e) => handleSeasonChange(e.target.value)}
          className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        >
          <option value="all">All seasons</option>
          {activeSeasons.map((s) => (
            <option key={s.id} value={s.id}>
              {seasonLabel(s)}
              {s.status !== "active" ? ` (${s.status})` : ""}
            </option>
          ))}
          {archivedSeasons.length > 0 && (
            <optgroup label="Archived">
              {archivedSeasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {seasonLabel(s)} [Archived]
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 select-none">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => handleToggleArchived(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-[#22C55E] focus:ring-[#22C55E]/30"
        />
        Show archived
      </label>
    </div>
  );
}

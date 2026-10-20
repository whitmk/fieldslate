"use client";

import type { GamesPerDay } from "../playoff-wizard-types";

/** "Games per team per day" — 1 or 2. Used by the plain round robin's Dates
 *  step and both panels of a two-stage setup. */
export function GamesPerDayControl({
  value,
  onChange,
  hint,
}: {
  value: GamesPerDay;
  onChange: (v: GamesPerDay) => void;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-gray-700">Games per team per day</span>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Games per team per day">
        {([1, 2] as const).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={`h-9 min-w-10 rounded-lg border px-3 text-sm font-semibold transition-colors ${
              value === n
                ? "border-[#0C1F3F] bg-[#0C1F3F] text-white"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400">{hint}</p>
    </div>
  );
}

export const RR_PER_DAY_HINT =
  "No team plays more than this many games in one day. Games that don't fit stay undated, and Review says so.";
export const STAGE2_PER_DAY_HINT = "With 1, each bracket round is on its own day.";

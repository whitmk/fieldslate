"use client";

// "Games in each round" — a 1 / 3 / 5 / 7 choice per round of a single
// elimination (approved mockup docs/mockups/playoff-series.html, screen 1).
// Every sentence comes from series.ts, rendered VERBATIM. Used by the plain
// Dates step and Stage 2 of a two-stage setup.

import { SERIES_LENGTHS, seriesLengthFor, type SeriesByRound, type SeriesLength } from "@/lib/playoffs/series-lengths";
import { roundLengthHelp, seriesSetupNote, wizardRounds } from "@/lib/playoffs/series";

export function SeriesLengthsControl({
  teamCount,
  value,
  onChange,
}: {
  /** Teams in the bracket (Stage 2: the advancing count). */
  teamCount: number;
  value: SeriesByRound;
  onChange: (next: SeriesByRound) => void;
}) {
  const rounds = wizardRounds(teamCount);
  if (!rounds.length) return null;
  const note = seriesSetupNote(rounds, value);

  function set(label: string, n: SeriesLength) {
    const next: SeriesByRound = { ...value };
    if (n === 1) delete next[label];
    else next[label] = n;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-gray-700">Games in each round</span>
      <div className="flex flex-col gap-2">
        {rounds.map((r) => {
          const current = seriesLengthFor(value, r.label);
          return (
            <div key={r.label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-28 flex-none text-sm font-semibold text-[#0C1F3F]">{r.title}</span>
              <div className="flex gap-1" role="radiogroup" aria-label={`Games in ${r.title}`}>
                {SERIES_LENGTHS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={current === n}
                    onClick={() => set(r.label, n)}
                    className={`h-9 min-w-10 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                      current === n
                        ? "border-[#0C1F3F] bg-[#0C1F3F] text-white"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="min-w-0 basis-full text-xs text-gray-500 sm:basis-auto sm:flex-1">
                {roundLengthHelp(current, r.matchups)}
              </span>
            </div>
          );
        })}
      </div>
      {note && (
        <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">{note}</p>
      )}
    </div>
  );
}

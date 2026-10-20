"use client";

// Review (approved mockup docs/mockups/playoff-series.html, screen 2): one line
// per round — "Best of 3 · Sun 11/15, Sat 11/21, Sun 11/22 (if needed)" — the
// games line, and every game left without a date, named. Rendered only when
// the plan has a series round; a bracket of single games keeps today's Review.
// Every sentence comes from series.ts, VERBATIM.

import { AlertTriangle } from "lucide-react";
import { isSeriesRound } from "@/lib/playoffs/series-names";
import { seriesGamesReviewLine, seriesReviewRows, undatedSeriesGamesLine } from "@/lib/playoffs/series";

type PlannedGame = { round: string; game_number: number; series_game?: number; scheduled_date: string | null };

export function hasSeriesRound(games: ReadonlyArray<PlannedGame>): boolean {
  return games.some((g) => isSeriesRound(g.round, games));
}

export function SeriesReview({ games, title }: { games: ReadonlyArray<PlannedGame>; title?: string }) {
  if (!hasSeriesRound(games)) return null;
  const rows = seriesReviewRows(games);
  const undated = undatedSeriesGamesLine(games);
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-gray-100 px-4 py-2">
        {title && <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>}
        <dl className="divide-y divide-gray-50">
          {rows.map((r) => (
            <div key={r.title} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
              <dt className="w-28 flex-none text-sm text-gray-500">{r.title}</dt>
              <dd className="text-sm text-gray-900">{r.text}</dd>
            </div>
          ))}
          <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
            <dt className="w-28 flex-none text-sm text-gray-500">Games</dt>
            <dd className="text-sm text-gray-900">{seriesGamesReviewLine(games)}</dd>
          </div>
        </dl>
      </div>
      {undated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <p>{undated}</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DAY_KEYS, DAY_LABELS } from "@/lib/venues/availability";
import { GameDetailModal } from "@/components/umpires/game-detail-modal";
import type { ScheduleGame } from "./schedule-list";
import {
  blockMarkers,
  bucketWeekGames,
  buildWeekRows,
  cellKey,
  countAwayGamesInWeek,
  currentWeekStartLocal,
  fmtTimeRange,
  shiftWeek,
  weekDates,
  weekLabel,
  visibleBlocks,
  weekMatchupLabel,
  type WeekVenueInput,
} from "@/lib/schedule/week-grid";

interface Props {
  games: ScheduleGame[];
  /** Monday of the displayed week, or NULL when `?week=` was absent/malformed.
   *  Null is resolved HERE, in the browser — see the effect below. */
  weekStart: string | null;
  /** Venues flagged `division_venues.allow_games` for a division in this
   *  season. Unioned with venues carrying games in the week. */
  eligibleVenues: WeekVenueInput[];
  /** Set when `?division=` narrows the games — used to say so under the grid,
   *  because an empty cell would otherwise read as "this field is free". */
  divisionFilterName?: string | null;
}

export function ScheduleWeekGrid({
  games,
  weekStart,
  eligibleVenues,
  divisionFilterName = null,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Local state, NOT a URL param — deliberately. `?past=` is a URL param
  // because it changes the QUERY; every status is already fetched here, so this
  // is pure display. It also makes the blocks-only rule structural: rows are
  // derived from the UNFILTERED game list, so no toggle state can restructure
  // the grid. Default ON.
  const [showCancelled, setShowCancelled] = useState(true);
  const [detailGame, setDetailGame] = useState<ScheduleGame | null>(null);

  // WHICH WEEK IS "NOW" IS A CLIENT QUESTION. The server's clock is UTC, so
  // defaulting the week there would show next week from roughly 4pm local
  // onward for a US league — the same latent bug the page's `todayLocalDateString`
  // already has, which this view must not inherit. So the server renders
  // whatever `?week=` says and NEVER invents one; when it is absent we resolve
  // it from the browser and rewrite the URL. `replace`, not `push`, so the
  // param-less URL does not become a back-button stop.
  useEffect(() => {
    if (weekStart) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", "week");
    params.set("week", currentWeekStartLocal());
    router.replace(`/dashboard/schedule?${params.toString()}`);
  }, [weekStart, router, searchParams]);

  function navigateWeek(delta: number) {
    if (!weekStart) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("week", shiftWeek(weekStart, delta));
    router.push(`/dashboard/schedule?${params.toString()}`);
  }

  function goToThisWeek() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("week", currentWeekStartLocal());
    router.push(`/dashboard/schedule?${params.toString()}`);
  }

  if (!weekStart) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">Loading week…</p>
    );
  }

  // Rows come from the UNFILTERED game list so the "Show cancelled" toggle can
  // never remove a row — see the toggle's own note. A field whose only game
  // this week is cancelled keeps its row, empty, when the toggle is off.
  const rows = buildWeekRows(eligibleVenues, games);
  const byCell = bucketWeekGames(games, weekStart);
  const dates = weekDates(weekStart);
  const awayCount = countAwayGamesInWeek(games, weekStart);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigateWeek(-1)}
            aria-label="Previous week"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[11rem] text-center text-sm font-semibold text-gray-900">
            {weekLabel(weekStart)}
          </span>
          <button
            type="button"
            onClick={() => navigateWeek(1)}
            aria-label="Next week"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToThisWeek}
            className="ml-2 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            This week
          </button>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <span className="text-gray-500">Show cancelled</span>
          <button
            type="button"
            role="switch"
            aria-checked={showCancelled}
            onClick={() => setShowCancelled((v) => !v)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
              showCancelled ? "bg-[#22C55E]" : "bg-gray-200"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                showCancelled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          No game-eligible fields in this season yet.
        </p>
      ) : (
        /* Wide content scrolls inside its own container so the page body never
           scrolls horizontally. */
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-40 border-b border-gray-200 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Field
                </th>
                {DAY_KEYS.map((day, i) => (
                  <th
                    key={day}
                    className="border-b border-l border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-500"
                  >
                    {DAY_LABELS[day]}{" "}
                    <span className="font-normal text-gray-400">
                      {dates[i].substring(8)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.venueId} className="align-top">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900"
                  >
                    {/* BARE short name, never qualifiedVenueLabel: one live
                        location is named identically to its own venue, which
                        would render the name twice on every row. */}
                    {row.name}
                    {row.locationName && (
                      <span className="mt-0.5 block text-xs font-normal text-gray-400">
                        {row.locationName}
                      </span>
                    )}
                  </th>
                  {DAY_KEYS.map((day) => {
                    const cell = byCell.get(cellKey(row.venueId, day)) ?? [];
                    // Hides BLOCKS, never rows — `rows` above is built from the
                    // unfiltered list and never sees this flag.
                    const visible = visibleBlocks(cell, showCancelled);
                    return (
                      <td
                        key={day}
                        className="border-b border-l border-gray-200 px-2 py-2"
                      >
                        {visible.length === 0 ? (
                          <span className="text-xs text-gray-300">—</span>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {visible.map((g) => (
                              <GameBlock
                                key={g.id}
                                game={g}
                                onOpen={() => setDetailGame(g)}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs text-gray-500">
        {/* Load-bearing, not decoration: without it a blank Wednesday reads as
            "this field is free" and an admin books a game over a practice. */}
        <p>Games only — practices aren&apos;t shown here.</p>
        {awayCount > 0 && (
          <p>
            {awayCount} away {awayCount === 1 ? "game" : "games"} this week{" "}
            {awayCount === 1 ? "is" : "are"} not shown — away games are played at
            the other league&apos;s field.
          </p>
        )}
        {divisionFilterName && (
          <p>
            Filtered to {divisionFilterName} — other divisions&apos; games at
            these fields aren&apos;t shown, so an empty cell doesn&apos;t mean
            the field is free.
          </p>
        )}
      </div>

      {detailGame && (
        <GameDetailModal game={detailGame} onClose={() => setDetailGame(null)} />
      )}
    </div>
  );
}

// ── Game block ───────────────────────────────────────────────────────────────

function GameBlock({
  game,
  onOpen,
}: {
  game: ScheduleGame;
  onOpen: () => void;
}) {
  // Markers come from the shared helper so the harness counts exactly what this
  // renders — see blockMarkers for why pending games appear at all.
  const { cancelled, pending, interleague } = blockMarkers(game);
  const divisionName = game.home_team?.division?.name ?? null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
        cancelled
          ? "border-gray-200 bg-gray-50 text-gray-400"
          : pending
            ? "border-amber-200 bg-amber-50 hover:bg-amber-100"
            : "border-gray-200 bg-white hover:bg-gray-50"
      }`}
    >
      <div
        className={`text-xs font-semibold ${
          cancelled ? "text-gray-400 line-through" : "text-gray-900"
        }`}
      >
        {fmtTimeRange(game.scheduled_at, game.durationMin)}
      </div>
      <div
        className={`text-xs ${
          cancelled ? "text-gray-400 line-through" : "text-gray-700"
        }`}
      >
        {weekMatchupLabel(game)}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-400">
        {divisionName ?? "No division"}
        {interleague && " · interleague"}
        {pending && " · pending interleague"}
        {cancelled && " · cancelled"}
      </div>
    </button>
  );
}

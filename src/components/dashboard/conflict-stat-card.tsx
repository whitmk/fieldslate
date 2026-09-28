"use client";

import { useState, useEffect, useMemo } from "react";
import {
  AlertCircle, X, CalendarClock, CalendarDays, MapPin, Layers, CalendarX,
} from "lucide-react";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { useScheduleReschedule } from "@/components/schedule/use-schedule-reschedule";
import { MoveNoticeLine } from "@/components/divisions/move-game-row";
import {
  rescheduleItemLockTitle,
  rescheduleItemVisible,
} from "@/lib/schedule/schedule-page-reschedule-route";

export type ConflictPeer = {
  id: string;
  scheduled_at: string;
  home_team_name: string;
  away_team_name: string;
  division_id: string | null;
};

export type ConflictGame = {
  id: string;
  status: string;
  scheduled_at: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string | null;
  venue_id: string | null;
  interleague_org_id: string | null;
  interleague_org: { name: string } | null;
  is_away: boolean | null;
  external_team_name: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string; division_id: string | null; division: { name: string } | null } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
  conflictType: "schedule" | "blackout";
  blackoutLabel: string | null;
  conflictsWith: ConflictPeer[];
};

interface Props {
  initialConflictGames: ConflictGame[];
  leagueId: string;
  divisionNames: Record<string, string>;
  /** Pro+ — the plain move on an ordinary game. This card had NO plan gate
   *  before 2026-09-28; it is the surface that fit both live incidents. */
  canReschedule?: boolean;
  /** Divisions locked as of this page load. */
  lockedDivisionIds?: string[];
}

export function ConflictStatCard({
  initialConflictGames,
  leagueId,
  divisionNames,
  canReschedule = false,
  lockedDivisionIds = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<ConflictGame[]>(initialConflictGames);
  const lockedSet = useMemo(() => new Set(lockedDivisionIds), [lockedDivisionIds]);
  // Routed per game (move picker / makeup request / upsell / refusal) —
  // this card used to open the picker on ANY non-rained-out status.
  const reschedule = useScheduleReschedule({
    canReschedule,
    lockedDivisionIds: lockedSet,
    logSource: "conflict card",
    buildLogMessage: (game, { newScheduledAt }) =>
      (game as ConflictGame).conflictType === "blackout"
        ? `${game.home_team?.name ?? "Home"} vs ${game.away_team?.name ?? "Away"} rescheduled from ${fmtGameDate(game.scheduled_at)} to ${fmtGameDate(newScheduledAt)} — was on blackout date`
        : `${game.home_team?.name ?? "Home"} vs ${game.away_team?.name ?? "Away"} rescheduled to ${fmtGameDate(newScheduledAt)}`,
  });
  void leagueId; // routing carries each game's own league_id now

  // Sync when server re-renders after router.refresh()
  useEffect(() => { setGames(initialConflictGames); }, [initialConflictGames]);

  const active = games.length > 0;

  return (
    <>
      {/* ── Stat card ── */}
      <button
        onClick={() => active && setOpen(true)}
        className={`w-full rounded-xl border bg-white p-5 shadow-sm text-left transition-shadow ${
          active ? "border-red-200 cursor-pointer hover:shadow-md" : "border-gray-100 cursor-default"
        }`}
      >
        <div className="flex items-center justify-between">
          <p className={`text-sm font-medium ${active ? "text-red-500" : "text-gray-500"}`}>Conflicts</p>
          <AlertCircle className={`h-4 w-4 ${active ? "text-red-300" : "text-gray-300"}`} />
        </div>
        <p className={`mt-2 text-3xl font-bold ${active ? "text-red-600" : "text-[#0C1F3F]"}`}>{games.length}</p>
        {active && <p className="mt-1 text-xs font-medium text-red-400">View →</p>}
      </button>

      {/* ── Modal ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-[85dvh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <h2 className="font-semibold text-[#0C1F3F]">Schedule Conflicts</h2>
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-500">
                  {games.length}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {games.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#22C55E]/10">
                    <AlertCircle className="h-6 w-6 text-[#22C55E]" />
                  </div>
                  <p className="font-medium text-[#0C1F3F]">All conflicts resolved</p>
                  <p className="text-sm text-gray-400">No scheduling conflicts remaining.</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {games.map((game) => {
                    const divId = game.home_team?.division_id ?? "";
                    const divisionName = divId ? divisionNames[divId] : null;
                    return (
                      <li key={game.id} className="px-6 py-4">
                        {/* Meta */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {fmtGameDate(game.scheduled_at)}
                          </span>
                          <span>{fmtGameTime(game.scheduled_at)}</span>
                          {game.venue?.name && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {game.venue.name}
                            </span>
                          )}
                          {divisionName && (
                            <span className="flex items-center gap-1">
                              <Layers className="h-3 w-3" />
                              {divisionName}
                            </span>
                          )}
                        </div>

                        {/* Matchup */}
                        <p className="mt-1.5 text-sm font-semibold text-[#0C1F3F]">
                          {game.home_team?.name ?? "TBD"}
                          <span className="mx-1.5 font-normal text-gray-400">vs</span>
                          {game.away_team?.name ?? "TBD"}
                        </p>

                        {/* Reason badge */}
                        <div className="mt-1.5">
                          {game.conflictType === "blackout" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                              <CalendarX className="h-3 w-3" />
                              Blackout date{game.blackoutLabel ? ` — ${game.blackoutLabel}` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-500">
                              <AlertCircle className="h-3 w-3" />
                              Double-booked field
                            </span>
                          )}
                        </div>

                        {/* Conflicting siblings */}
                        {game.conflictType === "schedule" && game.conflictsWith.length > 0 && (
                          <div className="mt-1.5 ml-0.5 text-xs text-red-600">
                            <span className="font-medium">Conflicts with:</span>
                            <ul className="mt-0.5 ml-3 list-disc space-y-0.5 text-red-500/90 marker:text-red-300">
                              {game.conflictsWith.map((peer) => {
                                const peerDivision = peer.division_id ? divisionNames[peer.division_id] : null;
                                const venueName = game.venue?.name;
                                const meta = [peerDivision, venueName, fmtGameTime(peer.scheduled_at)]
                                  .filter(Boolean)
                                  .join(", ");
                                return (
                                  <li key={peer.id}>
                                    {peer.home_team_name} vs {peer.away_team_name}
                                    {meta && <span className="text-red-400"> ({meta})</span>}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}

                        {reschedule.notice?.gameId === game.id && (
                          <div className="mt-2">
                            <MoveNoticeLine
                              message={reschedule.notice.message}
                              link={reschedule.notice.link}
                              onDismiss={reschedule.clearNotice}
                              inset="mx-0"
                            />
                          </div>
                        )}

                        {/* Action */}
                        {rescheduleItemVisible(game.status, canReschedule, !!game.interleague_org_id) && (() => {
                          const lockTitle = rescheduleItemLockTitle(
                            game,
                            !!game.home_team?.division_id && lockedSet.has(game.home_team.division_id),
                            game.home_team?.division?.name ?? "This division",
                          );
                          return (
                        <div className="mt-3">
                          <button
                            onClick={() => reschedule.open(game)}
                            disabled={!!lockTitle}
                            title={lockTitle ?? undefined}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <CalendarClock className="h-3 w-3" />
                            {game.interleague_org_id ? "Request new time" : "Reschedule"}
                          </button>
                        </div>
                          );
                        })()}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {reschedule.modals}
    </>
  );
}

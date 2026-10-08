"use client";

// What else is on ONE field and on the game's teams on ONE date — the reads
// behind the "anything it steps on" notices. Shared by the move picker's
// manual path (manual-move-form.tsx) and "Record where it was played"
// (record-played-modal.tsx), so both list the same bookings for the same day.
// Lifted verbatim from manual-move-form.tsx (2026-10-08); behaviour unchanged.
//
// DATE-bounded, never league-bounded: another season's game at the same field
// on the same date genuinely occupies it (see occupancyWindow). One field on
// one day, and the teams on one day — bounded far below PostgREST's 1000-row
// cap, so plain reads with their errors checked. `null` = that read FAILED
// (the caller says "couldn't check", never all-clear); `undefined` = not
// loaded yet for this (date, field).

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  durationFromSettings,
  occupancyWindow,
  toMins,
} from "@/lib/schedule/reschedule-slots";
import type { ManualBookedGame, ManualTeamGame } from "@/lib/schedule/manual-move";

type DayGameRow = {
  id: string;
  scheduled_at: string;
  venue_id: string | null;
  home_team_id: string;
  away_team_id: string | null;
  external_team_name: string | null;
  home_team: { name: string; division: { name: string; settings: unknown } | null } | null;
  away_team: { name: string } | null;
  interleague_org: { name: string } | null;
  venue: { name: string } | null;
};

const DAY_GAME_SELECT =
  "id, scheduled_at, venue_id, home_team_id, away_team_id, external_team_name, " +
  "home_team:teams!home_team_id(name, division:divisions(name, settings)), " +
  "away_team:teams!away_team_id(name), " +
  "interleague_org:interleague_orgs!interleague_org_id(name), " +
  "venue:venues(name)";

function opponentOf(g: DayGameRow): string {
  return (
    g.away_team?.name ??
    g.external_team_name ??
    g.interleague_org?.name ??
    "TBD"
  );
}

function spanOf(g: DayGameRow) {
  return {
    startMin: toMins(g.scheduled_at.substring(11, 16)),
    durationMin: durationFromSettings(g.home_team?.division?.settings),
  };
}

export type DayTeam = { id: string; name: string };

export function useDayOccupancy({
  gameId,
  date,
  venueId,
  teams,
}: {
  /** The game being placed — never counted against itself. */
  gameId: string;
  /** "YYYY-MM-DD", or null while the date input is incomplete. */
  date: string | null;
  venueId: string;
  /** The game's teams (a game with no away team passes one). */
  teams: DayTeam[];
}): {
  venueGames: ManualBookedGame[] | null | undefined;
  teamGames: ManualTeamGame[] | null | undefined;
} {
  const [venueGames, setVenueGames] = useState<ManualBookedGame[] | null | undefined>(undefined);
  const [teamGames, setTeamGames] = useState<ManualTeamGame[] | null | undefined>(undefined);
  const teamKey = teams.map((t) => `${t.id}:${t.name}`).join("|");

  useEffect(() => {
    if (!date || !venueId) {
      setVenueGames(undefined);
      setTeamGames(undefined);
      return;
    }
    let stale = false;
    setVenueGames(undefined);
    setTeamGames(undefined);
    const supabase = createClient();
    const win = occupancyWindow(date, date);
    const teamFilter = teams
      .map((t) => `home_team_id.eq.${t.id},away_team_id.eq.${t.id}`)
      .join(",");
    void Promise.all([
      supabase
        .from("games")
        .select(DAY_GAME_SELECT)
        .eq("venue_id", venueId)
        .neq("id", gameId)
        .neq("status", "cancelled")
        .gte("scheduled_at", win.fromIso)
        .lt("scheduled_at", win.toIsoExclusive),
      supabase
        .from("games")
        .select(DAY_GAME_SELECT)
        .or(teamFilter)
        .neq("id", gameId)
        .neq("status", "cancelled")
        .gte("scheduled_at", win.fromIso)
        .lt("scheduled_at", win.toIsoExclusive),
    ]).then(([vq, tq]) => {
      if (stale) return;
      setVenueGames(
        vq.error
          ? null
          : ((vq.data ?? []) as unknown as DayGameRow[]).map((g) => ({
              ...spanOf(g),
              label: `${g.home_team?.division?.name ?? "Game"}: ${g.home_team?.name ?? "TBD"} vs ${opponentOf(g)}`,
            })),
      );
      setTeamGames(
        tq.error
          ? null
          : ((tq.data ?? []) as unknown as DayGameRow[]).flatMap((g) => {
              const ours = teams.filter((t) => t.id === g.home_team_id || t.id === g.away_team_id);
              return ours.map((t) => ({
                ...spanOf(g),
                teamName: t.name,
                label: `${g.home_team?.name ?? "TBD"} vs ${opponentOf(g)}${g.venue?.name ? ` at ${g.venue.name}` : ""}`,
              }));
            }),
      );
    });
    return () => {
      stale = true;
    };
    // teamKey stands in for `teams` (a new array every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, venueId, gameId, teamKey]);

  return { venueGames, teamGames };
}

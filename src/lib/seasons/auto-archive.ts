// Write-on-read auto-archive, run by /dashboard, /dashboard/leagues and
// /dashboard/reports before they read the season list. WHETHER a season
// archives is decided by decideAutoArchive (./archive-decision.ts) — the one
// rule; this file only reads its inputs and writes the result.
//
// Reads, all with the caller's session:
//   1. the org's unarchived seasons that have an end date;
//   2. the org's timezone (profiles.timezone, on the owner's row) → "today";
//   3. for each season whose end date has passed (endDatePassed — the
//      decision's own rule, so seasons still running cost no further reads):
//      every game's date (fetchAllRows — complete or throw) and every playoff
//      game of its brackets;
//   4. ONE call for all of those seasons: volunteer_archive_holds (0121
//      part 4) — which of them hold volunteer data. A failed call (including
//      "function not found" before 0121 is applied) holds them all.
// Any read that fails means NO archive for the seasons it concerns: archiving
// early hides a running season; skipping costs nothing but one more visit.
//
// Before 2026-10-19 this archived any season whose end date was before the
// SERVER's date (UTC on Vercel — the evening of the last day in Pacific
// already counted as past), with no look at games or playoffs.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { todayInTimezone } from "@/lib/utils/org-today";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import {
  decideAutoArchive,
  endDatePassed,
  type PlayoffGameForArchive,
} from "./archive-decision";

type PlayoffRow = {
  scheduled_date: string | null;
  status: string | null;
  winner_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

/** What a visit decided: the seasons archived, and the seasons held back
 *  only because they hold volunteer data (the hold banner's list). */
export type AutoArchiveResult = { archived: string[]; heldForVolunteers: string[] };

const NOTHING: AutoArchiveResult = { archived: [], heldForVolunteers: [] };

export async function autoArchivePastSeasons(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  now: Date = new Date(),
): Promise<AutoArchiveResult> {
  const { data: seasonsRaw, error: seasonsError } = await supabase
    .from("leagues")
    .select("id, end_date")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .not("end_date", "is", null)
    .order("id", { ascending: true });
  if (seasonsError || !seasonsRaw || seasonsRaw.length === 0) return NOTHING;
  const seasons = seasonsRaw as unknown as { id: string; end_date: string }[];

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", ownerId)
    .maybeSingle();
  const tz = (profile as { timezone?: unknown } | null)?.timezone;
  if (profileError || typeof tz !== "string" || !tz) return NOTHING;
  let today: string;
  try {
    today = todayInTimezone(tz, now);
  } catch {
    return NOTHING;
  }

  const past = seasons.filter((s) => endDatePassed(s.end_date, today));
  if (past.length === 0) return NOTHING;

  let holds: string[] | null = null;
  {
    // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
    const { data, error } = await supabase.rpc("volunteer_archive_holds", { p_season_ids: past.map((s) => s.id) });
    const reply: unknown = data;
    if (!error && Array.isArray(reply) && reply.every((x: unknown) => typeof x === "string")) holds = reply as string[];
  }

  const result: AutoArchiveResult = { archived: [], heldForVolunteers: [] };
  for (const season of past) {

    let gameTimes: string[] | null = null;
    try {
      const rows = await fetchAllRows<{ scheduled_at: string }>(`auto-archive games ${season.id}`, ({ from, to, exactCount }) =>
        supabase
          .from("games")
          .select("scheduled_at", exactCount ? { count: "exact" } : undefined)
          .eq("league_id", season.id)
          .order("scheduled_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PagedResult<{ scheduled_at: string }>>,
      );
      gameTimes = rows.map((r) => r.scheduled_at);
    } catch {
      gameTimes = null;
    }

    let playoffGames: PlayoffGameForArchive[] | null = null;
    try {
      const rows = await fetchAllRows<PlayoffRow>(`auto-archive playoff games ${season.id}`, ({ from, to, exactCount }) =>
        supabase
          .from("playoff_games")
          .select("scheduled_date, status, winner_id, home_score, away_score", exactCount ? { count: "exact" } : undefined)
          .eq("league_id", season.id)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PagedResult<PlayoffRow>>,
      );
      playoffGames = rows.map((r) => ({
        scheduledDate: r.scheduled_date,
        status: r.status,
        winnerId: r.winner_id,
        homeScore: r.home_score,
        awayScore: r.away_score,
      }));
    } catch {
      playoffGames = null;
    }

    const volunteerData = holds === null ? null : holds.includes(season.id);
    const decision = decideAutoArchive({ endDate: season.end_date, today, gameTimes, playoffGames, volunteerData });
    if (decision.reason === "volunteer_data") result.heldForVolunteers.push(season.id);
    if (!decision.archive) continue;

    const { error } = await supabase
      .from("leagues")
      .update({ archived_at: now.toISOString(), status: "archived" } as never)
      .eq("id", season.id)
      .is("archived_at", null);
    if (!error) result.archived.push(season.id);
  }
  return result;
}

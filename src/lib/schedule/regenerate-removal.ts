// Which games a regenerate will delete — and so how many official assignments
// go with them — computed BEFORE the admin confirms (2026-11-06).
//
// ONE RULE, NOT A COPY. The pure part below is built ONLY from the generator's
// own predicates — `isProtectedInterleagueGame` and `willBeClearedByRegenerate`
// (generate-schedule.ts), which already mirror the regenerate DELETE. Never
// restate the delete's WHERE clause here. `npm run sim:assignment-loss` runs
// the REAL generateSchedule on the same fixture and requires the games it
// actually deleted to equal `regenerateRemovalIds` exactly.
//
// Display only: a count taken when the confirm opens can be stale by the time
// the admin clicks. The generator's own reads still decide what is deleted.

import { createClient } from "@/lib/supabase/client";
import {
  isProtectedInterleagueGame,
  willBeClearedByRegenerate,
  type GenerateScheduleClient,
} from "./generate-schedule";
import { countAssignmentsOnGames, type AssignmentCount } from "@/lib/umpires/assignment-loss";

export type RegenerateCandidateGame = {
  id: string;
  league_id: string | null;
  home_team_id: string | null;
  status: string | null;
  interleague_org_id: string | null;
  external_team_name: string | null;
  proposed_scheduled_at: string | null;
};

/** True when the generator would even look for a request row on this game. */
export function needsRequestCheck(g: RegenerateCandidateGame): boolean {
  return (
    g.interleague_org_id !== null &&
    (g.status === "pending_interleague" || g.status === "reschedule_pending")
  );
}

/** Ids of the games a regenerate of this division will delete. Pure. */
export function regenerateRemovalIds(
  games: readonly RegenerateCandidateGame[],
  leagueId: string,
  teamIds: ReadonlySet<string>,
  gamesWithRequests: ReadonlySet<string>,
): string[] {
  const teamSet = new Set(teamIds);
  const protectedIds = new Set<string>();
  for (const g of games) {
    if (
      isProtectedInterleagueGame({
        status: g.status,
        interleague_org_id: g.interleague_org_id,
        external_team_name: g.external_team_name,
        proposed_scheduled_at: g.proposed_scheduled_at,
        hasRescheduleRequest: gamesWithRequests.has(g.id),
      })
    ) {
      protectedIds.add(g.id);
    }
  }
  return games
    .filter((g) => willBeClearedByRegenerate(g, leagueId, teamSet, protectedIds))
    .map((g) => g.id);
}

export type RegenerateLoss = { games: string[]; assignments: AssignmentCount } | { failed: true };

/**
 * Reads the same rows the generator reads, then counts. Every read FAILS
 * CLOSED into `{ failed: true }`, which the confirm words as "couldn't count".
 * `client` is for the simulation harnesses ONLY; production callers omit it.
 */
export async function regenerateAssignmentLoss(
  divisionId: string,
  client?: GenerateScheduleClient,
): Promise<RegenerateLoss> {
  const supabase = client ?? createClient();
  const { data: div, error: divErr } = await supabase
    .from("divisions")
    .select("id, league_id")
    .eq("id", divisionId)
    .single();
  if (divErr || !div) return { failed: true };
  const leagueId = (div as { league_id: string }).league_id;

  const { data: teamRows, error: teamErr } = await supabase
    .from("teams")
    .select("id")
    .eq("division_id", divisionId);
  if (teamErr) return { failed: true };
  const teamIds = ((teamRows ?? []) as { id: string }[]).map((t) => t.id);
  if (teamIds.length === 0) return { games: [], assignments: { ok: true, count: 0 } };

  const { data: gameRows, error: gameErr } = await supabase
    .from("games")
    .select(
      "id, league_id, home_team_id, status, interleague_org_id, external_team_name, proposed_scheduled_at",
    )
    .in("home_team_id", teamIds);
  if (gameErr) return { failed: true };
  const games = (gameRows ?? []) as RegenerateCandidateGame[];

  const checkIds = games.filter(needsRequestCheck).map((g) => g.id);
  const gamesWithRequests = new Set<string>();
  if (checkIds.length > 0) {
    const { data: reqRows, error: reqErr } = await supabase
      .from("interleague_reschedule_requests")
      .select("game_id")
      .in("game_id", checkIds);
    if (reqErr) return { failed: true };
    for (const r of (reqRows ?? []) as { game_id: string }[]) gamesWithRequests.add(r.game_id);
  }

  const removed = regenerateRemovalIds(games, leagueId, new Set(teamIds), gamesWithRequests);
  const assignments = await countAssignmentsOnGames(
    supabase as unknown as ReturnType<typeof createClient>,
    removed,
  );
  return { games: removed, assignments };
}

/** The confirm's input for `assignmentLossLine`. */
export function lossCount(loss: RegenerateLoss | null): AssignmentCount | "pending" {
  if (loss === null) return "pending";
  if ("failed" in loss) return { ok: false };
  return loss.assignments;
}

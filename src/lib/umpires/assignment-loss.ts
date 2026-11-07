// "How many official assignments does this destroy?" — the count a confirm
// screen shows before a regenerate or a delete (2026-11-06). Every game delete
// cascades its `game_umpires` rows (0025), and none of these confirms used to
// say so.
//
// WARN ONLY. Nothing here changes what an operation does; it only names what
// will be lost. A count that couldn't be read says "couldn't count" — never 0,
// which on a destructive confirm reads as "nothing to lose" (house rule, see
// "Division deletion" in CLAUDE.md).
//
// Callers decide WHICH games go (the operation's own rule) and pass their ids.
// This module only counts the assignments on them and words the line.

import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getOfficialTitleLower } from "@/lib/utils/official-title";

export type AssignmentCount = { ok: true; count: number } | { ok: false };

/** Ids per request — keeps each `in.(…)` filter well inside URL limits. */
export const ASSIGNMENT_COUNT_CHUNK = 150;

type CountClient = ReturnType<typeof createClient>;

/**
 * Exact count of `game_umpires` rows on these games (a head count, so the
 * PostgREST row cap doesn't apply). Any failed chunk, or a reply without a
 * count, makes the whole answer `{ ok: false }` — never a partial sum.
 */
export async function countAssignmentsOnGames(
  client: CountClient,
  gameIds: readonly string[],
): Promise<AssignmentCount> {
  const ids = Array.from(new Set(gameIds));
  if (ids.length === 0) return { ok: true, count: 0 };
  let total = 0;
  for (let i = 0; i < ids.length; i += ASSIGNMENT_COUNT_CHUNK) {
    const chunk = ids.slice(i, i + ASSIGNMENT_COUNT_CHUNK);
    const { count, error } = await client
      .from("game_umpires")
      .select("id", { count: "exact", head: true })
      .in("game_id", chunk);
    if (error || typeof count !== "number") return { ok: false };
    total += count;
  }
  return { ok: true, count: total };
}

/**
 * The confirm line, or null when there is nothing to say (zero assignments).
 * `pending` (the count is still loading) is its own line so a confirm never
 * shows a silent gap that reads as "none".
 */
export function assignmentLossLine(
  result: AssignmentCount | "pending",
  sport: string | null | undefined,
): string | null {
  const title = getOfficialTitleLower(sport);
  if (result === "pending") return `Counting ${title} assignments…`;
  if (!result.ok) return `Couldn't count how many ${title} assignments this removes.`;
  if (result.count === 0) return null;
  return `This removes ${result.count} ${title} assignment${result.count === 1 ? "" : "s"}.`;
}

type IdRow = { id: string };
type IdPage = PromiseLike<{ data: IdRow[] | null; error: { message: string } | null; count?: number | null }>;

/** Every game id a query matches — complete or `null` (never a short list). */
async function allGameIds(
  label: string,
  page: (range: { from: number; to: number; exactCount: boolean }) => IdPage,
): Promise<string[] | null> {
  try {
    return (await fetchAllRows<IdRow>(label, page)).map((r) => r.id);
  } catch {
    return null;
  }
}

/**
 * Assignments a DIVISION delete removes: every game where either team column
 * names one of the division's teams — the same scope `delete_division_permanently`
 * deletes (and the confirm's own game count reads).
 */
export async function countAssignmentsForTeams(
  client: CountClient,
  teamIds: readonly string[],
): Promise<AssignmentCount> {
  if (teamIds.length === 0) return { ok: true, count: 0 };
  const list = teamIds.join(",");
  const ids = await allGameIds("this division's games", ({ from, to, exactCount }) =>
    client
      .from("games")
      .select("id", exactCount ? { count: "exact" } : undefined)
      .or(`home_team_id.in.(${list}),away_team_id.in.(${list})`)
      .order("id")
      .range(from, to) as unknown as IdPage,
  );
  if (ids === null) return { ok: false };
  return countAssignmentsOnGames(client, ids);
}

/** Assignments a SEASON delete removes: every game of the season. */
export async function countAssignmentsForSeason(
  client: CountClient,
  seasonId: string,
): Promise<AssignmentCount> {
  const ids = await allGameIds("this season's games", ({ from, to, exactCount }) =>
    client
      .from("games")
      .select("id", exactCount ? { count: "exact" } : undefined)
      .eq("league_id", seasonId)
      .order("id")
      .range(from, to) as unknown as IdPage,
  );
  if (ids === null) return { ok: false };
  return countAssignmentsOnGames(client, ids);
}

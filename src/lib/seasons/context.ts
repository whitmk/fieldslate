// Season context helpers (server-side) — the season analogue of
// src/lib/orgs/context.ts.
//
// The selected season is stored in a cookie and validated read-side on
// every request: a stale value (archived, permanently deleted, or belonging
// to a different org) is silently ignored — never an error, and never
// rewritten during render (server components can't set cookies; writes go
// through POST /api/seasons/select, and /api/orgs/select clears the cookie
// on org switch).
//
// Chunk A ships the plumbing only. Season-scoped pages start consuming
// getCurrentSeasonId() in Chunk B.

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

export const SEASON_COOKIE_NAME = "fs_season_id";

type ServerClient = SupabaseClient<Database>;

export interface ActiveSeason {
  id: string;
  name: string;
  /** Season label, e.g. "Spring 2026" — shown as the switcher subtitle. */
  season: string;
  sport: string;
}

/**
 * The org's active (non-archived) seasons, most recently created first —
 * the same default ordering resolveSelectedSeasonId() uses, so the
 * switcher's fallback matches the overview page's historical default.
 */
export async function listActiveSeasons(
  supabase: ServerClient,
  orgId: string,
): Promise<ActiveSeason[]> {
  const { data } = await supabase
    .from("leagues")
    .select("id, name, season, sport")
    .eq("owner_id", orgId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as ActiveSeason[];
}

/**
 * Resolves the season id the caller should be acting under, or null when
 * the org has no active seasons (pages keep their own empty states).
 *
 * Priority (mirrors getCurrentOrgId):
 *   1. Cookie value, IF it is one of the org's active seasons.
 *   2. The most recently created active season.
 *   3. null.
 */
export async function getCurrentSeasonId(
  supabase: ServerClient,
  orgId: string,
  seasons?: ActiveSeason[],
): Promise<string | null> {
  const list = seasons ?? (await listActiveSeasons(supabase, orgId));
  const cookieValue = cookies().get(SEASON_COOKIE_NAME)?.value;

  if (cookieValue && list.some((s) => s.id === cookieValue)) {
    return cookieValue;
  }

  return list[0]?.id ?? null;
}

// Server-side read of everything "New season" needs to pick a screen
// (newSeasonScreen): the league's plan and comp flag, its active seasons,
// and its unused season credits. Read with the CALLER's session — every
// row is one their membership already lets them read.
//
// FAILS CLOSED: any read that fails returns an error, never a guess. A credit
// count that silently read as 0 would send a league that already paid for a
// season to checkout again.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlan } from "@/lib/plan/limits";
import type { NewSeasonState } from "./season-purchase";

export async function loadNewSeasonState(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ ok: true; state: NewSeasonState } | { ok: false; error: string }> {
  const fail = { ok: false as const, error: "Couldn’t load your league’s seasons. Refresh the page to try again." };

  const [profileRes, seasonsRes, creditsRes] = await Promise.all([
    supabase.from("profiles").select("plan, comped").eq("id", orgId).maybeSingle(),
    supabase
      .from("leagues")
      .select("id, name, created_at")
      .eq("owner_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("season_purchases" as never)
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "credited")
      .is("league_id", null),
  ]);

  const profile = profileRes.data as { plan: unknown; comped: boolean | null } | null;
  if (profileRes.error || !profile || !isPlan(profile.plan)) return fail;
  if (seasonsRes.error || !seasonsRes.data) return fail;
  if (creditsRes.error || creditsRes.count === null) return fail;

  const seasons = seasonsRes.data as { id: string; name: string }[];
  return {
    ok: true,
    state: {
      plan: profile.plan,
      comped: profile.comped === true,
      activeCount: seasons.length,
      creditCount: creditsRes.count,
      activeSeasonName: seasons[0]?.name ?? null,
    },
  };
}

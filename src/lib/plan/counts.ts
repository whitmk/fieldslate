// Server-side count helpers used by RPCs (enforcement) and UI counter
// displays (reporting). Each is scoped by org_id via the canonical path
// (owner_id on leagues, org_id on org-membership tables) — never via
// sender_user_id or other user-anchored columns, which permit cross-org
// data for multi-org admins.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type ServerClient = SupabaseClient<Database>;

export async function getActiveSeasonCount(
  supabase: ServerClient,
  orgId: string,
): Promise<number> {
  const { count } = await supabase
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", orgId)
    .is("archived_at", null);
  return count ?? 0;
}

export async function getDivisionCount(
  supabase: ServerClient,
  orgId: string,
): Promise<number> {
  const { count } = await supabase
    .from("divisions")
    .select("id, leagues!inner(owner_id)", { count: "exact", head: true })
    .eq("leagues.owner_id", orgId);
  return count ?? 0;
}

// Org-total team count (across all divisions / leagues), NOT per-division.
export async function getTeamCountForOrg(
  supabase: ServerClient,
  orgId: string,
): Promise<number> {
  const { count } = await supabase
    .from("teams")
    .select("id, leagues!inner(owner_id)", { count: "exact", head: true })
    .eq("leagues.owner_id", orgId);
  return count ?? 0;
}

// "Admins" for cap purposes = active members + pending invitations.
// Mirrors the team-members UI's seatsUsed calculation so cap displays
// and RPC enforcement agree.
export async function getAdminCount(
  supabase: ServerClient,
  orgId: string,
): Promise<number> {
  const [{ count: memberCount }, { count: pendingCount }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", orgId),
    supabase
      .from("organization_invitations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
  ]);
  return (memberCount ?? 0) + (pendingCount ?? 0);
}

// Distinct partner orgs invited for a given season. Scope-check via
// leagues.owner_id (the season_id FK) — sender_user_id is a misleading
// auth.users reference and not a clean org anchor.
export async function getInterleagueOrgCountForSeason(
  supabase: ServerClient,
  orgId: string,
  seasonId: string,
): Promise<number> {
  const { data } = await supabase
    .from("interleague_invites")
    .select("interleague_org_id, leagues!inner(owner_id)")
    .eq("season_id", seasonId)
    .eq("leagues.owner_id", orgId);

  if (!data) return 0;
  const distinct = new Set(
    data.map((r) => (r as { interleague_org_id: string }).interleague_org_id),
  );
  return distinct.size;
}

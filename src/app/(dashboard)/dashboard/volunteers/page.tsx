// Admin: volunteer roles (0121). Exists only for an org whose volunteer switch
// is on (404 otherwise — a real league never finds it), Elite only, server-side.
// Every read is complete-or-throw; any failure shows one error card, never a
// partial list. The Filled counts come from volunteer_admin_signups — if that
// read fails, the roles still show and Filled says "Couldn't count".
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import { loadVolunteerFeature } from "@/lib/volunteers/feature-state";
import { volunteerSignupUrl } from "@/lib/volunteers/settings-card";
import { activeByRole } from "@/lib/volunteers/roles-screen";
import { loadSeasonShifts } from "@/lib/volunteers/shifts-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as W from "@/lib/volunteers/words";
import { RolesScreen, type RolesScreenData } from "@/components/volunteers/roles-screen";

export const dynamic = "force-dynamic";

type GameRow = {
  id: string;
  scheduled_at: string | null;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  interleague_org_id: string | null;
  is_away: boolean | null;
};
type RoleRow = {
  id: string;
  name: string;
  kind: "per_game" | "per_team" | "snack_shack";
  spots: number;
  lead_minutes: number;
  signups_open: boolean;
  counts_toward_goal: boolean;
  sort_order: number;
  volunteer_role_divisions: { division_id: string }[];
};

export default async function VolunteersPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgId = await getCurrentOrgId(supabase, user!.id);

  const feature = await loadVolunteerFeature(supabase, orgId, "volunteers");
  if (!feature) notFound();
  if (!feature.elite) return <FeatureLockedCard feature="Volunteer sign-ups" tier="Elite" />;

  const seasonId = await getCurrentSeasonId(supabase, orgId);
  if (!seasonId) {
    return <p className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600">{W.NO_SEASON}</p>;
  }

  let data: RolesScreenData;
  try {
    data = await loadRolesScreen(supabase, orgId, seasonId);
  } catch (e) {
    console.error("[volunteers] roles read failed:", (e as Error).message);
    return <p className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">{W.ROLES_READ_FAILED}</p>;
  }
  data.link = feature.settings?.linkEnabled ? volunteerSignupUrl(feature.settings.linkToken) : null;
  return <RolesScreen data={data} />;
}

async function loadRolesScreen(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  seasonId: string,
): Promise<RolesScreenData> {
  const season = await supabase.from("leagues").select("id, name").eq("id", seasonId).eq("owner_id", orgId).single();
  if (season.error || !season.data) throw new Error(season.error?.message ?? "season not found");

  const divisions = await supabase
    .from("divisions")
    .select("id, name")
    .eq("league_id", seasonId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });
  if (divisions.error || !divisions.data) throw new Error(divisions.error?.message ?? "divisions");

  const teams = await fetchAllRows<{ id: string; division_id: string | null }>("the season's teams", ({ from, to, exactCount }) =>
    supabase
      .from("teams")
      .select("id, division_id", exactCount ? { count: "exact" } : undefined)
      .eq("league_id", seasonId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<{ id: string; division_id: string | null }>>,
  );

  const games = await fetchAllRows<GameRow>("the season's games", ({ from, to, exactCount }) =>
    supabase
      .from("games")
      .select("id, scheduled_at, status, home_team_id, away_team_id, interleague_org_id, is_away", exactCount ? { count: "exact" } : undefined)
      .eq("league_id", seasonId)
      .order("scheduled_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<GameRow>>,
  );

  const roles = await supabase
    .from("volunteer_roles" as never)
    .select("id, name, kind, spots, lead_minutes, signups_open, counts_toward_goal, sort_order, volunteer_role_divisions(division_id)")
    .eq("season_id", seasonId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (roles.error || !roles.data) throw new Error(roles.error?.message ?? "roles");

  // 0122: the season's snack shack — its shifts are the snack shack role's
  // spots. No snack shack set up → the row says so. A failed read throws.
  const shack = await loadSeasonShifts(supabase as unknown as SupabaseClient, seasonId);

  // Filled counts: the admin list (names never leave this function).
  // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
  const signups = await supabase.rpc("volunteer_admin_signups", { p_season_id: seasonId });
  const claims = (signups.data as { claims?: unknown } | null)?.claims;
  const active =
    !signups.error && Array.isArray(claims)
      ? activeByRole(claims as { role_id: string | null; status: string }[])
      : null;
  if (active === null) console.error("[volunteers] sign-up count read failed:", signups.error?.message ?? "malformed reply");

  return {
    seasonId,
    seasonName: (season.data as { name: string }).name,
    divisions: divisions.data as { id: string; name: string }[],
    teamDivision: teams.filter((t) => t.division_id).map((t) => [t.id, t.division_id as string]),
    games: games.map((g) => ({
      id: g.id,
      scheduledAt: g.scheduled_at,
      status: g.status,
      homeTeamId: g.home_team_id,
      awayTeamId: g.away_team_id,
      interleagueOrgId: g.interleague_org_id,
      isAway: g.is_away === true,
    })),
    snack: {
      ...shack,
      role: (() => {
        const r = (roles.data as unknown as RoleRow[]).find((x) => x.kind === "snack_shack");
        return r ? { id: r.id, name: r.name, signupsOpen: r.signups_open, countsTowardGoal: r.counts_toward_goal } : null;
      })(),
    },
    roles: (roles.data as unknown as RoleRow[]).filter((r) => r.kind !== "snack_shack").map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as "per_game" | "per_team",
      spots: r.spots,
      leadMinutes: r.lead_minutes,
      signupsOpen: r.signups_open,
      countsTowardGoal: r.counts_toward_goal,
      divisionIds: r.volunteer_role_divisions.map((d) => d.division_id),
    })),
    active: active ? [...active.entries()] : null,
    link: null,
  };
}

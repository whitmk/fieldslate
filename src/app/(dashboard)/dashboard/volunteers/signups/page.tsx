// Admin: who signed up (0121). Same gates as the roles page: 404 without the
// volunteer switch, Elite on the server. Names and emails come ONLY from
// volunteer_admin_signups; every read is complete-or-throw and any failure
// shows one error card — a list missing sign-ups would read as open spots.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSeasonShifts } from "@/lib/volunteers/shifts-read";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import { loadVolunteerFeature } from "@/lib/volunteers/feature-state";
import * as W from "@/lib/volunteers/words";
import { SignupsScreen, type SignupsScreenData } from "@/components/volunteers/signups-screen";
import type { SignupClaim } from "@/lib/volunteers/signups-screen";
import { EmailProblemsBanner } from "@/components/email-problems/email-problems-banner";
import { loadEmailProblems } from "@/lib/outbound-email/problems-read";
import { problemsView } from "@/lib/outbound-email/problems";
import { VOLUNTEER_PROBLEMS } from "@/lib/volunteers/email-problems";

export const dynamic = "force-dynamic";

type GameRow = {
  id: string;
  scheduled_at: string | null;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  interleague_org_id: string | null;
  is_away: boolean | null;
  proposed_venue_name: string | null;
  venue: { name: string } | null;
};
type RoleRow = {
  id: string;
  name: string;
  kind: "per_game" | "per_team" | "snack_shack";
  spots: number;
  lead_minutes: number;
  signups_open: boolean;
  volunteer_role_divisions: { division_id: string }[];
};

export default async function VolunteerSignupsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgId = await getCurrentOrgId(supabase, user!.id);

  const feature = await loadVolunteerFeature(supabase, orgId, "volunteer signups");
  if (!feature) notFound();
  if (!feature.elite) return <FeatureLockedCard feature="Volunteer sign-ups" tier="Elite" />;

  const seasonId = await getCurrentSeasonId(supabase, orgId);
  if (!seasonId) {
    return <p className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600">{W.NO_SEASON}</p>;
  }
  // 0128: emails that didn't go out (admin-only; names from the database's
  // own function). An unreadable read shows "couldn't check", never nothing.
  const problems = await loadEmailProblems(supabase, VOLUNTEER_PROBLEMS, seasonId);
  const problemsBanner =
    problems.state === "off" ? null : problems.state === "unreadable" ? (
      <EmailProblemsBanner feature="volunteers" rpc={VOLUNTEER_PROBLEMS.rpc} seasonId={seasonId} view={null} />
    ) : (() => {
      const view = problemsView(problems.problems, "volunteers");
      return view ? <EmailProblemsBanner feature="volunteers" rpc={VOLUNTEER_PROBLEMS.rpc} seasonId={seasonId} view={view} /> : null;
    })();
  try {
    const data = await loadSignups(supabase, orgId, seasonId);
    return (
      <div className="flex flex-col gap-4">
        {problemsBanner}
        <SignupsScreen data={data} />
      </div>
    );
  } catch (e) {
    console.error("[volunteer signups] read failed:", (e as Error).message);
    return <p className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">{W.SIGNUPS_READ_FAILED}</p>;
  }
}

async function loadSignups(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  seasonId: string,
): Promise<SignupsScreenData> {
  const season = await supabase.from("leagues").select("id, name").eq("id", seasonId).eq("owner_id", orgId).single();
  if (season.error || !season.data) throw new Error(season.error?.message ?? "season not found");
  const divisions = await supabase.from("divisions").select("id, name").eq("league_id", seasonId).order("name").order("id");
  if (divisions.error || !divisions.data) throw new Error(divisions.error?.message ?? "divisions");
  const teams = await fetchAllRows<{ id: string; name: string; division_id: string | null }>("the season's teams", ({ from, to, exactCount }) =>
    supabase
      .from("teams")
      .select("id, name, division_id", exactCount ? { count: "exact" } : undefined)
      .eq("league_id", seasonId)
      .order("name")
      .order("id")
      .range(from, to) as unknown as PromiseLike<PagedResult<{ id: string; name: string; division_id: string | null }>>,
  );
  const games = await fetchAllRows<GameRow>("the season's games", ({ from, to, exactCount }) =>
    supabase
      .from("games")
      .select(
        "id, scheduled_at, status, home_team_id, away_team_id, interleague_org_id, is_away, proposed_venue_name, venue:venues(name)",
        exactCount ? { count: "exact" } : undefined,
      )
      .eq("league_id", seasonId)
      .order("scheduled_at")
      .order("id")
      .range(from, to) as unknown as PromiseLike<PagedResult<GameRow>>,
  );
  const roles = await supabase
    .from("volunteer_roles" as never)
    .select("id, name, kind, spots, lead_minutes, signups_open, volunteer_role_divisions(division_id)")
    .eq("season_id", seasonId)
    .order("sort_order")
    .order("created_at")
    .order("id");
  if (roles.error || !roles.data) throw new Error(roles.error?.message ?? "roles");
  // 0122: the season's shifts (the snack shack role's spots).
  const shack = await loadSeasonShifts(supabase as unknown as SupabaseClient, seasonId);
  const snackRole = (roles.data as unknown as RoleRow[]).find((r) => r.kind === "snack_shack") ?? null;
  // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
  const signups = await supabase.rpc("volunteer_admin_signups", { p_season_id: seasonId });
  const reply = signups.data as { claims?: unknown; today?: unknown } | null;
  if (signups.error || !reply || !Array.isArray(reply.claims) || typeof reply.today !== "string") {
    throw new Error(signups.error?.message ?? "malformed sign-up reply");
  }
  return {
    seasonId,
    seasonName: (season.data as { name: string }).name,
    nowWall: reply.today,
    divisions: divisions.data as { id: string; name: string }[],
    teams: teams.map((t) => ({ id: t.id, name: t.name, divisionId: t.division_id })),
    games: games.map((g) => ({
      id: g.id,
      scheduledAt: g.scheduled_at,
      status: g.status,
      homeTeamId: g.home_team_id,
      awayTeamId: g.away_team_id,
      interleagueOrgId: g.interleague_org_id,
      isAway: g.is_away === true,
      fieldLabel: g.is_away ? g.proposed_venue_name : g.venue?.name ?? null,
    })),
    shifts: shack.shifts,
    snackRole: snackRole ? { id: snackRole.id, name: snackRole.name } : null,
    roles: (roles.data as unknown as RoleRow[]).filter((r) => r.kind !== "snack_shack").map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as "per_game" | "per_team",
      spots: r.spots,
      leadMinutes: r.lead_minutes,
      signupsOpen: r.signups_open,
      divisionIds: r.volunteer_role_divisions.map((d) => d.division_id),
    })),
    claims: reply.claims as SignupClaim[],
  };
}

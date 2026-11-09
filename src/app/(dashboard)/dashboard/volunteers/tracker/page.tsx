// Admin: the volunteer tracker (0123). Same gates as the other volunteer
// pages: 404 without the volunteer switch, Elite on the server. Every number
// comes from volunteer_tracker (the database counts); every read is
// complete-or-throw and any failure shows one error card — numbers that
// might be short would read as families that haven't helped.
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import { loadVolunteerFeature } from "@/lib/volunteers/feature-state";
import { parseTracker } from "@/lib/volunteers/tracker";
import { getOfficialTitle, getOfficialTitlePlural } from "@/lib/utils/official-title";
import * as W from "@/lib/volunteers/words";
import { TrackerScreen, type TrackerScreenData } from "@/components/volunteers/tracker-screen";

export const dynamic = "force-dynamic";

export default async function VolunteerTrackerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgId = await getCurrentOrgId(supabase, user!.id);

  const feature = await loadVolunteerFeature(supabase, orgId, "volunteer tracker");
  if (!feature) notFound();
  if (!feature.elite) return <FeatureLockedCard feature="Volunteer sign-ups" tier="Elite" />;

  const seasonId = await getCurrentSeasonId(supabase, orgId);
  if (!seasonId) {
    return <p className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600">{W.NO_SEASON}</p>;
  }
  try {
    return <TrackerScreen data={await loadTracker(supabase, orgId, seasonId)} />;
  } catch (e) {
    console.error("[volunteer tracker] read failed:", (e as Error).message);
    return <p className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">{W.TRACKER_READ_FAILED}</p>;
  }
}

async function loadTracker(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  seasonId: string,
): Promise<TrackerScreenData> {
  const season = await supabase.from("leagues").select("id, name, sport").eq("id", seasonId).eq("owner_id", orgId).single();
  if (season.error || !season.data) throw new Error(season.error?.message ?? "season not found");
  const teams = await fetchAllRows<{ id: string; name: string; division: { name: string } | null }>("the season's teams", ({ from, to, exactCount }) =>
    supabase
      .from("teams")
      .select("id, name, division:divisions(name)", exactCount ? { count: "exact" } : undefined)
      .eq("league_id", seasonId)
      .order("name")
      .order("id")
      .range(from, to) as unknown as PromiseLike<PagedResult<{ id: string; name: string; division: { name: string } | null }>>,
  );
  // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
  const reply = await supabase.rpc("volunteer_tracker", { p_season_id: seasonId });
  const data = parseTracker(reply.data);
  if (reply.error || !data) {
    throw new Error(reply.error?.message ?? "malformed tracker reply");
  }
  const s = season.data as { name: string; sport: string | null };
  return {
    seasonId,
    seasonName: s.name,
    officialTitle: getOfficialTitle(s.sport),
    officialsTitle: getOfficialTitlePlural(s.sport),
    teams: teams.map((t) => ({ id: t.id, name: `${t.division?.name ? `${t.division.name} ` : ""}${t.name}` })),
    tracker: data,
  };
}

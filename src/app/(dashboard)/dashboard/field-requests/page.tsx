import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isProPlus } from "@/lib/plan/limits";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import { loadPlan, type PlanRow } from "@/lib/practice-plans/load";
import { pickPrefill, type PrefillRow } from "@/lib/practice-plans/prefill";
import { editedLabel, planDatesLabel, planSummaryLine } from "@/lib/practice-plans/list";
import { PLANS_FREE_CALCULATOR } from "@/lib/practice-plans/words";
import { PlansListClient, type PlanListItem } from "@/components/field-requests/plans-list-client";

// Field requests — the league's saved practice field plans (migration 0117).
// Pro and Elite: the page refuses Free here, and every write function
// (create / copy / save) refuses it again in the database; delete stays
// open to members so a downgraded league can tidy up.
//
// Every read here is complete-or-throw (fetchAllRows): the list and the New
// plan prefill are both built from "all the rows".

type DivisionReadRow = {
  id: string;
  name: string;
  created_at: string;
  league: { id: string; name: string; start_date: string | null; created_at: string; archived_at: string | null; owner_id: string };
  teams: { count: number }[];
};

export default async function FieldRequestsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgId = await getCurrentOrgId(supabase, user!.id);

  const plan = await getOrgPlan(orgId);
  if (!isProPlus(plan)) {
    return (
      <FeatureLockedCard
        feature="Field requests"
        secondaryLink={{ href: "/tools/practice-field-calculator", label: PLANS_FREE_CALCULATOR }}
      />
    );
  }

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", orgId).single();
  const timeZone = (profile as { timezone: string } | null)?.timezone ?? "America/Los_Angeles";

  const rows = await fetchAllRows<PlanRow>("the league's field request plans", ({ from, to, exactCount }) =>
    supabase
      .from("practice_plans")
      .select("id, name, input, input_version, mode, updated_at", exactCount ? { count: "exact" } : undefined)
      .eq("owner_id", orgId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<PlanRow>>,
  );

  const divisionRows = await fetchAllRows<DivisionReadRow>("the league's divisions and team counts", ({ from, to, exactCount }) =>
    supabase
      .from("divisions")
      .select(
        "id, name, created_at, league:leagues!inner(id, name, start_date, created_at, archived_at, owner_id), teams(count)",
        exactCount ? { count: "exact" } : undefined,
      )
      .eq("league.owner_id", orgId)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<DivisionReadRow>>,
  );

  const prefill = pickPrefill(
    divisionRows.map(
      (d): PrefillRow => ({
        seasonId: d.league.id,
        seasonName: d.league.name,
        seasonStart: d.league.start_date,
        seasonCreatedAt: d.league.created_at,
        seasonArchivedAt: d.league.archived_at,
        divisionId: d.id,
        divisionName: d.name,
        divisionCreatedAt: d.created_at,
        teamCount: d.teams?.[0]?.count ?? 0,
      }),
    ),
  );

  const now = new Date();
  const items: PlanListItem[] = rows.map((r) => {
    const loaded = loadPlan(r);
    const edited = editedLabel(r.updated_at, timeZone, now);
    if (!loaded.ok) return { id: r.id, name: r.name, updatedAt: r.updated_at, edited, readable: false, input: null, mode: null, dates: null, summary: null };
    const p = loaded.plan;
    return {
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      edited,
      readable: true,
      input: p.input,
      mode: p.mode,
      dates: planDatesLabel(p.input),
      summary: planSummaryLine(p.input, p.mode),
    };
  });

  return <PlansListClient orgId={orgId} plans={items} prefill={prefill} />;
}

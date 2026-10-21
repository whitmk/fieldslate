import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isProPlus } from "@/lib/plan/limits";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { cityByIdOrNull } from "@/lib/sun/us-cities";
import { loadPlan, type PlanRow } from "@/lib/practice-plans/load";
import { ensureDivisionIds } from "@/lib/practice-plans/editor";
import { parsePrefillAdjustmentQuery } from "@/lib/practice-plans/prefill";
import { readLeagueSettings, readPrefill } from "@/lib/practice-plans/server-reads";
import { BACK_TO_PLANS, PLANS_FREE_CALCULATOR } from "@/lib/practice-plans/words";
import { PlannerClient } from "@/components/field-requests/planner-client";

// One saved field-request plan (step 5b). Opening it writes nothing; the
// client saves only after an edit, through save_practice_plan (0117).
//
// The city: the league's profiles.sunset_city through cityByIdOrNull — a
// missing or unknown id is NO city (no daylight section), never Sacramento.

export default async function FieldRequestPlanPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string | string[]; adjusted?: string | string[] };
}) {
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

  const { data, error } = await supabase
    .from("practice_plans")
    .select("id, name, input, input_version, mode, updated_at")
    .eq("id", params.id)
    .eq("owner_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the plan: ${error.message}`);
  if (!data) notFound();

  const loaded = loadPlan(data as PlanRow);
  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/dashboard/field-requests" className="text-sm font-semibold text-[#16a34a]">← {BACK_TO_PLANS}</Link>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-900">{loaded.message}</div>
      </div>
    );
  }

  const [{ sunsetCity }, prefill] = await Promise.all([readLeagueSettings(supabase, orgId), readPrefill(supabase, orgId)]);

  return (
    <PlannerClient
      planId={loaded.plan.id}
      initialName={loaded.plan.name}
      initialInput={ensureDivisionIds(loaded.plan.input)}
      initialMode={loaded.plan.mode}
      initialUpdatedAt={loaded.plan.updatedAt}
      city={cityByIdOrNull(sunsetCity)}
      prefill={prefill}
      prefillNote={parsePrefillAdjustmentQuery(searchParams)}
    />
  );
}

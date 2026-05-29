import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isPlan, type Plan } from "./limits";

// React's cache() memoizes per render, keyed on argument identity. Holding
// the signature to a single uuid lets every gated server component in a
// page render call this freely without N database hits — the layout and
// each gated counter share one row.
//
// Reads the plan from the owner's profile (convention: org_id = owner's
// profile id). Defaults to 'free' on null/missing/unknown values so callers
// can rely on a Plan even if the DB row is in an unexpected state.
export const getOrgPlan = cache(async (orgId: string): Promise<Plan> => {
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", orgId)
    .single();

  const raw = (data as { plan: string } | null)?.plan;
  return isPlan(raw) ? raw : "free";
});

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isPlan, type Plan } from "./limits";

// React's cache() memoizes per render, keyed on argument identity. Holding
// the signature to a single uuid lets every gated server component in a
// page render call this freely without N database hits — the layout and
// each gated counter share one row.
//
// One row read shared by getOrgPlan and getOrgSetupDismissed — the layout's
// first-run setup trigger piggybacks on the same fetch, so checking the
// dismissed flag costs no extra query.
//
// Reads from the owner's profile (convention: org_id = owner's profile id).
const getOwnerProfile = cache(async (orgId: string) => {
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan, setup_dismissed")
    .eq("id", orgId)
    .single();
  return data as { plan: string; setup_dismissed: boolean } | null;
});

// Defaults to 'free' on null/missing/unknown values so callers can rely on
// a Plan even if the DB row is in an unexpected state.
export async function getOrgPlan(orgId: string): Promise<Plan> {
  const raw = (await getOwnerProfile(orgId))?.plan;
  return isPlan(raw) ? raw : "free";
}

// Missing row reads as dismissed=true (fail closed: never bounce a user to
// /setup off an unreadable profile).
export async function getOrgSetupDismissed(orgId: string): Promise<boolean> {
  return (await getOwnerProfile(orgId))?.setup_dismissed ?? true;
}

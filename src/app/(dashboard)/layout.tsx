import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { MobileSidebarProvider } from "@/components/dashboard/mobile-sidebar";
import { getCurrentOrgId, listMemberships } from "@/lib/orgs/context";
import { getOrgPlan, getOrgSetupDismissed } from "@/lib/plan/get-org-plan";
import { getActiveSeasonCount } from "@/lib/plan/counts";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Resolve plan once for nav gating. getOrgPlan is React-cached, so pages
  // below that also call it reuse this row — no extra DB round-trip.
  // Memberships are fetched once here and passed through so the setup
  // trigger below doesn't repeat getCurrentOrgId's internal lookup.
  const memberships = await listMemberships(supabase, user.id);
  const currentOrgId = await getCurrentOrgId(supabase, user.id, memberships);
  const plan = await getOrgPlan(currentOrgId);
  // Used only by the first-run /setup redirect below (0 active seasons is one
  // of its conditions).
  const activeSeasonCount = await getActiveSeasonCount(supabase, currentOrgId);

  // First-run setup: bounce brand-new owners to /setup (its own route group,
  // so this layout — and this redirect — never applies there). Conditions,
  // cheapest first: acting in their own org; never invited to another org
  // (volunteer co-admins are never redirected, even when browsing their own
  // empty org); hasn't dismissed (shares getOrgPlan's cached profile row —
  // no extra query); zero active seasons (already fetched for the sidebar).
  // Only then pay for the one extra venues head-count.
  if (
    currentOrgId === user.id &&
    memberships.every((m) => m.is_own) &&
    activeSeasonCount === 0 &&
    !(await getOrgSetupDismissed(currentOrgId))
  ) {
    const { count: venueCount } = await supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", currentOrgId);
    if ((venueCount ?? 0) === 0) {
      redirect("/setup");
    }
  }

  return (
    <MobileSidebarProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50 print:h-auto print:overflow-visible print:bg-white">
        <Sidebar plan={plan} orgId={currentOrgId} />
        <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">{children}</main>
        </div>
      </div>
    </MobileSidebarProvider>
  );
}

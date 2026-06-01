import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Resolve plan once for nav gating. getOrgPlan is React-cached, so pages
  // below that also call it reuse this row — no extra DB round-trip.
  const currentOrgId = await getCurrentOrgId(supabase, user.id);
  const plan = await getOrgPlan(currentOrgId);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 print:h-auto print:overflow-visible print:bg-white">
      <Sidebar isFree={plan === "free"} isElite={plan === "elite"} />
      <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCheck, Printer } from "lucide-react";
import { AddUmpireButton } from "@/components/umpires/add-umpire-button";
import { UmpireList, type UmpireRow, type SeasonPaySettings } from "@/components/umpires/umpire-list";
import { PayReportButton } from "@/components/umpires/pay-report-button";

export default async function UmpiresPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: rawUmpires }, { data: rawSeasons }] = await Promise.all([
    supabase
      .from("umpires")
      .select("id, name, designation, season_id, pay_rate, season:leagues(name)")
      .order("name", { ascending: true }),
    supabase
      .from("leagues")
      .select("id, name, pay_tracking_enabled, pay_rate_mode")
      .eq("owner_id", user!.id)
      .order("name", { ascending: true }),
  ]);

  const umpires = (rawUmpires as unknown as UmpireRow[] | null) ?? [];
  const seasons = (rawSeasons ?? []) as {
    id: string;
    name: string;
    pay_tracking_enabled: boolean;
    pay_rate_mode: string;
  }[];

  const showSeasonColumn = seasons.length > 1;

  const seasonPaySettings: SeasonPaySettings[] = seasons.map((s) => ({
    id: s.id,
    pay_tracking_enabled: s.pay_tracking_enabled ?? false,
    pay_rate_mode: (s.pay_rate_mode === "per_role" ? "per_role" : "per_umpire") as
      | "per_umpire"
      | "per_role",
  }));

  const anyPayTracking = seasonPaySettings.some((s) => s.pay_tracking_enabled);
  const simpleSeasons = seasons.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Umpires</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage the officials available to your seasons.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {anyPayTracking && umpires.length > 0 && (
            <PayReportButton seasonPaySettings={seasonPaySettings} />
          )}
          {umpires.length > 0 && (
            <Link
              href="/dashboard/umpires/print-all"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
            >
              <Printer className="h-4 w-4" />
              Print all schedules
            </Link>
          )}
          <AddUmpireButton seasons={simpleSeasons} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Umpires</CardTitle>
        </CardHeader>
        <CardContent>
          {umpires.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <UserCheck className="mb-3 h-8 w-8 text-gray-300" />
              <p className="font-medium text-gray-900">No umpires yet</p>
              <p className="mt-1 text-sm text-gray-500">
                Add officials so divisions can require them for game scheduling.
              </p>
            </div>
          ) : (
            <UmpireList
              umpires={umpires}
              showSeasonColumn={showSeasonColumn}
              seasonPaySettings={seasonPaySettings}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

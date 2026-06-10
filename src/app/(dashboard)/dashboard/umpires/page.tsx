import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCheck, Printer } from "lucide-react";
import { AddUmpireButton } from "@/components/umpires/add-umpire-button";
import { UmpireList, type UmpireRow, type SeasonPaySettings } from "@/components/umpires/umpire-list";
import { PayReportButton } from "@/components/umpires/pay-report-button";
import { LeaguePaySettings } from "@/components/umpires/league-pay-settings";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isElite } from "@/lib/plan/limits";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";

export default async function UmpiresPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // The standalone Officials page is Elite-only (in-schedule umpire assignment
  // stays available to all tiers — that's a separate surface). Guard the route.
  const plan = await getOrgPlan(currentOrgId);
  if (!isElite(plan)) {
    return <FeatureLockedCard feature="Officials" tier="Elite" />;
  }

  // Sequenced: seasons first so we can scope every downstream query by their
  // ids. Before this change `rawUmpires` had no filter and RLS alone would
  // surface a multi-org admin's umpires from BOTH orgs.
  const { data: rawSeasons } = await supabase
    .from("leagues")
    .select("id, name, sport, pay_tracking_enabled, pay_rate_mode")
    .eq("owner_id", currentOrgId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  const seasons = (rawSeasons ?? []) as {
    id: string;
    name: string;
    sport: string;
    pay_tracking_enabled: boolean;
    pay_rate_mode: string;
  }[];

  // Active (non-archived) seasons only — umpire/official assignment is an
  // operational surface; pay-tracking for archived seasons stays accessible
  // via /dashboard/leagues > season detail. Note: this means an umpire that
  // belongs to ONLY an archived season won't appear here either (same intent
  // as the seasons scope below).
  const seasonIds = seasons.map((s) => s.id);

  const [
    { data: rawUmpires },
    { data: rawDivisions },
    { data: rawRoleRates },
  ] = await Promise.all([
    seasonIds.length > 0
      ? supabase
          .from("umpires")
          .select(
            "id, name, designation, season_id, pay_rate, email, phone, max_games_per_week, notes, season:leagues(name, sport)",
          )
          .in("season_id", seasonIds)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    seasonIds.length > 0
      ? supabase
          .from("divisions")
          .select("league_id, umpire_roles")
          .in("league_id", seasonIds)
      : Promise.resolve({ data: [] as unknown[] }),
    seasonIds.length > 0
      ? supabase
          .from("umpire_role_rates")
          .select("season_id, role, rate")
          .in("season_id", seasonIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const umpires = (rawUmpires as unknown as UmpireRow[] | null) ?? [];

  const showSeasonColumn = seasons.length > 1;

  const seasonPaySettings: SeasonPaySettings[] = seasons.map((s) => ({
    id: s.id,
    sport: s.sport,
    pay_tracking_enabled: s.pay_tracking_enabled ?? false,
    pay_rate_mode: (s.pay_rate_mode === "per_role" ? "per_role" : "per_umpire") as
      | "per_umpire"
      | "per_role",
  }));

  const anyPayTracking = seasonPaySettings.some((s) => s.pay_tracking_enabled);
  const simpleSeasons = seasons.map((s) => ({ id: s.id, name: s.name, sport: s.sport }));

  const rolesBySeason = new Map<string, Set<string>>();
  for (const d of (rawDivisions ?? []) as { league_id: string; umpire_roles: unknown }[]) {
    if (!Array.isArray(d.umpire_roles)) continue;
    if (!rolesBySeason.has(d.league_id)) rolesBySeason.set(d.league_id, new Set());
    for (const r of d.umpire_roles) {
      if (typeof r === "string" && r) rolesBySeason.get(d.league_id)!.add(r);
    }
  }

  const ratesBySeason = new Map<string, { role: string; rate: number }[]>();
  for (const r of (rawRoleRates ?? []) as { season_id: string; role: string; rate: number }[]) {
    if (!ratesBySeason.has(r.season_id)) ratesBySeason.set(r.season_id, []);
    ratesBySeason.get(r.season_id)!.push({ role: r.role, rate: r.rate });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Officials</h1>
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
          <CardTitle>All officials</CardTitle>
        </CardHeader>
        <CardContent>
          {umpires.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <UserCheck className="mb-3 h-8 w-8 text-gray-300" />
              <p className="font-medium text-gray-900">No officials yet</p>
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

      {seasons.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#0C1F3F]">Pay tracking</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Enable pay tracking per season and set rates here. Pay rates and totals
              show on official schedules and the pay report.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {seasons.map((s) => (
              <LeaguePaySettings
                key={s.id}
                leagueId={s.id}
                seasonName={s.name}
                sport={s.sport}
                initialEnabled={s.pay_tracking_enabled ?? false}
                initialMode={
                  ((s.pay_rate_mode === "per_role" ? "per_role" : "per_umpire")) as
                    | "per_umpire"
                    | "per_role"
                }
                availableRoles={Array.from(rolesBySeason.get(s.id) ?? [])}
                initialRoleRates={ratesBySeason.get(s.id) ?? []}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

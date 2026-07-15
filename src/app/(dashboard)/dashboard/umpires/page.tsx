import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCheck, Printer } from "lucide-react";
import { AddUmpireButton } from "@/components/umpires/add-umpire-button";
import { UmpireList, type UmpireRow, type SeasonPaySettings } from "@/components/umpires/umpire-list";
import { PayReportButton } from "@/components/umpires/pay-report-button";
import { LeaguePaySettings } from "@/components/umpires/league-pay-settings";
import {
  OfficialRolesManager,
  type SeasonRole,
} from "@/components/umpires/official-roles-manager";
import {
  DivisionPriorityCard,
  type PriorityDivision,
} from "@/components/umpires/division-priority-card";
import { AutoAssignSeasonButton } from "@/components/umpires/auto-assign-season-button";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isElite } from "@/lib/plan/limits";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { isSetupIncomplete } from "@/lib/setup/derive-step";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";

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

  // Season-scoped (Chunk B1): the whole page — roster, roles, rates,
  // priority — follows the topbar's selected season. umpires are season-
  // scoped rows (umpires.season_id NOT NULL), so there is no org-level
  // roster to preserve. A null season (no active seasons) flows to the
  // existing empty states below. The `seasons` array keeps its shape (now
  // 0 or 1 elements) so the per-season card stacks render a single card.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);

  const { data: rawSeasons } = seasonId
    ? await supabase
        .from("leagues")
        .select("id, name, sport, pay_tracking_enabled, pay_rate_mode")
        .eq("id", seasonId)
    : { data: [] };

  const seasons = (rawSeasons ?? []) as {
    id: string;
    name: string;
    sport: string;
    pay_tracking_enabled: boolean;
    pay_rate_mode: string;
  }[];

  const [
    { data: rawUmpires },
    { data: rawSeasonRoles },
    { data: rawRoleRates },
    { data: rawDivisions },
  ] = await Promise.all([
    seasonId
      ? supabase
          .from("umpires")
          .select(
            "id, name, designation, season_id, pay_rate, email, phone, max_games_per_week, notes, team_id, season:leagues(name, sport), team:teams(name, division:divisions(name)), official_availability(id), official_blackouts(id)",
          )
          .eq("season_id", seasonId)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    seasonId
      ? supabase
          .from("official_roles")
          .select("id, name, sort_order, season_id")
          .eq("season_id", seasonId)
          .order("sort_order")
      : Promise.resolve({ data: [] as unknown[] }),
    seasonId
      ? supabase
          .from("umpire_role_rates")
          .select("season_id, role, rate")
          .eq("season_id", seasonId)
      : Promise.resolve({ data: [] as unknown[] }),
    seasonId
      ? supabase
          .from("divisions")
          .select("id, name, priority, league_id")
          .eq("league_id", seasonId)
          .order("priority")
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const umpires = (rawUmpires as unknown as UmpireRow[] | null) ?? [];

  // Single-season view — the season column never applies anymore.
  const showSeasonColumn = false;

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

  // Season roles now come from the normalized official_roles list (sorted),
  // not from flattening divisions.umpire_roles jsonb — these are the names
  // the role manager edits and the pay-rate rows are keyed to.
  const rolesBySeason = new Map<string, SeasonRole[]>();
  for (const r of (rawSeasonRoles ?? []) as (SeasonRole & { season_id: string })[]) {
    if (!rolesBySeason.has(r.season_id)) rolesBySeason.set(r.season_id, []);
    rolesBySeason.get(r.season_id)!.push({
      id: r.id,
      name: r.name,
      sort_order: r.sort_order,
    });
  }

  const ratesBySeason = new Map<string, { role: string; rate: number }[]>();
  for (const r of (rawRoleRates ?? []) as { season_id: string; role: string; rate: number }[]) {
    if (!ratesBySeason.has(r.season_id)) ratesBySeason.set(r.season_id, []);
    ratesBySeason.get(r.season_id)!.push({ role: r.role, rate: r.rate });
  }

  // Divisions per season for the priority card (0063) — auto-assign fills
  // higher-priority (lower number) divisions first.
  const divisionsBySeason = new Map<string, PriorityDivision[]>();
  for (const d of (rawDivisions ?? []) as (PriorityDivision & { league_id: string })[]) {
    if (!divisionsBySeason.has(d.league_id)) divisionsBySeason.set(d.league_id, []);
    divisionsBySeason.get(d.league_id)!.push({
      id: d.id,
      name: d.name,
      priority: d.priority,
    });
  }
  const anyDivisions = Array.from(divisionsBySeason.values()).some(
    (list) => list.length > 0,
  );

  // Empty-state /setup link (Chunk 4): own-org owners mid-setup only;
  // derived lazily so the check runs only when the empty state renders.
  const showSetupLink =
    umpires.length === 0 &&
    currentOrgId === user!.id &&
    (await isSetupIncomplete(supabase, currentOrgId, seasonId));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Officials</h1>
          <p className="mt-1 text-sm text-gray-500">
            {seasons[0]
              ? `Officials for ${seasons[0].name}.`
              : "No active season."}
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
              {showSetupLink && <FinishSetupLink className="mt-3" />}
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
            <h2 className="text-lg font-semibold text-[#0C1F3F]">Official roles</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              The roles officials can fill each season — these drive game slots,
              auto-assign, and per-role pay rates.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {seasons.map((s) => (
              <OfficialRolesManager
                key={s.id}
                seasonId={s.id}
                seasonName={s.name}
                sport={s.sport}
                initialRoles={rolesBySeason.get(s.id) ?? []}
              />
            ))}
          </div>
        </div>
      )}

      {anyDivisions && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0C1F3F]">
                Division priority
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                The order auto-assign works through divisions when officials are
                shared across them.
              </p>
            </div>
            {seasons[0] && (
              <AutoAssignSeasonButton
                seasonId={seasons[0].id}
                seasonName={seasons[0].name}
                sport={seasons[0].sport}
              />
            )}
          </div>
          <div className="flex flex-col gap-4">
            {seasons.map((s) => {
              const divs = divisionsBySeason.get(s.id) ?? [];
              if (divs.length === 0) return null;
              return (
                <DivisionPriorityCard
                  key={s.id}
                  seasonName={s.name}
                  divisions={divs}
                />
              );
            })}
          </div>
        </div>
      )}

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
                availableRoles={(rolesBySeason.get(s.id) ?? []).map((r) => r.name)}
                initialRoleRates={ratesBySeason.get(s.id) ?? []}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

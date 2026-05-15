import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { UmpireScheduleActions } from "@/components/umpires/umpire-schedule-actions";

type ScheduleAssignment = {
  role: string;
  paid: boolean;
  game: {
    id: string;
    scheduled_at: string;
    league: { name: string; season: string | null } | null;
    home_team: {
      name: string;
      division: { name: string } | null;
    } | null;
    away_team: { name: string } | null;
    venue: { name: string } | null;
  } | null;
};

function fmtDate(scheduled_at: string): string {
  return new Date(scheduled_at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(scheduled_at: string): string {
  return new Date(scheduled_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default async function UmpireSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  const { data: umpireRaw } = await supabase
    .from("umpires")
    .select("id, name, designation, pay_rate, season_id, season:leagues(name, season, pay_tracking_enabled, pay_rate_mode)")
    .eq("id", params.id)
    .single();

  if (!umpireRaw) notFound();
  const umpire = umpireRaw as unknown as {
    id: string;
    name: string;
    designation: string;
    pay_rate: number | null;
    season_id: string;
    season: {
      name: string;
      season: string | null;
      pay_tracking_enabled: boolean;
      pay_rate_mode: string;
    } | null;
  };

  const payEnabled = umpire.season?.pay_tracking_enabled ?? false;
  const payMode = umpire.season?.pay_rate_mode === "per_role" ? "per_role" : "per_umpire";

  // Load per-role rates if needed
  let roleRateMap: Record<string, number> = {};
  if (payEnabled && payMode === "per_role") {
    const { data: ratesRaw } = await supabase
      .from("umpire_role_rates")
      .select("role, rate")
      .eq("season_id", umpire.season_id);
    for (const r of (ratesRaw ?? []) as { role: string; rate: number }[]) {
      roleRateMap[r.role] = r.rate;
    }
  }

  const { data: rawRows } = await supabase
    .from("game_umpires")
    .select(
      `role, paid,
       game:games(
         id, scheduled_at,
         league:leagues(name, season),
         home_team:teams!home_team_id(name, division:divisions(name)),
         away_team:teams!away_team_id(name),
         venue:venues(name)
       )`,
    )
    .eq("umpire_id", umpire.id);

  const rows = ((rawRows as unknown as ScheduleAssignment[] | null) ?? [])
    .filter((r) => r.game)
    .sort(
      (a, b) =>
        new Date(a.game!.scheduled_at).getTime() -
        new Date(b.game!.scheduled_at).getTime(),
    );

  function getPayForRow(role: string): number | null {
    if (!payEnabled) return null;
    if (payMode === "per_role") return roleRateMap[role] ?? 0;
    return umpire.pay_rate ?? null;
  }

  const totalPay = payEnabled
    ? rows.reduce((sum, r) => sum + (getPayForRow(r.role) ?? 0), 0)
    : 0;

  const unpaidCount = payEnabled ? rows.filter((r) => !r.paid).length : 0;

  const designationLabel =
    umpire.designation === "adult" ? "Adult umpire" : "Youth umpire";
  const seasonName = umpire.season?.name ?? "";
  const seasonLabel = umpire.season?.season ?? "";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard/umpires"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-[#0C1F3F] print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        All umpires
      </Link>

      <div className="flex items-start justify-between gap-3 print:items-baseline">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 print:text-black">
            Umpire schedule
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[#0C1F3F] print:text-black">
            {umpire.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <Badge variant={umpire.designation === "adult" ? "info" : "success"}>
              {designationLabel}
            </Badge>
            {seasonName && (
              <span className="print:text-black">
                {seasonName}
                {seasonLabel ? ` · ${seasonLabel}` : ""}
              </span>
            )}
            {payEnabled && rows.length > 0 && (
              <span className="font-medium text-[#0C1F3F] print:text-black">
                Total: {fmtCurrency(totalPay)}
                {unpaidCount > 0 && (
                  <span className="ml-2 text-amber-600">
                    ({unpaidCount} unpaid)
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        <UmpireScheduleActions umpireId={umpire.id} umpireName={umpire.name} />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No games assigned yet.
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-left text-xs uppercase tracking-wider text-gray-500 print:bg-white">
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Time</th>
                  <th className="px-4 py-2.5 font-semibold">Role</th>
                  <th className="px-4 py-2.5 font-semibold">Matchup</th>
                  <th className="px-4 py-2.5 font-semibold">Division</th>
                  <th className="px-4 py-2.5 font-semibold">Venue</th>
                  {payEnabled && <th className="px-4 py-2.5 font-semibold">Pay</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => {
                  const g = r.game!;
                  const pay = getPayForRow(r.role);
                  return (
                    <tr key={`${g.id}-${i}`} className="text-gray-700">
                      <td className="px-4 py-3 tabular-nums">
                        {fmtDate(g.scheduled_at)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {fmtTime(g.scheduled_at)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#0C1F3F] print:text-black">
                        {r.role}
                      </td>
                      <td className="px-4 py-3">
                        {g.home_team?.name ?? "TBD"} vs {g.away_team?.name ?? "TBD"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 print:text-black">
                        {g.home_team?.division?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 print:text-black">
                        {g.venue?.name ?? "—"}
                      </td>
                      {payEnabled && (
                        <td className="px-4 py-3 tabular-nums">
                          {pay != null ? (
                            <span className={r.paid ? "text-gray-500 line-through" : "font-medium text-gray-900"}>
                              {fmtCurrency(pay)}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                          {r.paid && (
                            <span className="ml-1.5 text-xs text-[#22C55E]">paid</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {payEnabled && (
              <div className="flex items-center justify-end gap-6 border-t border-gray-100 bg-gray-50/70 px-4 py-3 print:bg-white">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Total earned
                </span>
                <span className="text-base font-bold tabular-nums text-[#0C1F3F]">
                  {fmtCurrency(totalPay)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

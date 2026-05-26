"use client";

import { useEffect, useState } from "react";
import { X, Printer, Download, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getOfficialTitlePlural } from "@/lib/utils/official-title";
import type { SeasonPaySettings } from "./umpire-list";

interface UmpireReport {
  id: string;
  name: string;
  season_id: string;
  season_name: string;
  pay_rate: number | null;
  games_worked: number;
  total_pay: number;
  unpaid_games: number;
}

interface Props {
  seasonPaySettings: SeasonPaySettings[];
  onClose: () => void;
}

function fmtCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function PayReportModal({ seasonPaySettings, onClose }: Props) {
  const [rows, setRows] = useState<UmpireReport[]>([]);
  const [loading, setLoading] = useState(true);

  const enabledSeasonIds = new Set(
    seasonPaySettings.filter((s) => s.pay_tracking_enabled).map((s) => s.id),
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      // Load all umpires in pay-tracked seasons
      const { data: umpiresRaw } = await supabase
        .from("umpires")
        .select("id, name, season_id, pay_rate, season:leagues(name)")
        .in("season_id", Array.from(enabledSeasonIds));

      const umpires = (umpiresRaw ?? []) as {
        id: string;
        name: string;
        season_id: string;
        pay_rate: number | null;
        season: { name: string } | null;
      }[];

      if (umpires.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Load per-role rates for all relevant seasons
      const { data: roleRatesRaw } = await supabase
        .from("umpire_role_rates")
        .select("season_id, role, rate")
        .in("season_id", Array.from(enabledSeasonIds));

      const roleRatesBySeasonAndRole = new Map<string, number>();
      for (const r of (roleRatesRaw ?? []) as { season_id: string; role: string; rate: number }[]) {
        roleRatesBySeasonAndRole.set(`${r.season_id}:${r.role}`, r.rate);
      }

      // Load game_umpires for all these umpires
      const umpireIds = umpires.map((u) => u.id);
      const { data: assignmentsRaw } = await supabase
        .from("game_umpires")
        .select("umpire_id, role, paid")
        .in("umpire_id", umpireIds);

      const assignments = (assignmentsRaw ?? []) as {
        umpire_id: string;
        role: string;
        paid: boolean;
      }[];

      // Build report rows
      const report: UmpireReport[] = umpires.map((u) => {
        const ps = seasonPaySettings.find((s) => s.id === u.season_id)!;
        const myAssignments = assignments.filter((a) => a.umpire_id === u.id);

        let totalPay = 0;
        for (const a of myAssignments) {
          if (ps.pay_rate_mode === "per_role") {
            totalPay += roleRatesBySeasonAndRole.get(`${u.season_id}:${a.role}`) ?? 0;
          } else {
            totalPay += u.pay_rate ?? 0;
          }
        }

        return {
          id: u.id,
          name: u.name,
          season_id: u.season_id,
          season_name: u.season?.name ?? "—",
          pay_rate: u.pay_rate,
          games_worked: myAssignments.length,
          total_pay: totalPay,
          unpaid_games: myAssignments.filter((a) => !a.paid).length,
        };
      });

      report.sort((a, b) => a.name.localeCompare(b.name));
      setRows(report);
      setLoading(false);
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportCsv() {
    const showSeason = new Set(rows.map((r) => r.season_id)).size > 1;
    const header = [
      "Name",
      ...(showSeason ? ["Season"] : []),
      "Games Worked",
      "Total Pay",
      "Unpaid Games",
    ].join(",");
    const csvRows = rows.map((r) =>
      [
        `"${r.name}"`,
        ...(showSeason ? [`"${r.season_name}"`] : []),
        r.games_worked,
        r.total_pay.toFixed(2),
        r.unpaid_games,
      ].join(","),
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "officials-pay-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const showSeason = new Set(rows.map((r) => r.season_id)).size > 1;
  const grandTotal = rows.reduce((s, r) => s + r.total_pay, 0);
  const grandUnpaid = rows.reduce((s, r) => s + r.unpaid_games, 0);

  // Title reflects the sport(s) of the seasons with pay tracking enabled.
  // Mixed sports → neutral "Officials".
  const enabledSports = Array.from(
    new Set(
      seasonPaySettings
        .filter((s) => s.pay_tracking_enabled)
        .map((s) => s.sport ?? ""),
    ),
  );
  const reportTitleSport = enabledSports.length === 1 ? enabledSports[0] : "";
  const reportTitlePlural = getOfficialTitlePlural(reportTitleSport);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:bg-white"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 print:hidden">
          <h2 className="font-semibold text-[#0C1F3F]">{reportTitlePlural} pay report</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={loading || rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Print-only header */}
        <div className="hidden px-0 pb-4 print:block">
          <h2 className="text-xl font-bold text-black">{reportTitlePlural} pay report</h2>
          <p className="text-sm text-gray-500">
            Generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">
              No officials found in pay-tracked seasons.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="pb-3 font-semibold">Name</th>
                  {showSeason && <th className="pb-3 font-semibold">Season</th>}
                  <th className="pb-3 text-right font-semibold">Games</th>
                  <th className="pb-3 text-right font-semibold">Total pay</th>
                  <th className="pb-3 text-right font-semibold">Unpaid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={r.id} className="text-gray-700">
                    <td className="py-3 font-medium text-gray-900">{r.name}</td>
                    {showSeason && <td className="py-3 text-gray-500">{r.season_name}</td>}
                    <td className="py-3 text-right tabular-nums">{r.games_worked}</td>
                    <td className="py-3 text-right tabular-nums font-medium">
                      {fmtCurrency(r.total_pay)}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {r.unpaid_games > 0 ? (
                        <span className="font-medium text-amber-600">{r.unpaid_games}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold text-gray-900">
                  <td className="pt-3" colSpan={showSeason ? 2 : 1}>
                    Total
                  </td>
                  <td className="pt-3 text-right tabular-nums">
                    {rows.reduce((s, r) => s + r.games_worked, 0)}
                  </td>
                  <td className="pt-3 text-right tabular-nums">{fmtCurrency(grandTotal)}</td>
                  <td className="pt-3 text-right tabular-nums">
                    {grandUnpaid > 0 ? (
                      <span className="text-amber-600">{grandUnpaid}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

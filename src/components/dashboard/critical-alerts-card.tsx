import Link from "next/link";
import { AlertTriangle, CloudRain, CalendarOff, ArrowRight, ShieldCheck } from "lucide-react";

export type CriticalAlertLeague = {
  id: string;
  name: string;
  season: string | null;
  rainoutCount: number;
  conflictCount: number;
  blackoutAffectedCount: number;
};

interface Props {
  leagues: CriticalAlertLeague[];
}

function leagueLabel(l: CriticalAlertLeague): string {
  return l.season ? `${l.name} · ${l.season}` : l.name;
}

export function CriticalAlertsCard({ leagues }: Props) {
  const flagged = leagues.filter(
    (l) => l.rainoutCount + l.conflictCount + l.blackoutAffectedCount > 0,
  );
  const totalRainouts = flagged.reduce((s, l) => s + l.rainoutCount, 0);
  const totalConflicts = flagged.reduce((s, l) => s + l.conflictCount, 0);
  const totalBlackouts = flagged.reduce((s, l) => s + l.blackoutAffectedCount, 0);

  if (flagged.length === 0) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#22C55E]/10">
            <ShieldCheck className="h-4 w-4 text-[#22C55E]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0C1F3F]">Critical Alerts</p>
            <p className="text-xs text-gray-500">No active issues across your seasons.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-amber-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0C1F3F]">Critical Alerts</p>
            <p className="text-xs text-gray-500">
              {totalRainouts} rained-out{totalRainouts === 1 ? "" : "s"} ·{" "}
              {totalConflicts} conflict{totalConflicts === 1 ? "" : "s"} ·{" "}
              {totalBlackouts} on blackout date{totalBlackouts === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      <ul className="divide-y divide-gray-100">
        {flagged.map((l) => (
          <li key={l.id}>
            <Link
              href={`/dashboard/leagues/${l.id}`}
              className="group flex items-center justify-between px-5 py-3 transition-colors hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#0C1F3F]">
                  {leagueLabel(l)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  {l.rainoutCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <CloudRain className="h-3 w-3 text-blue-400" />
                      {l.rainoutCount} rained out
                    </span>
                  )}
                  {l.conflictCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-red-400" />
                      {l.conflictCount} double-booked
                    </span>
                  )}
                  {l.blackoutAffectedCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarOff className="h-3 w-3 text-amber-400" />
                      {l.blackoutAffectedCount} on blackout date
                      {l.blackoutAffectedCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-300 transition-colors group-hover:text-[#0C1F3F]" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

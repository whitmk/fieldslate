"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CalendarX,
  CalendarClock,
  CloudRain,
  CalendarCheck,
  CheckCircle,
  UserPlus,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ActivityLogEntry = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
};

interface Props {
  leagueId: string;
}

type IconConfig = { icon: React.ElementType; bg: string; color: string };

const EVENT_ICONS: Record<string, IconConfig> = {
  practice_dropped:    { icon: CalendarX,    bg: "bg-red-50",    color: "text-red-400" },
  game_rescheduled:    { icon: CalendarClock, bg: "bg-blue-50",   color: "text-blue-400" },
  rainout_logged:      { icon: CloudRain,     bg: "bg-sky-50",    color: "text-sky-400" },
  schedule_generated:  { icon: CalendarCheck, bg: "bg-green-50",  color: "text-green-500" },
  conflict_resolved:   { icon: CheckCircle,   bg: "bg-green-50",  color: "text-green-500" },
  team_added:          { icon: UserPlus,      bg: "bg-gray-50",   color: "text-gray-400" },
  conflict_detected:   { icon: AlertTriangle, bg: "bg-amber-50",  color: "text-amber-400" },
};

const DEFAULT_ICON: IconConfig = { icon: Activity, bg: "bg-gray-50", color: "text-gray-400" };

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ActivityLogPanel({ leagueId }: Props) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("activity_log")
      .select("id, event_type, message, created_at")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setEntries((data ?? []) as ActivityLogEntry[]);
        setLoading(false);
      });
  }, [leagueId]);

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm">

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
        <Activity className="h-4 w-4 text-gray-400" />
        <h2 className="font-semibold text-[#0C1F3F]">Activity Log</h2>
        {entries.length > 0 && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            {entries.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <svg className="h-5 w-5 animate-spin text-gray-300" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
          <Activity className="h-6 w-6 text-gray-200" />
          <p className="mt-3 text-sm font-medium text-[#0C1F3F]">No activity yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Events like schedule generation, rainouts, and rescheduled games will appear here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {entries.map((entry) => {
            const cfg = EVENT_ICONS[entry.event_type] ?? DEFAULT_ICON;
            const Icon = cfg.icon;
            return (
              <li key={entry.id} className="flex items-start gap-3 px-6 py-3.5">
                <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[#0C1F3F]">{entry.message}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{fmtTimestamp(entry.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

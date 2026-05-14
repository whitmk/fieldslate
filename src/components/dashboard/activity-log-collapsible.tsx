"use client";

import { useState, useEffect } from "react";
import {
  Activity,
  CalendarX,
  CalendarClock,
  CloudRain,
  CalendarCheck,
  CheckCircle,
  UserPlus,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type ActivityLogEntry = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
};

interface Props {
  entries: ActivityLogEntry[];
  storageKey: string;
}

type IconConfig = { bg: string; color: string; Icon: React.ElementType };

const EVENT_ICONS: Record<string, IconConfig> = {
  practice_dropped:   { Icon: CalendarX,    bg: "bg-red-50",   color: "text-red-400" },
  game_rescheduled:   { Icon: CalendarClock, bg: "bg-blue-50",  color: "text-blue-400" },
  rainout_logged:     { Icon: CloudRain,     bg: "bg-sky-50",   color: "text-sky-400" },
  schedule_generated: { Icon: CalendarCheck, bg: "bg-green-50", color: "text-green-500" },
  conflict_resolved:  { Icon: CheckCircle,   bg: "bg-green-50", color: "text-green-500" },
  team_added:         { Icon: UserPlus,      bg: "bg-gray-50",  color: "text-gray-400" },
  conflict_detected:  { Icon: AlertTriangle, bg: "bg-amber-50", color: "text-amber-400" },
};

const DEFAULT_ICON: IconConfig = { Icon: Activity, bg: "bg-gray-50", color: "text-gray-400" };

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ActivityLogCollapsible({ entries, storageKey }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) setCollapsed(stored === "true");
    setMounted(true);
  }, [storageKey]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }

  // Avoid flash of wrong state before localStorage is read
  if (!mounted) return null;

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
      {/* Header */}
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 border-b border-gray-100 px-6 py-4 text-left transition-colors hover:bg-gray-50/50"
        style={{ borderBottomWidth: collapsed ? 0 : undefined }}
      >
        <Activity className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <h2 className="font-semibold text-[#0C1F3F]">Activity Log</h2>
        {entries.length > 0 && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            {entries.length}
          </span>
        )}
        <span className="ml-auto flex-shrink-0 text-gray-400">
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>

      {/* Body */}
      {!collapsed && (
        entries.length === 0 ? (
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
              return (
                <li key={entry.id} className="flex items-start gap-3 px-6 py-3.5">
                  <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
                    <cfg.Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#0C1F3F]">{entry.message}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{fmtTimestamp(entry.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}

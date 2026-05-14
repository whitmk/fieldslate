"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  ORDERED_DAYS,
  DEFAULT_DAY_WINDOW,
} from "@/components/divisions/wizard-types";
import type { PlayoffWizardData, PlayingDay, DayWindowMap } from "../playoff-wizard-types";

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
}

function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      aria-pressed={enabled}
      className={`relative flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-[#22C55E]" : "bg-gray-200"
      }`}
    >
      <span
        className={`absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
    />
  );
}

export function StepDates({ data, update }: Props) {
  const [expandedDays, setExpandedDays] = useState<Set<PlayingDay>>(() => {
    const s = new Set<PlayingDay>();
    for (const d of data.playing_days) s.add(d);
    return s;
  });

  function toggleExpand(day: PlayingDay) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function toggleDay(day: PlayingDay) {
    const enabled = data.playing_days.includes(day);
    if (enabled) {
      update({ playing_days: data.playing_days.filter((d) => d !== day) });
    } else {
      const windows: DayWindowMap = { ...data.day_windows };
      if (!windows[day]) windows[day] = { ...DEFAULT_DAY_WINDOW };
      update({
        playing_days: [...data.playing_days, day],
        day_windows: windows,
      });
      setExpandedDays((prev) => new Set(prev).add(day));
    }
  }

  function updateWindow(
    day: PlayingDay,
    field: "start" | "end",
    value: string
  ) {
    update({
      day_windows: {
        ...data.day_windows,
        [day]: {
          ...(data.day_windows[day] ?? DEFAULT_DAY_WINDOW),
          [field]: value,
        },
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">
          Dates &amp; time windows
        </h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Set the playoff date range and available time slots. These are
          separate from the regular season schedule.
        </p>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            Playoff start date
          </label>
          <input
            type="date"
            value={data.start_date}
            onChange={(e) => update({ start_date: e.target.value })}
            className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            Playoff end date
          </label>
          <input
            type="date"
            value={data.end_date}
            onChange={(e) => update({ end_date: e.target.value })}
            className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
      </div>

      {/* Day/time windows */}
      <div className="flex flex-col gap-2">
        <div>
          <label className="text-sm font-medium text-gray-700">
            Available days &amp; time windows
          </label>
          <p className="mt-0.5 text-xs text-gray-400">
            Expand a day to configure the time window for playoff games.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {ORDERED_DAYS.map(({ key, label }, i) => {
            const enabled = data.playing_days.includes(key);
            const isExpanded = expandedDays.has(key);
            const isLast = i === ORDERED_DAYS.length - 1;
            const win = data.day_windows[key] ?? DEFAULT_DAY_WINDOW;

            return (
              <div key={key} className={!isLast ? "border-b border-gray-100" : ""}>
                {/* Day header row */}
                <button
                  type="button"
                  onClick={() => toggleExpand(key)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/60"
                >
                  <span className="w-9 flex-shrink-0 text-sm font-semibold text-[#0C1F3F]">
                    {label}
                  </span>
                  <div className="flex flex-1 items-center gap-1.5">
                    {enabled ? (
                      <span className="rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-[10px] font-semibold text-[#16a34a]">
                        Games
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">
                        No schedule
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-150 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {/* Expanded row */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-4 pb-3 pt-2.5">
                    <div className="flex items-center gap-3">
                      <Toggle
                        enabled={enabled}
                        onChange={() => toggleDay(key)}
                      />
                      <span className="w-20 flex-shrink-0 text-xs font-semibold text-gray-600">
                        Games
                      </span>
                      {enabled ? (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="flex flex-1 flex-col gap-0.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                              Start
                            </p>
                            <TimeInput
                              value={win.start}
                              onChange={(v) => updateWindow(key, "start", v)}
                            />
                          </div>
                          <span className="flex-shrink-0 text-xs text-gray-300">
                            –
                          </span>
                          <div className="flex flex-1 flex-col gap-0.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                              End
                            </p>
                            <TimeInput
                              value={win.end}
                              onChange={(v) => updateWindow(key, "end", v)}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="flex-1 text-xs italic text-gray-300">
                          Off
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

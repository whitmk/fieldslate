"use client";

import { ORDERED_DAYS } from "@/components/divisions/wizard-types";
import type { SnackShackWizardData, DayCode } from "../wizard-types";

interface Props {
  data: SnackShackWizardData;
  update: (patch: Partial<SnackShackWizardData>) => void;
}

export function StepDays({ data, update }: Props) {
  function toggleDay(day: DayCode) {
    const isOn = data.days_of_week.includes(day);
    if (isOn) {
      // Remove day and its time blocks
      const nextBlocks = { ...data.time_blocks_by_day };
      delete nextBlocks[day];
      update({
        days_of_week: data.days_of_week.filter((d) => d !== day),
        time_blocks_by_day: nextBlocks,
      });
    } else {
      update({ days_of_week: [...data.days_of_week, day] });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Days open</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Select which days of the week the Snack Shack operates.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {ORDERED_DAYS.map(({ key, label }, i) => {
          const isLast = i === ORDERED_DAYS.length - 1;
          const enabled = data.days_of_week.includes(key as DayCode);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleDay(key as DayCode)}
              className={`flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 ${
                !isLast ? "border-b border-gray-100" : ""
              }`}
            >
              {/* Toggle pill */}
              <div
                className={`relative flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                  enabled ? "bg-[#22C55E]" : "bg-gray-200"
                }`}
              >
                <span
                  className={`absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    enabled ? "translate-x-[18px]" : "translate-x-0.5"
                  }`}
                />
              </div>
              <span className="text-sm font-medium text-gray-800">{label}</span>
              {enabled && (
                <span className="ml-auto rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-[10px] font-semibold text-[#16a34a]">
                  Open
                </span>
              )}
            </button>
          );
        })}
      </div>

      {data.days_of_week.length === 0 && (
        <p className="text-center text-sm text-gray-400">
          Select at least one day to continue.
        </p>
      )}
    </div>
  );
}

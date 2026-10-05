"use client";

// The RULE step — replaces the old Days + Blocks steps. The admin sets how
// early the shack opens, how late it stays, the longest shift, and which
// weekdays it can open on. Shifts themselves are derived from the game
// schedule on the Snack Shack page; nothing here creates a block.

import { ORDERED_DAYS } from "@/components/divisions/wizard-types";
import { MAX_SHIFT_OPTIONS_MIN, OFFSET_OPTIONS_MIN } from "@/lib/snack-shack/derive-shifts";
import { maxShiftHelpText } from "@/lib/snack-shack/regenerate-plan";
import type { SnackShackWizardData, DayCode } from "../wizard-types";

interface Props {
  data: SnackShackWizardData;
  update: (patch: Partial<SnackShackWizardData>) => void;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

function Segmented<T extends number>({
  values,
  current,
  label,
  onPick,
}: {
  values: readonly T[];
  current: number;
  label: (v: T) => string;
  onPick: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-gray-200">
      {values.map((v) => {
        const on = v === current;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            aria-pressed={on}
            className={`h-10 border-r border-gray-200 px-3 text-sm font-semibold last:border-r-0 ${
              on ? "bg-[#0C1F3F] text-white" : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {label(v)}
          </button>
        );
      })}
    </div>
  );
}

export function StepHours({ data, update }: Props) {
  function toggleDay(day: DayCode) {
    const isOn = data.days_of_week.includes(day);
    update({
      days_of_week: isOn ? data.days_of_week.filter((d) => d !== day) : [...data.days_of_week, day],
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Snack shack hours</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Shifts are made from the game schedule: the shack opens before the first
          game at your fields and closes after the last one ends. Set how early,
          how late, and the longest shift you&rsquo;ll ask a volunteer for.
        </p>
      </div>

      <div className="flex flex-col gap-5 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Open before the first game</label>
          <Segmented
            values={OFFSET_OPTIONS_MIN}
            current={data.open_before_min}
            label={(v) => (v === 0 ? "At start" : `${v} min`)}
            onPick={(v) => update({ open_before_min: v })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Close after the last game ends</label>
          <Segmented
            values={OFFSET_OPTIONS_MIN}
            current={data.close_after_min}
            label={(v) => (v === 0 ? "At end" : `${v} min`)}
            onPick={(v) => update({ close_after_min: v })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Longest shift</label>
          <Segmented
            values={MAX_SHIFT_OPTIONS_MIN}
            current={data.max_shift_min}
            label={fmtDuration}
            onPick={(v) => update({ max_shift_min: v })}
          />
          <p className="text-xs text-gray-500">{maxShiftHelpText(data.max_shift_min)}</p>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-[#0C1F3F]">Days the shack can open</h4>
        <p className="mt-0.5 text-sm text-gray-500">
          A game at your fields on any other day makes no shift. The Snack Shack
          page lists those dates so nothing is missed.
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
        <p className="text-center text-sm text-gray-400">Select at least one day to continue.</p>
      )}
    </div>
  );
}

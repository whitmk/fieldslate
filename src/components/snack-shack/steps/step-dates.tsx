"use client";

import type { SnackShackWizardData } from "../wizard-types";

interface Props {
  data: SnackShackWizardData;
  update: (patch: Partial<SnackShackWizardData>) => void;
}

export function StepDates({ data, update }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Date range</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Set when the Snack Shack is open for the season.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Open date</label>
          <input
            type="date"
            value={data.start_date}
            onChange={(e) => update({ start_date: e.target.value })}
            className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Close date</label>
          <input
            type="date"
            value={data.end_date}
            min={data.start_date || undefined}
            onChange={(e) => update({ end_date: e.target.value })}
            className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
      </div>

      {data.start_date && data.end_date && data.start_date > data.end_date && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          Close date must be on or after the open date.
        </p>
      )}
    </div>
  );
}

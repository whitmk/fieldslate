"use client";

import type { PlayoffWizardData, PlayoffFormat } from "../playoff-wizard-types";

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
}

const FORMATS: {
  value: PlayoffFormat;
  label: string;
  description: string;
}[] = [
  {
    value: "single_elimination",
    label: "Single elimination",
    description:
      "One loss and a team is out. The fastest format — ideal for large brackets or tight schedules.",
  },
  {
    value: "double_elimination",
    label: "Double elimination",
    description:
      "Teams get a second chance through the losers bracket before being eliminated.",
  },
  {
    value: "round_robin",
    label: "Round robin",
    description:
      "Every team plays every other team. Best for determining true standings with smaller groups.",
  },
];

export function StepFormat({ data, update }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Format</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Choose the playoff bracket format for{" "}
          <span className="font-medium text-[#0C1F3F]">
            {data.division_name || "this division"}
          </span>
          .
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {FORMATS.map(({ value, label, description }) => {
          const isSelected = data.format === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => update({ format: value })}
              className={`flex items-start gap-4 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? "border-[#22C55E] bg-[#22C55E]/5 ring-1 ring-[#22C55E]/30"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div
                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  isSelected ? "border-[#22C55E] bg-[#22C55E]" : "border-gray-300"
                }`}
              >
                {isSelected && (
                  <span className="h-2 w-2 rounded-full bg-white" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0C1F3F]">{label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

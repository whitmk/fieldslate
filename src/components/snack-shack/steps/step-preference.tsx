"use client";

import { CalendarCheck, CalendarOff } from "lucide-react";
import type { SnackShackWizardData } from "../wizard-types";

interface Props {
  data: SnackShackWizardData;
  update: (patch: Partial<SnackShackWizardData>) => void;
}

const OPTIONS = [
  {
    value: "prefer_game_days" as const,
    icon: CalendarCheck,
    label: "Prefer game days",
    description:
      "Assign teams to Snack Shack blocks on days they have a home game at a selected venue. Keeps families in the park on days they're already there.",
  },
  {
    value: "prefer_off_days" as const,
    icon: CalendarOff,
    label: "Prefer off days",
    description:
      "Assign teams on days they don't have any scheduled games. Spreads the duty across days without adding burden to game days.",
  },
];

export function StepPreference({ data, update }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Scheduling preference</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          When multiple teams are equally eligible for a block, which should be
          preferred? This is a soft preference — it falls back to round-robin
          if the preferred teams are already exhausted.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const selected = data.scheduling_preference === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ scheduling_preference: opt.value })}
              className={`flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-colors ${
                selected
                  ? "border-[#22C55E] bg-[#22C55E]/5"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                  selected ? "bg-[#22C55E]/15" : "bg-gray-100"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${selected ? "text-[#22C55E]" : "text-gray-400"}`}
                />
              </div>
              <div>
                <p
                  className={`font-semibold ${selected ? "text-[#0C1F3F]" : "text-gray-700"}`}
                >
                  {opt.label}
                </p>
                <p className="mt-0.5 text-sm text-gray-500">{opt.description}</p>
              </div>
              <div
                className={`ml-auto mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  selected ? "border-[#22C55E] bg-[#22C55E]" : "border-gray-300"
                }`}
              >
                {selected && (
                  <span className="h-2 w-2 rounded-full bg-white" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

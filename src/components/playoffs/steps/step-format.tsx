"use client";

import type { PlayoffWizardData, PlayoffFormat } from "../playoff-wizard-types";

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
  /** Editing an existing setup: whether it is a two-stage pair. A pair can't
   *  become one bracket and one bracket can't become a pair in Edit setup —
   *  that is delete and set up again. Null when setting up a new bracket. */
  editingTwoStage: boolean | null;
}

type Choice = PlayoffFormat | "two_stage";

const FORMATS: {
  value: Choice;
  label: string;
  description: string;
  isNew?: boolean;
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
  {
    value: "two_stage",
    label: "Round robin, then bracket",
    description:
      "Everyone plays everyone once. Then you seed the teams that advance into a single-elimination bracket.",
    isNew: true,
  },
];

const CONVERT_LINE =
  "A setup can't switch between one bracket and \"Round robin, then bracket\" in Edit setup. To change it, delete it from its card and set it up again.";

export function StepFormat({ data, update, editingTwoStage }: Props) {
  const current: Choice = data.two_stage ? "two_stage" : data.format;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Format</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          How should{" "}
          <span className="font-medium text-[#0C1F3F]">
            {data.division_name || "this division"}
          </span>
          &apos;s playoffs run? You can change this later in Edit setup, until a result is entered.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {FORMATS.map(({ value, label, description, isNew }) => {
          const isSelected = current === value;
          const disabled =
            editingTwoStage !== null && (value === "two_stage") !== editingTwoStage;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() =>
                value === "two_stage"
                  ? update({ format: "round_robin", two_stage: true })
                  : update({ format: value, two_stage: false })
              }
              className={`flex items-start gap-4 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? "border-[#22C55E] bg-[#22C55E]/5 ring-1 ring-[#22C55E]/30"
                  : disabled
                  ? "cursor-not-allowed border-gray-100 bg-gray-50 opacity-60"
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
                <p className="flex items-center gap-2 text-sm font-semibold text-[#0C1F3F]">
                  {label}
                  {isNew && (
                    <span className="rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#16a34a]">
                      New
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{description}</p>
              </div>
            </button>
          );
        })}
      </div>
      {editingTwoStage !== null && <p className="text-xs text-gray-500">{CONVERT_LINE}</p>}
    </div>
  );
}

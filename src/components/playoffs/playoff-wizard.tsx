"use client";

import { useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { StepDivision } from "./steps/step-division";
import { StepFormat } from "./steps/step-format";
import { StepSeeding } from "./steps/step-seeding";
import { StepDates } from "./steps/step-dates";
import { StepVenues } from "./steps/step-venues";
import { StepCrossDivision } from "./steps/step-cross-division";
import { StepReview } from "./steps/step-review";
import type { PlayoffWizardData } from "./playoff-wizard-types";

const STEPS = [
  { label: "Division" },
  { label: "Format" },
  { label: "Seeding" },
  { label: "Dates" },
  { label: "Venues" },
  { label: "Cross-div" },
  { label: "Review" },
];

interface Props {
  leagueId: string;
  leagueName: string;
  initialData: PlayoffWizardData;
  isEditMode: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function PlayoffWizard({
  leagueId,
  leagueName,
  initialData,
  isEditMode,
  onClose,
  onComplete,
}: Props) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<PlayoffWizardData>(initialData);

  const update = useCallback((patch: Partial<PlayoffWizardData>) => {
    setData((prev) => ({ ...prev, ...patch }));
  }, []);

  const step0Valid = data.division_id !== "";
  const canAdvance = step === 0 ? step0Valid : true;

  const stepContent = [
    <StepDivision key="division" data={data} update={update} leagueId={leagueId} />,
    <StepFormat key="format" data={data} update={update} />,
    <StepSeeding key="seeding" data={data} update={update} />,
    <StepDates key="dates" data={data} update={update} />,
    <StepVenues key="venues" data={data} update={update} leagueId={leagueId} />,
    <StepCrossDivision key="cross" data={data} update={update} leagueId={leagueId} />,
    <StepReview key="review" data={data} leagueId={leagueId} onEdit={setStep} onComplete={onComplete} />,
  ];

  const REVIEW_STEP = STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:h-[90vh] sm:max-w-2xl sm:rounded-2xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="font-semibold text-[#0C1F3F]">
              {isEditMode ? "Edit playoffs" : "Set up playoffs"}
            </h2>
            <p className="text-xs text-gray-400">{leagueName}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex flex-shrink-0 items-center gap-0.5 overflow-x-auto border-b border-gray-100 px-6 py-3">
          {STEPS.map((s, i) => (
            <div key={i} className="flex min-w-0 items-center gap-0.5">
              <button
                onClick={() => (isEditMode || i < step) && setStep(i)}
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i === step
                    ? "bg-[#22C55E] text-white"
                    : i < step || isEditMode
                    ? "cursor-pointer bg-[#22C55E]/20 text-[#22C55E] hover:bg-[#22C55E]/30"
                    : "cursor-default bg-gray-100 text-gray-400"
                }`}
              >
                {i < step ? (
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </button>
              <span
                className={`hidden whitespace-nowrap px-1 text-xs sm:inline ${
                  i === step ? "font-semibold text-[#0C1F3F]" : "text-gray-400"
                }`}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-1 h-px w-4 flex-shrink-0 sm:w-5 ${
                    i < step ? "bg-[#22C55E]/40" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {stepContent[step]}
        </div>

        {/* Footer — hidden on review step (has its own CTA) */}
        {step < REVIEW_STEP && (
          <div className="flex flex-shrink-0 items-center justify-between border-t border-gray-100 px-6 py-4">
            <button
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <span className="text-xs text-gray-400">
              Step {step + 1} of {STEPS.length}
            </span>
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

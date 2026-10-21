"use client";

import { useState, useCallback, useMemo } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { StepDivision } from "./steps/step-division";
import { StepFormat } from "./steps/step-format";
import { StepSeeding } from "./steps/step-seeding";
import { StepDates } from "./steps/step-dates";
import { StepVenues } from "./steps/step-venues";
import { StepReview } from "./steps/step-review";
import { StepTeams } from "./steps/step-teams";
import { StepStageDates } from "./steps/step-stage-dates";
import { StepTwoStageReview } from "./steps/step-two-stage-review";
import type { PlayoffWizardData, PlayingDay } from "./playoff-wizard-types";
import type { WindowStash } from "@/lib/divisions/day-window-toggle";

const STEPS = [
  { label: "Division" },
  { label: "Format" },
  { label: "Seeding" },
  { label: "Dates" },
  { label: "Venues" },
  { label: "Review" },
];
// The Cross-division step (steps/step-cross-division.tsx) is HIDDEN until
// cross-division playoffs are built: the planner never reads its settings.
// The saved cross_division_* values still ride through untouched — a new
// bracket saves the defaults and Edit setup saves back what the row holds
// (settingsPayload), so existing brackets don't change.

// "Round robin, then bracket": no seed order (the bracket is seeded after the
// round robin), one Dates & fields step for both stages, and no Cross-division
// step (saved today but never used by the generator).
const TWO_STAGE_STEPS = [
  { label: "Division" },
  { label: "Format" },
  { label: "Teams" },
  { label: "Dates & fields" },
  { label: "Review" },
];

/** Editing an existing two-stage setup: both rows, and whether the round
 *  robin has results (then only Stage 2's dates and fields can change). */
export type TwoStageEdit = { stage1Id: string; stage2Id: string; stage1HasResults: boolean };

interface Props {
  leagueId: string;
  leagueName: string;
  initialData: PlayoffWizardData;
  isEditMode: boolean;
  /** The bracket being edited; null when setting up a new one. */
  playoffId: string | null;
  /** Set when editing a two-stage setup. */
  twoStageEdit?: TwoStageEdit | null;
  currentOrgId: string;
  onClose: () => void;
  onComplete: () => void;
}

export function PlayoffWizard({
  leagueId,
  leagueName,
  initialData,
  isEditMode,
  playoffId,
  twoStageEdit = null,
  currentOrgId,
  onClose,
  onComplete,
}: Props) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<PlayoffWizardData>(initialData);

  const update = useCallback((patch: Partial<PlayoffWizardData>) => {
    setData((prev) => ({ ...prev, ...patch }));
  }, []);

  // Windows removed by switching a day OFF in this session, so switching it
  // back on restores the hours that were typed. Held HERE, not in the Dates
  // step (only the current step is mounted), and deliberately outside
  // PlayoffWizardData so it can never reach the saved playoff row. Same rule
  // and same shared function as the division wizard — see
  // lib/divisions/day-window-toggle.ts.
  const [dayWindowStash, setDayWindowStash] = useState<WindowStash<PlayingDay>>({});
  // Stage 2's own stash (two-stage only).
  const [stage2Stash, setStage2Stash] = useState<WindowStash<PlayingDay>>({});
  const existingPair = useMemo(
    () => (twoStageEdit ? { stage1Id: twoStageEdit.stage1Id, stage2Id: twoStageEdit.stage2Id } : null),
    [twoStageEdit],
  );

  const step0Valid = data.division_id !== "";
  const canAdvance = step === 0 ? step0Valid : true;

  const twoStage = data.two_stage;
  const steps = twoStage ? TWO_STAGE_STEPS : STEPS;
  const editingTwoStage = isEditMode ? !!twoStageEdit : null;

  const twoStageContent = [
    <StepDivision key="division" data={data} update={update} leagueId={leagueId} isEditMode={isEditMode} />,
    <StepFormat key="format" data={data} update={update} editingTwoStage={editingTwoStage} />,
    <StepTeams
      key="teams"
      data={data}
      update={update}
      lockedReason={
        twoStageEdit?.stage1HasResults
          ? "The round robin has results, so the team list and the number advancing can't change. Stage 2's dates, days and fields still can."
          : null
      }
    />,
    <StepStageDates
      key="stage-dates"
      data={data}
      update={update}
      currentOrgId={currentOrgId}
      stash1={dayWindowStash}
      stash2={stage2Stash}
      onStash1Change={setDayWindowStash}
      onStash2Change={setStage2Stash}
    />,
    <StepTwoStageReview
      key="review"
      data={data}
      original={isEditMode ? initialData : null}
      leagueId={leagueId}
      existing={existingPair}
      onEdit={setStep}
      onComplete={onComplete}
    />,
  ];

  const stepContent = [
    <StepDivision key="division" data={data} update={update} leagueId={leagueId} isEditMode={isEditMode} />,
    <StepFormat key="format" data={data} update={update} editingTwoStage={editingTwoStage} />,
    <StepSeeding key="seeding" data={data} update={update} />,
    <StepDates
      key="dates"
      data={data}
      update={update}
      windowStash={dayWindowStash}
      onWindowStashChange={setDayWindowStash}
    />,
    <StepVenues key="venues" data={data} update={update} leagueId={leagueId} currentOrgId={currentOrgId} />,
    <StepReview key="review" data={data} leagueId={leagueId} playoffId={playoffId} onEdit={setStep} onComplete={onComplete} />,
  ];

  const REVIEW_STEP = steps.length - 1;
  const content = twoStage ? twoStageContent : stepContent;

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
          {steps.map((s, i) => (
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
              {i < steps.length - 1 && (
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
          {content[Math.min(step, content.length - 1)]}
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
              Step {step + 1} of {steps.length}
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

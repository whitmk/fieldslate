"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { StepBasics } from "./steps/step-basics";
import { StepPlayingSchedule } from "./steps/step-playing-schedule";
import { StepFields } from "./steps/step-fields";
import { StepUmpires } from "./steps/step-umpires";
import { StepFormat } from "./steps/step-format";
import { StepInterleague } from "./steps/step-interleague";
import { StepCoaches } from "./steps/step-coaches";
import { StepReview } from "./steps/step-review";
import { DEFAULT_WIZARD_DATA, type WizardData } from "./wizard-types";
import type { Division } from "@/types/database";
import { getOfficialTitlePlural } from "@/lib/utils/official-title";

interface Props {
  leagueId: string;
  leagueName: string;
  leagueSport?: string;
  leagueStartDate?: string;
  leagueEndDate?: string;
  currentOrgId: string;
  onClose: () => void;
  onComplete: () => void;
  editDivision?: Division;
  initialData?: WizardData;
}

export function DivisionWizard({ leagueId, leagueName, leagueSport, leagueStartDate, leagueEndDate, currentOrgId, onClose, onComplete, editDivision, initialData }: Props) {
  const officialsPlural = getOfficialTitlePlural(leagueSport);

  const STEPS = [
    { label: "Basics" },
    { label: "Schedule" },
    { label: "Fields" },
    { label: officialsPlural },
    { label: "Format" },
    { label: "Interleague" },
    { label: "Coaches" },
    { label: "Review" },
  ];
  const isEditMode = !!editDivision;
  const draftKey = `fieldslate:division-draft:${leagueId}`;

  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(() => {
    if (isEditMode && initialData) return initialData;
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) return JSON.parse(saved) as WizardData;
      } catch {}
    }
    return {
      ...DEFAULT_WIZARD_DATA,
      start_date: leagueStartDate ?? DEFAULT_WIZARD_DATA.start_date,
      end_date: leagueEndDate ?? DEFAULT_WIZARD_DATA.end_date,
    };
  });

  // Auto-save draft only in create mode
  useEffect(() => {
    if (!isEditMode) localStorage.setItem(draftKey, JSON.stringify(data));
  }, [data, draftKey, isEditMode]);

  // Keep teams array length in sync with team_count
  useEffect(() => {
    setData((prev) => {
      if (prev.teams.length === prev.team_count) return prev;
      const teams = Array.from({ length: prev.team_count }, (_, i) =>
        prev.teams[i] ?? {
          name: `Team ${i + 1}`,
          has_coach_conflict: false,
          conflict_division: "",
          conflict_team: "",
        }
      );
      return { ...prev, teams };
    });
  }, [data.team_count]);

  const update = useCallback((patch: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...patch }));
  }, []);

  function clearAndClose() {
    if (!isEditMode) localStorage.removeItem(draftKey);
    onClose();
  }

  function handleComplete() {
    localStorage.removeItem(draftKey);
    onComplete();
  }

  const step1Valid =
    data.name.trim() !== "" && data.start_date !== "" && data.end_date !== "";
  const canAdvance = step === 0 ? step1Valid : true;

  const stepContent = [
    <StepBasics key="basics" data={data} update={update} />,
    <StepPlayingSchedule key="schedule" data={data} update={update} leagueId={leagueId} />,
    <StepFields key="fields" data={data} update={update} leagueId={leagueId} currentOrgId={currentOrgId} />,
    <StepUmpires key="umpires" data={data} update={update} sport={leagueSport} />,
    <StepFormat key="format" data={data} update={update} />,
    <StepInterleague key="interleague" data={data} update={update} />,
    <StepCoaches key="coaches" data={data} update={update} leagueId={leagueId} />,
    <StepReview
      key="review"
      data={data}
      originalData={isEditMode ? initialData : undefined}
      leagueId={leagueId}
      sport={leagueSport}
      onEdit={setStep}
      onComplete={handleComplete}
      divisionId={editDivision?.id}
    />,
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:h-[90vh] sm:max-w-2xl sm:rounded-2xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="font-semibold text-[#0C1F3F]">
              {isEditMode ? "Edit division" : "Add division"}
            </h2>
            <p className="text-xs text-gray-400">{leagueName}</p>
          </div>
          <button
            onClick={clearAndClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex flex-shrink-0 items-center gap-0.5 border-b border-gray-100 px-6 py-3 overflow-x-auto">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-0.5 min-w-0">
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
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
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
        <div className="flex-1 overflow-y-auto px-6 py-6">{stepContent[step]}</div>

        {/* Footer — hidden on review step (has its own CTA) */}
        {step < STEPS.length - 1 && (
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

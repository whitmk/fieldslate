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
import { WizardPreviewStep } from "./steps/wizard-preview-step";
import { DEFAULT_WIZARD_DATA, type WizardData } from "./wizard-types";
import type { Division } from "@/types/database";
import { getOfficialTitle, getOfficialTitlePlural } from "@/lib/utils/official-title";
import { isElite, isProPlus, type Plan } from "@/lib/plan/limits";

interface Props {
  leagueId: string;
  leagueName: string;
  leagueSport?: string;
  leagueStartDate?: string;
  leagueEndDate?: string;
  currentOrgId: string;
  /** Org-wide team count + cap, forwarded to the review step (upfront cap
   *  check) and to step-basics (clamp the "number of teams" input to real
   *  headroom). */
  teamCount: number;
  teamLimit: number;
  plan: Plan;
  /** In edit mode, the live team count in this division (from the teams
   *  table). Those teams stay after save, so they add back to the input's
   *  available headroom. New mode passes 0. */
  existingTeamCountInDivision?: number;
  onClose: () => void;
  onComplete: () => void;
  editDivision?: Division;
  initialData?: WizardData;
}

export function DivisionWizard({ leagueId, leagueName, leagueSport, leagueStartDate, leagueEndDate, currentOrgId, teamCount, teamLimit, plan, existingTeamCountInDivision = 0, onClose, onComplete, editDivision, initialData }: Props) {
  const officialsPlural = getOfficialTitlePlural(leagueSport);

  // Step order puts the tier-gated steps (Umpires = Elite, Interleague = Pro+)
  // immediately before Review, so non-entitled users hit the preview/upsell
  // screens last. Format stays ahead of Interleague (its games-per-team preview
  // reads interleague data — same relative order as before the reorder).
  const STEPS = [
    { label: "Basics" },
    { label: "Schedule" },
    { label: "Fields" },
    { label: "Format" },
    { label: "Coaches" },
    { label: officialsPlural },
    { label: "Interleague" },
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

  // Tier-gated steps render an upsell-preview instead of the real step for
  // non-entitled plans (Umpires = Elite, Interleague = Pro+). Clear any gated
  // values in CREATE mode — including stale localStorage drafts — so a skipped
  // preview never persists umpire/interleague data the plan can't use. Edit
  // mode keeps existing config (the real step is shown when data exists), so
  // opening the wizard never silently wipes a saved division.
  useEffect(() => {
    if (isEditMode) return;
    setData((prev) => {
      let next = prev;
      if (!isElite(plan) && (prev.umpires_per_game !== 0 || prev.umpire_roles.length > 0)) {
        next = { ...next, umpires_per_game: 0, umpire_roles: [] };
      }
      if (!isProPlus(plan) && (prev.plays_interleague || prev.interleague_games.length > 0)) {
        next = { ...next, plays_interleague: false, interleague_games: [] };
      }
      return next;
    });
  }, [plan, isEditMode]);

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

  // Umpires is Elite-only; Interleague is Pro+. Non-entitled users get a
  // skippable upsell preview instead of the real step. Edit mode shows the real
  // step when the division already has data so existing config stays editable.
  const officialTitle = getOfficialTitle(leagueSport);
  const showUmpiresReal = isElite(plan) || (isEditMode && data.umpires_per_game > 0);
  const showInterleagueReal = isProPlus(plan) || (isEditMode && data.plays_interleague);

  const umpiresStep = showUmpiresReal ? (
    <StepUmpires key="umpires" data={data} update={update} sport={leagueSport} />
  ) : (
    <WizardPreviewStep
      key="umpires-preview"
      feature={`${officialTitle} assignment`}
      tier="Elite"
      description={`Assign ${officialsPlural.toLowerCase()} to games and auto-fill open slots across your schedule.`}
      previewBenefits={[
        `Set how many ${officialsPlural.toLowerCase()} each game needs`,
        `Build a season ${officialTitle.toLowerCase()} roster`,
        `Auto-assign ${officialsPlural.toLowerCase()} and catch coverage shortfalls`,
      ]}
      onSkip={() => setStep((s) => s + 1)}
    />
  );

  const interleagueStep = showInterleagueReal ? (
    <StepInterleague
      key="interleague"
      data={data}
      update={update}
      currentOrgId={currentOrgId}
      plan={plan}
      leagueId={leagueId}
    />
  ) : (
    <WizardPreviewStep
      key="interleague-preview"
      feature="Interleague play"
      tier="Pro"
      description="Schedule games against other organizations and invite them to confirm matchups together."
      previewBenefits={[
        "Add partner leagues you play against",
        "Configure home/away interleague games per team",
        "Send invites and resolve scheduling with the other org",
      ]}
      onSkip={() => setStep((s) => s + 1)}
    />
  );

  const stepContent = [
    <StepBasics
      key="basics"
      data={data}
      update={update}
      teamLimit={teamLimit}
      teamCount={teamCount}
      existingTeamCountInDivision={existingTeamCountInDivision}
    />,
    <StepPlayingSchedule key="schedule" data={data} update={update} leagueId={leagueId} />,
    <StepFields key="fields" data={data} update={update} leagueId={leagueId} currentOrgId={currentOrgId} />,
    <StepFormat key="format" data={data} update={update} />,
    <StepCoaches key="coaches" data={data} update={update} leagueId={leagueId} />,
    umpiresStep,
    interleagueStep,
    <StepReview
      key="review"
      data={data}
      originalData={isEditMode ? initialData : undefined}
      leagueId={leagueId}
      currentOrgId={currentOrgId}
      sport={leagueSport}
      onEdit={setStep}
      onComplete={handleComplete}
      divisionId={editDivision?.id}
      teamCount={teamCount}
      teamLimit={teamLimit}
      plan={plan}
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

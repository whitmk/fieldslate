"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserCheck,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import { autoAssignUmpires, type SkipReason } from "@/lib/umpires/auto-assign";
import {
  getOfficialTitleLower,
  getOfficialTitlePlural,
  getOfficialTitlePluralLower,
} from "@/lib/utils/official-title";

/** Shared with the season-wide button so skip copy can't drift. */
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  conflict: "time conflicts",
  blackout: "blackout dates",
  coach_conflict: "coach conflicts",
  conflict_of_interest: "conflicts of interest",
  outside_availability: "outside listed availability",
  over_weekly_limit: "over weekly limit",
};

/**
 * To-do phrasing for slots auto-assign left open — shared by both entry
 * points. Officials blocked only by availability windows or weekly caps are
 * named: they're the ones to ask before assigning manually from the game.
 */
export function openSlotsSummary(
  skipped: number,
  reasons: SkipReason[],
  outsideAvailabilityNames: string[],
  overWeeklyLimitNames: string[],
): string {
  const base = `${skipped} slot${skipped !== 1 ? "s" : ""} left open`;
  const details: string[] = [];
  if (outsideAvailabilityNames.length > 0) {
    details.push(
      `outside listed availability: ${outsideAvailabilityNames.join(", ")}`,
    );
  }
  if (overWeeklyLimitNames.length > 0) {
    details.push(`over weekly limit: ${overWeeklyLimitNames.join(", ")}`);
  }
  const hard = reasons.filter(
    (r) => r !== "outside_availability" && r !== "over_weekly_limit",
  );
  if (hard.length > 0) {
    details.push(hard.map((r) => SKIP_REASON_LABELS[r]).join(", "));
  }
  const askTail =
    outsideAvailabilityNames.length + overWeeklyLimitNames.length > 0
      ? " Ask them, then assign manually from the game."
      : "";
  return `${base}${details.length > 0 ? ` — ${details.join(" · ")}` : ""}.${askTail}`;
}

/** Constraint explainer shared by both confirm dialogs. */
export function ConstraintCopy({ sport }: { sport?: string | null }) {
  return (
    <p>
      Assignments you&apos;ve already made are kept — only empty slots are
      filled. {getOfficialTitlePlural(sport)} are never assigned on their
      blackout dates, to games that overlap one they&apos;re already working,
      or to games involving a team they coach or have a conflict of interest
      with — and only within their listed availability and weekly limits.
      Slots nobody qualifies for stay open so you can ask first, then assign
      manually from the game.
    </p>
  );
}

interface Props {
  divisionId: string;
  seasonId: string;
  /** Hide the button entirely when the division doesn't require officials. */
  enabled: boolean;
  sport?: string | null;
  /** Fires after a successful run. Parents holding assignments in client
   *  state must re-fetch here — router.refresh() alone only reaches server
   *  components, so without this their selects keep stale values. */
  onAssigned?: () => void;
}

type RunResult = {
  filled: number;
  fallbackFilled: number;
  skipped: number;
  skipReasons: SkipReason[];
  outsideAvailabilityNames: string[];
  overWeeklyLimitNames: string[];
};

/**
 * Per-division auto-assign entry point (division schedule panel). Confirms
 * through the same dialog + fallback opt-in as the season-wide button —
 * the two surfaces must behave identically.
 */
export function AutoAssignUmpiresButton({
  divisionId,
  seasonId,
  enabled,
  sport,
  onAssigned,
}: Props) {
  const officialLower = getOfficialTitleLower(sport);
  const officialsLower = getOfficialTitlePluralLower(sport);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { kind: "ok"; run: RunResult } | { kind: "err"; message: string } | null
  >(null);

  if (!enabled) return null;

  function openDialog() {
    setResult(null);
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setResult(null);
  }

  async function handleRun() {
    setBusy(true);
    const res = await autoAssignUmpires(divisionId, seasonId);
    setBusy(false);
    if (!res.success) {
      setResult({ kind: "err", message: res.error ?? "Auto-assign failed." });
      return;
    }
    setResult({
      kind: "ok",
      run: {
        filled: res.filled,
        fallbackFilled: res.fallbackFilled,
        skipped: res.skipped,
        skipReasons: res.skipReasons,
        outsideAvailabilityNames: res.outsideAvailabilityNames,
        overWeeklyLimitNames: res.overWeeklyLimitNames,
      },
    });
    router.refresh();
    onAssigned?.();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
      >
        <UserCheck className="h-4 w-4" />
        Auto-assign {officialsLower}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[#22C55E]" />
                <h2 className="font-semibold text-[#0C1F3F]">
                  {result ? "Auto-assign results" : "Auto-assign this division?"}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!result ? (
              <div className="flex flex-col gap-4 px-6 py-5 text-sm text-gray-700">
                <p>
                  This fills every open {officialLower} slot in this
                  division&apos;s schedule.
                </p>
                <ConstraintCopy sport={sport} />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16A34A] disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserCheck className="h-4 w-4" />
                    )}
                    {busy ? "Assigning…" : "Run auto-assign"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-col">
                <div className="flex flex-col gap-3 overflow-y-auto px-6 py-5 text-sm text-gray-700">
                  {result.kind === "err" ? (
                    <p className="flex items-start gap-2 text-red-600">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{result.message}</span>
                    </p>
                  ) : (
                    <DivisionRunSummary run={result.run} />
                  )}
                </div>
                <div className="flex justify-end border-t border-gray-100 px-6 py-4">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function DivisionRunSummary({ run }: { run: RunResult }) {
  const totalSlots = run.filled + run.skipped;
  const clean = run.skipped === 0 && run.fallbackFilled === 0;
  return (
    <>
      <p className="flex items-start gap-1.5 font-semibold text-[#0C1F3F]">
        {clean ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#22C55E]" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        )}
        <span>
          {totalSlots === 0
            ? "Nothing to assign — every slot is already filled."
            : `${run.filled} of ${totalSlots} open slot${totalSlots !== 1 ? "s" : ""} filled.`}
        </span>
      </p>
      {run.fallbackFilled > 0 && (
        <p className="text-amber-700">
          {run.fallbackFilled} assignment
          {run.fallbackFilled !== 1 ? "s" : ""} filled outside availability or
          weekly limits (you opted in) — confirm with those officials.
        </p>
      )}
      {run.skipped > 0 && (
        <p className="text-amber-700">
          {openSlotsSummary(
            run.skipped,
            run.skipReasons,
            run.outsideAvailabilityNames,
            run.overWeeklyLimitNames,
          )}
        </p>
      )}
    </>
  );
}

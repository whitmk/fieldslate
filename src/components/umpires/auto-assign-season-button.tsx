"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserCheck,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  X,
} from "lucide-react";
import {
  autoAssignSeason,
  type SeasonAutoAssignResult,
  type SeasonDivisionResult,
} from "@/lib/umpires/auto-assign-season";
import { ConstraintCopy, openSlotsSummary } from "./auto-assign-button";
import {
  getOfficialTitleLower,
  getOfficialTitlePluralLower,
} from "@/lib/utils/official-title";

interface Props {
  seasonId: string;
  seasonName: string;
  sport?: string | null;
}

/**
 * Season-wide auto-assign entry point, rendered next to the Division
 * priority card so the ordering's purpose is visible. Confirms in plain
 * English before running, then shows a per-division results summary.
 * The per-division AutoAssignUmpiresButton (division schedule panel) is a
 * separate, untouched surface.
 */
export function AutoAssignSeasonButton({ seasonId, seasonName, sport }: Props) {
  const officialLower = getOfficialTitleLower(sport);
  const officialsLower = getOfficialTitlePluralLower(sport);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SeasonAutoAssignResult | null>(null);

  function openDialog() {
    setResult(null);
    setOpen(true);
  }

  function close() {
    if (running) return;
    setOpen(false);
    setResult(null);
  }

  async function handleRun() {
    setRunning(true);
    const res = await autoAssignSeason(seasonId);
    setRunning(false);
    setResult(res);
    // Refresh regardless of outcome — a partial run still wrote assignments.
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
      >
        <UserCheck className="h-4 w-4" />
        Auto-assign season
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
                  {result ? "Auto-assign results" : "Auto-assign the season?"}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={running}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!result ? (
              <div className="flex flex-col gap-4 px-6 py-5 text-sm text-gray-700">
                <p>
                  This fills every open {officialLower} slot in{" "}
                  <span className="font-semibold">{seasonName}</span>, working
                  through divisions in the priority order below — higher
                  divisions get first pick of available {officialsLower}.
                </p>
                <ConstraintCopy sport={sport} />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={close}
                    disabled={running}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={running}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16A34A] disabled:opacity-60"
                  >
                    {running ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserCheck className="h-4 w-4" />
                    )}
                    {running ? "Assigning…" : "Run auto-assign"}
                  </button>
                </div>
              </div>
            ) : (
              <SeasonResults
                result={result}
                officialsLower={officialsLower}
                onClose={close}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SeasonResults({
  result,
  officialsLower,
  onClose,
}: {
  result: SeasonAutoAssignResult;
  officialsLower: string;
  onClose: () => void;
}) {
  if (!result.success) {
    return (
      <div className="flex flex-col gap-4 px-6 py-5 text-sm">
        <p className="flex items-start gap-2 text-red-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>Couldn&apos;t load the season&apos;s divisions: {result.error}</span>
        </p>
        <div className="flex justify-end">
          <CloseButton onClose={onClose} />
        </div>
      </div>
    );
  }

  const totalSlots = result.totalFilled + result.totalSkipped;
  const errored = result.divisions.filter((d) => d.status === "error");

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-3 overflow-y-auto px-6 py-5 text-sm text-gray-700">
        <p className="font-semibold text-[#0C1F3F]">
          {totalSlots === 0
            ? "Nothing to assign — every slot is already filled."
            : `${result.totalFilled} of ${totalSlots} open slot${totalSlots !== 1 ? "s" : ""} filled.`}
        </p>
        {result.totalFallbackFilled > 0 && (
          <p className="flex items-start gap-1.5 text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              {result.totalFallbackFilled} assignment
              {result.totalFallbackFilled !== 1 ? "s" : ""} filled outside
              availability or weekly limits (you opted in) — confirm with
              those officials.
            </span>
          </p>
        )}
        {result.totalSkipped > 0 && (
          <p className="flex items-start gap-1.5 text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              {result.totalSkipped} slot{result.totalSkipped !== 1 ? "s" : ""}{" "}
              left open — each division below lists why, and which{" "}
              {officialsLower} to ask before assigning manually.
            </span>
          </p>
        )}
        {errored.length > 0 && (
          <p className="flex items-start gap-1.5 text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              {errored.length} division{errored.length !== 1 ? "s" : ""} hit an
              error — the rest of the season was still assigned.
            </span>
          </p>
        )}

        <ul className="flex flex-col gap-1.5 pt-1">
          {result.divisions.map((d) => (
            <DivisionResultRow
              key={d.divisionId}
              division={d}
              officialsLower={officialsLower}
            />
          ))}
        </ul>
      </div>
      <div className="flex justify-end border-t border-gray-100 px-6 py-4">
        <CloseButton onClose={onClose} />
      </div>
    </div>
  );
}

function DivisionResultRow({
  division: d,
  officialsLower,
}: {
  division: SeasonDivisionResult;
  officialsLower: string;
}) {
  let icon: React.ReactNode;
  let detail: React.ReactNode;

  if (d.status === "no_slots_required") {
    icon = <MinusCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-300" />;
    detail = (
      <span className="text-gray-400">doesn&apos;t use {officialsLower}</span>
    );
  } else if (d.status === "error") {
    icon = <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />;
    detail = <span className="text-red-600">{d.error}</span>;
  } else {
    const clean = d.skipped === 0 && d.fallbackFilled === 0;
    icon = clean ? (
      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#22C55E]" />
    ) : (
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
    );
    detail = (
      <span className={clean ? "text-gray-600" : "text-amber-700"}>
        {d.filled === 0 && d.skipped === 0
          ? "all slots already filled"
          : `${d.filled} slot${d.filled !== 1 ? "s" : ""} filled${
              d.fallbackFilled > 0
                ? ` · ${d.fallbackFilled} outside availability or weekly limits (opted in)`
                : ""
            }${
              d.skipped > 0
                ? ` · ${openSlotsSummary(
                    d.skipped,
                    d.skipReasons,
                    d.outsideAvailabilityNames,
                    d.overWeeklyLimitNames,
                  )}`
                : ""
            }`}
      </span>
    );
  }

  return (
    <li className="flex items-start gap-2 rounded-lg border border-gray-100 px-3 py-2">
      {icon}
      <div className="min-w-0 text-sm">
        <span className="font-medium text-gray-900">{d.divisionName}</span>{" "}
        — {detail}
      </div>
    </li>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
    >
      Done
    </button>
  );
}

"use client";

import { useState } from "react";
import { X, Printer, Download, CalendarDays, FileUp, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Division } from "@/types/database";
import type { DivisionStat } from "@/app/(dashboard)/dashboard/leagues/[id]/page";
import {
  buildSportsConnectCsv,
  fetchSportsConnectGames,
} from "@/lib/schedule/sports-connect-export";
import { exportGenericGamesCsv } from "@/lib/schedule/generic-games-export";

export type PrintMode = "games";

interface Props {
  divisions: Division[];
  divisionStats: DivisionStat[];
  leagueName: string;
  /** Sports Connect row is Pro-gated, matching /dashboard/export's server
   *  gate — the generic CSV/print row stays Free. */
  isPro: boolean;
  onClose: () => void;
  onPrint: (divisionId: string, mode: PrintMode) => void;
}

// ALL CSV logic lives in src/lib/schedule/ — generic-games-export.ts and
// sports-connect-export.ts, which share one fetch and one game-selection
// function. This modal only picks a division, calls them, and downloads.
// Never read games or format a row here.

function slugify(s: string) {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Component ────────────────────────────────────────────────────────────────

export function ExportPickerModal({
  divisions, divisionStats, leagueName, isPro, onClose, onPrint,
}: Props) {
  const [selectedDivisionId, setSelectedDivisionId] = useState(
    divisions.length === 1 ? divisions[0].id : "",
  );
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [doneAction, setDoneAction] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const selectedDivision = divisions.find((d) => d.id === selectedDivisionId);

  // BOM helps Excel; the Sports Connect file feeds an importer, so it skips it.
  function triggerDownload(csv: string, filename: string, bom = true) {
    const blob = new Blob([bom ? "﻿" + csv : csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCsv() {
    if (!selectedDivision) return;
    const key = "games-csv";
    setLoadingAction(key);
    setExportError(null);

    const today = new Date().toISOString().substring(0, 10).replace(/-/g, "");
    const base = `FieldSlate-${slugify(leagueName)}-${slugify(selectedDivision.name)}`;

    try {
      const result = await exportGenericGamesCsv(
        createClient(),
        selectedDivisionId,
        selectedDivision.name,
      );
      // A failed read downloads NOTHING — a header-only file would read as
      // "this division has no games".
      if (!result.ok) {
        setExportError(
          "Couldn't read this division's games, so no file was downloaded. Check your connection and try again.",
        );
      } else {
        triggerDownload(result.csv, `${base}-games-${today}.csv`);
        setDoneAction(key);
        setTimeout(() => setDoneAction(null), 3000);
      }
    } catch (err) {
      console.error("[ExportPickerModal] CSV export failed:", err);
      setExportError(
        "Couldn't read this division's games, so no file was downloaded. Check your connection and try again.",
      );
    }

    setLoadingAction(null);
  }

  async function handleSportsConnectCsv() {
    if (!selectedDivision) return;
    const key = "sportsconnect-csv";
    setLoadingAction(key);
    setExportError(null);

    const today = new Date().toISOString().substring(0, 10).replace(/-/g, "");
    const base = `FieldSlate-${slugify(leagueName)}-${slugify(selectedDivision.name)}`;

    try {
      const fetched = await fetchSportsConnectGames(createClient(), selectedDivisionId);
      if (!fetched.ok) {
        setExportError("Export failed — check your connection and try again.");
        setLoadingAction(null);
        return;
      }
      const settings = (selectedDivision.settings ?? {}) as { game_duration?: number };
      const result = buildSportsConnectCsv(
        fetched.games,
        settings.game_duration,
        selectedDivision.name,
      );
      if (!result.ok) {
        setExportError(result.error);
      } else {
        triggerDownload(result.csv, `${base}-sportsconnect-${today}.csv`, false);
        setDoneAction(key);
        setTimeout(() => setDoneAction(null), 3000);
      }
    } catch (err) {
      console.error("[ExportPickerModal] Sports Connect export failed:", err);
      setExportError("Export failed — check your connection and try again.");
    }

    setLoadingAction(null);
  }

  function handlePrint() {
    if (!selectedDivision) return;
    onPrint(selectedDivision.id, "games");
    onClose();
  }

  const canAct = !!selectedDivision;
  const csvKey = "games-csv";
  const isDownloading = loadingAction === csvKey;
  const isDone = doneAction === csvKey;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-[#0C1F3F]">Export Schedule</h3>
            <p className="mt-0.5 text-xs text-gray-400">Download or print the game schedule</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#0C1F3F]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {/* Division picker — only when multiple */}
          {divisions.length > 1 && (
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-gray-500">Division</label>
              <select
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                value={selectedDivisionId}
                onChange={(e) => { setSelectedDivisionId(e.target.value); setExportError(null); }}
              >
                <option value="">Select a division…</option>
                {divisions.map((d) => {
                  const stat = divisionStats.find((s) => s.divisionId === d.id);
                  const gameCount = stat?.gameCount ?? 0;
                  return (
                    <option key={d.id} value={d.id}>
                      {d.name} ({gameCount} game{gameCount !== 1 ? "s" : ""})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Export option row */}
          <div className="flex flex-col gap-2">
            <div
              className={`flex items-center gap-4 rounded-xl border border-gray-100 px-4 py-3 ${!canAct ? "opacity-50" : ""}`}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                <CalendarDays className="h-4 w-4 text-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0C1F3F]">Games</p>
                <p className="text-xs text-gray-400">Game schedule</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  disabled={!canAct}
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Printer className="h-3 w-3" />
                  Print
                </button>
                <button
                  disabled={!canAct || !!loadingAction}
                  onClick={handleCsv}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isDone
                      ? "border-[#22C55E] bg-[#22C55E]/5 text-[#22C55E]"
                      : "border-gray-200 text-gray-600 hover:border-emerald-400 hover:text-emerald-600"
                  }`}
                >
                  {isDownloading ? (
                    <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  {isDone ? "Downloaded!" : "CSV"}
                </button>
              </div>
            </div>

            {/* Sports Connect import CSV */}
            <div
              className={`flex items-center gap-4 rounded-xl border border-gray-100 px-4 py-3 ${!canAct ? "opacity-50" : ""}`}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                <FileUp className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0C1F3F]">Sports Connect</p>
                <p className="text-xs text-gray-400">Import-ready CSV with rounds and end times</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {isPro ? (
                  <button
                    disabled={!canAct || !!loadingAction}
                    onClick={handleSportsConnectCsv}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      doneAction === "sportsconnect-csv"
                        ? "border-[#22C55E] bg-[#22C55E]/5 text-[#22C55E]"
                        : "border-gray-200 text-gray-600 hover:border-emerald-400 hover:text-emerald-600"
                    }`}
                  >
                    {loadingAction === "sportsconnect-csv" ? (
                      <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {doneAction === "sportsconnect-csv" ? "Downloaded!" : "CSV"}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-400">
                    <Lock className="h-3 w-3" />
                    Pro plan
                  </span>
                )}
              </div>
            </div>

            {exportError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                {exportError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

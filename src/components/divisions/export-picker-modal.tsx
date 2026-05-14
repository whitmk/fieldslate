"use client";

import { useState } from "react";
import { X, Printer, Download, CalendarDays, Dumbbell, LayoutList } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Division } from "@/types/database";
import type { DivisionStat } from "@/app/(dashboard)/dashboard/leagues/[id]/page";

export type PrintMode = "games" | "practices" | "combined";

interface Props {
  divisions: Division[];
  divisionStats: DivisionStat[];
  leagueName: string;
  onClose: () => void;
  onPrint: (divisionId: string, mode: PrintMode) => void;
}

// ── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  return `"${val.replace(/"/g, '""')}"`;
}

function fmtCsvDate(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

function fmtCsvTime(iso: string): string {
  const [hourStr, minStr] = iso.substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const h12 = hour % 12 || 12;
  return `${h12.toString().padStart(2, "0")}:${minStr} ${hour >= 12 ? "PM" : "AM"}`;
}

function fmtPracticeTime(hhmm: string): string {
  const [hourStr, minStr] = hhmm.split(":");
  const hour = parseInt(hourStr, 10);
  const h12 = hour % 12 || 12;
  return `${h12.toString().padStart(2, "0")}:${minStr} ${hour >= 12 ? "PM" : "AM"}`;
}

function fmtPracticeDate(yyyymmdd: string): string {
  const [year, month, day] = yyyymmdd.split("-");
  return `${month}/${day}/${year}`;
}

function slugify(s: string) {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type GameRow = {
  scheduled_at: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

type PracticeRow = {
  scheduled_date: string;
  start_time: string;
  team: { name: string } | null;
  venue: { name: string } | null;
};

// ── Component ────────────────────────────────────────────────────────────────

export function ExportPickerModal({
  divisions, divisionStats, leagueName, onClose, onPrint,
}: Props) {
  const [selectedDivisionId, setSelectedDivisionId] = useState(
    divisions.length === 1 ? divisions[0].id : "",
  );
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [doneAction, setDoneAction] = useState<string | null>(null);

  const selectedDivision = divisions.find((d) => d.id === selectedDivisionId);

  async function fetchGames(divisionId: string): Promise<GameRow[]> {
    const supabase = createClient();
    const { data: teamData } = await supabase
      .from("teams").select("id").eq("division_id", divisionId);
    const teamIds = (teamData ?? []).map((t: { id: string }) => t.id);
    if (teamIds.length === 0) return [];
    const { data } = await supabase
      .from("games")
      .select(`scheduled_at,
        home_team:teams!home_team_id(name),
        away_team:teams!away_team_id(name),
        venue:venues(name)`)
      .in("home_team_id", teamIds)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    return (data ?? []) as unknown as GameRow[];
  }

  async function fetchPractices(divisionId: string): Promise<PracticeRow[]> {
    const supabase = createClient();
    const { data } = await supabase
      .from("practices")
      .select("scheduled_date, start_time, team:teams(name), venue:venues(name)")
      .eq("division_id", divisionId)
      .eq("status", "scheduled")
      .order("scheduled_date")
      .order("start_time");
    return (data ?? []) as unknown as PracticeRow[];
  }

  function triggerDownload(csv: string, filename: string) {
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCsv(mode: PrintMode) {
    if (!selectedDivision) return;
    const key = `${mode}-csv`;
    setLoadingAction(key);

    const today = new Date().toISOString().substring(0, 10).replace(/-/g, "");
    const base = `FieldSlate-${slugify(leagueName)}-${slugify(selectedDivision.name)}`;

    try {
      if (mode === "games") {
        const games = await fetchGames(selectedDivisionId);
        const header = ["Home Team", "Away Team", "Date", "Start Time", "Location/Field Name", "Division Name"]
          .map(csvEscape).join(",");
        const rows = games.map((g) =>
          [g.home_team?.name ?? "", g.away_team?.name ?? "", fmtCsvDate(g.scheduled_at),
           fmtCsvTime(g.scheduled_at), g.venue?.name ?? "", selectedDivision.name]
          .map(csvEscape).join(","));
        triggerDownload([header, ...rows].join("\r\n"), `${base}-games-${today}.csv`);

      } else if (mode === "practices") {
        const practices = await fetchPractices(selectedDivisionId);
        const header = ["Team", "Date", "Start Time", "Field / Venue", "Division Name"]
          .map(csvEscape).join(",");
        const rows = practices.map((p) =>
          [p.team?.name ?? "", fmtPracticeDate(p.scheduled_date),
           fmtPracticeTime(p.start_time), p.venue?.name ?? "", selectedDivision.name]
          .map(csvEscape).join(","));
        triggerDownload([header, ...rows].join("\r\n"), `${base}-practices-${today}.csv`);

      } else {
        // combined — Type, Home / Team, Away Team, Date, Start Time, Field / Venue, Division Name
        const [games, practices] = await Promise.all([
          fetchGames(selectedDivisionId),
          fetchPractices(selectedDivisionId),
        ]);
        const header = ["Type", "Home / Team", "Away Team", "Date", "Start Time", "Field / Venue", "Division Name"]
          .map(csvEscape).join(",");
        const gameRows = games.map((g) =>
          ["Game", g.home_team?.name ?? "", g.away_team?.name ?? "", fmtCsvDate(g.scheduled_at),
           fmtCsvTime(g.scheduled_at), g.venue?.name ?? "", selectedDivision.name]
          .map(csvEscape).join(","));
        const practiceRows = practices.map((p) =>
          ["Practice", p.team?.name ?? "", "", fmtPracticeDate(p.scheduled_date),
           fmtPracticeTime(p.start_time), p.venue?.name ?? "", selectedDivision.name]
          .map(csvEscape).join(","));
        triggerDownload([header, ...gameRows, ...practiceRows].join("\r\n"), `${base}-combined-${today}.csv`);
      }

      setDoneAction(key);
      setTimeout(() => setDoneAction(null), 3000);
    } catch (err) {
      console.error("[ExportPickerModal] CSV export failed:", err);
    }

    setLoadingAction(null);
  }

  function handlePrint(mode: PrintMode) {
    if (!selectedDivision) return;
    onPrint(selectedDivision.id, mode);
    onClose();
  }

  const canAct = !!selectedDivision;

  const EXPORT_ROWS = [
    {
      mode: "games" as const,
      Icon: CalendarDays,
      label: "Games",
      description: "Game schedule only",
      iconBg: "bg-blue-50",
      iconColor: "text-blue-500",
    },
    {
      mode: "practices" as const,
      Icon: Dumbbell,
      label: "Practices",
      description: "Practice schedule only",
      iconBg: "bg-indigo-50",
      iconColor: "text-indigo-500",
    },
    {
      mode: "combined" as const,
      Icon: LayoutList,
      label: "Combined",
      description: "Games and practices together",
      iconBg: "bg-emerald-50",
      iconColor: "text-emerald-600",
    },
  ] as const;

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
            <p className="mt-0.5 text-xs text-gray-400">Choose what to export and the format</p>
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
                onChange={(e) => setSelectedDivisionId(e.target.value)}
              >
                <option value="">Select a division…</option>
                {divisions.map((d) => {
                  const stat = divisionStats.find((s) => s.divisionId === d.id);
                  const gameCount = stat?.gameCount ?? 0;
                  const practiceCount = stat?.practiceCount ?? 0;
                  return (
                    <option key={d.id} value={d.id}>
                      {d.name} ({gameCount} game{gameCount !== 1 ? "s" : ""}
                      {practiceCount > 0 ? `, ${practiceCount} practice${practiceCount !== 1 ? "s" : ""}` : ""})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Export option rows */}
          <div className="flex flex-col gap-2">
            {EXPORT_ROWS.map(({ mode, Icon, label, description, iconBg, iconColor }) => {
              const csvKey = `${mode}-csv`;
              const isDownloading = loadingAction === csvKey;
              const isDone = doneAction === csvKey;
              return (
                <div
                  key={mode}
                  className={`flex items-center gap-4 rounded-xl border border-gray-100 px-4 py-3 ${!canAct ? "opacity-50" : ""}`}
                >
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
                    <Icon className={`h-4 w-4 ${iconColor}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#0C1F3F]">{label}</p>
                    <p className="text-xs text-gray-400">{description}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      disabled={!canAct}
                      onClick={() => handlePrint(mode)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Printer className="h-3 w-3" />
                      Print
                    </button>
                    <button
                      disabled={!canAct || !!loadingAction}
                      onClick={() => handleCsv(mode)}
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
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

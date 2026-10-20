"use client";

import { useState, useEffect } from "react";
import { X, Printer, Download, Trophy, CalendarDays, LayoutList } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PlayoffGame } from "@/types/database";
import { buildBracketPrintHtml, escapeHtml, printDocument, printHeader } from "@/lib/playoffs/bracket-print";
import {
  buildPlayoffCsv,
  exportDuration,
  exportRound,
  exportSlot,
  noDurationNote,
  type ExportPair,
} from "@/lib/playoffs/playoff-export";

interface GameWithTeams extends PlayoffGame {
  home_team_name: string | null;
  away_team_name: string | null;
  venue_name: string | null;
  winner_name: string | null;
  home_score: number | null;
  away_score: number | null;
}

interface Props {
  playoffId: string;
  divisionName: string;
  leagueName: string;
  format: string;
  /** A two-stage pair: `playoffId` is Stage 1, this is Stage 2. The bracket
   *  print is Stage 2's tree; the schedule and the CSV hold both stages. */
  stage2Id?: string | null;
  onClose: () => void;
}

// ─── Date / time helpers ──────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}/${y}`;
}

function fmtTime(t: string | null): string {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? "PM" : "AM"}`;
}

function slugify(s: string) {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}


// ─── Print window ─────────────────────────────────────────────────────────────

// The document comes from the pure builders in bracket-print.ts (the bracket
// prints landscape, the schedule table portrait); this only opens and prints.
function openPrintWindow(body: string, title: string, orientation: "landscape" | "portrait") {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(printDocument(body, title, orientation));
  win.document.close();
  setTimeout(() => { win.print(); }, 300);
}

function printedOn(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ─── Schedule print ───────────────────────────────────────────────────────────

function buildScheduleHtml(
  games: GameWithTeams[],
  leagueName: string,
  divisionName: string,
  pair: ExportPair,
  format: string,
): string {
  const sorted = [...games].sort((a, b) => {
    if ((a.scheduled_date ?? "") !== (b.scheduled_date ?? ""))
      return (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? "");
    return (a.start_time ?? "").localeCompare(b.start_time ?? "");
  });

  let rows = "";
  sorted.forEach((g, i) => {
    const bg = i % 2 === 1 ? "background:#f7f7f7" : "";
    // Every slot reads what the bracket shows: the team, else "Seed N",
    // "Winner of Game N" or "TBD" (playoff-export.ts).
    const matchup = `${exportSlot(g, "home", games, pair, format)} vs ${exportSlot(g, "away", games, pair, format)}`;
    const result =
      g.status === "completed" && g.home_score != null
        ? `${g.home_score} – ${g.away_score}`
        : "—";
    rows += `<tr style="${bg}">
      <td style="border:1pt solid #ccc;padding:3pt 8pt">${escapeHtml(exportRound(g, pair))}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt">${fmtDate(g.scheduled_date)}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt;white-space:nowrap">${fmtTime(g.start_time)}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt">${escapeHtml(matchup)}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt">${escapeHtml(g.venue_name ?? "—")}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt;white-space:nowrap">${result}</td>
    </tr>`;
  });

  return `${printHeader(leagueName, divisionName, "Playoff Schedule", printedOn())}
<table style="width:100%;border-collapse:collapse;font-size:9pt">
  <thead>
    <tr style="background:#ebebeb">
      <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Round</th>
      <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Date</th>
      <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Time</th>
      <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Matchup</th>
      <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Venue</th>
      <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Result</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function triggerCsvDownload(csv: string, filename: string) {
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

// ─── Modal ────────────────────────────────────────────────────────────────────

export function PlayoffExportModal({
  playoffId, divisionName, leagueName, format, stage2Id = null, onClose,
}: Props) {
  const pair: ExportPair = stage2Id ? { stage1Id: playoffId, stage2Id } : null;
  const bracketFormat = format;
  // `games` is what the bracket print draws (Stage 2's tree for a pair);
  // `allGames` is every game, for the schedule print and the CSV.
  const [games, setGames] = useState<GameWithTeams[]>([]);
  const [allGames, setAllGames] = useState<GameWithTeams[]>([]);
  // The division's game length (projected key, never the settings blob);
  // null = not set, so End is blank and the modal says so.
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [doneAction, setDoneAction] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const ids = stage2Id ? [playoffId, stage2Id] : [playoffId];
    void (async () => {
      const { data } = await supabase
        .from("playoff_games")
        .select(
          `*, home:teams!playoff_games_home_team_id_fkey(name),
           away:teams!playoff_games_away_team_id_fkey(name),
           venue:venues(name),
           winner:teams!playoff_games_winner_id_fkey(name)`,
        )
        .in("playoff_id", ids)
        .order("game_number");
      const rows = (data ?? []).map((g: Record<string, unknown>) => ({
        ...(g as PlayoffGame),
        home_team_name: (g.home as { name?: string } | null)?.name ?? null,
        away_team_name: (g.away as { name?: string } | null)?.name ?? null,
        venue_name: (g.venue as { name?: string } | null)?.name ?? null,
        winner_name: (g.winner as { name?: string } | null)?.name ?? null,
        home_score: (g.home_score as number | null) ?? null,
        away_score: (g.away_score as number | null) ?? null,
      }));
      setAllGames(rows);
      setGames(stage2Id ? rows.filter((g) => g.playoff_id === stage2Id) : rows);
      const divisionId = rows[0]?.division_id;
      if (divisionId) {
        const { data: div } = await supabase
          .from("divisions")
          .select("game_duration:settings->game_duration")
          .eq("id", divisionId)
          .maybeSingle();
        setDurationMin(exportDuration((div as { game_duration?: unknown } | null)?.game_duration));
      }
      setLoadingGames(false);
    })();
  }, [playoffId, stage2Id]);

  function handlePrintBracket() {
    // A pair prints Stage 2's tree (its format is single elimination).
    const format = pair ? "single_elimination" : bracketFormat;
    openPrintWindow(
      buildBracketPrintHtml(games, format, leagueName, divisionName, printedOn()),
      `${divisionName} Playoff Bracket`,
      "landscape",
    );
  }

  function handlePrintSchedule() {
    openPrintWindow(
      buildScheduleHtml(allGames, leagueName, divisionName, pair, format),
      `${divisionName} Playoff Schedule`,
      "portrait",
    );
  }

  async function handleCsvSportsConnect() {
    setLoadingAction("sc-csv");
    const csv = buildPlayoffCsv(allGames, { divisionName, durationMin, pair, format });
    const today = new Date().toISOString().substring(0, 10).replace(/-/g, "");
    triggerCsvDownload(
      csv,
      `FieldSlate-${slugify(leagueName)}-${slugify(divisionName)}-playoffs-${today}.csv`,
    );
    setDoneAction("sc-csv");
    setTimeout(() => setDoneAction(null), 3000);
    setLoadingAction(null);
  }

  const canAct = !loadingGames;

  const ROWS = [
    {
      key: "bracket",
      Icon: Trophy,
      label: "Bracket",
      description: "Visual bracket tree, letter-size",
      iconBg: "bg-amber-50",
      iconColor: "text-amber-500",
      printAction: handlePrintBracket,
      csvAction: null,
    },
    {
      key: "schedule",
      Icon: CalendarDays,
      label: "Schedule",
      description: "Game list sorted by date and time",
      iconBg: "bg-blue-50",
      iconColor: "text-blue-500",
      printAction: handlePrintSchedule,
      csvAction: null,
    },
    {
      key: "sc",
      Icon: LayoutList,
      label: "Sports Connect",
      description: "Import-ready CSV for Sports Connect",
      iconBg: "bg-emerald-50",
      iconColor: "text-emerald-600",
      printAction: null,
      csvAction: handleCsvSportsConnect,
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
            <h3 className="font-semibold text-[#0C1F3F]">Export Bracket</h3>
            <p className="mt-0.5 text-xs text-gray-400">
              {divisionName} · {leagueName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#0C1F3F]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {loadingGames ? (
            <div className="flex justify-center py-6">
              <svg className="h-5 w-5 animate-spin text-gray-300" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {durationMin === null && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {noDurationNote(divisionName)}
                </p>
              )}
              {ROWS.map(({ key, Icon, label, description, iconBg, iconColor, printAction, csvAction }) => {
                const csvKey = `${key}-csv`;
                const isDownloading = loadingAction === csvKey;
                const isDone = doneAction === csvKey;

                return (
                  <div
                    key={key}
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
                      {printAction && (
                        <button
                          disabled={!canAct}
                          onClick={printAction}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Printer className="h-3 w-3" />
                          Print
                        </button>
                      )}
                      {csvAction && (
                        <button
                          disabled={!canAct || !!loadingAction}
                          onClick={csvAction}
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
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

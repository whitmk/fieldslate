"use client";

import { useState, useEffect } from "react";
import { X, Printer, Download, Trophy, CalendarDays, LayoutList } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PlayoffGame } from "@/types/database";

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
  onClose: () => void;
}

// ─── Round helpers (mirrors bracket-view) ────────────────────────────────────

const ROUND_ORDER: Record<string, number> = {
  "WB-R1": 10, "WB-R2": 11, "WB-R3": 12, "WB-R4": 13,
  "WB-F": 20,
  "LB-R1": 30, "LB-R2": 31, "LB-R3": 32, "LB-R4": 33,
  "LB-R5": 34, "LB-R6": 35, "LB-R7": 36, "LB-R8": 37,
  "LB-F": 40,
  "GF": 50, "GF-R": 51,
};

function getRoundOrder(round: string): number {
  if (round in ROUND_ORDER) return ROUND_ORDER[round];
  const m = round.match(/^(RR|R|SF|F)(\d*)/);
  if (!m) return 99;
  if (m[1] === "F") return 50;
  if (m[1] === "SF") return 40;
  return parseInt(m[2] || "0");
}

function roundLabel(round: string): string {
  const map: Record<string, string> = {
    F: "Final", SF: "Semifinals",
    "WB-F": "Winners Final", "LB-F": "Losers Final",
    GF: "Grand Final", "GF-R": "Grand Final (Reset)",
  };
  if (round in map) return map[round];
  if (round.startsWith("RR")) return `Round ${round.slice(2)}`;
  if (round.startsWith("WB-R")) return `Winners Rd ${round.slice(4)}`;
  if (round.startsWith("LB-R")) return `Losers Rd ${round.slice(4)}`;
  if (round.startsWith("R")) return `Round ${round.slice(1)}`;
  return round;
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

function fmtCsvDate(d: string): string {
  const [y, mo, day] = d.split("-");
  return `${mo}/${day}/${y}`;
}

function fmtCsvTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${pad2(h % 12 || 12)}:${pad2(m)} ${h >= 12 ? "PM" : "AM"}`;
}

function addMinsFmt(t: string, mins: number): string {
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${pad2(nh % 12 || 12)}:${pad2(nm)} ${nh >= 12 ? "PM" : "AM"}`;
}

function csvEscape(val: string): string {
  return `"${val.replace(/"/g, '""')}"`;
}

function slugify(s: string) {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Print window ─────────────────────────────────────────────────────────────

function openPrintWindow(body: string, title: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0.75in;
      font-family: Arial, Helvetica, sans-serif;
      background: white;
      color: #000;
    }
    @media print {
      @page { margin: 0.75in; size: letter portrait; }
    }
  </style>
</head>
<body>${body}</body>
</html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 300);
}

// ─── Shared print header ──────────────────────────────────────────────────────

function printHeader(leagueName: string, divisionName: string, subtitle: string): string {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  return `
<div style="padding-bottom:12pt;border-bottom:2pt solid #000;margin-bottom:16pt">
  <div style="font-size:20pt;font-weight:800;color:#0c1f3f;letter-spacing:-0.3pt;line-height:1">
    Field<span style="color:#16a34a">Slate</span>
  </div>
  <div style="font-size:13pt;font-weight:700;color:#000;margin-top:8pt">${escapeHtml(leagueName)}</div>
  <div style="font-size:10pt;font-weight:600;color:#444;margin-top:2pt">
    ${escapeHtml(divisionName)} — ${escapeHtml(subtitle)}
  </div>
  <div style="font-size:8.5pt;color:#666;margin-top:6pt">Printed ${today}</div>
</div>`;
}

// ─── Bracket print ────────────────────────────────────────────────────────────

const PW = 188;   // card width
const PH = 70;   // card body height (2 rows × 35px)
const HG = 48;   // horizontal gap
const VS = 90;   // vertical slot per game in round 0

function pGameTop(rIdx: number, gIdx: number): number {
  const slotH = VS * Math.pow(2, rIdx);
  return gIdx * slotH + slotH / 2 - PH / 2;
}
function pGameCenter(rIdx: number, gIdx: number): number {
  return pGameTop(rIdx, gIdx) + PH / 2;
}

function gameCardHtml(game: GameWithTeams): string {
  const homeWon = game.winner_id === game.home_team_id;
  const awayWon = game.winner_id === game.away_team_id;
  const done = game.status === "completed";

  function teamRow(name: string | null, won: boolean, score: number | null, tbd: boolean) {
    const nameSt = tbd
      ? "color:#d1d5db;font-style:italic"
      : won
        ? "font-weight:700;color:#0c1f3f"
        : "color:#374151";
    const scoreSt = won ? "color:#0c1f3f;font-weight:700" : "color:#9ca3af;font-weight:600";
    return `<div style="padding:5px 8px;display:flex;align-items:center;justify-content:space-between;min-height:35px;background:${won ? "#f0fdf4" : "white"}">
      <span style="font-size:8pt;${nameSt}">${escapeHtml(name ?? "TBD")}</span>
      ${done && score != null ? `<span style="font-size:8pt;${scoreSt}">${score}</span>` : ""}
    </div>`;
  }

  return `<div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;background:white;width:${PW}px">
    ${teamRow(game.home_team_name, homeWon, game.home_score, !game.home_team_id)}
    <div style="height:1px;background:#f3f4f6"></div>
    ${teamRow(game.away_team_name, awayWon, game.away_score, !game.away_team_id)}
  </div>`;
}

function buildBracketHtml(
  rounds: [string, GameWithTeams[]][],
  leagueName: string,
  divisionName: string,
): string {
  if (!rounds.length) return printHeader(leagueName, divisionName, "Playoff Bracket") + "<p>No games yet.</p>";

  const r0Count = rounds[0][1].length;
  const totalH = r0Count * VS;
  const totalW = rounds.length * (PW + HG) - HG;

  // SVG connector lines
  let svgLines = "";
  for (let rIdx = 0; rIdx < rounds.length - 1; rIdx++) {
    const src = rounds[rIdx][1];
    const next = rounds[rIdx + 1][1];
    if (src.length !== next.length * 2) continue;
    for (let pi = 0; pi < next.length; pi++) {
      const xR = rIdx * (PW + HG) + PW;
      const xM = xR + HG / 2;
      const xN = (rIdx + 1) * (PW + HG);
      const y1 = pGameCenter(rIdx, pi * 2);
      const y2 = pGameCenter(rIdx, pi * 2 + 1);
      const yN = (y1 + y2) / 2;
      svgLines += `<line x1="${xR}" y1="${y1}" x2="${xM}" y2="${y1}" stroke="#d1d5db" stroke-width="1.5"/>
<line x1="${xR}" y1="${y2}" x2="${xM}" y2="${y2}" stroke="#d1d5db" stroke-width="1.5"/>
<line x1="${xM}" y1="${y1}" x2="${xM}" y2="${y2}" stroke="#d1d5db" stroke-width="1.5"/>
<line x1="${xM}" y1="${yN}" x2="${xN}" y2="${yN}" stroke="#d1d5db" stroke-width="1.5"/>`;
    }
  }

  // Round headers + game cards
  let elements = "";
  for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
    const [round, roundGames] = rounds[rIdx];
    const hdrLeft = rIdx * (PW + HG);
    elements += `<div style="position:absolute;top:0;left:${hdrLeft}px;width:${PW}px;text-align:center;font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.6pt;color:#9ca3af">
      ${escapeHtml(roundLabel(round))}
    </div>`;
    for (let gIdx = 0; gIdx < roundGames.length; gIdx++) {
      const x = rIdx * (PW + HG);
      const y = pGameTop(rIdx, gIdx) + 16;
      elements += `<div style="position:absolute;left:${x}px;top:${y}px">${gameCardHtml(roundGames[gIdx])}</div>`;
    }
  }

  return `${printHeader(leagueName, divisionName, "Playoff Bracket")}
<div style="position:relative;height:${totalH + 20}px;width:${totalW}px;min-width:${totalW}px">
  <svg width="${totalW}" height="${totalH + 20}" style="position:absolute;top:0;left:0;pointer-events:none">${svgLines}</svg>
  ${elements}
</div>`;
}

function buildColumnBracketHtml(
  rounds: [string, GameWithTeams[]][],
  leagueName: string,
  divisionName: string,
): string {
  let cols = "";
  for (const [round, roundGames] of rounds) {
    let cards = "";
    for (const g of roundGames) cards += `<div style="margin-bottom:12pt">${gameCardHtml(g)}</div>`;
    cols += `<div style="min-width:${PW}px;margin-right:24pt">
      <div style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.6pt;color:#9ca3af;text-align:center;margin-bottom:8pt">
        ${escapeHtml(roundLabel(round))}
      </div>
      ${cards}
    </div>`;
  }
  return `${printHeader(leagueName, divisionName, "Playoff Bracket")}
<div style="display:flex;align-items:flex-start">${cols}</div>`;
}

// ─── Schedule print ───────────────────────────────────────────────────────────

function buildScheduleHtml(
  games: GameWithTeams[],
  leagueName: string,
  divisionName: string,
): string {
  const sorted = [...games].sort((a, b) => {
    if ((a.scheduled_date ?? "") !== (b.scheduled_date ?? ""))
      return (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? "");
    return (a.start_time ?? "").localeCompare(b.start_time ?? "");
  });

  let rows = "";
  sorted.forEach((g, i) => {
    const bg = i % 2 === 1 ? "background:#f7f7f7" : "";
    const matchup =
      !g.home_team_id || !g.away_team_id
        ? "TBD"
        : `${g.home_team_name ?? "TBD"} vs ${g.away_team_name ?? "TBD"}`;
    const result =
      g.status === "completed" && g.home_score != null
        ? `${g.home_score} – ${g.away_score}`
        : "—";
    rows += `<tr style="${bg}">
      <td style="border:1pt solid #ccc;padding:3pt 8pt">${escapeHtml(roundLabel(g.round))}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt">${fmtDate(g.scheduled_date)}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt;white-space:nowrap">${fmtTime(g.start_time)}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt">${escapeHtml(matchup)}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt">${escapeHtml(g.venue_name ?? "—")}</td>
      <td style="border:1pt solid #ccc;padding:3pt 8pt;white-space:nowrap">${result}</td>
    </tr>`;
  });

  return `${printHeader(leagueName, divisionName, "Playoff Schedule")}
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

// ─── Sports Connect CSV ───────────────────────────────────────────────────────

function buildSportsConnectCsv(games: GameWithTeams[], divisionName: string): string {
  const header = ["Start_Date", "Start_Time", "End_Date", "End_Time", "Title", "Location", "Event_Type"]
    .map(csvEscape)
    .join(",");

  const rows = games
    .filter((g) => g.scheduled_date && g.home_team_id && g.away_team_id)
    .sort((a, b) => {
      if (a.scheduled_date !== b.scheduled_date)
        return a.scheduled_date!.localeCompare(b.scheduled_date!);
      return (a.start_time ?? "").localeCompare(b.start_time ?? "");
    })
    .map((g) => {
      const startDate = fmtCsvDate(g.scheduled_date!);
      const startTime = g.start_time ? fmtCsvTime(g.start_time) : "";
      const endTime = g.start_time ? addMinsFmt(g.start_time, 90) : "";
      const title = `${divisionName} Playoffs - ${roundLabel(g.round)}: ${g.home_team_name ?? "TBD"} vs ${g.away_team_name ?? "TBD"}`;
      return [startDate, startTime, startDate, endTime, title, g.venue_name ?? "", "Game"]
        .map(csvEscape)
        .join(",");
    });

  return [header, ...rows].join("\r\n");
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
  playoffId, divisionName, leagueName, format, onClose,
}: Props) {
  const [games, setGames] = useState<GameWithTeams[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [doneAction, setDoneAction] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("playoff_games")
      .select(
        `*, home:teams!playoff_games_home_team_id_fkey(name),
         away:teams!playoff_games_away_team_id_fkey(name),
         venue:venues(name),
         winner:teams!playoff_games_winner_id_fkey(name)`,
      )
      .eq("playoff_id", playoffId)
      .order("game_number")
      .then(({ data }) => {
        const rows = (data ?? []).map((g: Record<string, unknown>) => ({
          ...(g as PlayoffGame),
          home_team_name: (g.home as { name?: string } | null)?.name ?? null,
          away_team_name: (g.away as { name?: string } | null)?.name ?? null,
          venue_name: (g.venue as { name?: string } | null)?.name ?? null,
          winner_name: (g.winner as { name?: string } | null)?.name ?? null,
          home_score: (g.home_score as number | null) ?? null,
          away_score: (g.away_score as number | null) ?? null,
        }));
        setGames(rows);
        setLoadingGames(false);
      });
  }, [playoffId]);

  // Group and sort rounds (needed for bracket print)
  const roundMap = new Map<string, GameWithTeams[]>();
  for (const g of games) {
    if (!roundMap.has(g.round)) roundMap.set(g.round, []);
    roundMap.get(g.round)!.push(g);
  }
  const rounds = [...roundMap.entries()].sort(([a], [b]) => getRoundOrder(a) - getRoundOrder(b));

  function handlePrintBracket() {
    const html =
      format === "single_elimination"
        ? buildBracketHtml(rounds, leagueName, divisionName)
        : buildColumnBracketHtml(rounds, leagueName, divisionName);
    openPrintWindow(html, `${divisionName} Playoff Bracket`);
  }

  function handlePrintSchedule() {
    openPrintWindow(
      buildScheduleHtml(games, leagueName, divisionName),
      `${divisionName} Playoff Schedule`,
    );
  }

  async function handleCsvSportsConnect() {
    setLoadingAction("sc-csv");
    const csv = buildSportsConnectCsv(games, divisionName);
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

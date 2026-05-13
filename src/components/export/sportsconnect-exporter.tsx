"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FileDown, CheckCircle2, Info, AlertCircle } from "lucide-react";

type Division = { id: string; name: string };
export type LeagueOption = {
  id: string;
  name: string;
  sport: string;
  divisions: Division[];
};

// ── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  return `"${val.replace(/"/g, '""')}"`;
}

// Times are stored as wall-clock UTC — read directly from the ISO string,
// same approach as fmtGameDate/fmtGameTime in game-time.ts.
function fmtCsvDate(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

function fmtCsvTime(iso: string): string {
  const [hourStr, minStr] = iso.substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12.toString().padStart(2, "0")}:${minStr} ${period}`;
}

function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Component ────────────────────────────────────────────────────────────────

type Status = "idle" | "loading" | "done" | "empty" | "error";

export function SportsConnectExporter({ leagues }: { leagues: LeagueOption[] }) {
  const [selectedLeagueId, setSelectedLeagueId] = useState(
    leagues.length === 1 ? leagues[0].id : ""
  );
  const [selectedDivisionId, setSelectedDivisionId] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const selectedLeague = leagues.find((l) => l.id === selectedLeagueId);
  const selectedDivision = selectedLeague?.divisions.find(
    (d) => d.id === selectedDivisionId
  );

  // Auto-select the only division whenever the league changes.
  useEffect(() => {
    if (!selectedLeague) {
      setSelectedDivisionId("");
      return;
    }
    setSelectedDivisionId(
      selectedLeague.divisions.length === 1 ? selectedLeague.divisions[0].id : ""
    );
    setStatus("idle");
  }, [selectedLeague]);

  const canExport = !!selectedLeague && !!selectedDivision;

  async function handleExport() {
    if (!selectedLeague || !selectedDivision) return;
    setStatus("loading");

    const supabase = createClient();

    // Resolve team IDs for this division first.
    const { data: teamData, error: teamErr } = await supabase
      .from("teams")
      .select("id")
      .eq("division_id", selectedDivisionId);

    if (teamErr) {
      setStatus("error");
      return;
    }

    const teamIds = (teamData ?? []).map((t: { id: string }) => t.id);
    if (teamIds.length === 0) {
      setStatus("empty");
      return;
    }

    type GameRow = {
      scheduled_at: string;
      home_team: { name: string } | null;
      away_team: { name: string } | null;
      venue: { name: string } | null;
    };

    const { data: gamesData, error: gamesErr } = await supabase
      .from("games")
      .select(`
        scheduled_at,
        home_team:teams!home_team_id(name),
        away_team:teams!away_team_id(name),
        venue:venues(name)
      `)
      .in("home_team_id", teamIds)
      .order("scheduled_at", { ascending: true });

    if (gamesErr) {
      setStatus("error");
      return;
    }

    const games = (gamesData ?? []) as unknown as GameRow[];
    if (games.length === 0) {
      setStatus("empty");
      return;
    }

    const COLUMNS = [
      "Home Team",
      "Away Team",
      "Date",
      "Start Time",
      "Location/Field Name",
      "Division Name",
    ];

    const header = COLUMNS.map(csvEscape).join(",");
    const rows = games.map((g) =>
      [
        csvEscape(g.home_team?.name ?? ""),
        csvEscape(g.away_team?.name ?? ""),
        csvEscape(fmtCsvDate(g.scheduled_at)),
        csvEscape(fmtCsvTime(g.scheduled_at)),
        csvEscape(g.venue?.name ?? ""),
        csvEscape(selectedDivision.name),
      ].join(",")
    );

    // UTF-8 BOM ensures Excel and SportsConnect read accented chars correctly.
    const csv = "﻿" + [header, ...rows].join("\r\n");

    const today = new Date().toISOString().substring(0, 10).replace(/-/g, "");
    const filename = `FieldSlate-${slugify(selectedLeague.name)}-${slugify(selectedDivision.name)}-${today}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus("done");
    setTimeout(() => setStatus("idle"), 4000);
  }

  const selectClass =
    "h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";

  return (
    <div className="max-w-lg rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#0C1F3F]">
          <FileDown className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">SportsConnect Export</h2>
          <p className="text-xs text-gray-500">Download a schedule CSV for SportsConnect import</p>
        </div>
      </div>

      {/* SportsConnect import note */}
      <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-blue-50 px-3.5 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <p className="text-sm text-blue-700">
          Import this file directly into SportsConnect under{" "}
          <strong className="font-semibold">Schedule &gt; Import</strong>.
        </p>
      </div>

      {leagues.length === 0 ? (
        <p className="mt-5 text-sm text-gray-500">
          You haven&apos;t created any leagues yet. Create a league first, then return here to export.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {/* League picker — only shown when there are multiple leagues */}
          {leagues.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">League</label>
              <select
                className={selectClass}
                value={selectedLeagueId}
                onChange={(e) => {
                  setSelectedLeagueId(e.target.value);
                  setStatus("idle");
                }}
              >
                <option value="">Select a league…</option>
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Division picker — only shown when selected league has multiple divisions */}
          {selectedLeague && selectedLeague.divisions.length === 0 && (
            <p className="text-sm text-gray-500">
              This league has no divisions yet. Add divisions before exporting.
            </p>
          )}

          {selectedLeague && selectedLeague.divisions.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Division</label>
              <select
                className={selectClass}
                value={selectedDivisionId}
                onChange={(e) => {
                  setSelectedDivisionId(e.target.value);
                  setStatus("idle");
                }}
              >
                <option value="">Select a division…</option>
                {selectedLeague.divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Contextual feedback */}
          {status === "empty" && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              No scheduled games found for this division.
            </div>
          )}
          {status === "error" && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Something went wrong. Please try again.
            </div>
          )}
          {status === "done" && (
            <div className="flex items-center gap-2 text-sm text-[#22C55E]">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              CSV downloaded — check your downloads folder.
            </div>
          )}

          {/* Export button */}
          {selectedLeague && selectedLeague.divisions.length > 0 && (
            <Button
              onClick={handleExport}
              disabled={!canExport || status === "loading"}
              isLoading={status === "loading"}
              className="w-full"
            >
              {status !== "loading" && <FileDown className="mr-2 h-4 w-4" />}
              Export to SportsConnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

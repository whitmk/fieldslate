"use client";

// The /dashboard/export surface for the Sports Connect import CSV.
//
// ALL format logic lives in src/lib/schedule/sports-connect-export.ts —
// this component (like the league-page export picker modal) only picks a
// division, calls the shared fetch + builder, and downloads the result.
// Never add CSV formatting here; the two surfaces must stay byte-identical.
// What this page adds over the modal: an org-wide season picker that
// includes ARCHIVED seasons (exporting past seasons is a primary use case).

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FileDown, CheckCircle2, Info, AlertCircle } from "lucide-react";
import {
  buildSportsConnectCsv,
  fetchSportsConnectGames,
} from "@/lib/schedule/sports-connect-export";

type Division = {
  id: string;
  name: string;
  /** Raw divisions.settings.game_duration — validated by the builder, which
   *  refuses the export (naming the division) when missing/non-positive. */
  gameDuration: unknown;
};
export type LeagueOption = {
  id: string;
  name: string;
  sport: string;
  /** True when the season has been archived. Tagged in the picker so the
   * admin knows what they're exporting. */
  isArchived?: boolean;
  divisions: Division[];
};

function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type Status = "idle" | "loading" | "done" | "empty" | "error";

export function SportsConnectExporter({ leagues }: { leagues: LeagueOption[] }) {
  const [selectedLeagueId, setSelectedLeagueId] = useState(
    leagues.length === 1 ? leagues[0].id : ""
  );
  const [selectedDivisionId, setSelectedDivisionId] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    setErrorMsg(null);
  }, [selectedLeague]);

  const canExport = !!selectedLeague && !!selectedDivision;

  async function handleExport() {
    if (!selectedLeague || !selectedDivision) return;
    setStatus("loading");
    setErrorMsg(null);

    const fetched = await fetchSportsConnectGames(
      createClient(),
      selectedDivision.id
    );
    if (!fetched.ok) {
      setStatus("error");
      setErrorMsg(null); // generic message — a fetch error isn't actionable copy
      return;
    }

    const result = buildSportsConnectCsv(
      fetched.games,
      selectedDivision.gameDuration,
      selectedDivision.name
    );
    if (!result.ok) {
      setStatus("error");
      setErrorMsg(result.error);
      return;
    }
    if (result.rowCount === 0) {
      setStatus("empty");
      return;
    }

    // No BOM — this file feeds Sports Connect's importer, not Excel. Same
    // download shape as the modal so the two surfaces stay byte-identical.
    const today = new Date().toISOString().substring(0, 10).replace(/-/g, "");
    const filename = `FieldSlate-${slugify(selectedLeague.name)}-${slugify(selectedDivision.name)}-sportsconnect-${today}.csv`;
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
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
          <p className="text-xs text-gray-500">
            Import-ready schedule CSV with rounds and end times
          </p>
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
          You haven&apos;t created any seasons yet. Create a season first, then return here to export.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {/* Season picker — only shown when there are multiple seasons */}
          {leagues.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Season</label>
              <select
                className={selectClass}
                value={selectedLeagueId}
                onChange={(e) => {
                  setSelectedLeagueId(e.target.value);
                  setStatus("idle");
                  setErrorMsg(null);
                }}
              >
                <option value="">Select a season…</option>
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.isArchived ? " [Archived]" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Division picker — only shown when selected league has multiple divisions */}
          {selectedLeague && selectedLeague.divisions.length === 0 && (
            <p className="text-sm text-gray-500">
              This season has no divisions yet. Add divisions before exporting.
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
                  setErrorMsg(null);
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
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{errorMsg ?? "Something went wrong. Please try again."}</span>
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

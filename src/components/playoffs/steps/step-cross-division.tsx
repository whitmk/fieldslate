"use client";

import { useState, useEffect } from "react";
import { Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData } from "../playoff-wizard-types";

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
  leagueId: string;
}

type DivisionRow = { id: string; name: string };

export function StepCrossDivision({ data, update, leagueId }: Props) {
  const [otherDivisions, setOtherDivisions] = useState<DivisionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("divisions")
      .select("id, name")
      .eq("league_id", leagueId)
      .neq("id", data.division_id)
      .order("name")
      .then(({ data: divs }) => {
        setOtherDivisions((divs as DivisionRow[]) ?? []);
        setLoading(false);
      });
  }, [leagueId, data.division_id]);

  function toggleEnabled() {
    update({
      cross_division_enabled: !data.cross_division_enabled,
      cross_division_opponent_id: "",
      cross_division_opponent_name: "",
    });
  }

  function selectOpponent(div: DivisionRow) {
    update({
      cross_division_opponent_id: div.id,
      cross_division_opponent_name: div.name,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">
          Cross-division championship
        </h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Optionally have this division&apos;s playoff winner face another
          division&apos;s winner in an overall championship game.
        </p>
      </div>

      {/* Toggle row */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">
            Include cross-division championship?
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {data.cross_division_enabled
              ? "Enabled — pick the opponent division below."
              : "Disabled — this division's playoff ends at the bracket final."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleEnabled}
          aria-pressed={data.cross_division_enabled}
          className={`relative flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
            data.cross_division_enabled ? "bg-[#22C55E]" : "bg-gray-200"
          }`}
        >
          <span
            className={`absolute h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              data.cross_division_enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Division picker (shown only when enabled) */}
      {data.cross_division_enabled && (
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-gray-700">
            Opponent division
          </label>

          {loading ? (
            <div className="flex justify-center py-4">
              <svg
                className="h-5 w-5 animate-spin text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          ) : otherDivisions.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-6 text-center">
              <Trophy className="h-6 w-6 text-gray-300" />
              <p className="mt-2 text-sm text-gray-400">
                No other divisions in this league.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {otherDivisions.map((div) => {
                const isSelected = data.cross_division_opponent_id === div.id;
                return (
                  <button
                    key={div.id}
                    type="button"
                    onClick={() => selectOpponent(div)}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                      isSelected
                        ? "border-[#22C55E] bg-[#22C55E]/5 ring-1 ring-[#22C55E]/30"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <Trophy
                      className={`h-4 w-4 flex-shrink-0 ${
                        isSelected ? "text-[#22C55E]" : "text-gray-300"
                      }`}
                    />
                    <span className="flex-1 text-sm font-medium text-gray-900">
                      {div.name}
                    </span>
                    {isSelected && (
                      <svg
                        className="h-4 w-4 flex-shrink-0 text-[#22C55E]"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

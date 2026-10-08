"use client";

import { useState, useEffect } from "react";
import { Layers } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { playoffDefaultsFromDivision } from "@/lib/playoffs/bracket-plan";
import { addBracketBlock } from "@/lib/playoffs/bracket-delete";
import { DEFAULT_PLAYOFF_DATA, type PlayoffWizardData } from "../playoff-wizard-types";

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
  leagueId: string;
  /** Editing an existing bracket: its division is fixed. A bracket's
   *  division never changes (replace_playoff_games keeps it). */
  isEditMode: boolean;
}

type DivisionRow = { id: string; name: string; team_count: number; settings: unknown };

export function StepDivision({ data, update, leagueId, isEditMode }: Props) {
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [existingIds, setExistingIds] = useState<string[]>([]);
  // A failed read of which divisions already have a bracket is SAID, not
  // assumed empty. (The database's unique (league, division) is the
  // backstop: a second bracket for a division cannot be inserted.)
  const [existingError, setExistingError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: divData }, { data: playoffData, error: playoffError }] = await Promise.all([
        supabase
          .from("divisions")
          .select("id, name, team_count, settings")
          .eq("league_id", leagueId)
          .order("name"),
        supabase
          .from("playoffs")
          .select("division_id")
          .eq("league_id", leagueId),
      ]);

      setDivisions((divData as DivisionRow[]) ?? []);
      setExistingIds(
        ((playoffData as { division_id: string }[]) ?? []).map(
          (p) => p.division_id
        )
      );
      setExistingError(!!playoffError);
      setLoading(false);
    }
    load();
  }, [leagueId]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">
          Select division
        </h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Choose which division this playoff bracket is for. Each division gets
          its own independent playoff setup.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
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
      ) : divisions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <Layers className="h-6 w-6 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-600">
            No divisions found
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Add divisions to this season before setting up playoffs.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {isEditMode && (
            <p className="text-xs text-gray-500">
              A bracket&apos;s division can&apos;t be changed. To set up playoffs for another division, use Add bracket.
            </p>
          )}
          {!isEditMode && existingError && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              We couldn&apos;t check which divisions already have a bracket. A division that has one will be refused when you generate.
            </p>
          )}
          {divisions.map((div) => {
            const isSelected = data.division_id === div.id;
            // Create mode: a division that already has a bracket is BLOCKED
            // (no overwrite). Edit mode: only the bracket's own division.
            const blocked = isEditMode ? null : addBracketBlock(div.name, existingIds.includes(div.id));
            const disabled = isEditMode ? !isSelected : blocked !== null;

            return (
              <button
                key={div.id}
                type="button"
                disabled={disabled}
                onClick={() =>
                  update({
                    division_id: div.id,
                    division_name: div.name,
                    seeding: [],
                    // The Dates step starts from the division's OWN playing
                    // days and windows (a Saturday-only division should not
                    // start from the wizard's Sa+Su 9–5 default). Still
                    // editable there.
                    ...playoffDefaultsFromDivision(div.settings, DEFAULT_PLAYOFF_DATA),
                  })
                }
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                  isSelected
                    ? "border-[#22C55E] bg-[#22C55E]/5 ring-1 ring-[#22C55E]/30"
                    : disabled
                    ? "cursor-not-allowed border-gray-100 bg-gray-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Layers
                  className={`h-4 w-4 flex-shrink-0 ${
                    isSelected ? "text-[#22C55E]" : "text-gray-300"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{div.name}</p>
                  <p className="text-xs text-gray-400">
                    {div.team_count} team{div.team_count !== 1 ? "s" : ""}
                  </p>
                  {blocked && <p className="mt-1 text-xs text-amber-700">{blocked}</p>}
                </div>
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
  );
}

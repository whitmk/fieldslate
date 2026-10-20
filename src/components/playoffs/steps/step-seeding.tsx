"use client";

import { useState, useEffect, useRef } from "react";
import { GripVertical, Users, Shuffle, X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData, SeededTeam } from "../playoff-wizard-types";
import {
  addTeamBack,
  bracketSummaryLine,
  canExclude,
  excludeTeam,
  MIN_TEAMS_LINE,
  reconcileSeeding,
  teamCountProblem,
  type SeedingState,
} from "@/lib/playoffs/seeding";

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
}

type TeamRow = { id: string; name: string };

export function StepSeeding({ data, update }: Props) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Who is in the bracket and who was removed — every rule is in
  // lib/playoffs/seeding.ts; this step only calls it.
  const [state, setState] = useState<SeedingState>({
    included: data.seeding,
    excluded: data.excluded,
  });
  const seeding = state.included;
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function apply(next: SeedingState) {
    setState(next);
    update({ seeding: next.included, excluded: next.excluded });
  }

  // Always load the division's teams: a new bracket starts with all of them,
  // and an existing one's removed teams are the ones not in its seeding.
  useEffect(() => {
    if (!data.division_id) return;

    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    supabase
      .from("teams")
      .select("id, name")
      .eq("division_id", data.division_id)
      .order("name")
      .then(({ data: teams, error }) => {
        setLoading(false);
        if (error) {
          // Keep the seeding as it stands; only the removed list is unknown.
          setLoadError("Couldn't load this division's teams, so removed teams can't be shown or added back right now.");
          return;
        }
        const divisionTeams: SeededTeam[] = ((teams as TeamRow[]) ?? []).map((t) => ({
          team_id: t.id,
          team_name: t.name,
        }));
        apply(reconcileSeeding(divisionTeams, data.seeding));
      });
  // update is stable (useCallback with [] deps in parent); data.seeding is read
  // once per division on purpose — later edits come from this step.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.division_id]);

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOver(index);
  }

  function handleDrop(index: number) {
    if (dragIndex.current === null || dragIndex.current === index) {
      setDragOver(null);
      return;
    }
    const next = [...seeding];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    dragIndex.current = null;
    setDragOver(null);
    apply({ ...state, included: next });
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDragOver(null);
  }

  const removable = canExclude(state);
  const countProblem = seeding.length > 0 ? teamCountProblem(data.format, seeding.length) : null;

  if (!data.division_id) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="h-6 w-6 text-gray-300" />
        <p className="mt-3 text-sm text-gray-400">
          No division selected. Go back to Step 1.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[#0C1F3F]">Seeding</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Drag teams to set the seed order. Seed 1 is the top team entering the
            bracket. Remove a team to leave it out of this bracket only.
          </p>
        </div>
        {seeding.length > 1 && (
          <button
            type="button"
            onClick={() => {
              const next = [...seeding];
              for (let i = next.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [next[i], next[j]] = [next[j], next[i]];
              }
              apply({ ...state, included: next });
            }}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Randomize
          </button>
        )}
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
      ) : seeding.length === 0 && state.excluded.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <Users className="h-6 w-6 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            No teams in this division yet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {seeding.map((team, i) => (
              <div
                key={team.team_id}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                className={`flex cursor-grab items-center gap-3 border-b border-gray-100 px-4 py-2 last:border-0 transition-colors active:cursor-grabbing ${
                  dragOver === i
                    ? "bg-[#22C55E]/5 ring-2 ring-inset ring-[#22C55E]/30"
                    : "bg-white hover:bg-gray-50/60"
                }`}
              >
                <GripVertical className="h-4 w-4 flex-shrink-0 text-gray-300" />
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#0C1F3F] text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                  {team.team_name}
                </span>
                <button
                  type="button"
                  onClick={() => apply(excludeTeam(state, team.team_id))}
                  disabled={!removable}
                  title={removable ? `Leave ${team.team_name} out of this bracket` : MIN_TEAMS_LINE}
                  className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500">
            {bracketSummaryLine(data.format, seeding.length)}
            {!removable && seeding.length > 0 && <> · {MIN_TEAMS_LINE}</>}
          </p>
          {countProblem && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {countProblem}
            </p>
          )}
          {loadError && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {loadError}
            </p>
          )}

          {state.excluded.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Not in this bracket
              </p>
              <div className="overflow-hidden rounded-xl border border-dashed border-gray-200">
                {state.excluded.map((team) => (
                  <div
                    key={team.team_id}
                    className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-2 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-400">
                      {team.team_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => apply(addTeamBack(state, team.team_id))}
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-[#16a34a] transition-colors hover:bg-[#22C55E]/10"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add back
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">
                Removed teams keep their games and stay in other brackets. Add back puts a team at the bottom of the seed order.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

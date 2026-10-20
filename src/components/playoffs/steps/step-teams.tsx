"use client";

// Two-stage Teams step: who's playing (Remove / Add back, the same rules as
// the Seeding step — lib/playoffs/seeding.ts) and how many advance. No seed
// numbers and no dragging: Stage 1 needs no order, and Stage 2 is seeded later
// from the results (approved mockup, screen 2).

import { useEffect, useState } from "react";
import { Minus, Plus, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData, SeededTeam } from "../playoff-wizard-types";
import {
  addTeamBack,
  canExclude,
  excludeTeam,
  MIN_TEAMS_LINE,
  reconcileSeeding,
  type SeedingState,
} from "@/lib/playoffs/seeding";
import {
  advanceProblem,
  defaultAdvanceCount,
  initialSeedOrder,
  MIN_ADVANCING,
  twoStageSummaryLine,
} from "@/lib/playoffs/two-stage";

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
  /** Editing a pair whose round robin has results: the team list and the
   *  advancing count can't change (decided 2026-10-19, D5/D6). */
  lockedReason: string | null;
}

export function StepTeams({ data, update, lockedReason }: Props) {
  const [state, setState] = useState<SeedingState>({ included: data.seeding, excluded: data.excluded });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  function apply(next: SeedingState) {
    setState(next);
    // A count above the teams in is clamped back into range as teams leave.
    const advance = Math.min(data.advance_count, Math.max(next.included.length, MIN_ADVANCING));
    update({ seeding: next.included, excluded: next.excluded, advance_count: advance });
  }

  useEffect(() => {
    if (!data.division_id) return;
    setLoading(true);
    setLoadError(null);
    createClient()
      .from("teams")
      .select("id, name")
      .eq("division_id", data.division_id)
      .order("name")
      .then(({ data: rows, error }) => {
        setLoading(false);
        if (error) {
          setLoadError("Couldn't load this division's teams, so removed teams can't be shown or added back right now.");
          return;
        }
        const teams: SeededTeam[] = ((rows as { id: string; name: string }[]) ?? []).map((t) => ({
          team_id: t.id,
          team_name: t.name,
        }));
        const next = reconcileSeeding(teams, data.seeding);
        setState(next);
        // A new setup starts at 4 advancing, or every team when there are fewer.
        const advance = data.seeding.length === 0 ? defaultAdvanceCount(next.included.length) : data.advance_count;
        update({ seeding: next.included, excluded: next.excluded, advance_count: advance });
      });
    // Read once per division; later edits come from this step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.division_id]);

  const shown = initialSeedOrder(state.included);
  const removable = canExclude(state) && !lockedReason;
  const n = state.included.length;
  const problem = n > 0 ? advanceProblem(n, data.advance_count) : null;

  if (!data.division_id) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="h-6 w-6 text-gray-300" />
        <p className="mt-3 text-sm text-gray-400">No division selected. Go back to Step 1.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Who&apos;s playing?</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Remove a team that isn&apos;t taking part. You&apos;ll seed the bracket after the round robin.
        </p>
      </div>

      {lockedReason && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{lockedReason}</p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading teams…</p>
      ) : n === 0 && state.excluded.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <Users className="h-6 w-6 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No teams in this division yet.</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {shown.map((team) => (
              <div key={team.team_id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-2 last:border-0">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{team.team_name}</span>
                <button
                  type="button"
                  onClick={() => apply(excludeTeam(state, team.team_id))}
                  disabled={!removable}
                  title={lockedReason ?? (removable ? `Leave ${team.team_name} out of these playoffs` : MIN_TEAMS_LINE)}
                  className="inline-flex min-h-9 flex-shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            ))}
          </div>

          {state.excluded.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Not in these playoffs</p>
              <div className="overflow-hidden rounded-xl border border-dashed border-gray-200">
                {state.excluded.map((team) => (
                  <div key={team.team_id} className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-2 last:border-0">
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-400">{team.team_name}</span>
                    <button
                      type="button"
                      onClick={() => apply(addTeamBack(state, team.team_id))}
                      disabled={!!lockedReason}
                      className="inline-flex min-h-9 flex-shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-[#16a34a] transition-colors hover:bg-[#22C55E]/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add back
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">Removed teams keep their regular-season games.</p>
            </div>
          )}

          <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#0C1F3F]">Teams advancing to the bracket</p>
              <p className="text-xs text-gray-400">The rest finish after the round robin.</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Fewer"
                disabled={!!lockedReason || data.advance_count <= MIN_ADVANCING}
                onClick={() => update({ advance_count: data.advance_count - 1 })}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-sm font-bold text-[#0C1F3F]" aria-live="polite">
                {data.advance_count}
              </span>
              <button
                type="button"
                aria-label="More"
                disabled={!!lockedReason || data.advance_count >= n}
                onClick={() => update({ advance_count: data.advance_count + 1 })}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {n > 0 && <p className="text-xs text-gray-500">{twoStageSummaryLine(n, data.advance_count)}</p>}
          {problem && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{problem}</p>
          )}
        </>
      )}
      {loadError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{loadError}</p>
      )}
    </div>
  );
}

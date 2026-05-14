"use client";

import { useState, useEffect } from "react";
import { Plus, SkipForward, X, AlertTriangle, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ORDERED_DAYS,
  type WizardData,
  type PlayingDay,
  type PracticeSlotEntry,
} from "../wizard-types";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  onSkip: () => void;
}

type VenueOption = { id: string; name: string };

const DAY_LABEL: Record<PlayingDay, string> = {
  Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun",
};

// A team's stored slots, falling back to one empty row for display
function displaySlots(team: { practice_slots?: PracticeSlotEntry[] }): PracticeSlotEntry[] {
  return team.practice_slots?.length ? team.practice_slots : [{}];
}

export function StepPracticeSchedule({ data, update, onSkip }: Props) {
  const [practiceVenues, setPracticeVenues] = useState<VenueOption[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: rows } = await supabase
        .from("venues")
        .select("id, name")
        .eq("owner_id", user.id)
        .in("venue_type", ["practice", "both"])
        .order("name");
      setPracticeVenues((rows as VenueOption[]) ?? []);
    }
    load();
  }, []);

  // ── Slot mutation helpers ───────────────────────────────────────────────────

  function updateSlot(teamIdx: number, slotIdx: number, patch: Partial<PracticeSlotEntry>) {
    const teams = [...data.teams];
    const team = { ...teams[teamIdx] };
    const slots = [...displaySlots(team)];
    const prev = slots[slotIdx] ?? {};
    const next = { ...prev, ...patch };

    // Pre-fill venue with first practice venue when a day is first selected
    if (patch.day && !prev.venue_id) {
      const firstPracticeVenue = data.venue_assignments.find((a) => a.allow_practices);
      if (firstPracticeVenue) next.venue_id = firstPracticeVenue.venue_id;
    }
    // Clear day-dependent fields when day is removed
    if (patch.day === undefined || patch.day === ("" as PlayingDay)) {
      delete next.day;
      delete next.start;
      delete next.venue_id;
    }

    slots[slotIdx] = next;
    team.practice_slots = slots;
    teams[teamIdx] = team;
    update({ teams });
  }

  function addSlot(teamIdx: number) {
    const teams = [...data.teams];
    const team = { ...teams[teamIdx] };
    team.practice_slots = [...(team.practice_slots ?? []), {}];
    teams[teamIdx] = team;
    update({ teams });
  }

  function removeSlot(teamIdx: number, slotIdx: number) {
    const teams = [...data.teams];
    const team = { ...teams[teamIdx] };
    team.practice_slots = (team.practice_slots ?? []).filter((_, i) => i !== slotIdx);
    teams[teamIdx] = team;
    update({ teams });
  }

  function handleSkip() {
    update({
      teams: data.teams.map((t) => ({ ...t, practice_slots: [] })),
    });
    onSkip();
  }

  // ── Derived counts ──────────────────────────────────────────────────────────

  const totalPinned = data.teams.reduce(
    (sum, t) => sum + (t.practice_slots ?? []).filter((s) => s.day).length,
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Practice schedule</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Set recurring practice slots for each team, or skip to auto-assign.
        </p>
      </div>

      {/* Practice dates */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-[#0C1F3F]">Practice dates</p>
          <p className="mt-0.5 text-xs text-gray-400">Leave blank to use the game season dates.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Practice season start
            </label>
            <input
              type="date"
              value={data.practice_season_start}
              onChange={(e) => update({ practice_season_start: e.target.value })}
              className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Practice season end
            </label>
            <input
              type="date"
              value={data.practice_season_end}
              onChange={(e) => update({ practice_season_end: e.target.value })}
              className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
        </div>
      </div>

      {/* Activities-per-week context banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400" />
        <p className="text-sm text-blue-700">
          This division has{" "}
          <span className="font-semibold">{data.activities_per_week}</span>{" "}
          activit{data.activities_per_week === 1 ? "y" : "ies"} per week —
          practices fill slots not taken by games.
        </p>
      </div>

      {/* Teams list */}
      <div className="flex flex-col gap-3">
        {data.teams.map((team, teamIdx) => {
          const slots = displaySlots(team);
          const pinnedCount = slots.filter((s) => s.day).length;
          const overLimit = pinnedCount > data.activities_per_week;

          return (
            <div
              key={teamIdx}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white"
            >
              {/* Team name header */}
              <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-2.5">
                <span className="text-sm font-semibold text-[#0C1F3F]">
                  {team.name || `Team ${teamIdx + 1}`}
                </span>
                {pinnedCount > 0 && (
                  <span className="ml-2 text-xs text-gray-400">
                    {pinnedCount} slot{pinnedCount !== 1 ? "s" : ""} pinned
                  </span>
                )}
              </div>

              {/* Slot rows */}
              <div className="flex flex-col divide-y divide-gray-50 px-4">
                {slots.map((slot, slotIdx) => {
                  const win = slot.day ? (data.day_windows[slot.day] ?? null) : null;

                  return (
                    <div key={slotIdx} className="flex items-end gap-2 py-3">
                      {/* Day */}
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                          Day
                        </label>
                        <select
                          value={slot.day ?? ""}
                          onChange={(e) =>
                            updateSlot(teamIdx, slotIdx, {
                              day: (e.target.value as PlayingDay) || undefined,
                            })
                          }
                          className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                        >
                          <option value="">— None —</option>
                          {ORDERED_DAYS.map(({ key }) => (
                            <option key={key} value={key}>
                              {DAY_LABEL[key]}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Start time */}
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                          {win ? `Start (${win.start}–${win.end})` : "Start time"}
                        </label>
                        <input
                          type="time"
                          value={slot.start ?? ""}
                          min={win?.start}
                          max={win?.end}
                          disabled={!slot.day}
                          onChange={(e) => updateSlot(teamIdx, slotIdx, { start: e.target.value || undefined })}
                          className="h-9 w-full rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </div>

                      {/* Venue */}
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                          Venue
                        </label>
                        {practiceVenues.length === 0 ? (
                          <div className="flex h-9 items-center rounded-lg border border-dashed border-gray-200 px-2">
                            <span className="truncate text-xs italic text-gray-400">
                              No practice venues
                            </span>
                          </div>
                        ) : (
                          <select
                            value={slot.venue_id ?? ""}
                            disabled={!slot.day}
                            onChange={(e) =>
                              updateSlot(teamIdx, slotIdx, { venue_id: e.target.value || undefined })
                            }
                            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <option value="">None</option>
                            {practiceVenues.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Remove button — only when there's more than one row */}
                      <button
                        type="button"
                        onClick={() => removeSlot(teamIdx, slotIdx)}
                        disabled={slots.length === 1 && !slot.day}
                        aria-label="Remove slot"
                        className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400 disabled:pointer-events-none disabled:opacity-0"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Per-team footer: warning + add button */}
              <div className="flex flex-col gap-2 border-t border-gray-100 px-4 py-3">
                {overLimit && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    This exceeds your activities per week limit.
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => addSlot(teamIdx)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add slot
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom: status + skip */}
      <div className="flex flex-col items-center gap-3">
        {totalPinned > 0 && (
          <p className="text-xs text-gray-500">
            <span className="font-semibold text-[#22C55E]">{totalPinned}</span> slot
            {totalPinned !== 1 ? "s" : ""} pinned across{" "}
            {data.teams.filter((t) => (t.practice_slots ?? []).some((s) => s.day)).length} team
            {data.teams.filter((t) => (t.practice_slots ?? []).some((s) => s.day)).length !== 1
              ? "s"
              : ""}{" "}
            — the rest will be auto-assigned.
          </p>
        )}
        <button
          type="button"
          onClick={handleSkip}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
        >
          <SkipForward className="h-4 w-4" />
          Skip — auto-assign all
        </button>
      </div>
    </div>
  );
}

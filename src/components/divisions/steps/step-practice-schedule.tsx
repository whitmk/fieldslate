"use client";

import { useState, useEffect } from "react";
import { SkipForward } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ORDERED_DAYS, type WizardData, type PlayingDay, type TeamEntry } from "../wizard-types";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  onSkip: () => void;
}

type VenueOption = { id: string; name: string };

const DAY_LABEL: Record<PlayingDay, string> = {
  Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun",
};

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

  function getWindow(day: PlayingDay) {
    return data.day_windows[day] ?? null;
  }

  function withoutSlot(t: TeamEntry): TeamEntry {
    const copy = { ...t };
    delete copy.practice_day;
    delete copy.practice_start;
    delete copy.practice_venue_id;
    return copy;
  }

  function setSlotField(
    index: number,
    field: "practice_day" | "practice_start" | "practice_venue_id",
    value: string,
  ) {
    const teams = [...data.teams];
    const prev = teams[index];

    if (field === "practice_day" && !value) {
      teams[index] = withoutSlot(prev);
    } else if (field === "practice_day") {
      teams[index] = {
        ...prev,
        practice_day: value as PlayingDay,
        ...(!prev.practice_venue_id && data.practice_venue_id
          ? { practice_venue_id: data.practice_venue_id }
          : {}),
      };
    } else {
      teams[index] = { ...prev, [field]: value || undefined };
    }

    update({ teams });
  }

  function clearSlot(index: number) {
    const teams = [...data.teams];
    teams[index] = withoutSlot(data.teams[index]);
    update({ teams });
  }

  function handleSkip() {
    update({ teams: data.teams.map(withoutSlot) });
    onSkip();
  }

  const pinnedCount = data.teams.filter((t) => t.practice_day).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Practice schedule</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Set recurring practice slots for each team, or skip to auto-assign.
        </p>
      </div>

      {/* Teams list */}
      <div className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
        {data.teams.map((team, i) => {
          const hasSlot = !!team.practice_day;
          const win = team.practice_day ? getWindow(team.practice_day) : null;

          return (
            <div
              key={i}
              className={`px-4 py-3.5 transition-colors ${hasSlot ? "bg-white" : "bg-gray-50/50"}`}
            >
              {/* Row header */}
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-sm font-semibold text-[#0C1F3F]">
                  {team.name || `Team ${i + 1}`}
                </span>
                {hasSlot && (
                  <button
                    type="button"
                    onClick={() => clearSlot(i)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Slot inputs — 3 columns */}
              <div className="grid grid-cols-3 gap-2">
                {/* Day */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                    Day
                  </label>
                  <select
                    value={team.practice_day ?? ""}
                    onChange={(e) => setSlotField(i, "practice_day", e.target.value)}
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
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                    {win ? `Start (${win.start}–${win.end})` : "Start time"}
                  </label>
                  <input
                    type="time"
                    value={team.practice_start ?? ""}
                    min={win?.start}
                    max={win?.end}
                    disabled={!team.practice_day}
                    onChange={(e) => setSlotField(i, "practice_start", e.target.value)}
                    className="h-9 w-full rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>

                {/* Venue */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                    Venue
                  </label>
                  {practiceVenues.length === 0 ? (
                    <div className="flex h-9 items-center rounded-lg border border-dashed border-gray-200 px-2">
                      <span className="truncate text-xs italic text-gray-400">No practice venues</span>
                    </div>
                  ) : (
                    <select
                      value={team.practice_venue_id ?? data.practice_venue_id ?? ""}
                      disabled={!team.practice_day}
                      onChange={(e) => setSlotField(i, "practice_venue_id", e.target.value)}
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
              </div>
            </div>
          );
        })}
      </div>

      {/* Status + skip */}
      <div className="flex flex-col items-center gap-3">
        {pinnedCount > 0 && (
          <p className="text-xs text-gray-500">
            <span className="font-semibold text-[#22C55E]">{pinnedCount}</span> of{" "}
            {data.teams.length} team{data.teams.length !== 1 ? "s" : ""} pinned —{" "}
            the rest will be auto-assigned.
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

      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-[#0C1F3F]">Tip:</span>{" "}
          Pinned slots are locked for the whole season. Teams with no slot set here will have
          practices auto-assigned by the generator.
        </p>
      </div>
    </div>
  );
}

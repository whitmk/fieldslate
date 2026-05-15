"use client";

import { Plus, Trash2 } from "lucide-react";
import { ORDERED_DAYS } from "@/components/divisions/wizard-types";
import type { SnackShackWizardData, DayCode, TimeBlock } from "../wizard-types";

interface Props {
  data: SnackShackWizardData;
  update: (patch: Partial<SnackShackWizardData>) => void;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

function fmtTime(t: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function StepTimeBlocks({ data, update }: Props) {
  const enabledDays = ORDERED_DAYS.filter((d) =>
    data.days_of_week.includes(d.key as DayCode),
  );

  function getBlocks(day: DayCode): TimeBlock[] {
    return data.time_blocks_by_day[day] ?? [];
  }

  function setBlocks(day: DayCode, blocks: TimeBlock[]) {
    update({
      time_blocks_by_day: {
        ...data.time_blocks_by_day,
        [day]: blocks,
      },
    });
  }

  function addBlock(day: DayCode) {
    const blocks = getBlocks(day);
    const lastEnd = blocks.length > 0 ? blocks[blocks.length - 1].end : "09:00";
    setBlocks(day, [
      ...blocks,
      { id: uid(), start: lastEnd, end: lastEnd },
    ]);
  }

  function removeBlock(day: DayCode, id: string) {
    setBlocks(day, getBlocks(day).filter((b) => b.id !== id));
  }

  function updateBlock(
    day: DayCode,
    id: string,
    field: "start" | "end",
    value: string,
  ) {
    setBlocks(
      day,
      getBlocks(day).map((b) => (b.id === id ? { ...b, [field]: value } : b)),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Time blocks</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          For each open day, define the coverage blocks. Each block represents
          one team assignment — e.g. Sat: 9am–12pm, 12pm–3pm, 3pm–6pm.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {enabledDays.map(({ key, label }) => {
          const day = key as DayCode;
          const blocks = getBlocks(day);
          return (
            <div key={key} className="overflow-hidden rounded-xl border border-gray-200">
              {/* Day header */}
              <div className="flex items-center justify-between bg-gray-50/70 px-4 py-2.5">
                <span className="text-sm font-semibold text-[#0C1F3F]">{label}</span>
                <button
                  type="button"
                  onClick={() => addBlock(day)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[#22C55E] transition-colors hover:bg-[#22C55E]/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add block
                </button>
              </div>

              {/* Blocks list */}
              {blocks.length === 0 ? (
                <div className="px-4 py-4 text-center text-sm text-gray-400">
                  No blocks yet.{" "}
                  <button
                    type="button"
                    onClick={() => addBlock(day)}
                    className="font-medium text-[#22C55E] hover:underline"
                  >
                    Add one
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {blocks.map((block, bi) => (
                    <div
                      key={block.id}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <span className="w-5 flex-shrink-0 text-center text-xs font-semibold text-gray-400">
                        {bi + 1}
                      </span>
                      <div className="flex flex-1 items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            Start
                          </p>
                          <input
                            type="time"
                            value={block.start}
                            onChange={(e) =>
                              updateBlock(day, block.id, "start", e.target.value)
                            }
                            className="h-8 w-28 rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                          />
                        </div>
                        <span className="mt-4 flex-shrink-0 text-xs text-gray-300">–</span>
                        <div className="flex flex-col gap-0.5">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            End
                          </p>
                          <input
                            type="time"
                            value={block.end}
                            min={block.start}
                            onChange={(e) =>
                              updateBlock(day, block.id, "end", e.target.value)
                            }
                            className="h-8 w-28 rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                          />
                        </div>
                        {block.start && block.end && (
                          <span className="hidden text-xs text-gray-400 sm:inline">
                            {fmtTime(block.start)} – {fmtTime(block.end)}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeBlock(day, block.id)}
                        aria-label="Remove block"
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

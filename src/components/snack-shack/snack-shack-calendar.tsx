"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  BlockEditModal,
  type BlockRow,
  type TeamOption,
} from "./snack-shack-schedule";

interface Props {
  blocks: BlockRow[];
  teams: TeamOption[];
  /** Snack shack open-range start (YYYY-MM-DD). Cells outside are dimmed. */
  startDate: string;
  /** Snack shack open-range end (YYYY-MM-DD). Cells outside are dimmed. */
  endDate: string;
}

// ── Date helpers ────────────────────────────────────────────────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayLocal(): string {
  return localDateStr(new Date());
}

// Mon-Sun grid. Map JS day (Sun=0..Sat=6) → column (Mon=0..Sun=6).
function dayToCol(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function buildGrid(month: string): Date[] {
  const [yr, mo] = month.split("-").map(Number);
  const first = new Date(yr, mo - 1, 1);
  const offset = dayToCol(first.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(yr, mo - 1, 1 - offset + i));
  }
  return cells;
}

function monthLabel(month: string) {
  const [yr, mo] = month.split("-").map(Number);
  return new Date(yr, mo - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function shiftMonth(month: string, delta: number) {
  const [yr, mo] = month.split("-").map(Number);
  const d = new Date(yr, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function initialMonth(startDate: string, endDate: string): string {
  const today = todayLocal();
  // If today is within the open range, use today's month.
  if (today >= startDate && today <= endDate) {
    return today.substring(0, 7);
  }
  // Otherwise use the start date's month.
  return startDate.substring(0, 7);
}

// ── Component ───────────────────────────────────────────────────────────────

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SnackShackCalendar({ blocks, teams, startDate, endDate }: Props) {
  const today = todayLocal();
  const [month, setMonth] = useState(() => initialMonth(startDate, endDate));
  const [editingBlock, setEditingBlock] = useState<BlockRow | null>(null);

  // Index blocks by date and sort within each day.
  const blocksByDate = useMemo(() => {
    const map = new Map<string, BlockRow[]>();
    for (const b of blocks) {
      if (!map.has(b.date)) map.set(b.date, []);
      map.get(b.date)!.push(b);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [blocks]);

  const cells = buildGrid(month);
  const [, mo] = month.split("-").map(Number);

  return (
    <div className="flex flex-col gap-3">
      {/* Month nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonth(initialMonth(startDate, endDate))}
            className="ml-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
          >
            Today
          </button>
        </div>
        <h3 className="text-base font-semibold text-[#0C1F3F]">
          {monthLabel(month)}
        </h3>
        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
            Recurring
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            One-off
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, idx) => {
            const cellDate = localDateStr(cell);
            const inMonth = cell.getMonth() === mo - 1;
            const isToday = cellDate === today;
            const inOpenRange = cellDate >= startDate && cellDate <= endDate;
            const cellBlocks = blocksByDate.get(cellDate) ?? [];
            const isLastRow = idx >= 35;
            const dimmed = !inMonth || !inOpenRange;

            return (
              <div
                key={idx}
                className={`min-h-[110px] border-gray-50 p-1.5 ${
                  (idx + 1) % 7 === 0 ? "" : "border-r"
                } ${isLastRow ? "" : "border-b"} ${
                  dimmed ? "bg-gray-50/60" : "bg-white"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                      isToday
                        ? "bg-[#22C55E] text-white"
                        : dimmed
                        ? "text-gray-300"
                        : "text-[#0C1F3F]"
                    }`}
                  >
                    {cell.getDate()}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  {cellBlocks.map((b) => (
                    <AssignmentPill
                      key={b.id}
                      block={b}
                      muted={dimmed}
                      onClick={() => setEditingBlock(b)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editingBlock && (
        <BlockEditModal
          block={editingBlock}
          teams={teams}
          onClose={() => setEditingBlock(null)}
          onSaved={() => setEditingBlock(null)}
        />
      )}
    </div>
  );
}

// ── Assignment pill ─────────────────────────────────────────────────────────

function AssignmentPill({
  block,
  muted,
  onClick,
}: {
  block: BlockRow;
  muted: boolean;
  onClick: () => void;
}) {
  const teamLabel = block.team_name ?? "Unassigned";
  const assigned = !!block.assigned_team_id;
  const dotColor = block.is_recurring ? "bg-gray-300" : "bg-indigo-500";

  const base = muted
    ? "bg-gray-100 text-gray-400 hover:bg-gray-200"
    : assigned
    ? "bg-orange-50 text-orange-800 hover:bg-orange-100"
    : "border border-dashed border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-0.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors ${base}`}
      title={`${teamLabel} · ${fmtTime(block.start_time)} – ${fmtTime(block.end_time)} · ${
        block.is_recurring ? "Recurring" : "One-off"
      }`}
    >
      <span className="flex items-center gap-1.5 truncate font-semibold">
        <span
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotColor}`}
          aria-hidden
        />
        <span className="truncate">{teamLabel}</span>
      </span>
      <span className="truncate tabular-nums text-[10px] opacity-80">
        {fmtTime(block.start_time)} – {fmtTime(block.end_time)}
      </span>
    </button>
  );
}

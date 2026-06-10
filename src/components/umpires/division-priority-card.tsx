"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ListOrdered,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type PriorityDivision = { id: string; name: string; priority: number };

interface Props {
  /** Optional — rendered as a subheading so multiple seasons can stack. */
  seasonName?: string;
  divisions: PriorityDivision[];
}

/**
 * Drag-to-reorder list of a season's divisions. Order is persisted as
 * sequential divisions.priority values (0, 1, 2…) — auto-assign fills
 * higher-priority (lower number) divisions first. HTML5 native drag and
 * drop, with up/down buttons as the touch/keyboard path (HTML5 DnD doesn't
 * fire on mobile Safari).
 */
export function DivisionPriorityCard({ seasonName, divisions }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<PriorityDivision[]>(
    [...divisions].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  async function applyOrder(next: PriorityDivision[]) {
    setItems(next);
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const results = await Promise.all(
      next.map((d, i) =>
        supabase
          .from("divisions")
          .update({ priority: i } as never)
          .eq("id", d.id),
      ),
    );
    setSaving(false);
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      setError(firstErr.message);
    }
    // Refresh either way — on partial failure this re-reads server truth.
    router.refresh();
  }

  function moveTo(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void applyOrder(next);
  }

  function handleDrop(e: React.DragEvent, to: number) {
    e.preventDefault();
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setOverIndex(null);
    if (from != null) moveTo(from, to);
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <ListOrdered className="h-4 w-4 text-gray-400" />
        <div className="flex flex-col">
          <h3 className="font-semibold text-[#0C1F3F]">Division priority</h3>
          {seasonName && <p className="text-xs text-gray-400">{seasonName}</p>}
        </div>
        {saving && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-gray-300" />}
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Drag to set the order officials are assigned. Higher divisions get
        first pick of available officials.
      </p>

      <ul className="flex flex-col gap-1.5">
        {items.map((div, idx) => (
          <li
            key={div.id}
            draggable
            onDragStart={(e) => {
              dragIndexRef.current = idx;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(idx);
            }}
            onDragLeave={() => setOverIndex((cur) => (cur === idx ? null : cur))}
            onDrop={(e) => handleDrop(e, idx)}
            onDragEnd={() => {
              dragIndexRef.current = null;
              setOverIndex(null);
            }}
            className={`flex min-h-[44px] cursor-grab items-center gap-2 rounded-lg border bg-white pl-2 pr-1 transition-colors active:cursor-grabbing ${
              overIndex === idx
                ? "border-[#22C55E] bg-[#22C55E]/5"
                : "border-gray-100"
            }`}
          >
            <GripVertical className="h-4 w-4 flex-shrink-0 text-gray-300" />
            <span className="w-5 flex-shrink-0 text-xs font-semibold tabular-nums text-gray-400">
              {idx + 1}.
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
              {div.name}
            </span>
            <button
              type="button"
              onClick={() => moveTo(idx, idx - 1)}
              disabled={idx === 0 || saving}
              aria-label={`Move ${div.name} up`}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-300 transition-colors hover:text-[#0C1F3F] disabled:cursor-default disabled:opacity-30"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => moveTo(idx, idx + 1)}
              disabled={idx === items.length - 1 || saving}
              aria-label={`Move ${div.name} down`}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-300 transition-colors hover:text-[#0C1F3F] disabled:cursor-default disabled:opacity-30"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { GripVertical, Users, Shuffle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData, SeededTeam } from "../playoff-wizard-types";

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
}

type TeamRow = { id: string; name: string };

export function StepSeeding({ data, update }: Props) {
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState<SeededTeam[]>(data.seeding);
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Load teams when division changes and seeding is not yet populated
  useEffect(() => {
    if (!data.division_id) return;

    if (data.seeding.length > 0) {
      setSeeding(data.seeding);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    supabase
      .from("teams")
      .select("id, name")
      .eq("division_id", data.division_id)
      .order("name")
      .then(({ data: teams }) => {
        const initial: SeededTeam[] = ((teams as TeamRow[]) ?? []).map((t) => ({
          team_id: t.id,
          team_name: t.name,
        }));
        setSeeding(initial);
        update({ seeding: initial });
        setLoading(false);
      });
  // update is stable (useCallback with [] deps in parent); omit to avoid loop
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
    setSeeding(next);
    update({ seeding: next });
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDragOver(null);
  }

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
            bracket.
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
              setSeeding(next);
              update({ seeding: next });
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
      ) : seeding.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <Users className="h-6 w-6 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            No teams in this division yet.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          {seeding.map((team, i) => (
            <div
              key={team.team_id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
              className={`flex cursor-grab items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 transition-colors active:cursor-grabbing ${
                dragOver === i
                  ? "bg-[#22C55E]/5 ring-2 ring-inset ring-[#22C55E]/30"
                  : "bg-white hover:bg-gray-50/60"
              }`}
            >
              <GripVertical className="h-4 w-4 flex-shrink-0 text-gray-300" />
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#0C1F3F] text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <span className="flex-1 text-sm font-medium text-gray-900">
                {team.team_name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

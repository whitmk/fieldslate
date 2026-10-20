"use client";

// Seed Stage 2 (approved mockup, screens 7, 8 and 8b). The list opens A–Z —
// FieldSlate never ranks — or in the saved order for "Change seeds". Rows
// drag on desktop and move with ▲ ▼ everywhere (how it works on a phone).
// "Review bracket" asks seed_playoff_stage for its preview (writes nothing),
// then the confirm lists byes, round-1 matchups, who doesn't advance and —
// for Seed anyway — the games never played. Every sentence: two-stage.ts.

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Loader2, X } from "lucide-react";
import type { SeededTeam } from "@/components/playoffs/playoff-wizard-types";
import {
  cutLine,
  moveSeed,
  recordsFootnote,
  recordText,
  SEED_SCREEN_LINE,
  seedConfirm,
  type Stage1Status,
  type Stage2Game,
  type TeamRecord,
} from "@/lib/playoffs/two-stage";
import { seedStage } from "@/lib/playoffs/two-stage-io";

interface Props {
  divisionName: string;
  stage2Id: string;
  order: SeededTeam[];
  records: TeamRecord[];
  advance: number;
  status: Stage1Status;
  stage2Games: Stage2Game[];
  teamName: (id: string | null) => string;
  onClose: () => void;
  onSeeded: () => void;
}

export function SeedStage2Modal({
  divisionName,
  stage2Id,
  order: initialOrder,
  records,
  advance,
  status,
  stage2Games,
  teamName,
  onClose,
  onSeeded,
}: Props) {
  const [order, setOrder] = useState<SeededTeam[]>(initialOrder);
  const [step, setStep] = useState<"order" | "confirm">("order");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const byId = new Map(records.map((r) => [r.teamId, r]));
  const never = status.kind === "seed_anyway" ? status.neverPlayed.length : 0;
  const total = status.total;

  async function review() {
    setBusy(true);
    setError(null);
    const res = await seedStage(stage2Id, order.map((t) => t.team_id), false);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setStep("confirm");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await seedStage(stage2Id, order.map((t) => t.team_id), true);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onSeeded();
  }

  function drop(to: number) {
    const from = drag.current;
    drag.current = null;
    setDragOver(null);
    if (from === null || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
  }

  const confirm = seedConfirm({ divisionName, stage2Games, order, advance, status, teamName });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">
            {step === "order" ? `Seed the ${divisionName} bracket` : confirm.title}
          </h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === "order" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-500">{SEED_SCREEN_LINE(advance)}</p>
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <div className="grid grid-cols-[20px_24px_1fr_auto_auto] items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:grid-cols-[20px_24px_1fr_48px_40px_40px_auto]">
                  <span />
                  <span>#</span>
                  <span>Team</span>
                  <span className="text-right">W-L</span>
                  <span className="hidden text-right sm:block">RF</span>
                  <span className="hidden text-right sm:block">RA</span>
                  <span />
                </div>
                {order.map((t, i) => {
                  const r = byId.get(t.team_id);
                  const out = i >= advance;
                  return (
                    <div key={t.team_id}>
                      {i === advance && (
                        <div className="border-y border-dashed border-gray-300 bg-gray-50 py-1 text-center text-[11px] font-medium text-gray-500">
                          {cutLine(advance)}
                        </div>
                      )}
                      <div
                        draggable
                        onDragStart={() => (drag.current = i)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(i);
                        }}
                        onDrop={() => drop(i)}
                        onDragEnd={() => {
                          drag.current = null;
                          setDragOver(null);
                        }}
                        className={`grid grid-cols-[20px_24px_1fr_auto_auto] items-center gap-2 border-b border-gray-100 px-3 py-1.5 last:border-0 sm:grid-cols-[20px_24px_1fr_48px_40px_40px_auto] ${
                          dragOver === i ? "bg-[#22C55E]/5" : out ? "bg-gray-50/70" : "bg-white"
                        }`}
                      >
                        <GripVertical className="h-4 w-4 cursor-grab text-gray-300" />
                        <span className={`text-sm font-bold ${out ? "text-gray-400" : "text-[#0C1F3F]"}`}>{i + 1}</span>
                        <span className={`min-w-0 truncate text-sm ${out ? "text-gray-400" : "font-medium text-gray-900"}`}>
                          {t.team_name}
                          {r && (
                            <span className="block text-[11px] font-normal text-gray-400 sm:hidden">
                              {r.runsFor} for · {r.runsAgainst} against
                            </span>
                          )}
                        </span>
                        <span className="text-right text-sm tabular-nums text-gray-700">{r ? recordText(r) : "—"}</span>
                        <span className="hidden text-right text-sm tabular-nums text-gray-500 sm:block">{r?.runsFor ?? "—"}</span>
                        <span className="hidden text-right text-sm tabular-nums text-gray-500 sm:block">{r?.runsAgainst ?? "—"}</span>
                        <span className="flex">
                          <button
                            type="button"
                            aria-label={`Move ${t.team_name} up`}
                            disabled={i === 0}
                            onClick={() => setOrder(moveSeed(order, i, -1))}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${t.team_name} down`}
                            disabled={i === order.length - 1}
                            onClick={() => setOrder(moveSeed(order, i, 1))}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500">{recordsFootnote(total, never)}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm text-gray-800">
              {confirm.unplayed && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{confirm.unplayed}</p>
              )}
              <ol className="flex list-decimal flex-col gap-1.5 pl-5">
                {confirm.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
              {confirm.notAdvancing && <p className="text-xs text-gray-500">{confirm.notAdvancing}</p>}
              <p className="text-xs text-gray-500">
                Saving fills the bracket&apos;s team slots. Dates, times, fields and game numbers stay as they are.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button
            onClick={step === "order" ? onClose : () => setStep("order")}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            {step === "order" ? "Cancel" : "Back"}
          </button>
          <button
            onClick={step === "order" ? review : save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16a34a] disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {step === "order" ? "Review bracket" : confirm.button === "Seed anyway" ? "Seed anyway" : "Seed bracket"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

// The regenerate PREVIEW. Nothing is written until Confirm; Cancel writes
// nothing. Shows every shift added, removed or changed by date, every
// assignment that would change, and how many past shifts are left as they
// are. The counts and lines come from the plan — the modal invents nothing.

import { useEffect, useRef } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { assignmentChangeLines, type RegeneratePlan } from "@/lib/snack-shack/regenerate-plan";
import type { StoredShiftRow } from "@/lib/snack-shack/derive-shifts";

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(t: string) {
  const [h, m] = t.substring(0, 5).split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}
const span = (s: string, e: string) => `${fmtTime(s)} – ${fmtTime(e)}`;

interface Props {
  plan: RegeneratePlan;
  teamName: (id: string | null) => string;
  /** 0104: the cash person's name, or null for none. */
  cashName?: (id: string | null) => string | null;
  /** The calmer notice for shifts made before automatic shifts. */
  legacyNotice: string | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RegeneratePreviewModal({ plan, teamName, cashName = () => null, legacyNotice, busy, error, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const added = plan.dayChanges.reduce((n, d) => n + d.added.length, 0);
  const removed = plan.dayChanges.reduce((n, d) => n + d.removed.length, 0);
  const changed = plan.dayChanges.reduce((n, d) => n + d.changed.length, 0);
  const lines = assignmentChangeLines(plan.assignmentChanges, teamName);
  const rowSpan = (r: StoredShiftRow) => span(r.start_time, r.end_time);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="regen-title"
        className="flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl"
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 id="regen-title" className="font-semibold text-[#0C1F3F]">Regenerate shifts from the game schedule</h2>
            <p className="text-xs text-gray-400">Nothing is written until you confirm.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {legacyNotice && (
            <p className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{legacyNotice}</p>
          )}

          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-green-50 px-2.5 py-1 font-semibold text-green-700">{added} added</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">{changed} changed</span>
            <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700">{removed} removed</span>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-600">{plan.kept} unchanged</span>
            {plan.frozenPast > 0 && (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-600">
                {plan.frozenPast === 1 ? "1 past shift left as it is" : `${plan.frozenPast} past shifts left as they are`}
              </span>
            )}
          </div>

          {!plan.hasChanges ? (
            <p className="text-sm text-gray-500">
              The shifts already match the game schedule. Confirming only records that they were checked today.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {plan.dayChanges.map((d) => (
                <div key={d.date}>
                  <p className="text-sm font-semibold text-[#0C1F3F]">{fmtDate(d.date)}</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                    {d.changed.map((c) => (
                      <li key={`c-${c.from.id}`} className="text-amber-800">
                        Changed: {rowSpan(c.from)} → {span(c.to.start, c.to.end)}
                      </li>
                    ))}
                    {d.added.map((a) => (
                      <li key={`a-${a.start}-${a.end}`} className="text-green-800">Added: {span(a.start, a.end)}</li>
                    ))}
                    {d.removed.map((r) => (
                      <li key={`r-${r.id}`} className="text-red-800">Removed: {rowSpan(r)}</li>
                    ))}
                  </ul>
                </div>
              ))}

              {plan.carried.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-[#0C1F3F]">Notes and cash people carried to the changed shift</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm text-gray-700">
                    {plan.carried.map((c) => (
                      <li key={`k-${c.date}-${c.start}`}>
                        {fmtDate(c.date)} {fmtTime(c.start)}: {c.notes ? `“${c.notes}”` : ""}{c.notes && c.cashPersonId ? " · " : ""}{c.cashPersonId ? `cash: ${cashName(c.cashPersonId) ?? "a name"}` : ""} → moves to {fmtTime(c.start)} – {fmtTime(c.toEnd)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.lost.length > 0 && (
                <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                  <p className="text-sm font-semibold text-red-800">Notes and cash people on removed shifts — gone after Confirm</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm text-red-800">
                    {plan.lost.map((l) => (
                      <li key={`l-${l.date}-${l.start}`}>
                        {fmtDate(l.date)} {span(l.start, l.end)}: {l.notes ? `“${l.notes}”` : ""}{l.notes && l.cashPersonId ? " · " : ""}{l.cashPersonId ? `cash: ${cashName(l.cashPersonId) ?? "a name"}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {lines.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-[#0C1F3F]">Assignments that would change</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm text-gray-700">
                    {lines.map((l, i) => (
                      <li key={i} className="tabular-nums">{l}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}
            className="h-11 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#22C55E] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {busy ? "Writing…" : "Confirm and regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}

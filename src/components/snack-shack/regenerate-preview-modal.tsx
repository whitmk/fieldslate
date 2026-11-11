"use client";

// The regenerate PREVIEW — the whole season, or one day (0131, Part B).
// Nothing is written until Confirm; Cancel writes nothing. For every day the
// plan changes it shows the day AS IT WILL BE (each shift with its team, and
// what that team's shift was), the teams left with no shift that day, and the
// volunteers who lose their spot or move with a changed shift, BY NAME. Every
// line comes from the plan and stale-days.ts — the modal invents nothing.
//
// THIS IS THE ONE FILE that may call volunteer_shift_claims_for_blocks (first
// initial + last name, never an email). sim:game-notes fails if any other
// file in src names it. If the names can't be read, the count line still
// shows with "Couldn't read who signed up." — Confirm stays allowed.

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { signupsLine, type RegeneratePlan } from "@/lib/snack-shack/regenerate-plan";
import type { SchedulingPreference, StoredShiftRow } from "@/lib/snack-shack/derive-shifts";
import { dayResults, fmtDay, previewTitle } from "@/lib/snack-shack/stale-days";
import {
  COULDNT_READ_NAMES,
  parseShiftClaimNames,
  previewBlockIds,
  signupNameLines,
  type ShiftClaimName,
} from "@/lib/snack-shack/preview-names";
import { NEEDS_TEAM, fmtShiftRange, previewFlagLine } from "@/lib/snack-shack/shift-flags";
import { headcountCarryText } from "@/lib/snack-shack/headcount";

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(t: string) {
  const [h, m] = t.substring(0, 5).split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}
const span = (s: string, e: string) => fmtShiftRange(s, e);

interface Props {
  plan: RegeneratePlan;
  /** The season — the names read is gated by it. */
  seasonId: string;
  /** The stored shifts the plan was built from (the "was" side of each day). */
  stored: StoredShiftRow[];
  /** Words the off-preference lines ("not at the park" vs "plays that day"). */
  preference: SchedulingPreference;
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

export function RegeneratePreviewModal({ plan, seasonId, stored, preference, teamName, cashName = () => null, legacyNotice, busy, error, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Names of the volunteers on removed and changed shifts. Read only when the
  // counts say someone signed up; "error" keeps the count line and says so.
  const [names, setNames] = useState<ShiftClaimName[] | "loading" | "error" | null>(null);
  const ids = previewBlockIds(plan);
  const idsKey = [...ids.lost, ...ids.carried].sort().join(",");
  const anySignups = plan.signups !== null && plan.signups.carried + plan.signups.lost > 0;
  useEffect(() => {
    if (!anySignups || idsKey === "") { setNames(null); return; }
    let cancelled = false;
    setNames("loading");
    createClient()
      // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
      .rpc("volunteer_shift_claims_for_blocks", { p_season_id: seasonId, p_block_ids: idsKey.split(",") })
      .then(({ data, error: e }: { data: unknown; error: { message: string } | null }) => {
        if (cancelled) return;
        const parsed = e ? null : parseShiftClaimNames(data);
        if (e) console.error("[snack shack] volunteer names:", e.message);
        setNames(parsed ?? "error");
      });
    return () => { cancelled = true; };
  }, [anySignups, idsKey, seasonId]);
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
  const days = dayResults(plan, stored, (id) => teamName(id));
  const head = previewTitle(plan.onlyDates);
  const withDate = !(plan.onlyDates && plan.onlyDates.length === 1);
  const named = Array.isArray(names) ? signupNameLines(plan, names, withDate) : null;
  const countLine = signupsLine(plan.signups);
  const needsTeam = plan.flagged.filter((f) => f.flag === "unfilled").length;
  // What a carried or lost row holds: "“note” · cash: Pat · needs 3 people".
  const internalText = (notes: string | null, cashPersonId: string | null, peopleNeeded: number | null) =>
    [
      notes ? `“${notes}”` : "",
      cashPersonId ? `cash: ${cashName(cashPersonId) ?? "a name"}` : "",
      headcountCarryText(peopleNeeded),
    ].filter(Boolean).join(" · ");

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
            <h2 id="regen-title" className="font-semibold text-[#0C1F3F]">{head.title}</h2>
            <p className="text-xs text-gray-400">{head.subtitle}</p>
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
            {plan.untouched > 0 && (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-600">
                {plan.untouched === 1 ? "1 shift on other days left as it is" : `${plan.untouched} shifts on other days left as they are`}
              </span>
            )}
            {plan.frozenPast > 0 && (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold text-gray-600">
                {plan.frozenPast === 1 ? "1 past shift left as it is" : `${plan.frozenPast} past shifts left as they are`}
              </span>
            )}
            {needsTeam > 0 && (
              <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700">
                {needsTeam === 1 ? "1 needs a team" : `${needsTeam} need a team`}
              </span>
            )}
          </div>

          {!plan.hasChanges ? (
            <p className="text-sm text-gray-500">
              The shifts already match the game schedule. Confirming only records that they were checked today.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {days.map((d) => (
                <div key={d.date}>
                  <p className="text-sm font-semibold text-[#0C1F3F]">{fmtDay(d.date)} — after the rebuild</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm tabular-nums">
                    {d.shifts.map((sh) => (
                      <li key={`s-${sh.start}-${sh.end}`} className={sh.needsTeam ? "font-medium text-red-700" : "text-gray-800"}>{sh.text}</li>
                    ))}
                    {d.shifts.length === 0 && <li className="text-gray-500">No shifts this day.</li>}
                    {d.noLonger.map((l) => (
                      <li key={l} className="text-amber-800">{l}</li>
                    ))}
                  </ul>
                </div>
              ))}

              {plan.carried.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-[#0C1F3F]">Notes, cash people and headcounts carried to the changed shift</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm text-gray-700">
                    {plan.carried.map((c) => (
                      <li key={`k-${c.date}-${c.start}`}>
                        {fmtDate(c.date)} {fmtTime(c.start)}: {internalText(c.notes, c.cashPersonId, c.peopleNeeded)} → moves to {fmtTime(c.start)} – {fmtTime(c.toEnd)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {names === "loading" && countLine && (
                <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600">{countLine} Reading who signed up…</p>
              )}
              {names === "error" && countLine && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">{countLine} {COULDNT_READ_NAMES}</p>
              )}
              {names === null && countLine && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{countLine}</p>
              )}
              {named?.lost && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">{named.lost}</p>
              )}
              {named?.carried && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{named.carried}</p>
              )}
              {named && !named.lost && !named.carried && countLine && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{countLine}</p>
              )}

              {plan.lost.length > 0 && (
                <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                  <p className="text-sm font-semibold text-red-800">Notes, cash people and headcounts on removed shifts — gone after Confirm</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm text-red-800">
                    {plan.lost.map((l) => (
                      <li key={`l-${l.date}-${l.start}`}>
                        {fmtDate(l.date)} {span(l.start, l.end)}: {internalText(l.notes, l.cashPersonId, l.peopleNeeded)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.flagged.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-[#0C1F3F]">After Confirm</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm text-gray-700">
                    {plan.flagged.map((f) => {
                      const line = previewFlagLine(f.flag, preference);
                      return (
                        <li key={`f-${f.date}-${f.start}`} className="tabular-nums">
                          {fmtDate(f.date)}, {span(f.start, f.end)}:{" "}
                          {f.teamId ? teamName(f.teamId) : <span className="font-medium text-red-700">{NEEDS_TEAM}</span>}
                          {" — "}
                          <span className={line.red ? "text-red-700" : "text-gray-500"}>{line.text}</span>.
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1 text-xs text-gray-400">Only new shifts are listed here. Past shifts are never flagged.</p>
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
            {busy ? "Writing…" : head.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

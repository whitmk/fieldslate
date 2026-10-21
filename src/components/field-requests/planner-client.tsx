"use client";

// The planner (step 5b; mockup screen 3). Opening writes nothing; an edit
// marks the plan dirty and, after a pause, saves it through
// save_practice_plan with the updated_at this page loaded. The decisions —
// what each reply does, when autosave may run, when leaving warns — are
// editor.ts's; this file wires them to inputs, a timer and the page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { computePlan } from "@/lib/practice-planner/report";
import type { SpreadMode } from "@/lib/practice-planner/types";
import type { UsCity } from "@/lib/sun/us-cities";
import type { PlanDivision, PlanInput } from "@/lib/practice-plans/load";
import { INPUT_LIMITS, PLAN_INPUT_VERSION, practicePlanInputProblem } from "@/lib/practice-plans/plan-input";
import type { Prefill, PrefillAdjustments } from "@/lib/practice-plans/prefill";
import { saveOutcome } from "@/lib/practice-plans/list";
import { litDivisionNames } from "@/lib/practice-plans/request";
import {
  addDivision,
  afterSave,
  autosaveAllowed,
  canAddDivision,
  committedDate,
  removeDivision,
  updateDivision,
  warnOnLeave,
  type SaveState,
} from "@/lib/practice-plans/editor";
import {
  BACK_TO_PLANS,
  CHANGE_IN_SETTINGS,
  CITY_NOT_SET,
  CITY_SOURCE_NOTE,
  DIVISIONS_CARD,
  END_LABEL,
  LEAVE_WARNING,
  MINUTES_BETWEEN_LABEL,
  NO_CITY_LINK,
  PLAN_NAME_LABEL,
  PLAN_REQUIRED_STOPPED,
  PRACTICES_CARD,
  PRACTICES_HINT,
  RELOAD_CONFIRM_BODY,
  RELOAD_CONFIRM_BUTTON,
  RELOAD_CONFIRM_TITLE,
  SAVE_FAILED,
  SAVE_NEEDS_NAME,
  SAVE_RETRY,
  SAVE_SAVED,
  SAVE_SAVING,
  SAVE_UNSAVED,
  START_LABEL,
  STALE_KEEP_MINE,
  STALE_RELOAD,
  SUNSET_FOR_LABEL,
  divisionsHint,
  planErrorMessage,
  prefillAdjustedLine,
  staleSaveLine,
} from "@/lib/practice-plans/words";
import { DivisionEditor } from "./division-editor";
import { PlanResults, SETTINGS_DAYLIGHT_HREF } from "./plan-results";

const AUTOSAVE_DELAY_MS = 900;
const INPUT =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#16a34a] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/30 disabled:bg-gray-50";

type Props = {
  planId: string;
  initialName: string;
  initialInput: PlanInput;
  initialMode: SpreadMode;
  initialUpdatedAt: string;
  city: UsCity | null;
  prefill: Prefill;
  prefillNote: { seasonName: string; adjustments: PrefillAdjustments } | null;
};

function staleWhen(iso: string): string {
  // Event-time text (after a save comes back), never a render-path clock read.
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function PlannerClient(props: Props) {
  const [name, setName] = useState(props.initialName);
  const [input, setInput] = useState<PlanInput>(props.initialInput);
  const [mode, setMode] = useState<SpreadMode>(props.initialMode);
  const [state, setState] = useState<SaveState>({ kind: "clean" });
  const [confirmReload, setConfirmReload] = useState(false);
  const updatedAt = useRef(props.initialUpdatedAt);
  const edits = useRef(0);
  const leaving = useRef(false);
  const latest = useRef({ name, input, mode });
  latest.current = { name, input, mode };

  const readOnly = state.kind === "stopped";

  // Every edit goes through here: it bumps the edit counter and marks the plan
  // dirty — unless a stale answer or a refusal is waiting on the person.
  const edit = useCallback((apply: () => void) => {
    apply();
    edits.current++;
    setState((s) => (s.kind === "stale" || s.kind === "stopped" ? s : { kind: "dirty" }));
  }, []);

  const save = useCallback(async (expected: string) => {
    const { name: n, input: inp, mode: m } = latest.current;
    const trimmed = n.trim();
    if (!trimmed || Array.from(trimmed).length > INPUT_LIMITS.planName.maxChars) {
      setState({ kind: "failed", message: SAVE_NEEDS_NAME });
      return;
    }
    if (practicePlanInputProblem(inp) !== null) {
      setState({ kind: "failed", message: planErrorMessage("invalid_input") });
      return;
    }
    const startedAt = edits.current;
    setState({ kind: "saving" });
    const { data, error } = await createClient().rpc(
      // @ts-expect-error — database.ts keeps an empty Functions map on purpose.
      "save_practice_plan",
      { p_plan_id: props.planId, p_expected_updated_at: expected, p_name: trimmed, p_input: inp, p_input_version: PLAN_INPUT_VERSION, p_mode: m },
    );
    const next = afterSave(saveOutcome(data, error), error);
    if (next.updatedAt) updatedAt.current = next.updatedAt;
    // An edit made while this save was in flight is still unsaved.
    if (next.state.kind === "clean" && edits.current !== startedAt) setState({ kind: "dirty" });
    else setState(next.state);
  }, [props.planId]);

  // Debounced autosave: only from dirty, only after a pause in editing.
  useEffect(() => {
    if (!autosaveAllowed(state)) return;
    const t = window.setTimeout(() => void save(updatedAt.current), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [state, name, input, mode, save]);

  // Warn on leaving only while an edit is unsaved.
  useEffect(() => {
    if (!warnOnLeave(state)) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = LEAVE_WARNING;
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [state]);

  const plan = useMemo(() => computePlan(input, { city: props.city }), [input, props.city]);
  const litNames = useMemo(() => litDivisionNames(input), [input]);
  const note = props.prefillNote
    ? prefillAdjustedLine(props.prefillNote.seasonName, props.prefillNote.adjustments, {
        divisions: INPUT_LIMITS.divisions.max, nameChars: INPUT_LIMITS.divisionName.maxChars, teams: INPUT_LIMITS.teams.max,
      })
    : null;

  const onDivision = (id: string, patch: Partial<PlanDivision>) => edit(() => setInput((i) => updateDivision(i, id, patch)));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/dashboard/field-requests" className="text-sm font-semibold text-[#16a34a]">← {BACK_TO_PLANS}</Link>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="min-w-0 break-words text-2xl font-bold text-gray-900">{name.trim() || props.initialName}</h1>
          <SaveStatus state={state} onRetry={() => void save(updatedAt.current)} />
        </div>
      </div>

      {state.kind === "stale" && (
        <div role="alert" data-stale className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>{staleSaveLine(state.byName, staleWhen(state.updatedAt))}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setConfirmReload(true)}
              className="min-h-9 rounded-lg border border-amber-300 bg-white px-3 font-semibold">{STALE_RELOAD}</button>
            <button type="button" onClick={() => void save(state.updatedAt)}
              className="min-h-9 rounded-lg bg-[#0C1F3F] px-3 font-semibold text-white">{STALE_KEEP_MINE}</button>
          </span>
        </div>
      )}
      {state.kind === "stopped" && (
        <div role="alert" data-stopped className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{PLAN_REQUIRED_STOPPED}</div>
      )}
      {note && <div data-prefill-note className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">{note}</div>}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-bold text-[#0C1F3F]">{PRACTICES_CARD}</h2>
        <p className="mb-3 text-xs text-gray-500">{PRACTICES_HINT}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-1">
            <span className="mb-1 block text-xs font-semibold text-gray-600">{PLAN_NAME_LABEL}</span>
            <input className={INPUT} value={name} disabled={readOnly} maxLength={INPUT_LIMITS.planName.maxChars}
              onChange={(e) => edit(() => setName(e.target.value))} />
          </label>
          <DateField label={START_LABEL} value={input.seasonStart} readOnly={readOnly} onCommit={(v) => edit(() => setInput((i) => ({ ...i, seasonStart: v })))} />
          <DateField label={END_LABEL} value={input.seasonEnd} readOnly={readOnly} onCommit={(v) => edit(() => setInput((i) => ({ ...i, seasonEnd: v })))} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">{MINUTES_BETWEEN_LABEL}</span>
            <select className={INPUT} value={input.minutesBetween} disabled={readOnly}
              onChange={(e) => edit(() => setInput((i) => ({ ...i, minutesBetween: Number(e.target.value) })))}>
              {Array.from({ length: INPUT_LIMITS.minutesBetween.max / 5 + 1 }, (_, k) => k * 5).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-gray-600">{SUNSET_FOR_LABEL}</span>
            <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm">
              <span>{props.city ? `${props.city.name}, ${props.city.state}` : CITY_NOT_SET}</span>
              <Link href={SETTINGS_DAYLIGHT_HREF} className="text-xs font-semibold text-[#16a34a] underline">
                {props.city ? CHANGE_IN_SETTINGS : NO_CITY_LINK}
              </Link>
            </div>
            <p className="mt-1 text-xs text-gray-500">{CITY_SOURCE_NOTE}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-bold text-[#0C1F3F]">{DIVISIONS_CARD}</h2>
        <p className="mb-3 text-xs text-gray-500">{divisionsHint(props.prefill.season?.name ?? null)}</p>
        <DivisionEditor
          divisions={input.divisions}
          prefill={props.prefill}
          canAdd={canAddDivision(input)}
          readOnly={readOnly}
          onChange={onDivision}
          onAdd={() => edit(() => setInput((i) => addDivision(i).input))}
          onRemove={(id) => edit(() => setInput((i) => removeDivision(i, id)))}
        />
      </section>

      <PlanResults plan={plan} mode={mode} city={props.city} litNames={litNames} readOnly={readOnly}
        onMode={(m) => m !== mode && edit(() => setMode(m))} />

      {confirmReload && (
        <ConfirmDialog title={RELOAD_CONFIRM_TITLE} detail={RELOAD_CONFIRM_BODY} confirmLabel={RELOAD_CONFIRM_BUTTON}
          onCancel={() => setConfirmReload(false)}
          onConfirm={() => {
            leaving.current = true;
            window.location.reload();
          }} />
      )}
    </div>
  );
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === "saving")
    return <span data-save-status className="inline-flex items-center gap-1.5 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{SAVE_SAVING}</span>;
  if (state.kind === "dirty") return <span data-save-status className="text-xs text-gray-500">{SAVE_UNSAVED}</span>;
  if (state.kind === "failed")
    return (
      <span data-save-status role="alert" className="inline-flex flex-wrap items-center gap-2 text-xs font-semibold text-red-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        {state.message === SAVE_NEEDS_NAME ? SAVE_NEEDS_NAME : `${SAVE_FAILED} ${state.message}`}
        {state.message !== SAVE_NEEDS_NAME && (
          <button type="button" onClick={onRetry} className="rounded-md border border-red-200 bg-white px-2 py-1 text-red-700">{SAVE_RETRY}</button>
        )}
      </span>
    );
  if (state.kind === "clean") return <span data-save-status className="inline-flex items-center gap-1 text-xs text-gray-500"><Check className="h-3.5 w-3.5" />{SAVE_SAVED}</span>;
  return null;
}

function DateField({ label, value, readOnly, onCommit }: { label: string; value: string; readOnly: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-600">{label}</span>
      <input type="date" className={INPUT} value={draft} disabled={readOnly} min={`${INPUT_LIMITS.yearMin}-01-01`} max={`${INPUT_LIMITS.yearMax}-12-31`}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = committedDate(e.target.value);
          if (v !== null) onCommit(v);
        }} />
    </label>
  );
}

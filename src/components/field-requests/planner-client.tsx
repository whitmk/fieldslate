"use client";

// The planner (step 5b; mockup screen 3). Opening writes nothing; an edit
// marks the plan dirty and, after a pause, saves it through
// save_practice_plan with the updated_at this page loaded. The decisions —
// what each reply does, when autosave may run, when leaving warns — are
// editor.ts's; this file wires them to inputs, a timer and the page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { AlertTriangle, Check, ClipboardCopy, Loader2, Printer, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { computePlan } from "@/lib/practice-planner/report";
import type { SpreadMode } from "@/lib/practice-planner/types";
import type { UsCity } from "@/lib/sun/us-cities";
import type { PlanDivision, PlanInput } from "@/lib/practice-plans/load";
import { INPUT_LIMITS, PLAN_INPUT_VERSION, practicePlanInputProblem } from "@/lib/practice-plans/plan-input";
import type { Prefill, PrefillAdjustments } from "@/lib/practice-plans/prefill";
import { saveOutcome } from "@/lib/practice-plans/list";
import { litDivisionNames, litLine, planRequestText } from "@/lib/practice-plans/request";
import {
  addDivision,
  afterSave,
  autosaveAllowed,
  canAddDivision,
  committedDate,
  removeDivision,
  stateAfterEdit,
  stateAfterReply,
  updateDivision,
  warnOnLeave,
  type SaveState,
} from "@/lib/practice-plans/editor";
import {
  BACK_TO_PLANS,
  CHANGE_IN_SETTINGS,
  CITY_NOT_SET,
  CITY_SOURCE_NOTE,
  COPIED_TOAST,
  COPY_DONE,
  COPY_FALLBACK,
  COPY_FALLBACK_TITLE,
  COPY_REQUEST_BUTTON,
  COPY_REQUEST_BUTTON_SHORT,
  DIVISIONS_CARD,
  END_LABEL,
  LEAVE_WARNING,
  DATE_INVALID,
  MINUTES_BETWEEN_LABEL,
  NAME_INVALID,
  NO_CITY_LINK,
  PLAN_NAME_LABEL,
  PLAN_REQUIRED_STOPPED,
  PRINT_BUTTON,
  PRACTICES_CARD,
  PRACTICES_HINT,
  RELOAD_CONFIRM_BODY,
  RELOAD_CONFIRM_BUTTON,
  RELOAD_CONFIRM_TITLE,
  SAVE_BLOCKED_INVALID,
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
import { PlanPrintRegion } from "./plan-print-region";

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
  /** profiles.org_name — heads the print. */
  leagueName: string | null;
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
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [printedOn, setPrintedOn] = useState<string | null>(null);
  // Fields whose typed text is not (yet) a value the plan can take.
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());
  const onValidity = useCallback((key: string, ok: boolean) => {
    setInvalid((cur) => {
      if (ok ? !cur.has(key) : cur.has(key)) return cur;
      const next = new Set(cur);
      if (ok) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const nameValid = name.trim().length > 0 && Array.from(name.trim()).length <= INPUT_LIMITS.planName.maxChars;
  const invalidCount = invalid.size + (nameValid ? 0 : 1);
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
    setState(stateAfterEdit);
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
    // An edit made while this save was in flight is still unsaved: the
    // plan goes back to dirty and the follow-up save starts on its own.
    setState(stateAfterReply(next.state, edits.current !== startedAt));
  }, [props.planId]);

  // Debounced autosave: only from dirty, only after a pause in editing.
  useEffect(() => {
    if (!autosaveAllowed(state, invalidCount)) return;
    const t = window.setTimeout(() => void save(updatedAt.current), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [state, invalidCount, name, input, mode, save]);

  // Warn on leaving only while an edit is unsaved.
  useEffect(() => {
    if (!warnOnLeave(state, invalidCount)) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = LEAVE_WARNING;
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [state, invalidCount]);

  const plan = useMemo(() => computePlan(input, { city: props.city }), [input, props.city]);
  const litNames = useMemo(() => litDivisionNames(input), [input]);
  const note = props.prefillNote
    ? prefillAdjustedLine(props.prefillNote.seasonName, props.prefillNote.adjustments, {
        divisions: INPUT_LIMITS.divisions.max, nameChars: INPUT_LIMITS.divisionName.maxChars, teams: INPUT_LIMITS.teams.max,
      })
    : null;

  const onDivision = (id: string, patch: Partial<PlanDivision>) => edit(() => setInput((i) => updateDivision(i, id, patch)));

  // Copy for city request: the module's request text for the mode on screen,
  // plus the lit-fields line. Clipboard first; if the browser refuses, the
  // same text in a modal, selected, to copy by hand.
  const copyRequest = async () => {
    const result = mode === "spread" ? plan.spread : plan.sameNights;
    const text = planRequestText(input, result, plan.inUse);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopyFallback(text);
    }
  };
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(t);
  }, [copied]);

  // Print: the "Printed" date is read when the button is pressed (event time),
  // rendered into the print region synchronously, then the browser prints.
  const print = () => {
    flushSync(() => setPrintedOn(new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date())));
    window.print();
  };
  const cityLabel = props.city ? `${props.city.name}, ${props.city.state}` : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/dashboard/field-requests" className="text-sm font-semibold text-[#16a34a]">← {BACK_TO_PLANS}</Link>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="min-w-0 break-words text-2xl font-bold text-gray-900">{name.trim() || props.initialName}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <SaveStatus state={state} blocked={invalidCount > 0} onRetry={() => void save(updatedAt.current)} />
            <div className="hidden gap-2 sm:flex">
              <button type="button" onClick={() => void copyRequest()} disabled={plan.inUse.length === 0}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-[#0C1F3F] hover:border-gray-300 disabled:opacity-50">
                <ClipboardCopy className="h-4 w-4" />{COPY_REQUEST_BUTTON}
              </button>
              <button type="button" onClick={print}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-[#0C1F3F] hover:border-gray-300">
                <Printer className="h-4 w-4" />{PRINT_BUTTON}
              </button>
            </div>
          </div>
        </div>
        {copied && (
          <p role="status" data-copied className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-3 py-1.5 text-sm font-semibold text-white">
            <Check className="h-4 w-4" />{COPIED_TOAST}
          </p>
        )}
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
            <input className={`${INPUT} ${nameValid ? "" : "border-red-400"}`} aria-invalid={!nameValid} value={name} disabled={readOnly}
              maxLength={INPUT_LIMITS.planName.maxChars} onChange={(e) => edit(() => setName(e.target.value))} />
            {!nameValid && <span className="mt-0.5 block text-xs font-semibold text-red-700">{NAME_INVALID}</span>}
          </label>
          <DateField label={START_LABEL} vkey="seasonStart" onValidity={onValidity} value={input.seasonStart} readOnly={readOnly} onCommit={(v) => edit(() => setInput((i) => ({ ...i, seasonStart: v })))} />
          <DateField label={END_LABEL} vkey="seasonEnd" onValidity={onValidity} value={input.seasonEnd} readOnly={readOnly} onCommit={(v) => edit(() => setInput((i) => ({ ...i, seasonEnd: v })))} />
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
          onValidity={onValidity}
        />
      </section>

      <PlanResults plan={plan} mode={mode} city={props.city} litNames={litNames} readOnly={readOnly}
        onMode={(m) => m !== mode && edit(() => setMode(m))} />

      {/* Phone: Copy and Print stay in reach at the bottom of the screen. */}
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white px-4 py-2.5 sm:hidden">
        <button type="button" onClick={() => void copyRequest()} disabled={plan.inUse.length === 0}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-[#0C1F3F] disabled:opacity-50">
          <ClipboardCopy className="h-4 w-4" />{COPY_REQUEST_BUTTON_SHORT}
        </button>
        <button type="button" onClick={print}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-[#0C1F3F]">
          <Printer className="h-4 w-4" />{PRINT_BUTTON}
        </button>
      </div>

      {copyFallback !== null && <CopyFallback text={copyFallback} onDone={() => setCopyFallback(null)} />}

      <PlanPrintRegion leagueName={props.leagueName} planName={name.trim() || props.initialName} input={input} plan={plan} mode={mode}
        cityLabel={cityLabel} litLine={litLine(input)} printedOn={printedOn} />

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

function SaveStatus({ state, blocked, onRetry }: { state: SaveState; blocked: boolean; onRetry: () => void }) {
  if (blocked && state.kind !== "stale" && state.kind !== "stopped")
    return <span data-save-status role="status" className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700"><AlertTriangle className="h-3.5 w-3.5" />{SAVE_BLOCKED_INVALID}</span>;
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

function DateField({ label, vkey, value, readOnly, onCommit, onValidity }: {
  label: string; vkey: string; value: string; readOnly: boolean; onCommit: (v: string) => void; onValidity: (key: string, valid: boolean) => void;
}) {
  // A date typed by hand reads as "" until every part is filled in — the
  // same as a cleared box. badInput tells them apart: a half-typed date is
  // kept on screen, reported invalid, and never saved as "no date".
  const [draft, setDraft] = useState(value);
  const [partial, setPartial] = useState(false);
  useEffect(() => setDraft((cur) => (committedDate(cur) === value ? cur : value)), [value]);
  const valid = !partial && committedDate(draft) !== null;
  useEffect(() => onValidity(vkey, valid), [vkey, valid, onValidity]);
  const check = (el: HTMLInputElement) => setPartial(el.validity.badInput);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-600">{label}</span>
      <input type="date" aria-invalid={!valid} className={`${INPUT} ${valid ? "" : "border-red-400"}`} value={draft} disabled={readOnly}
        min={`${INPUT_LIMITS.yearMin}-01-01`} max={`${INPUT_LIMITS.yearMax}-12-31`}
        onKeyUp={(e) => check(e.currentTarget)} onBlur={(e) => check(e.currentTarget)}
        onChange={(e) => {
          const el = e.target;
          check(el);
          setDraft(el.value);
          if (el.validity.badInput) return;
          const v = committedDate(el.value);
          if (v !== null) onCommit(v);
        }} />
      {!valid && <span className="mt-0.5 block text-xs font-semibold text-red-700">{DATE_INVALID}</span>}
    </label>
  );
}

function CopyFallback({ text, onDone }: { text: string; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDone]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && onDone()}>
      <div role="dialog" aria-modal="true" aria-label={COPY_FALLBACK_TITLE} data-copy-fallback
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-[#0C1F3F]">{COPY_FALLBACK_TITLE}</h2>
          <button type="button" aria-label={COPY_DONE} onClick={onDone} className="grid h-9 w-9 place-items-center rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1.5 text-sm text-gray-600">{COPY_FALLBACK}</p>
        <textarea ref={ref} readOnly value={text} rows={14}
          className="mt-3 w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-[#0C1F3F]" />
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onDone} className="min-h-10 rounded-lg bg-[#22C55E] px-4 text-sm font-semibold text-white hover:bg-[#16a34a]">{COPY_DONE}</button>
        </div>
      </div>
    </div>
  );
}

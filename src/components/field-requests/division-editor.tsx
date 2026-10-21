"use client";

// The planner's Divisions card: a table at md and up, one collapsible card
// per division below it (mockup screen 3). Every value a person types is
// committed only when it is inside the plan's limits (editor.ts), so an
// autosave can never send what 0117 would refuse.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { DAY_SHORT, FIELD_TYPES, fieldTypeLabel } from "@/lib/practice-planner/constants";
import { fmtTime, formatDayList, toMinutes } from "@/lib/practice-planner/format";
import type { FieldTypeId } from "@/lib/practice-planner/types";
import type { PlanDivision } from "@/lib/practice-plans/load";
import { INPUT_LIMITS } from "@/lib/practice-plans/plan-input";
import { teamHint, type Prefill } from "@/lib/practice-plans/prefill";
import { committedLength, committedTeams, committedTime, toggleDay } from "@/lib/practice-plans/editor";
import {
  ADD_DIVISION,
  COL,
  DIVISION_LIMIT,
  LIT_OFF,
  LENGTH_INVALID,
  LIT_ON,
  REMOVE_DIVISION,
  TEAMS_INVALID,
  TIME_INVALID,
  divisionSummary,
  litDivisionNote,
  noTeamsLine,
  teamHintLine,
} from "@/lib/practice-plans/words";

const CONTROL =
  "h-9 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 text-sm text-[#0C1F3F] focus:border-[#16a34a] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/30 disabled:bg-gray-50";

type Props = {
  divisions: PlanDivision[];
  prefill: Prefill;
  canAdd: boolean;
  readOnly: boolean;
  onChange: (id: string, patch: Partial<PlanDivision>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  /** A field reports whether its typed text is a value the plan can take. */
  onValidity: (key: string, valid: boolean) => void;
};

export function DivisionEditor({ divisions, prefill, canAdd, readOnly, onChange, onAdd, onRemove, onValidity }: Props) {
  // The table (md+) and the cards (below md) are both mounted, so each
  // reports validity under its own scope (t: / c:) — one never hides the other.
  // Stable callbacks: a new function every render would re-run each field's
  // report-on-unmount cleanup and flip its validity on every render.
  const vt = useCallback((key: string, ok: boolean) => onValidity(`t:${key}`, ok), [onValidity]);
  const vc = useCallback((key: string, ok: boolean) => onValidity(`c:${key}`, ok), [onValidity]);
  const v = (scope: "t" | "c") => (scope === "t" ? vt : vc);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <th className="pb-2 pr-2">{COL.division}</th>
              <th className="pb-2 pr-2">{COL.teams}</th>
              <th className="pb-2 pr-2">{COL.perWeek}</th>
              <th className="pb-2 pr-2">{COL.length}</th>
              <th className="pb-2 pr-2">{COL.days}</th>
              <th className="pb-2 pr-2">{COL.window}</th>
              <th className="pb-2 pr-2">{COL.field}</th>
              <th className="pb-2 pr-2">{COL.perField}</th>
              <th className="pb-2 pr-2">{COL.lit}</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {divisions.map((d) => (
              <tr key={d.id} data-division-row className="align-top">
                <td className="border-t border-gray-100 py-2 pr-2"><NameField d={d} readOnly={readOnly} onChange={onChange} /></td>
                <td className="border-t border-gray-100 py-2 pr-2"><TeamsField d={d} prefill={prefill} readOnly={readOnly} onChange={onChange} onValidity={v("t")} /></td>
                <td className="border-t border-gray-100 py-2 pr-2"><PerWeekField d={d} readOnly={readOnly} onChange={onChange} /></td>
                <td className="border-t border-gray-100 py-2 pr-2"><LengthField d={d} readOnly={readOnly} onChange={onChange} onValidity={v("t")} /></td>
                <td className="border-t border-gray-100 py-2 pr-2"><DaysField d={d} readOnly={readOnly} onChange={onChange} /></td>
                <td className="border-t border-gray-100 py-2 pr-2">
                  <div className="flex items-center gap-1">
                    <TimeField label={`${d.name} ${COL.from}`} vkey={`${d.id}:start`} onValidity={v("t")} value={d.start} readOnly={readOnly} onCommit={(start) => onChange(d.id!, { start })} />
                    <span className="text-gray-400">–</span>
                    <TimeField label={`${d.name} ${COL.until}`} vkey={`${d.id}:end`} onValidity={v("t")} value={d.end} readOnly={readOnly} onCommit={(end) => onChange(d.id!, { end })} />
                  </div>
                </td>
                <td className="border-t border-gray-100 py-2 pr-2"><FieldTypeField d={d} readOnly={readOnly} onChange={onChange} /></td>
                <td className="border-t border-gray-100 py-2 pr-2"><PerFieldField d={d} readOnly={readOnly} onChange={onChange} /></td>
                <td className="border-t border-gray-100 py-2 pr-2"><LitSwitch d={d} readOnly={readOnly} onChange={onChange} /></td>
                <td className="border-t border-gray-100 py-2">
                  <button type="button" disabled={readOnly} aria-label={`${REMOVE_DIVISION} ${d.name}`} onClick={() => onRemove(d.id!)}
                    className="grid h-9 w-9 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40">
                    <X className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2.5 md:hidden">
        {divisions.map((d) => {
          const isOpen = open === d.id;
          return (
            <div key={d.id} data-division-card className="rounded-xl border border-gray-200 bg-white p-3">
              <button type="button" aria-expanded={isOpen} className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(isOpen ? null : d.id!)}>
                <span className="min-w-0">
                  <span className="block font-semibold text-[#0C1F3F]">{d.name || "Division"}</span>
                  {!isOpen && (
                    <span className="block text-xs text-gray-500">
                      {divisionSummary({
                        teams: d.teams, perWeek: d.perWeek, lengthMin: d.lengthMin, days: formatDayList(d.days),
                        window: `${fmtTime(toMinutes(d.start))}–${fmtTime(toMinutes(d.end))}`, field: fieldTypeLabel(d.fieldType), teamsPerField: d.teamsPerField,
                      })}
                    </span>
                  )}
                </span>
                {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 flex-none text-gray-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 flex-none text-gray-400" />}
              </button>
              {isOpen && (
                <div className="mt-3 grid gap-3">
                  <Labeled label={COL.division}><NameField d={d} readOnly={readOnly} onChange={onChange} /></Labeled>
                  <div className="grid grid-cols-2 gap-3">
                    <Labeled label={COL.teams}><TeamsField d={d} prefill={prefill} readOnly={readOnly} onChange={onChange} onValidity={v("c")} /></Labeled>
                    <Labeled label={COL.perWeek}><PerWeekField d={d} readOnly={readOnly} onChange={onChange} /></Labeled>
                    <Labeled label={COL.length}><LengthField d={d} readOnly={readOnly} onChange={onChange} onValidity={v("c")} /></Labeled>
                    <Labeled label={COL.teamsPerField}><PerFieldField d={d} readOnly={readOnly} onChange={onChange} /></Labeled>
                  </div>
                  <Labeled label={COL.days}><DaysField d={d} readOnly={readOnly} onChange={onChange} wide /></Labeled>
                  <div className="grid grid-cols-2 gap-3">
                    <Labeled label={COL.from}><TimeField label={`${d.name} ${COL.from}`} vkey={`${d.id}:start`} onValidity={v("c")} value={d.start} readOnly={readOnly} onCommit={(start) => onChange(d.id!, { start })} /></Labeled>
                    <Labeled label={COL.until}><TimeField label={`${d.name} ${COL.until}`} vkey={`${d.id}:end`} onValidity={v("c")} value={d.end} readOnly={readOnly} onCommit={(end) => onChange(d.id!, { end })} /></Labeled>
                  </div>
                  <Labeled label={COL.field}><FieldTypeField d={d} readOnly={readOnly} onChange={onChange} /></Labeled>
                  <div className="flex items-center justify-between">
                    <LitSwitch d={d} readOnly={readOnly} onChange={onChange} withLabel />
                    <button type="button" disabled={readOnly} onClick={() => onRemove(d.id!)} className="min-h-9 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40">
                      {REMOVE_DIVISION}
                    </button>
                  </div>
                  {d.lit && <p className="text-xs text-gray-500">{litDivisionNote(d.name)}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!canAdd || readOnly} onClick={onAdd}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-[#0C1F3F] hover:border-gray-300 disabled:opacity-50">
          <Plus className="h-4 w-4" />
          {ADD_DIVISION}
        </button>
        {!canAdd && <span className="text-xs text-gray-500">{DIVISION_LIMIT(INPUT_LIMITS.divisions.max)}</span>}
      </div>
    </>
  );
}

type FieldProps = { d: PlanDivision; readOnly: boolean; onChange: (id: string, patch: Partial<PlanDivision>) => void };

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function NameField({ d, readOnly, onChange }: FieldProps) {
  return (
    <input aria-label={COL.division} className={`${CONTROL} min-w-[7rem]`} value={d.name} disabled={readOnly}
      maxLength={INPUT_LIMITS.divisionName.maxChars} onChange={(e) => onChange(d.id!, { name: e.target.value })} />
  );
}

type Validity = { onValidity: (key: string, valid: boolean) => void };

/**
 * Reports a field's validity up while mounted, and "valid" when it goes away
 * (a removed division, a collapsed card) so a gone field never blocks saving.
 */
function useReportValidity(key: string, valid: boolean, onValidity: (key: string, valid: boolean) => void) {
  useEffect(() => {
    onValidity(key, valid);
  }, [key, valid, onValidity]);
  useEffect(() => () => onValidity(key, true), [key, onValidity]);
}

function TeamsField({ d, prefill, readOnly, onChange, onValidity }: FieldProps & Validity & { prefill: Prefill }) {
  // The box keeps exactly what is typed; only a whole number inside the limit
  // reaches the plan. While it holds anything else it says so, and the page
  // holds autosave.
  const [draft, setDraft] = useState(String(d.teams));
  useEffect(() => {
    setDraft((cur) => (committedTeams(cur) === d.teams ? cur : String(d.teams)));
  }, [d.teams]);
  const valid = committedTeams(draft) !== null;
  useReportValidity(`${d.id}:teams`, valid, onValidity);
  const hint = teamHint(prefill, d.name);
  return (
    <div className="min-w-[4rem]">
      <input aria-label={`${d.name} ${COL.teams}`} inputMode="numeric" aria-invalid={!valid}
        className={`${CONTROL} ${valid ? "" : "border-red-400"}`} value={draft} disabled={readOnly}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = committedTeams(e.target.value);
          if (n !== null) onChange(d.id!, { teams: n });
        }} />
      {!valid ? (
        <span className="mt-0.5 block whitespace-nowrap text-[11px] font-semibold text-red-700">{TEAMS_INVALID(INPUT_LIMITS.teams.min, INPUT_LIMITS.teams.max)}</span>
      ) : hint ? (
        <span className="mt-0.5 block whitespace-nowrap text-[11px] text-gray-500">{teamHintLine(hint.count, hint.seasonName)}</span>
      ) : d.teams === 0 ? (
        <span className="mt-0.5 block max-w-[10rem] text-[11px] font-semibold text-amber-700">{noTeamsLine(d.name, prefill.season?.name ?? null)}</span>
      ) : null}
    </div>
  );
}

function PerWeekField({ d, readOnly, onChange }: FieldProps) {
  return (
    <select aria-label={`${d.name} ${COL.perWeek}`} className={`${CONTROL} min-w-[3.5rem]`} value={d.perWeek} disabled={readOnly}
      onChange={(e) => onChange(d.id!, { perWeek: Number(e.target.value) })}>
      {Array.from({ length: INPUT_LIMITS.perWeek.max - INPUT_LIMITS.perWeek.min + 1 }, (_, i) => i + INPUT_LIMITS.perWeek.min).map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  );
}

function LengthField({ d, readOnly, onChange, onValidity }: FieldProps & Validity) {
  // Typed minutes, kept as typed; committed only inside the limit.
  const [draft, setDraft] = useState(String(d.lengthMin));
  useEffect(() => {
    setDraft((cur) => (committedLength(cur) === d.lengthMin ? cur : String(d.lengthMin)));
  }, [d.lengthMin]);
  const valid = committedLength(draft) !== null;
  useReportValidity(`${d.id}:length`, valid, onValidity);
  return (
    <div className="min-w-[4.5rem]">
      <div className="relative">
        <input aria-label={`${d.name} ${COL.length}`} inputMode="numeric" aria-invalid={!valid}
          className={`${CONTROL} pr-9 ${valid ? "" : "border-red-400"}`} value={draft} disabled={readOnly}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = committedLength(e.target.value);
            if (n !== null) onChange(d.id!, { lengthMin: n });
          }} />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">min</span>
      </div>
      {!valid && (
        <span className="mt-0.5 block whitespace-nowrap text-[11px] font-semibold text-red-700">{LENGTH_INVALID(INPUT_LIMITS.lengthMin.min, INPUT_LIMITS.lengthMin.max)}</span>
      )}
    </div>
  );
}

function DaysField({ d, readOnly, onChange, wide }: FieldProps & { wide?: boolean }) {
  return (
    <div role="group" aria-label={`${d.name} ${COL.days}`} className="flex gap-0.5">
      {DAY_SHORT.map((label, k) => {
        const on = d.days.includes(k);
        return (
          <button key={label} type="button" aria-pressed={on} aria-label={label} disabled={readOnly}
            onClick={() => onChange(d.id!, { days: toggleDay(d.days, k) })}
            className={`grid place-items-center rounded-md border text-[11px] font-bold ${wide ? "h-10 flex-1" : "h-8 w-6"} ${on ? "border-[#16a34a] bg-[#22C55E]/10 text-[#16a34a]" : "border-gray-200 text-gray-500"}`}>
            {label[0]}
          </button>
        );
      })}
    </div>
  );
}

function TimeField({ label, vkey, value, readOnly, onCommit, onValidity }: Validity & { label: string; vkey: string; value: string; readOnly: boolean; onCommit: (v: string) => void }) {
  // A half-typed time reads as "" (iOS can even show one it hasn't
  // committed): kept on screen, reported invalid, never sent.
  const [draft, setDraft] = useState(value);
  const [partial, setPartial] = useState(false);
  useEffect(() => setDraft((cur) => (committedTime(cur) === value ? cur : value)), [value]);
  const valid = !partial && committedTime(draft) !== null;
  useReportValidity(vkey, valid, onValidity);
  const check = (el: HTMLInputElement) => setPartial(el.validity.badInput);
  return (
    <div>
      <input type="time" step={900} aria-label={label} aria-invalid={!valid}
        className={`${CONTROL} min-w-[6.5rem] ${valid ? "" : "border-red-400"}`} value={draft} disabled={readOnly}
        onKeyUp={(e) => check(e.currentTarget)} onBlur={(e) => check(e.currentTarget)}
        onChange={(e) => {
          check(e.target);
          setDraft(e.target.value);
          const t = committedTime(e.target.value);
          if (t) onCommit(t);
        }} />
      {!valid && <span className="mt-0.5 block text-[11px] font-semibold text-red-700">{TIME_INVALID}</span>}
    </div>
  );
}

function FieldTypeField({ d, readOnly, onChange }: FieldProps) {
  return (
    <select aria-label={`${d.name} ${COL.field}`} className={`${CONTROL} min-w-[8.5rem]`} value={d.fieldType} disabled={readOnly}
      onChange={(e) => onChange(d.id!, { fieldType: e.target.value as FieldTypeId })}>
      {FIELD_TYPES.map((f) => (
        <option key={f.id} value={f.id}>{f.label}</option>
      ))}
    </select>
  );
}

function PerFieldField({ d, readOnly, onChange }: FieldProps) {
  return (
    <select aria-label={`${d.name} ${COL.teamsPerField}`} className={`${CONTROL} min-w-[3.5rem]`} value={d.teamsPerField} disabled={readOnly}
      onChange={(e) => onChange(d.id!, { teamsPerField: Number(e.target.value) })}>
      {Array.from({ length: INPUT_LIMITS.teamsPerField.max - INPUT_LIMITS.teamsPerField.min + 1 }, (_, i) => i + INPUT_LIMITS.teamsPerField.min).map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  );
}

function LitSwitch({ d, readOnly, onChange, withLabel }: FieldProps & { withLabel?: boolean }) {
  const on = d.lit === true;
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`${d.name} ${COL.lit}`} disabled={readOnly}
      onClick={() => onChange(d.id!, { lit: !on })} className="inline-flex min-h-9 items-center gap-2 text-sm text-gray-700 disabled:opacity-50">
      <span className={`relative h-[18px] w-8 flex-none rounded-full transition-colors ${on ? "bg-[#16a34a]" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${on ? "left-4" : "left-0.5"}`} />
      </span>
      {withLabel ? COL.lit : on ? LIT_ON : LIT_OFF}
    </button>
  );
}

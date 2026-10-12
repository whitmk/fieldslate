"use client";

// One division's inputs. Two lines at every width: the numbers, then the days
// and the window. On a phone the numbers stack two to a row.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ALL_DAYS, DAY_LONG, DAY_SHORT, FIELD_TYPES } from "@/lib/practice-planner/constants";
import type { DivisionInput, FieldTypeId } from "@/lib/practice-planner/types";

export type DivisionDraft = DivisionInput & { id: string };

export const DIVISION_COLORS = [
  "#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777",
  "#059669", "#dc2626", "#0891b2", "#65a30d", "#ea580c",
];
export const divisionColor = (i: number) => DIVISION_COLORS[i % DIVISION_COLORS.length];

const LENGTHS = [45, 60, 75, 90, 105, 120, 150];

const LABEL = "text-xs font-semibold text-gray-500";
const CONTROL =
  "h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-[#0C1F3F] focus:border-[#16a34a] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/30";

/** A number box that lets the field be cleared while typing; commits whole numbers in range. */
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (s: string) => {
    const n = Math.round(Number(s));
    onChange(Number.isFinite(n) && s.trim() !== "" ? Math.min(max, Math.max(min, n)) : min);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value.trim() !== "") commit(e.target.value);
        }}
        onBlur={() => {
          commit(draft);
          setDraft(String(value));
        }}
        className={CONTROL}
      />
    </div>
  );
}

export function DivisionRow({
  d,
  index,
  onChange,
  onRemove,
  timesMissing,
}: {
  d: DivisionDraft;
  index: number;
  onChange: (patch: Partial<DivisionDraft>) => void;
  onRemove: () => void;
  timesMissing: boolean;
}) {
  const p = `div-${d.id}`;
  const toggleDay = (k: number) =>
    onChange({ days: d.days.includes(k) ? d.days.filter((x) => x !== k) : [...d.days, k].sort((a, b) => a - b) });

  return (
    <div className="relative rounded-xl border border-gray-200 bg-white p-4">
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${d.name || "division"}`}
        className="absolute right-2 top-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E]"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:pr-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.8fr)]">
        <div className="col-span-2 flex min-w-0 items-end gap-2 pr-10 sm:col-span-3 lg:col-span-1 lg:pr-0">
          <span className="mb-1 h-8 w-2.5 shrink-0 rounded" style={{ backgroundColor: divisionColor(index) }} aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${p}-name`} className={LABEL}>
              Division
            </label>
            <input
              id={`${p}-name`}
              value={d.name}
              maxLength={40}
              onChange={(e) => onChange({ name: e.target.value })}
              className={CONTROL}
            />
          </div>
        </div>
        <NumberField id={`${p}-teams`} label="Teams" value={d.teams} min={0} max={60} onChange={(teams) => onChange({ teams })} />
        <NumberField id={`${p}-ppw`} label="Per week" value={d.perWeek} min={0} max={7} onChange={(perWeek) => onChange({ perWeek })} />
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${p}-len`} className={LABEL}>
            Length
          </label>
          <select id={`${p}-len`} value={d.lengthMin} onChange={(e) => onChange({ lengthMin: Number(e.target.value) })} className={CONTROL}>
            {LENGTHS.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${p}-field`} className={LABEL}>
            Field
          </label>
          <select
            id={`${p}-field`}
            value={d.fieldType}
            onChange={(e) => onChange({ fieldType: e.target.value as FieldTypeId })}
            className={CONTROL}
          >
            {FIELD_TYPES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${p}-per`} className={LABEL}>
            Teams per field
          </label>
          <select id={`${p}-per`} value={d.teamsPerField} onChange={(e) => onChange({ teamsPerField: Number(e.target.value) })} className={CONTROL}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <fieldset className="min-w-0">
          <legend className={LABEL}>Days</legend>
          <div className="mt-1 flex flex-wrap gap-1">
            {ALL_DAYS.map((k) => {
              const on = d.days.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  aria-label={DAY_LONG[k]}
                  onClick={() => toggleDay(k)}
                  className={`h-10 w-10 rounded-lg border text-xs sm:w-11 font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] ${
                    on ? "border-[#0C1F3F] bg-[#0C1F3F] text-white" : "border-gray-300 bg-white text-gray-500 hover:border-gray-400"
                  }`}
                >
                  {DAY_SHORT[k]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className={LABEL}>Between</legend>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="time"
              step={900}
              value={d.start}
              onChange={(e) => onChange({ start: e.target.value })}
              aria-label={`${d.name || "Division"} earliest start`}
              className={`${CONTROL} w-32`}
            />
            <span className="text-gray-400" aria-hidden="true">
              –
            </span>
            <input
              type="time"
              step={900}
              value={d.end}
              onChange={(e) => onChange({ end: e.target.value })}
              aria-label={`${d.name || "Division"} latest end`}
              className={`${CONTROL} w-32`}
            />
          </div>
        </fieldset>
      </div>
      {timesMissing && (
        <p className="mt-2 text-xs font-medium text-amber-700">
          Set both times (check AM/PM) to count this division.
        </p>
      )}
    </div>
  );
}

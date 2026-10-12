"use client";

// "See the night": one way the practices fit, field by field, for one field
// type and one night. The timeline scrolls sideways inside its own box so the
// page itself never does on a phone.

import { useState } from "react";
import { DAY_SHORT, fieldTypeLabel } from "@/lib/practice-planner/constants";
import { fmtTime } from "@/lib/practice-planner/format";
import type { DayIndex, FieldTypeId, ModeResult } from "@/lib/practice-planner/types";
import { divisionColor } from "./division-row";

const TAB =
  "inline-flex h-9 items-center rounded-lg border px-3 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E]";

export function NightBoard({
  result,
  inUse,
  names,
  colorIndex,
  sunset,
  sunsetLabel,
}: {
  result: ModeResult;
  inUse: FieldTypeId[];
  /** Indexed like the results' division indexes. */
  names: string[];
  /** Each result division's position in the on-screen list (its swatch color). */
  colorIndex: number[];
  /** Sunset on the first day of practice (local minutes), or null. */
  sunset: number | null;
  sunsetLabel: string;
}) {
  const [pickedType, setPickedType] = useState<FieldTypeId | null>(null);
  const [pickedDay, setPickedDay] = useState<DayIndex | null>(null);

  if (!inUse.length) {
    return <p className="text-sm text-gray-500">No practices yet.</p>;
  }
  const type = pickedType && inUse.includes(pickedType) ? pickedType : inUse[0];
  const nights = result.byType[type];
  const days = nights.map((n, k) => (n.count > 0 ? (k as DayIndex) : null)).filter((k): k is DayIndex => k !== null);
  const day = pickedDay !== null && days.includes(pickedDay) ? pickedDay : (result.need[type].peakDay ?? days[0] ?? null);
  const night = day !== null ? nights[day] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Field type">
          {inUse.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={z === type}
              onClick={() => {
                setPickedType(z);
                setPickedDay(null);
              }}
              className={`${TAB} ${z === type ? "border-[#0C1F3F] text-[#0C1F3F]" : "border-gray-200 bg-white text-gray-500"}`}
            >
              {fieldTypeLabel(z)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Night">
          {days.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === day}
              onClick={() => setPickedDay(k)}
              className={`${TAB} ${k === day ? "border-[#0C1F3F] text-[#0C1F3F]" : "border-gray-200 bg-white text-gray-500"}`}
            >
              {DAY_SHORT[k]}
              <span className="ml-1 font-extrabold text-[#16a34a]">{nights[k].count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-3">
        {!night || night.first === null || night.last === null ? (
          <p className="text-sm text-gray-500">No practices on this field type yet.</p>
        ) : (
          <Timeline night={night} names={names} colorIndex={colorIndex} sunset={sunset} first={night.first} last={night.last} />
        )}
      </div>

      {night && night.count > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {Array.from(new Set(night.fields.flat().map((b) => b.division))).map((i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: divisionColor(colorIndex[i]) }} />
              {names[i]}
            </span>
          ))}
          {sunset !== null && night.first !== null && night.last !== null && sunsetInView(sunset, night.first, night.last) && (
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
              {sunsetLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function span(first: number, last: number) {
  const t0 = Math.floor(first / 60) * 60;
  const t1 = Math.max(Math.ceil(last / 60) * 60, t0 + 60);
  return { t0, t1 };
}

function sunsetInView(ss: number, first: number, last: number) {
  const { t0, t1 } = span(first, last);
  return ss > t0 && ss < t1;
}

function Timeline({
  night,
  names,
  colorIndex,
  sunset,
  first,
  last,
}: {
  night: ModeResult["byType"][FieldTypeId][number];
  names: string[];
  colorIndex: number[];
  sunset: number | null;
  first: number;
  last: number;
}) {
  const { t0, t1 } = span(first, last);
  const total = t1 - t0;
  const pct = (m: number) => ((m - t0) / total) * 100;
  const ticks: number[] = [];
  for (let m = t0; m <= t1; m += 60) ticks.push(m);
  const showSunset = sunset !== null && sunsetInView(sunset, first, last);

  return (
    <div className="min-w-[620px]">
      <div className="relative ml-[72px] h-5 text-[11px] text-gray-500">
        {ticks.map((m) => (
          <span key={m} className="absolute -translate-x-1/2" style={{ left: `${pct(m)}%` }}>
            {fmtTime(m)}
          </span>
        ))}
      </div>
      {night.fields.map((f, fi) => (
        <div key={fi} className="flex h-11 items-center border-t border-gray-100">
          <div className="w-[72px] shrink-0 text-xs font-bold text-gray-500">Field {fi + 1}</div>
          <div className="relative h-8 flex-1 rounded-md bg-gray-50">
            {ticks.slice(1, -1).map((m) => (
              <span key={m} className="absolute inset-y-0 border-l border-gray-200" style={{ left: `${pct(m)}%` }} />
            ))}
            {showSunset && (
              <span
                className="absolute -inset-y-1 border-l-2 border-dashed border-amber-500"
                style={{ left: `${pct(sunset!)}%` }}
                title={`Sunset ${fmtTime(sunset!)}`}
              />
            )}
            {f.map((b, bi) => (
              <div
                key={bi}
                className="absolute inset-y-0.5 overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold leading-tight text-white"
                style={{
                  left: `${pct(b.start)}%`,
                  width: `calc(${(b.lengthMin / total) * 100}% - 2px)`,
                  backgroundColor: divisionColor(colorIndex[b.division]),
                }}
                title={`${names[b.division]} ${fmtTime(b.start)}–${fmtTime(b.start + b.lengthMin)}`}
              >
                {names[b.division]}
                <span className="block font-semibold opacity-90">
                  {fmtTime(b.start)}
                  {b.teams > 1 ? `, ${b.teams} teams` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

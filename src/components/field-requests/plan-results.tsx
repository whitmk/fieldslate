"use client";

// The planner's "Fields to request" card: the module's answer for the mode
// on screen, its warnings verbatim, the earliest sunset line (city only),
// the no-city note, and the season totals.

import Link from "next/link";
import { AlertTriangle, Sun } from "lucide-react";
import { DAY_LONG, DAY_SHORT, fieldTypeLabel } from "@/lib/practice-planner/constants";
import { fmtInt, fmtTime } from "@/lib/practice-planner/format";
import { busiestLabel, type Plan } from "@/lib/practice-planner/report";
import type { SpreadMode } from "@/lib/practice-planner/types";
import type { UsCity } from "@/lib/sun/us-cities";
import {
  MODE_NAMES,
  MODE_SHORT,
  NIGHT_COL,
  NO_CITY_BODY,
  NO_CITY_LINK,
  NO_CITY_TITLE,
  NO_RESULTS,
  RESULTS_CARD,
  RESULTS_HINT,
  TOTALS,
  answerAlt,
  earliestSunsetLine,
} from "@/lib/practice-plans/words";

export const SETTINGS_DAYLIGHT_HREF = "/dashboard/settings#daylight-state";

export function PlanResults({ plan, mode, city, litNames, readOnly, onMode }: {
  plan: Plan; mode: SpreadMode; city: UsCity | null; litNames: string[]; readOnly: boolean; onMode: (m: SpreadMode) => void;
}) {
  const result = mode === "spread" ? plan.spread : plan.sameNights;
  const other = mode === "spread" ? plan.sameNights : plan.spread;
  const used = DAY_LONG.map((_, k) => plan.inUse.some((z) => result.byType[z][k].count > 0));
  const warnings = plan.warnings[mode];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#0C1F3F]">{RESULTS_CARD}</h2>
          <p className="text-xs text-gray-500">{RESULTS_HINT}</p>
        </div>
        <div role="group" aria-label="Practice spread" className="flex w-full gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 sm:w-auto">
          {(["spread", "sameNights"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} disabled={readOnly && mode !== m} onClick={() => onMode(m)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold sm:flex-none sm:text-sm ${mode === m ? "bg-white text-[#0C1F3F] shadow-sm" : "text-gray-500"}`}>
              <span className="sm:hidden">{MODE_SHORT[m]}</span>
              <span className="hidden sm:inline">{MODE_NAMES[m]}</span>
            </button>
          ))}
        </div>
      </div>

      {plan.seasonError && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{plan.seasonError}</p>}

      {plan.inUse.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">{NO_RESULTS}</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {plan.inUse.map((z) => (
              <div key={z} data-answer className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-3xl font-extrabold leading-none text-[#0C1F3F]">{result.need[z].fields}</div>
                <div className="mt-1 font-semibold text-[#0C1F3F]">{fieldTypeLabel(z)}s</div>
                <div className="mt-1 text-xs text-gray-500">{answerAlt(busiestLabel(result.need[z]), other.need[z].fields, mode)}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-2">{NIGHT_COL}</th>
                  {DAY_SHORT.map((d, k) => used[k] && <th key={d} className="py-2 pr-2">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {plan.inUse.map((z) => (
                  <tr key={z} className="border-b border-gray-100">
                    <td className="whitespace-nowrap py-2 pr-2 font-semibold text-[#0C1F3F]">{fieldTypeLabel(z)}</td>
                    {DAY_SHORT.map((d, k) => {
                      if (!used[k]) return null;
                      const r = result.byType[z][k];
                      return (
                        <td key={d} className="py-2 pr-2">
                          {r.count && r.first !== null && r.last !== null ? (
                            <><b className="block">{r.count}</b><span className="whitespace-nowrap text-[11px] text-gray-500">{fmtTime(r.first)}–{fmtTime(r.last)}</span></>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 sm:hidden">
            {plan.inUse.map((z) => (
              <div key={z}>
                <div className="mt-3 text-sm font-bold text-[#0C1F3F]">{fieldTypeLabel(z)}s</div>
                {result.byType[z].map((r, k) =>
                  r.count && r.first !== null && r.last !== null ? (
                    <div key={k} className="flex justify-between border-b border-gray-100 py-1.5 text-sm">
                      <span>{DAY_LONG[k]}</span>
                      <span className="text-gray-500">{r.count} field{r.count > 1 ? "s" : ""} · {fmtTime(r.first)}–{fmtTime(r.last)}</span>
                    </div>
                  ) : null,
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-4">
        {city && plan.earliestSunset ? (
          <p data-sunset-line className="mb-2 text-xs text-gray-500">{earliestSunsetLine(city, plan.earliestSunset, litNames)}</p>
        ) : !city ? (
          <div data-no-city className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800">
            <Sun className="mt-0.5 h-4 w-4 flex-none text-gray-500" />
            <div>
              <b>{NO_CITY_TITLE}</b> {NO_CITY_BODY}{" "}
              <Link href={SETTINGS_DAYLIGHT_HREF} className="font-semibold text-[#16a34a] underline">{NO_CITY_LINK}</Link>
            </div>
          </div>
        ) : null}
        {warnings.map((w) => (
          <div key={w} data-warning className="mt-2 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{w}</span>
          </div>
        ))}
      </div>

      {plan.totals && (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-xs text-gray-500 sm:flex sm:flex-wrap sm:gap-6">
          <div><b className="block text-xl text-[#0C1F3F]">{fmtInt(plan.totals.teamPracticesPerWeek)}</b>{TOTALS.practices}</div>
          <div><b className="block text-xl text-[#0C1F3F]">{fmtInt(plan.totals.fieldHoursPerWeek)}</b>{TOTALS.hoursWeek}</div>
          <div><b className="block text-xl text-[#0C1F3F]">{fmtInt(plan.totals.weeks)}</b>{TOTALS.weeks}</div>
          <div><b className="block text-xl text-[#0C1F3F]">{fmtInt(plan.totals.fieldHoursSeason)}</b>{TOTALS.hoursSeason}</div>
        </div>
      )}
    </section>
  );
}

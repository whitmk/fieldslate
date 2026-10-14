"use client";

// The practice field calculator. All math is src/lib/practice-planner/ (pure,
// shared with the future in-app version); this file holds the form state and
// renders the module's answers and sentences VERBATIM.
//
// Nothing here is saved or sent anywhere — no fetch, no storage. The first
// render is fully deterministic (fixed example league, fixed ids, no clock,
// no toLocale*), so server and browser markup match.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DAY_LONG, fieldTypeLabel } from "@/lib/practice-planner/constants";
import { fmtDate, fmtInt, fmtTime, parseIsoDate } from "@/lib/practice-planner/format";
import { EXAMPLE_LEAGUE, NEW_DIVISION } from "@/lib/practice-planner/example-league";
import { busiestLabel, computePlan, requestText } from "@/lib/practice-planner/report";
import { STATES_SORTED, STATE_NAMES, cityById, citiesInState } from "@/lib/sun/us-cities";
import type { DivisionInput, ModeResult, PlannerInput, SpreadMode } from "@/lib/practice-planner/types";
import { DivisionRow, NumberField, type DivisionDraft } from "./division-row";
import { NightBoard } from "./night-board";
import { PrintRegion } from "./print-region";

const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const timesSet = (d: DivisionInput) => TIME.test(d.start) && TIME.test(d.end);

const LABEL = "text-xs font-semibold text-gray-500";
const CONTROL =
  "h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-[#0C1F3F] focus:border-[#16a34a] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/30";

const MODE_HINT: Record<SpreadMode, string> = {
  spread: "Assumes the league assigns practice nights so no night is overloaded.",
  sameNights:
    "Assumes teams pick Tuesday and Thursday first, then Monday, Wednesday, Friday. This is closer to what happens when coaches choose.",
};

export function PracticeFieldCalculator() {
  const [seasonStart, setSeasonStart] = useState(EXAMPLE_LEAGUE.seasonStart);
  const [seasonEnd, setSeasonEnd] = useState(EXAMPLE_LEAGUE.seasonEnd);
  const [cityId, setCityId] = useState(EXAMPLE_LEAGUE.cityId);
  const [minutesBetween, setMinutesBetween] = useState(EXAMPLE_LEAGUE.minutesBetween);
  const [divisions, setDivisions] = useState<DivisionDraft[]>(() =>
    EXAMPLE_LEAGUE.divisions.map((d, i) => ({ ...d, days: [...d.days], id: `ex${i}` })),
  );
  const [mode, setMode] = useState<SpreadMode>("spread");
  const [toast, setToast] = useState<string | null>(null);
  const nextId = useRef(0);

  const city = cityById(cityId);

  // A division whose time box is cleared (or holds an uncommitted AM/PM on
  // iOS) is left out of the math rather than read as midnight.
  const input: PlannerInput = useMemo(
    () => ({ seasonStart, seasonEnd, cityId, minutesBetween, divisions: divisions.filter(timesSet) }),
    [seasonStart, seasonEnd, cityId, minutesBetween, divisions],
  );
  const plan = useMemo(() => computePlan(input), [input]);
  const result: ModeResult = mode === "spread" ? plan.spread : plan.sameNights;
  const other: ModeResult = mode === "spread" ? plan.sameNights : plan.spread;
  const warnings = plan.warnings[mode];
  // Names indexed like input.divisions (what the results reference).
  const names = input.divisions.map((d) => d.name || "Division");
  const colorIndex = input.divisions.map((d) => divisions.findIndex((x) => x.id === (d as DivisionDraft).id));

  const update = (id: string, patch: Partial<DivisionDraft>) =>
    setDivisions((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => setDivisions((ds) => ds.filter((d) => d.id !== id));
  const add = () => {
    const id = `new${nextId.current++}`;
    setDivisions((ds) => [...ds, { ...NEW_DIVISION, days: [...NEW_DIVISION.days], id }]);
    requestAnimationFrame(() => {
      const el = document.getElementById(`div-${id}-name`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  };

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 1800);
  };
  const copy = async () => {
    const text = requestText(input, result, plan.inUse);
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        flash("Copied");
      } catch {
        flash("Copy failed. Select the table and copy it instead.");
      }
      ta.remove();
    }
  };

  const activeDays = DAY_LONG.map((_, k) => k).filter((k) => plan.inUse.some((z) => result.byType[z][k].count > 0));
  // Every night that ties for a field type's busiest gets the marker.
  const peakDays = new Set<number>(plan.inUse.flatMap((z) => result.need[z].peakDays));
  const sunsetLabel =
    plan.sunsetAtStart !== null ? `Sunset ${fmtTime(plan.sunsetAtStart)} on ${fmtDate(parseIsoDate(seasonStart))}` : "";

  return (
    <div className="mt-8 space-y-10">
      {/* ── Season ── */}
      <section className="print:hidden" aria-labelledby="pfc-season">
        <h2 id="pfc-season" className="text-lg font-extrabold text-[#0C1F3F]">
          Season
        </h2>
        <p className="mt-1 text-sm text-gray-500">Dates set the season totals. Location sets sunset times for the daylight check.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="pfc-start" className={LABEL}>
              Practices start
            </label>
            <input id="pfc-start" type="date" value={seasonStart} onChange={(e) => setSeasonStart(e.target.value)} className={CONTROL} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="pfc-end" className={LABEL}>
              Practices end
            </label>
            <input id="pfc-end" type="date" value={seasonEnd} onChange={(e) => setSeasonEnd(e.target.value)} className={CONTROL} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="pfc-state" className={LABEL}>
              State
            </label>
            <select
              id="pfc-state"
              value={city.state}
              onChange={(e) => setCityId(citiesInState(e.target.value)[0].id)}
              className={CONTROL}
            >
              {STATES_SORTED.map((s) => (
                <option key={s} value={s}>
                  {STATE_NAMES[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="pfc-city" className={LABEL}>
              Nearest city
            </label>
            <select id="pfc-city" value={city.id} onChange={(e) => setCityId(e.target.value)} className={CONTROL}>
              {citiesInState(city.state).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <NumberField
            id="pfc-between"
            label="Minutes between practices"
            value={minutesBetween}
            min={0}
            max={30}
            step={5}
            onChange={setMinutesBetween}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Sunset times are for the city you pick and can be a few minutes off for towns nearby.
        </p>
      </section>

      {/* ── Divisions ── */}
      <section className="print:hidden" aria-labelledby="pfc-divisions">
        <h2 id="pfc-divisions" className="text-lg font-extrabold text-[#0C1F3F]">
          Divisions
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          &ldquo;Teams per field&rdquo; lets younger divisions share a field, two teams on each half.
        </p>
        <div className="mt-3 space-y-3">
          {divisions.map((d, i) => (
            <DivisionRow
              key={d.id}
              d={d}
              index={i}
              onChange={(patch) => update(d.id, patch)}
              onRemove={() => remove(d.id)}
              timesMissing={!timesSet(d)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={add}
          className="mt-3 inline-flex h-11 items-center rounded-lg border border-dashed border-gray-300 px-4 text-sm font-bold text-[#0C1F3F] hover:border-[#0C1F3F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E]"
        >
          Add a division
        </button>
      </section>

      {/* ── Answer ── */}
      <section className="print:hidden" aria-labelledby="pfc-answer">
        <div className="rounded-2xl bg-[#0C1F3F] p-5 text-white sm:p-6">
          <h2 id="pfc-answer" className="text-lg font-extrabold">
            Fields to request
          </h2>
          <p className="mt-1 text-sm text-white/60">The most fields in use at the same time on your busiest night, by field type.</p>
          <div className="mt-4 grid gap-0.5 overflow-hidden rounded-xl sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
            {plan.inUse.length ? (
              plan.inUse.map((z) => {
                const n = result.need[z];
                const o = other.need[z];
                return (
                  <div key={z} className="bg-white/[0.06] px-4 py-4">
                    <div className="text-4xl font-extrabold leading-none text-[#22C55E]">{n.fields}</div>
                    <div className="mt-1.5 font-bold">
                      {fieldTypeLabel(z)}
                      {n.fields === 1 ? "" : "s"}
                    </div>
                    <div className="mt-1 text-sm text-white/60">
                      Busiest: <span className="whitespace-nowrap">{busiestLabel(n)}</span>.{" "}
                      {mode === "spread"
                        ? `${o.fields} if everyone wants the same nights.`
                        : `${o.fields} if spread across the week.`}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="bg-white/[0.06] px-4 py-4 font-bold">Add a division with teams and practice days to see a number.</div>
            )}
          </div>
        </div>

        <div className="mt-5 inline-flex rounded-full border border-gray-200 bg-white p-1" role="group" aria-label="Practice spread">
          {(["spread", "sameNights"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-9 rounded-full px-3.5 text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] ${
                mode === m ? "bg-[#22C55E] text-[#0C1F3F]" : "text-gray-500 hover:text-[#0C1F3F]"
              }`}
            >
              {m === "spread" ? "Spread across the week" : "Everyone wants the same nights"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-gray-500">{MODE_HINT[mode]}</p>

        {plan.inUse.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-500">
                  <th className="whitespace-nowrap px-4 py-2.5">Night</th>
                  {plan.inUse.map((z) => (
                    <th key={z} className="whitespace-nowrap px-4 py-2.5">
                      {fieldTypeLabel(z)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeDays.map((k) => (
                  <tr key={k} className="border-b border-gray-100 last:border-0">
                    <td className={`whitespace-nowrap px-4 py-2.5 font-bold text-[#0C1F3F] ${peakDays.has(k) ? "shadow-[inset_3px_0_0_#22C55E]" : ""}`}>
                      {DAY_LONG[k]}
                    </td>
                    {plan.inUse.map((z) => {
                      const r = result.byType[z][k];
                      return (
                        <td key={z} className="whitespace-nowrap px-4 py-2.5">
                          {r.count && r.first !== null && r.last !== null ? (
                            <>
                              <span className="text-base font-extrabold text-[#0C1F3F]">{r.count}</span>{" "}
                              <span className="text-xs text-gray-500">
                                field{r.count > 1 ? "s" : ""}, {fmtTime(r.first)}–{fmtTime(r.last)}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(plan.seasonError || warnings.length > 0) && (
          <ul className="mt-4 space-y-2">
            {plan.seasonError && (
              <li className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">{plan.seasonError}</li>
            )}
            {warnings.map((w) => (
              <li key={w} className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
                {w}
              </li>
            ))}
          </ul>
        )}

        {plan.totals && (
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:flex sm:flex-wrap sm:gap-8">
            {[
              [fmtInt(plan.totals.teamPracticesPerWeek), "team practices a week"],
              [fmtInt(plan.totals.fieldHoursPerWeek), "field hours a week"],
              [fmtInt(plan.totals.weeks), "weeks"],
              [fmtInt(plan.totals.fieldHoursSeason), "field hours this season"],
            ].map(([n, label]) => (
              <div key={label}>
                <dt className="sr-only">{label}</dt>
                <dd>
                  <span className="block text-xl font-extrabold text-[#0C1F3F]">{n}</span>
                  <span className="text-gray-600">{label}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copy}
            disabled={!plan.inUse.length}
            className="inline-flex h-11 items-center rounded-lg bg-[#22C55E] px-4 text-sm font-bold text-[#0C1F3F] hover:bg-[#16a34a] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0C1F3F] disabled:opacity-50"
          >
            Copy for city request
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-11 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-bold text-[#0C1F3F] hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E]"
          >
            Print
          </button>
        </div>
      </section>

      {/* ── See the night ── */}
      <section className="print:hidden" aria-labelledby="pfc-night">
        <h2 id="pfc-night" className="text-lg font-extrabold text-[#0C1F3F]">
          See the night
        </h2>
        <p className="mb-3 mt-1 text-sm text-gray-500">
          One way the practices fit. The dashed line is sunset on the first day of practice.
        </p>
        <NightBoard
          result={result}
          inUse={plan.inUse}
          names={names}
          colorIndex={colorIndex}
          sunset={plan.sunsetAtStart}
          sunsetLabel={sunsetLabel}
        />
      </section>

      <div className="border-t border-gray-200 pt-6 text-sm text-gray-600 print:hidden">
        <p>
          Once the city gives you fields,{" "}
          <Link href="/" className="font-bold text-[#0C1F3F] underline-offset-2 hover:underline">
            FieldSlate schedules the practices
          </Link>{" "}
          and the games around them. Nothing you enter here is saved or sent anywhere.
        </p>
        <p className="mt-2">
          New to field requests? Read{" "}
          <Link href="/blog/how-many-practice-fields" className="font-bold text-[#0C1F3F] underline-offset-2 hover:underline">
            how many practice fields your league needs
          </Link>
          .
        </p>
      </div>

      <PrintRegion
        input={input}
        result={result}
        other={other}
        mode={mode}
        inUse={plan.inUse}
        warnings={plan.seasonError ? [plan.seasonError, ...warnings] : warnings}
        totals={plan.totals}
        cityLabel={`${city.name}, ${city.state}`}
      />

      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#0C1F3F] px-4 py-2.5 text-sm font-bold text-white shadow-lg transition-opacity motion-reduce:transition-none ${
          toast ? "opacity-100" : "opacity-0"
        }`}
      >
        {toast}
      </div>
    </div>
  );
}

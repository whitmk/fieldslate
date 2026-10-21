// Practice field calculator — warnings, season totals and the city-request
// text, ported from the approved mockup (render / requestText). Every
// sentence the page shows is built here and rendered VERBATIM.
//
// Deliberate changes from the mockup (founder-approved, 2026-10-12):
// - The daylight check also handles a FALL season ("works until <date>") and a
//   season spanning summer or winter. The mockup only warned when the window
//   ended after sunset on the FIRST day.
// - The daylight check compares sunset with when each division's practices
//   ACTUALLY end in the chosen mode (the packed blocks), not with its window
//   end. A 5:30–8pm window whose practices all finish at 7pm is a 7pm
//   question, and the warning names 7pm.
// - Season totals leave out practices too long for their window, as the
//   warning about them says.
// - The request text names both years when the season crosses New Year.
//
// IN-APP OPTIONS (additive, 2026-10-21): computePlan takes an optional second
// argument for the in-app planner — the league's city, already resolved with
// cityByIdOrNull, or null for none. With options, the input carries no city
// id, cityById is never called, a null city means no daylight warnings and no
// sunset, and the result gains `earliestSunset`. A division with `lit` is
// skipped by the daylight check only. WITHOUT options (the calculator) the
// result is exactly what it always was, key for key — pinned by the golden
// in sim:practice-planner section G.

import { DAY_LONG, fieldTypeLabel } from "./constants";
import { fmtDate, fmtTime, formatDayList, isIsoDate, parseIsoDate, toMinutes } from "./format";
import { computeMode, countedPerWeek, divisionIsActive, fieldTypesInUse, normalizeDays } from "./plan";
import { daylightFor, sunsetMinutes } from "@/lib/sun/sunset";
import type { DivisionInput, FieldNeed, FieldTypeId, ModeResult, PlanCore, PlannerInput, SpreadMode } from "./types";
import { cityById, type UsCity } from "@/lib/sun/us-cities";

const DAY_MS = 864e5;

export type SeasonTotals = {
  teamPracticesPerWeek: number;
  fieldHoursPerWeek: number;
  weeks: number;
  fieldHoursSeason: number;
};

export type Plan = {
  spread: ModeResult;
  sameNights: ModeResult;
  /** Field types some active division uses, in display order. */
  inUse: FieldTypeId[];
  /** Division warnings, then daylight warnings for that mode's packing. */
  warnings: Record<SpreadMode, string[]>;
  /** Null when the season dates are unusable (see seasonError). */
  totals: SeasonTotals | null;
  /** Sunset on the first day of practice, local minutes; null without valid dates. */
  sunsetAtStart: number | null;
  /** A sentence when the season dates can't be used; null when they can. */
  seasonError: string | null;
  /**
   * ONLY when computePlan is given options (the in-app planner): the earliest
   * sunset in the season and the first day it happens; null without a city or
   * valid dates. Absent — not undefined, not null — for the calculator.
   */
  earliestSunset?: EarliestSunset | null;
};

/** `date` is a UTC-midnight epoch value; `minutes` local clock minutes. */
export type EarliestSunset = { date: number; minutes: number };

/** The in-app planner's options: the league's city, or null for none. */
export type PlanOptions = { city: UsCity | null };

export function seasonError(input: PlanCore): string | null {
  if (!isIsoDate(input.seasonStart) || !isIsoDate(input.seasonEnd)) return "Pick a start and end date for practices.";
  if (parseIsoDate(input.seasonEnd) < parseIsoDate(input.seasonStart)) return "Practices end before they start.";
  return null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function divisionWarnings(input: PlanCore): string[] {
  const w: string[] = [];
  for (const d of input.divisions) {
    const days = normalizeDays(d.days).length;
    if (days && d.perWeek > days) {
      w.push(`${d.name} practices ${d.perWeek} times a week but only has ${plural(days, "day")} picked. Counted as ${days}.`);
    }
    const start = toMinutes(d.start);
    const end = toMinutes(d.end);
    if (d.lengthMin > end - start) {
      w.push(
        `${d.name}'s ${d.lengthMin}-minute practice doesn't fit between ${fmtTime(start)} and ${fmtTime(end)}. Those practices aren't counted.`,
      );
    }
  }
  return w;
}

/** A practice longer than its window is never placed or counted. */
export function fitsWindow(d: DivisionInput): boolean {
  return d.lengthMin <= toMinutes(d.end) - toMinutes(d.start);
}

/** When division `i`'s last placed practice ends on any night, or null if none was placed. */
export function latestPracticeEnd(result: ModeResult, i: number, d: DivisionInput): number | null {
  let latest: number | null = null;
  for (const night of result.byType[d.fieldType]) {
    for (const f of night.fields) {
      for (const b of f) {
        if (b.division === i) latest = Math.max(latest ?? 0, b.start + b.lengthMin);
      }
    }
  }
  return latest;
}

/**
 * The busiest night(s) for the answer cards and the print: one night by its
 * full name ("Monday"), a tie as a day list ("Mon–Fri", "Tue, Thu").
 */
export function busiestLabel(need: FieldNeed): string {
  if (!need.peakDays.length) return "—";
  return need.peakDays.length === 1 ? DAY_LONG[need.peakDays[0]] : formatDayList(need.peakDays);
}

/** "a 7pm finish", "an 8pm finish", "an 11am finish". */
function finish(min: number): string {
  const t = fmtTime(min);
  return `${/^(8|11)[:ap]/.test(t) ? "an" : "a"} ${t} finish`;
}

export function daylightWarnings(input: PlanCore, result: ModeResult, city: UsCity): string[] {
  if (seasonError(input)) return [];
  const sd = parseIsoDate(input.seasonStart);
  const ed = parseIsoDate(input.seasonEnd);

  // Active divisions grouped by when their practices actually end, earliest
  // first. A division with nothing placed (every practice too long) has no
  // daylight question; it already has its length warning.
  const byEnd = new Map<number, string[]>();
  input.divisions.forEach((d, i) => {
    // A division on lit fields has no daylight question.
    if (!divisionIsActive(d) || d.lit) return;
    const end = latestPracticeEnd(result, i, d);
    if (end === null) return;
    byEnd.set(end, [...(byEnd.get(end) ?? []), d.name]);
  });
  const ends = Array.from(byEnd.keys()).sort((a, b) => a - b);

  const w: string[] = [];
  for (const em of ends) {
    const names = byEnd.get(em)!;
    const r = daylightFor(em, sd, ed, city);
    if (r.kind === "ok") continue;
    const lead = `Daylight: ${names.join(", ")} run${names.length > 1 ? "" : "s"} until ${fmtTime(em)}, but sunset on `;
    const fin = finish(em);
    const on = (t: number) => `${fmtDate(t)} is ${fmtTime(sunsetMinutes(t, city))}. `;
    switch (r.kind) {
      case "from":
        w.push(`${lead}${on(sd)}Without lights, ${fin} works from ${fmtDate(r.from)}.`);
        break;
      case "never":
        w.push(`${lead}${on(sd)}Without lights, ${fin} doesn't work at any point this season.`);
        break;
      case "until":
        w.push(`${lead}${on(r.until + DAY_MS)}Without lights, ${fin} works until ${fmtDate(r.until)}.`);
        break;
      case "between":
        w.push(`${lead}${on(sd)}Without lights, ${fin} works from ${fmtDate(r.from)} to ${fmtDate(r.until)}.`);
        break;
      case "gap":
        w.push(
          `${lead}${on(r.until + DAY_MS)}Without lights, ${fin} works until ${fmtDate(r.until)} and again from ${fmtDate(r.from)}.`,
        );
        break;
    }
  }
  return w;
}

export function seasonTotals(input: PlanCore): SeasonTotals | null {
  if (seasonError(input)) return null;
  const sd = parseIsoDate(input.seasonStart);
  const ed = parseIsoDate(input.seasonEnd);
  const weeks = Math.max(1, Math.ceil(((ed - sd) / DAY_MS + 1) / 7));
  let weekMin = 0;
  let practices = 0;
  for (const d of input.divisions) {
    if (!normalizeDays(d.days).length) continue;
    if (!fitsWindow(d)) continue;
    const n = d.teams * countedPerWeek(d);
    practices += n;
    weekMin += (n * d.lengthMin) / d.teamsPerField;
  }
  return {
    teamPracticesPerWeek: practices,
    fieldHoursPerWeek: Math.round(weekMin / 60),
    weeks,
    fieldHoursSeason: Math.round((weekMin / 60) * weeks),
  };
}

/** The earliest sunset from the first to the last day, and the first day it happens. */
export function earliestSunset(input: PlanCore, city: UsCity): EarliestSunset {
  const sd = parseIsoDate(input.seasonStart);
  const ed = parseIsoDate(input.seasonEnd);
  let best: EarliestSunset = { date: sd, minutes: sunsetMinutes(sd, city) };
  for (let t = sd + DAY_MS; t <= ed; t += DAY_MS) {
    const m = sunsetMinutes(t, city);
    if (m < best.minutes) best = { date: t, minutes: m };
  }
  return best;
}

/**
 * The calculator: computePlan(input) — its own picked city, with the
 * Sacramento fallback, exactly as before. The in-app planner:
 * computePlan(core, { city }) — the city it resolved, or null; the input's
 * city id is never read.
 */
export function computePlan(input: PlannerInput): Plan;
export function computePlan(input: PlanCore, opts: PlanOptions): Plan;
export function computePlan(input: PlanCore | PlannerInput, opts?: PlanOptions): Plan {
  const city = opts ? opts.city : cityById((input as PlannerInput).cityId);
  const err = seasonError(input);
  const spread = computeMode(input, "spread");
  const sameNights = computeMode(input, "sameNights");
  const divisionW = divisionWarnings(input);
  const daylight = (r: ModeResult) => (city ? daylightWarnings(input, r, city) : []);
  const plan: Plan = {
    spread,
    sameNights,
    inUse: fieldTypesInUse(input),
    warnings: {
      spread: [...divisionW, ...daylight(spread)],
      sameNights: [...divisionW, ...daylight(sameNights)],
    },
    totals: seasonTotals(input),
    sunsetAtStart: err || !city ? null : sunsetMinutes(parseIsoDate(input.seasonStart), city),
    seasonError: err,
  };
  // Options only: without them the result keeps exactly the calculator's keys.
  if (opts) plan.earliestSunset = err || !city ? null : earliestSunset(input, city);
  return plan;
}

/** "Feb 22 to May 29, 2027"; "Nov 1, 2026 to Feb 28, 2027" across New Year. Null without valid dates. */
export function seasonRangeLabel(input: PlanCore): string | null {
  if (seasonError(input)) return null;
  const sd = parseIsoDate(input.seasonStart);
  const ed = parseIsoDate(input.seasonEnd);
  const ys = new Date(sd).getUTCFullYear();
  const ye = new Date(ed).getUTCFullYear();
  return ys === ye
    ? `${fmtDate(sd)} to ${fmtDate(ed)}, ${ys}`
    : `${fmtDate(sd)}, ${ys} to ${fmtDate(ed)}, ${ye}`;
}

/** Plain text for the city request: night by night per field type, then the inputs. */
export function requestText(input: PlanCore, result: ModeResult, inUse: FieldTypeId[]): string {
  const lines: string[] = [];
  const range = seasonRangeLabel(input);
  lines.push(range ? `Practice field request: ${range}` : "Practice field request");
  for (const z of inUse) {
    lines.push("", `${fieldTypeLabel(z)}s: ${result.need[z].fields} at the busiest time`);
    result.byType[z].forEach((r, k) => {
      if (r.count && r.first !== null && r.last !== null) {
        lines.push(`  ${DAY_LONG[k]}: ${plural(r.count, "field")}, ${fmtTime(r.first)} to ${fmtTime(r.last)}`);
      }
    });
  }
  const based = input.divisions
    .filter(divisionIsActive)
    .map((d) => `${d.name} (${d.teams} teams, ${countedPerWeek(d)}x/week, ${d.lengthMin} min)`)
    .join("; ");
  lines.push("", `Based on: ${based}.`);
  return lines.join("\n");
}


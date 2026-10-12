// Practice field calculator — warnings, season totals and the city-request
// text, ported from the approved mockup (render / requestText). Every
// sentence the page shows is built here and rendered VERBATIM.
//
// One deliberate addition to the mockup: the daylight check also handles a
// FALL season ("works until <date>") and a season spanning summer or winter.
// The mockup only warned when the window ended after sunset on the FIRST day,
// so a fall season that loses its daylight in October said nothing.

import { DAY_LONG, fieldTypeLabel } from "./constants";
import { fmtDate, fmtTime, isIsoDate, parseIsoDate, toMinutes } from "./format";
import { computeMode, countedPerWeek, divisionIsActive, fieldTypesInUse, normalizeDays } from "./plan";
import { daylightFor, sunsetMinutes } from "./sunset";
import type { FieldTypeId, ModeResult, PlannerInput } from "./types";
import { cityById } from "./us-cities";

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
  warnings: string[];
  /** Null when the season dates are unusable (see seasonError). */
  totals: SeasonTotals | null;
  /** Sunset on the first day of practice, local minutes; null without valid dates. */
  sunsetAtStart: number | null;
  /** A sentence when the season dates can't be used; null when they can. */
  seasonError: string | null;
};

export function seasonError(input: PlannerInput): string | null {
  if (!isIsoDate(input.seasonStart) || !isIsoDate(input.seasonEnd)) return "Pick a start and end date for practices.";
  if (parseIsoDate(input.seasonEnd) < parseIsoDate(input.seasonStart)) return "Practices end before they start.";
  return null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function divisionWarnings(input: PlannerInput): string[] {
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

export function daylightWarnings(input: PlannerInput): string[] {
  if (seasonError(input)) return [];
  const city = cityById(input.cityId);
  const sd = parseIsoDate(input.seasonStart);
  const ed = parseIsoDate(input.seasonEnd);

  // Active divisions grouped by window end, earliest end first ("HH:MM"
  // strings sort in time order, as the mockup's Object.entries(...).sort()).
  const byEnd = new Map<string, string[]>();
  for (const d of input.divisions) {
    if (!divisionIsActive(d)) continue;
    byEnd.set(d.end, [...(byEnd.get(d.end) ?? []), d.name]);
  }
  const ends = Array.from(byEnd.keys()).sort();

  const w: string[] = [];
  for (const end of ends) {
    const names = byEnd.get(end)!;
    const em = toMinutes(end);
    const r = daylightFor(em, sd, ed, city);
    if (r.kind === "ok") continue;
    const lead = `Daylight: ${names.join(", ")} run${names.length > 1 ? "" : "s"} until ${fmtTime(em)}, but sunset on `;
    const on = (t: number) => `${fmtDate(t)} is ${fmtTime(sunsetMinutes(t, city))}. `;
    switch (r.kind) {
      case "from":
        w.push(`${lead}${on(sd)}Without lights, that window works from ${fmtDate(r.from)}.`);
        break;
      case "never":
        w.push(`${lead}${on(sd)}Without lights, it doesn't work before practices end.`);
        break;
      case "until":
        w.push(`${lead}${on(r.until + DAY_MS)}Without lights, that window works until ${fmtDate(r.until)}.`);
        break;
      case "between":
        w.push(`${lead}${on(sd)}Without lights, that window works from ${fmtDate(r.from)} to ${fmtDate(r.until)}.`);
        break;
      case "gap":
        w.push(
          `${lead}${on(r.until + DAY_MS)}Without lights, that window works until ${fmtDate(r.until)} and again from ${fmtDate(r.from)}.`,
        );
        break;
    }
  }
  return w;
}

export function seasonTotals(input: PlannerInput): SeasonTotals | null {
  if (seasonError(input)) return null;
  const sd = parseIsoDate(input.seasonStart);
  const ed = parseIsoDate(input.seasonEnd);
  const weeks = Math.max(1, Math.ceil(((ed - sd) / DAY_MS + 1) / 7));
  let weekMin = 0;
  let practices = 0;
  for (const d of input.divisions) {
    if (!normalizeDays(d.days).length) continue;
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

export function computePlan(input: PlannerInput): Plan {
  const err = seasonError(input);
  return {
    spread: computeMode(input, "spread"),
    sameNights: computeMode(input, "sameNights"),
    inUse: fieldTypesInUse(input),
    warnings: [...divisionWarnings(input), ...daylightWarnings(input)],
    totals: seasonTotals(input),
    sunsetAtStart: err ? null : sunsetMinutes(parseIsoDate(input.seasonStart), cityById(input.cityId)),
    seasonError: err,
  };
}

/** Plain text for the city request: night by night per field type, then the inputs. */
export function requestText(input: PlannerInput, result: ModeResult, inUse: FieldTypeId[]): string {
  const lines: string[] = [];
  if (!seasonError(input)) {
    const sd = parseIsoDate(input.seasonStart);
    const ed = parseIsoDate(input.seasonEnd);
    lines.push(`Practice field request: ${fmtDate(sd)} to ${fmtDate(ed)}, ${new Date(sd).getUTCFullYear()}`);
  } else {
    lines.push("Practice field request");
  }
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


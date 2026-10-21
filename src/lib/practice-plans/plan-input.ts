// The saved practice plan's input — the TypeScript twin of
// practice_plan_input_problem (migration 0117). PURE: no React, no DOM, no
// clock, no Supabase.
//
// The stored input is the practice-planner module's PlanCore (no city — every
// plan reads the league's city when it opens) with an optional `lit` and `id`
// per division. A `cityId` key is refused by name; any other unknown key is
// refused.
//
// ONE RULE, TWO LANGUAGES, ONE TABLE: the PLANINPUT-TABLE-BEGIN / -END block in
// scripts/sim/practice-plans-sim.sql. The SQL proof runs it through the
// database function; sim:practice-plan-input parses the SAME block and runs it
// through practicePlanInputProblem, and builds the just-inside / just-outside
// rows for every limit below from INPUT_LIMITS and requires each to be in the
// table with the expected answer. Change a limit here or in 0117 alone and its
// side goes red. Never a second copy of the table.
//
// The in-app planner's form must keep every value inside INPUT_LIMITS, so a
// planner-valid input is never refused on save.

import { FIELD_TYPE_IDS } from "@/lib/practice-planner/constants";
import { isIsoDate } from "@/lib/practice-planner/format";

/** The stored input's version. Old plans are upgraded when they open. */
export const PLAN_INPUT_VERSION = 1;

export const PLAN_MODES = ["spread", "sameNights"] as const;

export const INPUT_LIMITS = {
  /** Season dates: "" or a real YYYY-MM-DD in these years. */
  yearMin: 2000,
  yearMax: 2099,
  minutesBetween: { min: 0, max: 30 },
  divisions: { max: 40 },
  divisionName: { maxChars: 60 },
  teams: { min: 0, max: 60 },
  perWeek: { min: 0, max: 7 },
  lengthMin: { min: 15, max: 240 },
  teamsPerField: { min: 1, max: 4 },
  id: { minChars: 1, maxChars: 40 },
  planName: { minChars: 1, maxChars: 80 },
} as const;

/** One problem key, in 0117's words, or null for a good input. */
export type PlanInputProblem =
  | "not_an_object"
  | "city_not_allowed"
  | "unknown_key"
  | "missing_key"
  | "season_start"
  | "season_end"
  | "minutes_between"
  | "divisions"
  | "division_count"
  | "division_not_object"
  | "division_unknown_key"
  | "division_missing_key"
  | "division_name"
  | "teams"
  | "per_week"
  | "length"
  | "days"
  | "start"
  | "end"
  | "field_type"
  | "teams_per_field"
  | "lit"
  | "id";

const TOP_KEYS = ["seasonStart", "seasonEnd", "minutesBetween", "divisions"];
const DIVISION_KEYS = ["id", "name", "teams", "perWeek", "lengthMin", "days", "start", "end", "fieldType", "teamsPerField", "lit"];
const DIVISION_REQUIRED = ["name", "teams", "perWeek", "lengthMin", "days", "start", "end", "fieldType", "teamsPerField"];
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A JSON number with no fractional part, inside [min, max]. */
function intIn(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= min && v <= max;
}

/** Characters as Postgres counts them (code points), not UTF-16 units. */
function chars(s: string): number {
  return Array.from(s).length;
}

function dateOk(v: unknown): boolean {
  if (typeof v !== "string") return false;
  if (v === "") return true;
  if (!isIsoDate(v)) return false;
  const y = Number(v.slice(0, 4));
  return y >= INPUT_LIMITS.yearMin && y <= INPUT_LIMITS.yearMax;
}

/** Same checks, same order, same keys as practice_plan_input_problem (0117). */
export function practicePlanInputProblem(input: unknown): PlanInputProblem | null {
  if (!isObject(input)) return "not_an_object";
  if ("cityId" in input) return "city_not_allowed";
  if (Object.keys(input).some((k) => !TOP_KEYS.includes(k))) return "unknown_key";
  if (!TOP_KEYS.every((k) => k in input)) return "missing_key";

  if (!dateOk(input.seasonStart)) return "season_start";
  if (!dateOk(input.seasonEnd)) return "season_end";

  const L = INPUT_LIMITS;
  if (!intIn(input.minutesBetween, L.minutesBetween.min, L.minutesBetween.max)) return "minutes_between";

  const divisions = input.divisions;
  if (!Array.isArray(divisions)) return "divisions";
  if (divisions.length > L.divisions.max) return "division_count";

  for (const d of divisions) {
    if (!isObject(d)) return "division_not_object";
    if (Object.keys(d).some((k) => !DIVISION_KEYS.includes(k))) return "division_unknown_key";
    if (!DIVISION_REQUIRED.every((k) => k in d)) return "division_missing_key";

    if (typeof d.name !== "string" || chars(d.name) > L.divisionName.maxChars) return "division_name";
    if (!intIn(d.teams, L.teams.min, L.teams.max)) return "teams";
    if (!intIn(d.perWeek, L.perWeek.min, L.perWeek.max)) return "per_week";
    if (!intIn(d.lengthMin, L.lengthMin.min, L.lengthMin.max)) return "length";

    if (!Array.isArray(d.days) || d.days.length > 7) return "days";
    if (d.days.some((x) => typeof x !== "number")) return "days";
    const seen = new Set<number>();
    for (const x of d.days as number[]) {
      if (!intIn(x, 0, 6) || seen.has(x)) return "days";
      seen.add(x);
    }

    if (typeof d.start !== "string" || !TIME.test(d.start)) return "start";
    if (typeof d.end !== "string" || !TIME.test(d.end)) return "end";
    if (typeof d.fieldType !== "string" || !(FIELD_TYPE_IDS as string[]).includes(d.fieldType)) return "field_type";
    if (!intIn(d.teamsPerField, L.teamsPerField.min, L.teamsPerField.max)) return "teams_per_field";
    if ("lit" in d && typeof d.lit !== "boolean") return "lit";
    if ("id" in d && (typeof d.id !== "string" || chars(d.id) < L.id.minChars || chars(d.id) > L.id.maxChars)) return "id";
  }
  return null;
}

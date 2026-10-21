// Practice field calculator — the shapes the math takes and returns.
//
// PURE: no React, no DOM, no clock, no Supabase. The public page
// (/tools/practice-field-calculator) runs it in the browser; a later in-app
// version will save plans per season and must call this SAME module rather
// than a copy. Source of truth for every rule: the approved mockup's script,
// docs/mockups/practice-field-calculator.html.

/** Day index: 0 = Monday … 6 = Sunday (the mockup's order). */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type FieldTypeId =
  | "diamond60"
  | "diamond5070"
  | "diamond90"
  | "softball"
  | "soccerSmall"
  | "soccerFull";

export type SpreadMode = "spread" | "sameNights";

export type DivisionInput = {
  /** For the UI's list keys only; the math never reads it. */
  id?: string;
  name: string;
  teams: number;
  /** Practices per team per week. */
  perWeek: number;
  /** Practice length in minutes. */
  lengthMin: number;
  /** Allowed days, any order (normalized to Mon→Sun inside). */
  days: number[];
  /** Window "HH:MM", 24-hour. */
  start: string;
  end: string;
  fieldType: FieldTypeId;
  /** Teams that share one field at the same time (1–4). */
  teamsPerField: number;
  /**
   * Practices on lit fields (in-app planner only; the calculator never sets
   * it). Skipped by the daylight check and NOTHING else — field counts,
   * totals, division warnings and the request text still count it.
   */
  lit?: boolean;
};

/** Everything the math reads except the city. */
export type PlanCore = {
  /** "YYYY-MM-DD" */
  seasonStart: string;
  seasonEnd: string;
  /** Minutes between practices on the same field. */
  minutesBetween: number;
  divisions: DivisionInput[];
};

/** The public calculator's input: the core plus its picked city's id. */
export type PlannerInput = PlanCore & {
  /** An id from US_CITIES. */
  cityId: string;
};

/** One block on a field: a group of up to teamsPerField teams. */
export type PlacedBlock = {
  /** Index into PlannerInput.divisions. */
  division: number;
  /** Start, minutes after midnight. */
  start: number;
  lengthMin: number;
  teams: number;
};

export type NightResult = {
  /** Fields in use that night. */
  count: number;
  fields: PlacedBlock[][];
  /** Earliest start / latest end that night; null when no fields. */
  first: number | null;
  last: number | null;
  /** Blocks whose practice is longer than the window (not counted). */
  skipped: number;
};

export type FieldNeed = {
  /** Most fields used on any one night. */
  fields: number;
  /** First night that reaches it; null when no practices. */
  peakDay: DayIndex | null;
  /** Every night that reaches it, Monday first (ties included); empty when no practices. */
  peakDays: DayIndex[];
};

export type ModeResult = {
  /** byType[fieldType][day] */
  byType: Record<FieldTypeId, NightResult[]>;
  need: Record<FieldTypeId, FieldNeed>;
};

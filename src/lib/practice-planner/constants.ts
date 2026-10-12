import type { DayIndex, FieldTypeId } from "./types";

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAY_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const ALL_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * "Everyone wants the same nights": the order nights get asked for.
 * Tue, Thu, Mon, Wed, Fri, Sat, Sun (the mockup's PREF).
 */
export const SAME_NIGHTS_PREFERENCE: DayIndex[] = [1, 3, 0, 2, 4, 5, 6];

/** Fixed list for v1 — no free text. Order is display order only. */
export const FIELD_TYPES: { id: FieldTypeId; label: string }[] = [
  { id: "diamond60", label: "60-ft diamond" },
  { id: "diamond5070", label: "50/70 diamond" },
  { id: "diamond90", label: "90-ft diamond" },
  { id: "softball", label: "Softball diamond" },
  { id: "soccerSmall", label: "Small soccer field" },
  { id: "soccerFull", label: "Full soccer field" },
];

export const FIELD_TYPE_IDS: FieldTypeId[] = FIELD_TYPES.map((f) => f.id);

export function fieldTypeLabel(id: FieldTypeId): string {
  return FIELD_TYPES.find((f) => f.id === id)?.label ?? id;
}

/** Packing tries start times on this grid, from the window's start. */
export const PACK_STEP_MIN = 5;

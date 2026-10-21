// The in-app city request and print additions. PURE. The module's
// requestText stays exactly as the calculator uses it; the planner appends
// one line naming the divisions on lit fields, and the print shows the same
// line.

import { divisionIsActive } from "@/lib/practice-planner/plan";
import type { FieldTypeId, ModeResult } from "@/lib/practice-planner/types";
import { requestText } from "@/lib/practice-planner/report";
import type { PlanInput } from "./load";
import { litFieldsLine } from "./words";

/**
 * The lit divisions the request is about: lit AND counted (the same
 * divisions the module's "Based on" line names), in plan order.
 */
export function litDivisionNames(input: PlanInput): string[] {
  return input.divisions.filter((d) => d.lit === true && divisionIsActive(d)).map((d) => d.name || "Division");
}

/** "On lit fields: Majors." — null when no counted division is lit. */
export function litLine(input: PlanInput): string | null {
  return litFieldsLine(litDivisionNames(input));
}

/** The text "Copy for city request" puts on the clipboard. */
export function planRequestText(input: PlanInput, result: ModeResult, inUse: FieldTypeId[]): string {
  const text = requestText(input, result, inUse);
  const lit = litLine(input);
  return lit ? `${text}\n\n${lit}` : text;
}

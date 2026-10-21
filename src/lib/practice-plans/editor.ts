// The planner's editing and autosave decisions. PURE — the planner component
// only wires these to inputs and timers.
//
// AUTOSAVE: opening a plan writes nothing; only an edit marks the plan dirty
// and (debounced) saves it through save_practice_plan with the updated_at the
// page loaded. What each reply does to the state:
//   saved         → clean, the new updated_at is the next save's guard
//   stale         → autosave STOPS; the banner names who and when; "Keep mine"
//                   is an explicit second save carrying the stale updated_at;
//                   "Reload" drops local edits (after a confirm)
//   plan_required → autosave STOPS for good (the league left Pro/Elite); the
//                   plan stays readable
//   anything else → "Couldn't save" with Retry; edits stay dirty

import { NEW_DIVISION } from "@/lib/practice-planner/example-league";
import type { PlanDivision, PlanInput } from "./load";
import { planErrorKey, type SaveOutcome } from "./list";
import { INPUT_LIMITS } from "./plan-input";

/** Every division gets a stable id (the list key); missing ones become d1, d2… unused. */
export function ensureDivisionIds(input: PlanInput): PlanInput {
  if (input.divisions.every((d) => typeof d.id === "string" && d.id)) return input;
  const used = new Set(input.divisions.map((d) => d.id).filter(Boolean));
  let n = 1;
  const next = () => {
    while (used.has(`d${n}`)) n++;
    used.add(`d${n}`);
    return `d${n}`;
  };
  return { ...input, divisions: input.divisions.map((d) => (d.id ? d : { ...d, id: next() })) };
}

export function canAddDivision(input: PlanInput): boolean {
  return input.divisions.length < INPUT_LIMITS.divisions.max;
}

/** "+ Add a division": the calculator's NEW_DIVISION defaults, a fresh id. Unchanged at the limit. */
export function addDivision(input: PlanInput): { input: PlanInput; id: string | null } {
  if (!canAddDivision(input)) return { input, id: null };
  const used = new Set(input.divisions.map((d) => d.id));
  let n = input.divisions.length + 1;
  while (used.has(`d${n}`)) n++;
  const id = `d${n}`;
  const d: PlanDivision = { ...NEW_DIVISION, days: [...NEW_DIVISION.days], id };
  return { input: { ...input, divisions: [...input.divisions, d] }, id };
}

export function removeDivision(input: PlanInput, id: string): PlanInput {
  return { ...input, divisions: input.divisions.filter((d) => d.id !== id) };
}

export function updateDivision(input: PlanInput, id: string, patch: Partial<PlanDivision>): PlanInput {
  return { ...input, divisions: input.divisions.map((d) => (d.id === id ? { ...d, ...patch, id } : d)) };
}

/** Toggle a day, keeping the list in Monday-first order with no repeats. */
export function toggleDay(days: number[], day: number): number[] {
  const set = new Set(days);
  if (set.has(day)) set.delete(day);
  else set.add(day);
  return [0, 1, 2, 3, 4, 5, 6].filter((k) => set.has(k));
}

export type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "failed"; message: string }
  | { kind: "stale"; byName: string | null; updatedAt: string }
  | { kind: "stopped" };

/** What a save_practice_plan reply does to the state (see the header). */
export function afterSave(outcome: SaveOutcome, rawError: { message?: string } | null): { state: SaveState; updatedAt: string | null } {
  if (outcome.kind === "saved") return { state: { kind: "clean" }, updatedAt: outcome.updatedAt };
  if (outcome.kind === "stale") return { state: { kind: "stale", byName: outcome.byName, updatedAt: outcome.updatedAt }, updatedAt: null };
  if (planErrorKey(rawError) === "plan_required") return { state: { kind: "stopped" }, updatedAt: null };
  return { state: { kind: "failed", message: outcome.message }, updatedAt: null };
}

/** Autosave runs only from dirty. Stale and stopped wait for the person. */
export function autosaveAllowed(state: SaveState): boolean {
  return state.kind === "dirty";
}

/** Warn on leaving only when an edit is unsaved: pending, saving, failed, or held back. */
export function warnOnLeave(state: SaveState): boolean {
  return state.kind !== "clean";
}

/** Practice lengths the planner offers (all inside INPUT_LIMITS.lengthMin); a saved value outside the list is offered too. */
export const PRACTICE_LENGTHS = [45, 60, 75, 90, 105, 120, 150] as const;

export function lengthOptions(current: number): number[] {
  const list: number[] = [...PRACTICE_LENGTHS];
  if (!list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

/** A typed time is committed only when it is a whole "HH:MM" (iOS can show a time it hasn't committed). */
export function committedTime(value: string): string | null {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value) ? value : null;
}

/** A typed team count is committed only when it is a whole number inside the limit. */
export function committedTeams(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= INPUT_LIMITS.teams.min && n <= INPUT_LIMITS.teams.max ? n : null;
}

/** A typed season date: "" or a YYYY-MM-DD inside the plan's years. */
export function committedDate(value: string): string | null {
  if (value === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const y = Number(value.slice(0, 4));
  const t = Date.UTC(y, Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== value) return null;
  return y >= INPUT_LIMITS.yearMin && y <= INPUT_LIMITS.yearMax ? value : null;
}

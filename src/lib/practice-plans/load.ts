// Opening a saved plan: upgrade its stored input to the current version, then
// run the SAME input check the database runs on save (plan-input.ts, pinned
// to 0117 by one case table). Anything that fails either step is "can't
// open" — never a crash, never a half-read plan. PURE.

import type { DivisionInput, PlanCore, SpreadMode } from "@/lib/practice-planner/types";
import { PLAN_INPUT_VERSION, PLAN_MODES, practicePlanInputProblem, type PlanInputProblem } from "./plan-input";
import { CANT_OPEN_PLAN } from "./words";

/** A practice_plans row as the browser reads it. */
export type PlanRow = {
  id: string;
  name: string;
  input: unknown;
  input_version: number;
  mode: string;
  updated_at: string;
};

/** A division as a saved plan holds it: the module's input plus the in-app flags. */
export type PlanDivision = DivisionInput & { lit?: boolean; id?: string };
export type PlanInput = PlanCore & { divisions: PlanDivision[] };

export type LoadedPlan = {
  id: string;
  name: string;
  mode: SpreadMode;
  input: PlanInput;
  /** Pass back to save_practice_plan exactly as read. */
  updatedAt: string;
};

export type LoadResult =
  | { ok: true; plan: LoadedPlan }
  | { ok: false; message: string; why: "version" | "mode" | PlanInputProblem };

/**
 * Step from an older stored version to the next, keyed by the version it
 * upgrades FROM. Empty today: version 1 is the only one. When the module's
 * input gains a field, bump PLAN_INPUT_VERSION, add the step here, and widen
 * 0117's check in a migration.
 */
const UPGRADES: Record<number, (raw: unknown) => unknown> = {};

/**
 * The input brought up to PLAN_INPUT_VERSION, or null when the version can't
 * be upgraded. (The input itself may be anything, null included — the input
 * check decides that.)
 */
export function upgradePlanInput(version: number, raw: unknown): { input: unknown } | null {
  if (!Number.isInteger(version) || version < 1 || version > PLAN_INPUT_VERSION) return null;
  let v = version;
  let input = raw;
  while (v < PLAN_INPUT_VERSION) {
    const step = UPGRADES[v];
    if (!step) return null;
    input = step(input);
    v++;
  }
  return { input };
}

export function loadPlan(row: PlanRow): LoadResult {
  const upgraded = upgradePlanInput(row.input_version, row.input);
  if (upgraded === null) return { ok: false, message: CANT_OPEN_PLAN, why: "version" };
  const input = upgraded.input;
  const problem = practicePlanInputProblem(input);
  if (problem) return { ok: false, message: CANT_OPEN_PLAN, why: problem };
  if (!(PLAN_MODES as readonly string[]).includes(row.mode)) return { ok: false, message: CANT_OPEN_PLAN, why: "mode" };
  return {
    ok: true,
    plan: { id: row.id, name: row.name, mode: row.mode as SpreadMode, input: input as PlanInput, updatedAt: row.updated_at },
  };
}

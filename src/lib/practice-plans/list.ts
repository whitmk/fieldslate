// The plans list's derived lines and the plan functions' replies. PURE.

import { fieldTypeLabel } from "@/lib/practice-planner/constants";
import { computeMode, fieldTypesInUse } from "@/lib/practice-planner/plan";
import { seasonRangeLabel } from "@/lib/practice-planner/report";
import type { SpreadMode } from "@/lib/practice-planner/types";
import { todayInTimezone } from "@/lib/utils/org-today";
import type { PlanInput } from "./load";
import { PLAN_NO_DATES, PLAN_NO_FIELDS, planErrorMessage } from "./words";

/** "6 60-ft diamonds · 2 50/70 diamonds" for the mode the plan was left in. */
export function planSummaryLine(input: PlanInput, mode: SpreadMode): string {
  const result = computeMode(input, mode);
  const parts = fieldTypesInUse(input)
    .map((z) => ({ n: result.need[z].fields, z }))
    .filter((p) => p.n > 0)
    .map((p) => `${p.n} ${fieldTypeLabel(p.z)}${p.n === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : PLAN_NO_FIELDS;
}

export function planDatesLabel(input: PlanInput): string {
  return seasonRangeLabel(input) ?? PLAN_NO_DATES;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "today", "Oct 19", or "Oct 19, 2025" — the plan's last save as a date in
 * the LEAGUE's timezone. Server-side only (pass the string to the client):
 * it reads a clock, which a client render path must never do.
 */
export function editedLabel(updatedAt: string, timeZone: string, now: Date): string {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return "—";
  const day = todayInTimezone(timeZone, new Date(t));
  const today = todayInTimezone(timeZone, now);
  if (day === today) return "today";
  const [y, m, d] = day.split("-").map(Number);
  const label = `${MONTHS[m - 1]} ${d}`;
  return y === Number(today.slice(0, 4)) ? label : `${label}, ${y}`;
}

type RpcError = { message?: string } | null;

/** The refusal key a plan function raised (before any ":detail"), or null. */
export function planErrorKey(error: RpcError): string | null {
  if (!error) return null;
  const m = /\b(not_authorized|plan_required|invalid_name|invalid_input|input_version|invalid_mode|plan_not_found|nothing_saved|invalid_arguments)\b/.exec(error.message ?? "");
  return m ? m[1] : "unknown";
}

export type WriteOutcome = { ok: true; id: string; updatedAt: string | null } | { ok: false; message: string };

/** create / copy / delete: success only on a committed reply that names a plan id. */
export function writeOutcome(data: unknown, error: RpcError): WriteOutcome {
  if (error) return { ok: false, message: planErrorMessage(planErrorKey(error) ?? "unknown") };
  const d = data as { committed?: unknown; id?: unknown; updated_at?: unknown } | null;
  if (!d || d.committed !== true || typeof d.id !== "string") return { ok: false, message: planErrorMessage("unknown") };
  return { ok: true, id: d.id, updatedAt: typeof d.updated_at === "string" ? d.updated_at : null };
}

export type SaveOutcome =
  | { kind: "saved"; updatedAt: string }
  | { kind: "stale"; updatedAt: string; byName: string | null }
  | { kind: "error"; message: string };

/** save_practice_plan's reply. A reply that is neither a save nor a stale answer is an error. */
export function saveOutcome(data: unknown, error: RpcError): SaveOutcome {
  if (error) return { kind: "error", message: planErrorMessage(planErrorKey(error) ?? "unknown") };
  const d = data as { committed?: unknown; status?: unknown; updated_at?: unknown; updated_by_name?: unknown } | null;
  if (d && d.committed === true && d.status === "saved" && typeof d.updated_at === "string") return { kind: "saved", updatedAt: d.updated_at };
  if (d && d.committed === false && d.status === "stale" && typeof d.updated_at === "string") {
    return { kind: "stale", updatedAt: d.updated_at, byName: typeof d.updated_by_name === "string" ? d.updated_by_name : null };
  }
  return { kind: "error", message: planErrorMessage("unknown") };
}

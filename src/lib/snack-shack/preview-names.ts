// The rebuild preview's NAMED sign-up lines (0131, Part B / B3): who loses
// their spot, who moves with a changed shift. Pure. The rows come from 0131's
// names-only read, which ONLY regenerate-preview-modal.tsx may call
// (sim:game-notes [O1-snack-names-only]); this file parses and words them. First
// initial + last name only — never an email.

import { fmtShiftRange } from "./shift-flags";
import type { RegeneratePlan } from "./regenerate-plan";
import { fmtDay, joinNames } from "./stale-days";

export type ShiftClaimName = { blockId: string; claimId: string; firstInitial: string; lastName: string };

/** The names-only read's reply → rows, or null when malformed.
 *  Only these four keys are read; anything else in the reply is ignored. */
export function parseShiftClaimNames(raw: unknown): ShiftClaimName[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ShiftClaimName[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    if (typeof r.block_id !== "string" || typeof r.claim_id !== "string"
        || typeof r.first_initial !== "string" || typeof r.last_name !== "string") return null;
    out.push({ blockId: r.block_id, claimId: r.claim_id, firstInitial: r.first_initial, lastName: r.last_name });
  }
  return out;
}

export function volunteerLabel(n: ShiftClaimName): string {
  return `${n.firstInitial.trim()}. ${n.lastName.trim()}`;
}

/** The block ids whose sign-ups the preview names: removed shifts (lost) and
 *  changed shifts (carried). */
export function previewBlockIds(plan: RegeneratePlan): { lost: string[]; carried: string[] } {
  return {
    lost: plan.dayChanges.flatMap((d) => d.removed.map((r) => r.id)),
    carried: plan.dayChanges.flatMap((d) => d.changed.map((c) => c.from.id)),
  };
}

export const COULDNT_READ_NAMES = "Couldn't read who signed up.";

/** The named sign-up lines. `withDate` adds the day to each shift (a
 *  full-season preview spans many days). Empty when nobody is affected. */
export function signupNameLines(plan: RegeneratePlan, names: ShiftClaimName[], withDate: boolean): { lost: string | null; carried: string | null } {
  const where = (date: string, start: string, end: string) =>
    withDate ? `${fmtDay(date)} ${fmtShiftRange(start, end)}` : fmtShiftRange(start, end);
  const byBlock = new Map<string, ShiftClaimName[]>();
  for (const n of names) {
    const l = byBlock.get(n.blockId);
    if (l) l.push(n);
    else byBlock.set(n.blockId, [n]);
  }
  const lostParts: string[] = [];
  for (const d of plan.dayChanges) {
    for (const r of d.removed) {
      for (const n of byBlock.get(r.id) ?? []) lostParts.push(`${volunteerLabel(n)} (${where(d.date, r.start_time, r.end_time)})`);
    }
  }
  const carriedNames: string[] = [];
  for (const d of plan.dayChanges) {
    for (const c of d.changed) {
      for (const n of byBlock.get(c.from.id) ?? []) carriedNames.push(volunteerLabel(n));
    }
  }
  const lost = lostParts.length === 0 ? null
    : lostParts.length === 1
      ? `${lostParts[0]} loses their spot when you confirm. They're emailed.`
      : `${joinNames(lostParts)} lose their spot when you confirm. Each is emailed.`;
  const carried = carriedNames.length === 0 ? null
    : carriedNames.length === 1
      ? `${carriedNames[0]} moves with their changed shift and is emailed the new hours.`
      : `${joinNames(carriedNames)} move with their changed shifts and are emailed the new hours.`;
  return { lost, carried };
}


// The reschedule picker's OWN guard: refuse an interleague game at open, and
// again at save. Decided 2026-09-28 — the guard lives in the PICKER, not in
// each surface. Per-surface routing is how four ungated render paths came to
// exist, and a ninth render site will appear eventually. Every surface still
// routes (that is where the admin gets an explanation); this is the backstop
// that makes a routing mistake fail loudly instead of moving another league's
// game.
//
// WHAT IT REFUSES
// - An interleague game, always. Its time is changed by a REQUEST to the
//   partner (the request modal), never by a direct write. Two live incidents
//   (2026-07-13/14, SRALL "Fall 2026") came from this picker moving interleague
//   games: one pending game bypassed the partner's agreement and was left
//   rendering "TBD" forever; one accepted game moved with no request and no
//   email.
// - A game whose status is not the one the variant expects: the RAINOUT
//   variant reschedules a CANCELLED game, the MOVE variant a SCHEDULED one.
//   The save writes `status: "scheduled"`, so a game reaching the wrong
//   variant (a completed game, say) would have its status silently rewritten.
//   Zero completed / in_progress / postponed games exist live; this is the one
//   status condition the picker owns, and it is acceptable ONLY because a
//   zero-row save reports an ERROR (saveOutcome), never success.
//
// AT SAVE the conditions go INTO the UPDATE's WHERE (`is("interleague_org_id",
// null)` + `eq("status", expected)`) and the row count comes back via
// `.select("id")`. Zero rows means the game changed under the admin — or a
// surface opened the picker on a game it should not have — and NOTHING was
// written; the admin is told so. A refused open never reaches save; the save
// condition is defence in depth.
//
// NOT IN SCOPE, recorded (decided 2026-09-28):
// - A codebase-wide status-clause sweep. Every write would need rows-affected
//   handling or it becomes a silent no-op — worse than the bug. Zero rows in
//   any of the statuses a sweep would protect exist live.
// - A database trigger. The only layer that covers direct RLS writes and the
//   eventual right answer; deferred because every legitimate status writer
//   (rainout, restore, the interleague routes, the token functions, the
//   generator) would need auditing against it first.
//
// Pure. `npm run sim:picker-guard` drives these exact functions and greps the
// picker for the two call sites.

import type { RescheduleVariant } from "@/lib/schedule/reschedule-variant";

export type PickerGameRow = {
  status: string;
  interleague_org_id: string | null;
  interleague_org?: { name: string } | null;
};

/** The status each variant is allowed to act on. */
export function expectedStatusFor(variant: RescheduleVariant): "cancelled" | "scheduled" {
  return variant === "rainout" ? "cancelled" : "scheduled";
}

const STATUS_WORD: Record<string, string> = {
  cancelled: "rained out",
  scheduled: "scheduled",
  completed: "completed",
  pending_interleague: "not yet agreed with the other league",
  reschedule_pending: "waiting on a reschedule request",
};

/**
 * Why the picker must not open for this game, or null to proceed.
 * `row` is null when the game could not be read — refuse (fail closed): a
 * picker that cannot tell what kind of game it has must not offer slots.
 */
export function pickerOpenRefusal(
  row: PickerGameRow | null,
  variant: RescheduleVariant,
): string | null {
  if (!row) {
    return "Couldn't confirm what kind of game this is, so no times are shown. Close and try again.";
  }
  if (row.interleague_org_id) {
    const org = row.interleague_org?.name ?? "the other league";
    const action = row.status === "cancelled" ? "Propose makeup time" : "Request reschedule";
    return `This is an interleague game with ${org}, so its time is changed by a request to them, not moved directly. Close this and use “${action}” instead.`;
  }
  const expected = expectedStatusFor(variant);
  if (row.status !== expected) {
    const is = STATUS_WORD[row.status] ?? row.status;
    return variant === "rainout"
      ? `This game is ${is}, not rained out, so there's nothing to recover. Close this and use “Reschedule” to move it.`
      : `This game is ${is}, not scheduled, so it can't be moved from here.`;
  }
  return null;
}

/** The WHERE conditions the save adds beyond `id` — both must be in the
 *  UPDATE, never checked client-side first. */
export function saveScope(variant: RescheduleVariant): {
  interleagueOrgIdIsNull: true;
  status: "cancelled" | "scheduled";
} {
  return { interleagueOrgIdIsNull: true, status: expectedStatusFor(variant) };
}

/** After the UPDATE: the error to show, or null on success. Zero rows is an
 *  ERROR — the conditions excluded the game, so nothing was written. */
export function saveOutcome(rowsAffected: number, variant: RescheduleVariant): string | null {
  if (rowsAffected > 0) return null;
  const expected = expectedStatusFor(variant) === "cancelled" ? "rained out" : "scheduled";
  return `Nothing was saved. This game changed since you opened this — it may no longer be ${expected}, or it is an interleague game, whose time is changed by a request. Close and try again.`;
}

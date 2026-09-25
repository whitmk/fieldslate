// What the reschedule picker's `variant` changes beyond the header.
//
// The picker (RainoutRescheduleModal) has two doors:
// - "rainout" — a rained-out game being put back on the schedule. Every
//   caller before 2026-09-25, and still the default.
// - "move" — the division panel's "Reschedule a game": a game that was NOT
//   rained out, moved by choice.
//
// MAKEUP DAYS ARE A RAINOUT CAPABILITY (decided 2026-09-25). A field's
// `makeup` flag means "a rained-out game may move here on this day"; a plain
// move is not a rainout, so the move variant clears every flag before the slot
// build — exactly what the interleague counter-proposal picker does, for the
// same reason, with the same `stripMakeup`. Rainout recovery keeps them.
// Everything else the picker does is identical for both variants: the same
// reads, the same builder, the same gates, the same save. The admin can still
// reach a non-playing day on a move through the "include non-playing days"
// override, which is not a makeup-flag decision.
//
// Pure, so `npm run sim:panel-reschedule` (part V) drives the exact functions
// the modal calls.

import type { VenueAvailability } from "@/lib/venues/availability";
import { stripMakeup } from "@/lib/schedule/interleague-resolve-picker";

export type RescheduleVariant = "rainout" | "move";

/** The venue availability the slot builder sees for this variant. */
export function availabilityForVariant(
  av: VenueAvailability,
  variant: RescheduleVariant,
): VenueAvailability {
  return variant === "move" ? stripMakeup(av) : av;
}

export type NoFieldCopy = {
  text: string;
  /** "config" = amber + a Venues link; "info" = grey, no link. */
  tone: "config" | "info";
  link: string | null;
};

/**
 * The sentence for an empty weekday whose reason is `no_field` — case (a).
 *
 * RAINOUT: byte-identical to the strings the modal rendered before this
 * function existed (pinned by literal assertions in the harness).
 *
 * MOVE: makeups are stripped, so "marked for makeups" / "Mark a field Makeup"
 * would name a lever that does nothing here. Two situations remain and they
 * read differently:
 * - a day the division does not play, override off → it just doesn't play
 *   (informational; nothing is misconfigured);
 * - otherwise (a playing day, or any day with the override on) → no field is
 *   open, with the same "Set field hours" link the override-on copy uses.
 */
export function noFieldCopy(p: {
  variant: RescheduleVariant;
  includeNonPlayingDays: boolean;
  playsThatDay: boolean;
  divisionName: string;
  /** " (3 dates)" when the weekday has several reasons, else "". */
  countSuffix: string;
}): NoFieldCopy {
  if (p.variant === "move") {
    if (!p.playsThatDay && !p.includeNonPlayingDays) {
      return {
        // Rendered after the weekday label ("Fridays — AA doesn't play that day.").
        text: `${p.divisionName} doesn't play that day${p.countSuffix}.`,
        tone: "info",
        link: null,
      };
    }
    return {
      text: `no field is open that day${p.countSuffix}.`,
      tone: "config",
      link: "Set field hours on the Venues page",
    };
  }
  return p.includeNonPlayingDays
    ? {
        text: `no field is open that day${p.countSuffix}.`,
        tone: "config",
        link: "Set field hours on the Venues page",
      }
    : {
        text: `no field is open and marked for makeups${p.countSuffix}.`,
        tone: "config",
        link: "Mark a field “Makeup” on the Venues page",
      };
}

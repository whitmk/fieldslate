// Home / Away on the public league schedule — the ONE place it is decided.
//
// A game is HOME when its field belongs to a park the league marked as its own
// (`locations.is_home_park`, 0105). Everything else is AWAY: a field in another
// league's park, a field in no park at all, and an interleague game at the
// partner's field (no venue of ours; the partner's typed field name instead).
// Nothing about the field TABLE says "ours" — an org's venues include the other
// leagues' fields it plays at — so the park flag is the only signal.
//
// The one exception is a game with NO field and not at a partner's field: it
// is "TBD", never Away, because Away claims a fact (another league's field) we
// do not have. Zero such games exist live (2026-10-08); the state exists so the
// page never asserts something it does not know.
//
// Color is never the only signal: every surface pairs the site with its text
// tag (siteTag) and a shape (solid vs outlined).

import type { PublicVenue } from "./types";

export type Site = "home" | "away" | "tbd";

export function siteOf(venue: PublicVenue, partnerField: boolean): Site {
  if (venue) return venue.home_park === true ? "home" : "away";
  return partnerField ? "away" : "tbd";
}

export const SITE_TAG: Record<Site, string> = {
  home: "Home",
  away: "Away",
  tbd: "Field TBD",
};

export type StatusDisplay = {
  /** Struck through and greyed: the game is not being played on this date. */
  struck: boolean;
  /** The tag that replaces Home/Away on a struck game, or a note beside it. */
  label: string | null;
  /** True when the label is a note shown beside the site tag. */
  note: boolean;
};

/** Regular games. `cancelled` is written only by the rainout flow, so it reads
 *  "Rained out". A status this table does not know renders as a normal game —
 *  the reader already decided it may be shown. */
export function gameStatusDisplay(status: string): StatusDisplay {
  switch (status) {
    case "cancelled":
      return { struck: true, label: "Rained out", note: false };
    case "postponed":
      return { struck: true, label: "Postponed", note: false };
    case "reschedule_pending":
      return { struck: false, label: "Time may change", note: true };
    default:
      return { struck: false, label: null, note: false };
  }
}

/** Playoff games. Nothing in the product writes a cancelled playoff game, so
 *  it is not assumed to be weather. */
export function playoffStatusDisplay(status: string): StatusDisplay {
  if (status === "cancelled") return { struck: true, label: "Cancelled", note: false };
  return { struck: false, label: null, note: false };
}

// The Schedule page's Location filter (`?location=`) — the tier above the
// venue filter. "Who is playing at Monroe on Saturday?" without selecting each
// of Monroe's fields one at a time.
//
// It MIRRORS the venue filter rather than adding a mechanism: URL-param driven,
// a server-side DB filter on the ONE shared games query, and options derived
// from venues that actually carry a game this season (no dead options). Every
// view mode — list, calendar, week-by-field, print — reads that one query, so
// all of them honour it.
//
// Pure except `fetchLocationVenueIds`. `npm run sim:location-filter` drives
// these exact functions; the page has no second implementation.
//
// SCOPE DECISIONS (approved 2026-09-24):
// - Venues with no location are OUT OF SCOPE BY DESIGN. They never produce a
//   location option, there is no "Unassigned" option, and a specific location
//   excludes them. Interleague away games (venue_id null) fall out too — the
//   same way they do under a specific venue.
// - Location → venue cascades like division → team: the dropdown clears
//   `?venue=` on change, and the server drops a venue outside the selected
//   location (the `effectiveTeamId` pattern).
// - Stale-season params are NOT reconciled here. A `?location=` carried across
//   a season switch still filters while its dropdown reads "All locations" —
//   the same known defect as `?division=` / `?venue=` (CLAUDE.md, "Schedule
//   filters"). That fix belongs to all three params together, separately.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type VenueOption = {
  id: string;
  name: string;
  location: { id: string; name: string } | null;
};

export type LocationOption = { id: string; name: string };

/**
 * Location options: one per distinct location among the season's venue
 * options, sorted by name. A venue with no location contributes nothing.
 */
export function locationOptionsFromVenues(
  venues: VenueOption[],
): LocationOption[] {
  const byId = new Map<string, LocationOption>();
  for (const v of venues) {
    if (v.location && !byId.has(v.location.id)) {
      byId.set(v.location.id, { id: v.location.id, name: v.location.name });
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/**
 * The Venue dropdown's options under a location: only that location's venues.
 * No location selected → every option, unchanged.
 */
export function venueOptionsForLocation(
  venues: VenueOption[],
  selectedLocationId: string,
): VenueOption[] {
  if (!selectedLocationId) return venues;
  return venues.filter((v) => v.location?.id === selectedLocationId);
}

/**
 * The venue the query should actually filter on. Under a location, a venue
 * outside it is dropped ("" = all of the location's venues) rather than ANDed
 * into an always-empty result — the `effectiveTeamId` pattern.
 *
 * `locationVenueIds` is null when no location is selected; then the venue
 * passes through untouched (stale-season reconciliation is out of scope, see
 * the header).
 */
export function effectiveVenueForLocation(
  selectedVenueId: string,
  locationVenueIds: string[] | null,
): string {
  if (!selectedVenueId) return "";
  if (locationVenueIds === null) return selectedVenueId;
  return locationVenueIds.includes(selectedVenueId) ? selectedVenueId : "";
}

export type VenueScope = {
  /** Effective venue id ("" = none). */
  venueId: string;
  /** The selected location's venue ids, or null when no location is selected. */
  locationVenueIds: string[] | null;
};

/** Same sentinel the page's team scope uses for "matches nothing". */
const NO_VENUE_SENTINEL = "00000000-0000-0000-0000-000000000000";

type ScopableQuery<Q> = {
  eq(column: string, value: string): Q;
  in(column: string, values: string[]): Q;
};

/**
 * Applies the venue and location filters to the shared games query. ANDs with
 * whatever division/team scope is already on it. A location with no venues
 * (only reachable via a stale or hand-typed param) matches nothing rather than
 * silently widening to every game.
 */
export function applyVenueScope<Q extends ScopableQuery<Q>>(
  q: Q,
  scope: VenueScope,
): Q {
  let out = q;
  if (scope.locationVenueIds !== null) {
    out = out.in(
      "venue_id",
      scope.locationVenueIds.length > 0
        ? scope.locationVenueIds
        : [NO_VENUE_SENTINEL],
    );
  }
  if (scope.venueId) {
    out = out.eq("venue_id", scope.venueId);
  }
  return out;
}

/**
 * Week-by-field row narrowing. The games are already filtered, but the grid
 * ALSO shows eligible fields with no games as empty rows — so without this, a
 * Monroe-only view lists Westside's fields as empty rows, which reads as "free
 * this week". Same reason the venue filter narrows them.
 */
export function narrowWeekVenues<T extends { venueId: string }>(
  rows: T[],
  scope: VenueScope,
): T[] {
  let out = rows;
  if (scope.locationVenueIds !== null) {
    const ids = new Set(scope.locationVenueIds);
    out = out.filter((r) => ids.has(r.venueId));
  }
  if (scope.venueId) {
    out = out.filter((r) => r.venueId === scope.venueId);
  }
  return out;
}

/**
 * The selected location's venue ids, read from `venues` directly — NOT from the
 * dropdown options (that read is unpaginated, so a venue lost to truncation
 * there would silently drop its games from this filter) and NOT via an
 * `!inner` venue embed (that would change the shared query's embed for every
 * view mode).
 *
 * FAILS LOUD: throws on a read error so the page shows its schedule error
 * instead of an empty list. Deliberately not `fetchAllRows`: the result is
 * bounded by the fields in ONE park, nowhere near PostgREST's 1000-row cap.
 */
export async function fetchLocationVenueIds(
  supabase: SupabaseClient<Database>,
  orgId: string,
  locationId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("id")
    .eq("owner_id", orgId)
    .eq("location_id", locationId);
  if (error) {
    throw new Error(`Could not read the location's fields: ${error.message}`);
  }
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

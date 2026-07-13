// Shared seasons-fetch predicates.
//
// The default for operational pages (Schedule, Practices, Teams, Divisions,
// Playoffs, Snack Shack, Umpires, Interleague) is "active only" — admins
// doing work shouldn't be selecting an archived season by accident. Reports
// / Overview / Export get the full set and surface an explicit toggle or
// "[Archived]" suffix so the archived rows aren't silent.
//
// We expose the filter as a chainable function rather than wrapping the
// whole query, so callers keep Supabase's row-type inference from their own
// `.select("...")` clause. Usage:
//
//   const { data } = await activeLeaguesOnly(
//     supabase.from("leagues").select("id, name").eq("owner_id", currentOrgId)
//   ).order("name");
//
// Single source of truth for the predicate column name — when the schema
// shifts, every operational page picks up the change here.

// Loose generic so the filter chains onto any Supabase query builder
// (PostgrestFilterBuilder, PostgrestTransformBuilder, etc.) without
// dropping the caller's row type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IsFilter<T> = T & { is: (column: string, value: any) => T };

/** Restrict a leagues query to non-archived rows. Chainable. */
export function activeLeaguesOnly<T>(query: IsFilter<T>): T {
  return query.is("archived_at", null);
}

/**
 * In-memory counterpart of activeLeaguesOnly for already-fetched league rows.
 * Keyed on `archived_at` (the archive source of truth — never the legacy
 * `status` column). "Not archived" deliberately includes draft/upcoming
 * seasons: the Overview/Reports "All seasons" rollup means exactly this.
 */
export function nonArchivedLeagues<T extends { archived_at: string | null }>(
  leagues: T[],
): T[] {
  return leagues.filter((l) => !l.archived_at);
}

// Shared season-selection resolution. Used by the Overview dashboard and the
// Reports route, which both honor the same `?season=` URL param. Kept in one
// place so the two pages resolve the default/selected season identically.
//
// Priority: URL param (explicit page-level override, including "all") →
// the topbar's global selection (pass getCurrentSeasonId()'s result as
// `globalSeasonId`) → most-recent-active fallback. The local selector on
// these pages only ever writes the URL param — never the global cookie;
// the topbar switcher is the only cookie writer.

type SeasonRow = {
  id: string;
  status: string;
  archived_at: string | null;
};

export function resolveSelectedSeasonId(
  param: string | undefined,
  leagues: SeasonRow[],
  globalSeasonId?: string | null,
): string {
  if (param === "all") return "all";
  if (param && leagues.some((l) => l.id === param)) return param;
  // No explicit param: follow the global switcher when its season is one of
  // this org's (getCurrentSeasonId already validates, but re-checking here
  // keeps this function safe for any caller).
  if (globalSeasonId && leagues.some((l) => l.id === globalSeasonId)) {
    return globalSeasonId;
  }
  // Fallback: most recently created NON-ARCHIVED active season; never auto-
  // select an archived season (the admin has to opt in via Show archived +
  // explicit pick). Fall back to any non-archived season, then to "all".
  const mostRecentActive = leagues.find(
    (l) => l.status === "active" && !l.archived_at,
  );
  if (mostRecentActive) return mostRecentActive.id;
  const firstNonArchived = leagues.find((l) => !l.archived_at);
  if (firstNonArchived) return firstNonArchived.id;
  return "all";
}

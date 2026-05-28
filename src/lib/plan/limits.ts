// Single source of truth for tier limits.
//
// `-1` means unlimited. Use `isUnlimited()` rather than comparing to -1
// inline so the convention is searchable. The DB enforces these
// independently (see migration 0052 for the admin cap); keep the two
// in sync if any limit changes here.
//
// Note on `teamsPerOrg`: this is an org-total count (across all
// divisions), not per-division. For Free this is identical to
// per-division since Free is capped to 1 division, but the org-total
// shape is future-proof against grandfathered downgrades.

export type Plan = "free" | "pro" | "elite";

export const PLAN_LIMITS = {
  free: {
    divisions: 1,
    teamsPerOrg: 6,
    activeSeasons: 1,
    admins: 1,
    interleagueOrgsPerSeason: 0,
  },
  pro: {
    divisions: -1,
    teamsPerOrg: -1,
    activeSeasons: -1,
    admins: 2,
    interleagueOrgsPerSeason: 5,
  },
  elite: {
    divisions: -1,
    teamsPerOrg: -1,
    activeSeasons: -1,
    admins: 5,
    interleagueOrgsPerSeason: -1,
  },
} as const;

export const isUnlimited = (limit: number) => limit === -1;

export function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "pro" || value === "elite";
}

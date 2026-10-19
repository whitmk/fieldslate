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
    // Seasons are the unit of sale. Free gets one active season at a time;
    // for a paid league every season is paid for (0111: create_league needs a
    // season credit, and "New season" goes to checkout via NewSeasonFlow).
    // This number is only the Free cap and the Seasons-page counter.
    activeSeasons: 1,
    admins: 2,
    interleagueOrgsPerSeason: 5,
  },
  elite: {
    divisions: -1,
    teamsPerOrg: -1,
    // See the Pro note above.
    activeSeasons: 1,
    admins: 5,
    interleagueOrgsPerSeason: -1,
  },
} as const;

export const isUnlimited = (limit: number) => limit === -1;

// True for any paid tier (Pro or Elite). Pro+ feature gates use this rather
// than an inline `plan !== "free"` so the intent is searchable and Elite is
// never accidentally excluded — never gate a Pro+ feature with
// `plan === "pro"`, which would lock Elite users out.
export const isProPlus = (plan: Plan): boolean => plan !== "free";

// True only for the top tier. Elite-only feature gates use this (parallel to
// isProPlus). Both Free AND Pro are denied — gate with `!isElite(plan)`, never
// with `plan === "free"` (which would let Pro in).
export const isElite = (plan: Plan): boolean => plan === "elite";

export function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "pro" || value === "elite";
}

// What an ELITE league loses by moving to Pro, beyond the PLAN_LIMITS numbers.
// One entry per Elite-only gate; `gates` are the exact `feature` labels the
// screens pass to FeatureLockedCard / UpgradeModal with tier="Elite", and
// `lose` is how the "what you lose" line names it. sim:season-purchase fails
// when an Elite gate in src is missing here, so the line can't drift from
// the code. Order is the order the line reads.
export const ELITE_FEATURES: ReadonlyArray<{ gates: readonly string[]; lose: string }> = [
  { gates: ["Playoff brackets"], lose: "playoff brackets" },
  { gates: ["Officials"], lose: "officials" },
  { gates: ["Snack Shack"], lose: "snack shack" },
  { gates: ["Reports"], lose: "reports" },
  { gates: ["Team scheduling constraints"], lose: "team scheduling constraints" },
  {
    gates: ["Browsing & restoring archived seasons", "Restoring archived seasons"],
    lose: "browsing and restoring archived seasons",
  },
];

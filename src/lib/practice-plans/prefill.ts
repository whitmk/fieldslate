// "New plan" starts from the league's divisions and team counts — of the
// MOST RECENT SEASON THAT HAS AT LEAST ONE TEAM. PURE: the screen reads the
// rows (every division of the org with its season and live team count) and
// hands them here.
//
// The season: latest start_date, seasons without a start date after every
// dated one, then the newest created, then the id (so the pick is
// deterministic). Archived seasons count. A season whose divisions hold no
// team is skipped — a season created early for next year must not prefill
// every count as 0.
//
// Team counts are live `teams` rows. Never teams.practices_per_week, never
// divisions.team_count (a wizard value nothing maintains).

import { NEW_DIVISION } from "@/lib/practice-planner/example-league";
import { INPUT_LIMITS } from "./plan-input";
import type { PlanDivision, PlanInput } from "./load";

/** One division of the org, with its season and its live team count. */
export type PrefillRow = {
  seasonId: string;
  seasonName: string;
  /** "YYYY-MM-DD" or null. */
  seasonStart: string | null;
  /** ISO timestamp. */
  seasonCreatedAt: string;
  seasonArchivedAt: string | null;
  divisionId: string;
  divisionName: string;
  divisionCreatedAt: string;
  teamCount: number;
};

export type Prefill = {
  season: { id: string; name: string } | null;
  /** The season's divisions, oldest first; each count as read. */
  divisions: { name: string; teams: number }[];
};

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** Negative when season a should be picked before season b. */
function seasonOrder(a: PrefillRow, b: PrefillRow): number {
  if (a.seasonStart !== b.seasonStart) {
    if (a.seasonStart === null) return 1;
    if (b.seasonStart === null) return -1;
    return a.seasonStart < b.seasonStart ? 1 : -1;
  }
  const c = time(b.seasonCreatedAt) - time(a.seasonCreatedAt);
  if (c !== 0) return c;
  return a.seasonId < b.seasonId ? 1 : a.seasonId > b.seasonId ? -1 : 0;
}

export function pickPrefill(rows: PrefillRow[]): Prefill {
  const withTeams = new Set(rows.filter((r) => r.teamCount > 0).map((r) => r.seasonId));
  const candidates = rows.filter((r) => withTeams.has(r.seasonId)).sort(seasonOrder);
  if (!candidates.length) return { season: null, divisions: [] };
  const pick = candidates[0];
  const divisions = rows
    .filter((r) => r.seasonId === pick.seasonId)
    .sort((a, b) => time(a.divisionCreatedAt) - time(b.divisionCreatedAt) || (a.divisionId < b.divisionId ? -1 : a.divisionId > b.divisionId ? 1 : 0))
    .map((r) => ({ name: r.divisionName, teams: r.teamCount }));
  return { season: { id: pick.seasonId, name: pick.seasonName }, divisions };
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The "6 in Fall 2026" hint for a division name: its count in the prefill
 * season, matched lowercased and trimmed. Null when there is no prefill
 * season, no match, or the season has two divisions with that name (never a
 * guess).
 */
export function teamHint(prefill: Prefill, name: string): { count: number; seasonName: string } | null {
  if (!prefill.season) return null;
  const matches = prefill.divisions.filter((d) => norm(d.name) === norm(name));
  if (matches.length !== 1) return null;
  return { count: matches[0].teams, seasonName: prefill.season.name };
}

/** Code points, as Postgres counts characters. */
const cut = (s: string, max: number) => Array.from(s).slice(0, max).join("");

/** What newPlanInput had to change to fit a plan's limits — shown, never silent. */
export type PrefillAdjustments = {
  /** Divisions left out past the plan's limit. */
  dropped: number;
  /** Names cut to the limit. */
  shortened: number;
  /** Team counts lowered to the limit. */
  capped: number;
};

/**
 * A new plan's input: no dates yet, one row per prefilled division with the
 * calculator's NEW_DIVISION defaults for everything but the name and team
 * count. Kept inside INPUT_LIMITS (the limits 0117 checks) so the first save
 * can't be refused, and every change made to fit is counted in
 * `adjustments` for the planner's note (prefillAdjustedLine).
 */
export function newPlanInput(prefill: Prefill): { input: PlanInput; adjustments: PrefillAdjustments } {
  const L = INPUT_LIMITS;
  const kept = prefill.divisions.slice(0, L.divisions.max);
  const adjustments: PrefillAdjustments = { dropped: prefill.divisions.length - kept.length, shortened: 0, capped: 0 };
  const divisions: PlanDivision[] = kept.map((d, i) => {
    const name = cut(d.name, L.divisionName.maxChars);
    if (name !== d.name) adjustments.shortened++;
    const count = Math.max(0, Math.trunc(d.teams));
    const teams = Math.min(count, L.teams.max);
    if (teams !== count) adjustments.capped++;
    return { ...NEW_DIVISION, days: [...NEW_DIVISION.days], name, teams, id: `d${i + 1}` };
  });
  return { input: { seasonStart: "", seasonEnd: "", minutesBetween: 0, divisions }, adjustments };
}

// Playoff seeding — which teams are IN a bracket, in which order, and which
// were left out. PURE: no Supabase, no React. The wizard's Seeding step only
// calls these and renders their sentences VERBATIM; generate-bracket.ts plans
// from `planSeeds`. Harness: `npm run sim:playoff-exclude` (+ `:mutants`).
//
// THE RULES
// - An excluded team is left out of THIS bracket only. Nothing here touches
//   the team, its games or any other bracket; the team simply isn't handed to
//   the planner, so it can never appear in a playoff game, and seeding, byes
//   and "Winner of Game N" are all computed from the included teams alone.
// - `seeding` (saved on the playoffs row) holds the INCLUDED teams only, in
//   seed order. Exclusion is not stored separately: an existing bracket's
//   excluded teams are the division's teams that aren't in its seeding.
//   Consequence, accepted: a team added to the division after the bracket was
//   set up shows under "Not in this bracket" in Edit setup, with Add back.
// - At least MIN_BRACKET_TEAMS stay included; Remove is refused below that.
// - Removing keeps everyone else's order (each team below moves up a seed).
//   Add back puts the team at the BOTTOM of the seed order.

import { bracketSizeFor, DOUBLE_ELIM_SUPPORTED_COUNTS } from "./bracket-plan";
import type { PlayoffFormat, SeededTeam } from "@/components/playoffs/playoff-wizard-types";

export const MIN_BRACKET_TEAMS = 2;

export type SeedingState = {
  /** In the bracket, index 0 = seed 1. */
  included: SeededTeam[];
  /** Left out of this bracket, by name. */
  excluded: SeededTeam[];
};

function byName(a: SeededTeam, b: SeededTeam): number {
  return a.team_name < b.team_name ? -1 : a.team_name > b.team_name ? 1 : a.team_id < b.team_id ? -1 : 1;
}

/**
 * The Seeding step's starting state from the division's teams (as loaded) and
 * the wizard's saved seeding. No seeding yet (a new bracket) → every team in,
 * in the order given. Otherwise the seeding stands as saved, and every
 * division team not in it is excluded.
 */
export function reconcileSeeding(divisionTeams: SeededTeam[], seeding: SeededTeam[]): SeedingState {
  if (seeding.length === 0) {
    return { included: [...divisionTeams], excluded: [] };
  }
  const seeded = new Set(seeding.map((s) => s.team_id));
  return {
    included: [...seeding],
    excluded: divisionTeams.filter((t) => !seeded.has(t.team_id)).sort(byName),
  };
}

export function canExclude(state: SeedingState): boolean {
  return state.included.length > MIN_BRACKET_TEAMS;
}

/** Shown beside a disabled Remove. */
export const MIN_TEAMS_LINE = `A bracket needs at least ${MIN_BRACKET_TEAMS} teams.`;

/** Removes a team from the bracket. Refused (state unchanged) when only the
 *  minimum is left or the team isn't included. */
export function excludeTeam(state: SeedingState, teamId: string): SeedingState {
  if (!canExclude(state)) return state;
  const team = state.included.find((t) => t.team_id === teamId);
  if (!team) return state;
  return {
    included: state.included.filter((t) => t.team_id !== teamId),
    excluded: [...state.excluded, team].sort(byName),
  };
}

/** Puts an excluded team back, as the lowest seed. */
export function addTeamBack(state: SeedingState, teamId: string): SeedingState {
  const team = state.excluded.find((t) => t.team_id === teamId);
  if (!team) return state;
  return {
    included: [...state.included, team],
    excluded: state.excluded.filter((t) => t.team_id !== teamId),
  };
}

/**
 * The seeds the planner gets: the saved seeding, minus anything also marked
 * excluded (a defence against a stale seeding list — an excluded team must
 * never reach a game).
 */
export function planSeeds(seeding: SeededTeam[], excluded: SeededTeam[]): SeededTeam[] {
  const out = new Set(excluded.map((t) => t.team_id));
  return seeding.filter((t) => !out.has(t.team_id));
}

/** Round-1 byes in a single-elimination bracket of `count` teams. */
export function singleElimByes(count: number): number {
  return count < MIN_BRACKET_TEAMS ? 0 : bracketSizeFor(count) - count;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The line under the seed list: how many teams are in and what that means
 *  for the bracket. */
export function bracketSummaryLine(format: PlayoffFormat, count: number): string {
  const teams = `${plural(count, "team", "teams")} in this bracket`;
  if (format === "single_elimination") {
    const byes = singleElimByes(count);
    if (byes === 0) return teams;
    return `${teams} · ${plural(byes, "bye", "byes")} in round 1 (${byes === 1 ? "seed 1" : `seeds 1–${byes}`})`;
  }
  if (format === "round_robin") {
    return `${teams} · ${plural((count * (count - 1)) / 2, "game", "games")}`;
  }
  return teams;
}

/** Why this format can't be built with `count` teams, or null. The Seeding
 *  step shows it at the list; generate refuses with the same sentence. */
export function teamCountProblem(format: PlayoffFormat, count: number): string | null {
  if (count < MIN_BRACKET_TEAMS) return "Need at least 2 teams to generate a bracket.";
  if (format === "double_elimination" && !DOUBLE_ELIM_SUPPORTED_COUNTS.includes(count)) {
    return (
      `Double elimination needs exactly 2, 4, 8, 16, or 32 teams — this bracket has ${count}. ` +
      `Remove or add back teams, or pick a different format (bye rounds aren't supported for double elimination yet).`
    );
  }
  return null;
}

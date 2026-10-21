// A bracket's rounds in play order, and which one is its championship —
// lifted verbatim out of bracket-view.tsx (2026-10-20) so the public bracket
// page orders and crowns rounds by the SAME rule as the Playoffs page. Pure.
import { isFinalRound } from "@/lib/playoffs/series-names";
import type { SeriesRow } from "@/lib/playoffs/series-names";

const ROUND_ORDER: Record<string, number> = {
  "WB-R1": 10, "WB-R2": 11, "WB-R3": 12, "WB-R4": 13,
  "WB-F": 20,
  "LB-R1": 30, "LB-R2": 31, "LB-R3": 32, "LB-R4": 33,
  "LB-R5": 34, "LB-R6": 35, "LB-R7": 36, "LB-R8": 37,
  "LB-F": 40,
  "GF": 50, "GF-R": 51,
};

export function getRoundOrder(round: string): number {
  if (round in ROUND_ORDER) return ROUND_ORDER[round];
  const m = round.match(/^(RR|R|SF|F)(\d*)/);
  if (!m) return 99;
  if (m[1] === "F") return 50;
  if (m[1] === "SF") return 40;
  return parseInt(m[2] || "0");
}

const CHAMPIONSHIP_ROUNDS = new Set(["F", "GF"]);

/** The games grouped by round, rounds in play order. */
export function sortedRounds<G extends { round: string }>(games: ReadonlyArray<G>): [string, G[]][] {
  const roundMap = new Map<string, G[]>();
  for (const g of games) {
    if (!roundMap.has(g.round)) roundMap.set(g.round, []);
    roundMap.get(g.round)!.push(g);
  }
  return [...roundMap.entries()].sort(([a], [b]) => getRoundOrder(a) - getRoundOrder(b));
}

/** The last round is the championship for SE/DE formats. A single
 *  elimination's last round is its Final whatever it is stored as (a 2-team
 *  bracket's only round is "R1"). Null when there is none. */
export function championshipRoundOf<G extends SeriesRow>(rounds: [string, G[]][], games: ReadonlyArray<G>): string | null {
  const lastRound = rounds[rounds.length - 1]?.[0] ?? null;
  return CHAMPIONSHIP_ROUNDS.has(lastRound ?? "") || (lastRound !== null && isFinalRound(lastRound, games)) ? lastRound : null;
}

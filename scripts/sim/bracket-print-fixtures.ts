// Fixture brackets for the printable bracket: the REAL generator's output
// (buildSingleElimination / buildRoundRobin / buildDoubleElimination) with
// team names, dates, times and fields attached. Shared by
// bracket-print-sim.ts (assertions) and bracket-print-render.ts (proof PDFs).
//
// The 11-team bracket is the live SRALL Fall 2026 Majors SHAPE (11 seeds, 5
// byes: round-1 games 2, 6, 8; game 10 is a round-2 game whose two teams both
// arrived by bye), with its dates/times/field pattern. Team names are
// placeholders of realistic length — no league data is copied here.
import {
  buildDoubleElimination,
  buildRoundRobin,
  buildSingleElimination,
} from "../../src/lib/playoffs/bracket-plan";
import type { PrintGame } from "../../src/lib/playoffs/bracket-print";

const IDS = { playoffId: "p", leagueId: "l", divisionId: "d" };
const NO_SLOTS = { pick: () => null, skippedForOrder: () => 0 };

export function teamName(seed: number): string {
  const towns = ["EMLL", "SLL", "SRALL", "WSLL", "RVLL", "RPCR"];
  const clubs = ["Nationals", "Giants", "Guardians", "Rays", "Phillies", "Angels", "Athletics", "Mariners", "Royals", "Dodgers", "Cubs", "Padres", "Mets", "Twins", "Brewers", "Reds"];
  return `${towns[seed % towns.length]} ${clubs[(seed - 1) % clubs.length]} - Majors`;
}

type When = { date: string; time: string; venue: string } | null;

function attach(
  rows: { round: string; game_number: number; home_team_id: string | null; away_team_id: string | null }[],
  when: (round: string, gameNumber: number, idx: number) => When,
): PrintGame[] {
  return rows.map((g, i) => {
    const w = when(g.round, g.game_number, i);
    return {
      id: `g${g.game_number}`,
      round: g.round,
      game_number: g.game_number,
      home_team_id: g.home_team_id,
      away_team_id: g.away_team_id,
      home_team_name: g.home_team_id ? teamName(Number(g.home_team_id.slice(1))) : null,
      away_team_name: g.away_team_id ? teamName(Number(g.away_team_id.slice(1))) : null,
      winner_id: null,
      status: "scheduled",
      home_score: null,
      away_score: null,
      scheduled_date: w?.date ?? null,
      start_time: w?.time ?? null,
      venue_name: w?.venue ?? null,
    };
  });
}

function seeds(n: number) {
  return Array.from({ length: n }, (_, i) => ({ team_id: `t${i + 1}`, team_name: teamName(i + 1) }));
}

/** Single elimination for n teams; dates on the first `datedGames` games in
 *  number order (the live Majors pattern: one game a night at 5:15 PM). */
export function singleElim(n: number, datedGames: number, venue = "Polley Field @ Ives Park (SLL)"): PrintGame[] {
  const rows = buildSingleElimination(seeds(n), IDS, NO_SLOTS);
  const order = [...rows].sort((a, b) => a.game_number - b.game_number).map((g) => g.game_number);
  return attach(rows, (_r, num) => {
    const k = order.indexOf(num);
    if (k < 0 || k >= datedGames) return null;
    const day = 26 + k;
    const date = day <= 31 ? `2026-10-${day}` : `2026-11-${String(day - 31).padStart(2, "0")}`;
    return { date, time: "17:15:00", venue };
  });
}

export function roundRobin(n: number): PrintGame[] {
  const rows = buildRoundRobin(seeds(n), IDS, NO_SLOTS);
  return attach(rows, (_r, _num, i) => (i < 4 ? { date: `2026-11-0${i + 1}`, time: "10:45:00", venue: "Andrews" } : null));
}

export function doubleElim(n: number): PrintGame[] {
  const rows = buildDoubleElimination(seeds(n), IDS, NO_SLOTS);
  return attach(rows, (_r, _num, i) => (i < 2 ? { date: "2026-11-07", time: "10:45:00", venue: "Andrews" } : null));
}

/** A played 4-team bracket: game 1 won by seed 1 and advanced; the final is
 *  an unplayed game with one empty slot — the trophy rule's fixture. */
export function playedFour(): PrintGame[] {
  const g = singleElim(4, 3, "Andrews");
  const g1 = g.find((x) => x.game_number === 1)!;
  g1.status = "completed"; g1.home_score = 5; g1.away_score = 2; g1.winner_id = g1.home_team_id;
  const f = g.find((x) => x.game_number === 3)!;
  f.home_team_id = g1.home_team_id; f.home_team_name = g1.home_team_name;
  return g;
}

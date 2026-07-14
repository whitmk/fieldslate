// Pure double-elimination advancement mapping — no Supabase import, so a
// plain node script (or future test) can drive it against generated brackets.
//
// The mapping is derived from the bracket buildDoubleElimination emits for
// bracketSize = 2^m (team counts must be exact powers of two — the generator
// silently drops bye teams otherwise):
//
//   WB-R1 (bracketSize/2 games) … WB-R(m-1), WB-F     — m rounds
//     (m = 1, a 2-team bracket, has only WB-R1 and no WB-F)
//   LB-R1 … LB-R(2(m-1)-1), LB-F                      — 2(m-1) rounds
//   GF, GF-R
//
// Movement rules (indices are a game's position within its round, ordered by
// game_number):
//   WB-R1        winner → next WB round game ⌊i/2⌋, slot by i%2
//                loser  → LB-R1 game ⌊i/2⌋, slot by i%2 (losers pair up)
//   WB-Rk (k≥2)  winner → next WB round game ⌊i/2⌋, slot by i%2
//                loser  → LB-R(2(k-1)) away slot, index REVERSED to avoid
//                         immediate rematches (home slot is the LB survivor)
//   WB-F         winner → GF home (the undefeated side)
//   LB odd  j    winner → LB-R(j+1) game i, home slot
//   LB even j    winner → LB-R(j+1) game ⌊i/2⌋, slot by i%2
//   LB-F         winner → GF away
//   GF           home (WB side) wins → bracket over, GF-R stays a TBD row
//                away (LB side) wins → GF-R gets both teams (bracket reset)
//   2-team (m=1) WB-R1 winner → GF home, loser → GF away; GF/GF-R as above
//
// Edit semantics: re-saving a result recomputes the same deterministic slots,
// overwriting any stale occupants — but only while every downstream target is
// unplayed. If a target already has a winner, the whole save is blocked so an
// edit can never corrupt a played game.

export interface GameRow {
  id: string;
  round: string;
  game_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  winner_id: string | null;
}

export type SlotField = "home_team_id" | "away_team_id";

export type SlotWrite = { gameId: string; round: string; field: SlotField; teamId: string | null };

export type DoubleElimAdvancement = { blocked: string } | { writes: SlotWrite[] };

// ─── Round order (shared with enter-result / mirrors bracket-view) ───────────

export const ROUND_ORDER: Record<string, number> = {
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

// ─── Advancement ──────────────────────────────────────────────────────────────

export function computeDoubleElimAdvancement(
  game: GameRow,
  winnerId: string,
  allGames: GameRow[],
): DoubleElimAdvancement {
  const rounds = new Map<string, GameRow[]>();
  for (const g of allGames) {
    if (!rounds.has(g.round)) rounds.set(g.round, []);
    rounds.get(g.round)!.push(g);
  }
  for (const gs of rounds.values()) gs.sort((a, b) => a.game_number - b.game_number);

  const byOrder = (a: string, b: string) => getRoundOrder(a) - getRoundOrder(b);
  const wbRounds = [...rounds.keys()].filter((r) => r.startsWith("WB-")).sort(byOrder);
  const lbRounds = [...rounds.keys()].filter((r) => r.startsWith("LB-")).sort(byOrder);
  const gf = rounds.get("GF")?.[0];
  const gfReset = rounds.get("GF-R")?.[0];

  const loserId = winnerId === game.home_team_id ? game.away_team_id : game.home_team_id;
  const writes: SlotWrite[] = [];
  const push = (target: GameRow | undefined, field: SlotField, teamId: string | null) => {
    if (target) writes.push({ gameId: target.id, round: target.round, field, teamId });
  };

  if (game.round === "GF-R") return { writes: [] };

  if (game.round === "GF") {
    if (gfReset) {
      if (winnerId === game.home_team_id) {
        // WB sweep — the bracket is decided; GF-R stays a TBD row (clear any
        // stale slots from a previously-entered LB win).
        push(gfReset, "home_team_id", null);
        push(gfReset, "away_team_id", null);
      } else {
        // LB side won — bracket reset, same two teams play GF-R.
        push(gfReset, "home_team_id", game.home_team_id);
        push(gfReset, "away_team_id", game.away_team_id);
      }
    }
    return checkBlocked(writes, rounds) ?? { writes };
  }

  const slotByParity = (i: number): SlotField =>
    i % 2 === 0 ? "home_team_id" : "away_team_id";

  const wbIdx = wbRounds.indexOf(game.round);
  if (wbIdx !== -1) {
    const i = rounds.get(game.round)!.findIndex((g) => g.id === game.id);

    // Winner up the winners bracket, or into GF from the last WB round.
    if (wbIdx === wbRounds.length - 1) {
      push(gf, "home_team_id", winnerId);
    } else {
      const next = rounds.get(wbRounds[wbIdx + 1])!;
      push(next[Math.floor(i / 2)], slotByParity(i), winnerId);
    }

    // Loser down into the losers bracket.
    if (wbRounds.length === 1) {
      // 2-team bracket: no LB — the loser gets its second chance in GF.
      push(gf, "away_team_id", loserId);
    } else if (wbIdx === 0) {
      const lb1 = rounds.get(lbRounds[0])!;
      push(lb1[Math.floor(i / 2)], slotByParity(i), loserId);
    } else {
      // WB-R(k≥2) loser → even LB round 2(k-1), away slot, reversed index.
      const lbGames = rounds.get(lbRounds[2 * wbIdx - 1])!;
      push(lbGames[lbGames.length - 1 - i], "away_team_id", loserId);
    }
    return checkBlocked(writes, rounds) ?? { writes };
  }

  const lbIdx = lbRounds.indexOf(game.round);
  if (lbIdx !== -1) {
    const i = rounds.get(game.round)!.findIndex((g) => g.id === game.id);
    if (lbIdx === lbRounds.length - 1) {
      push(gf, "away_team_id", winnerId);
    } else {
      const next = rounds.get(lbRounds[lbIdx + 1])!;
      const j = lbIdx + 1; // 1-based LB round number
      if (j % 2 === 1) push(next[i], "home_team_id", winnerId);
      else push(next[Math.floor(i / 2)], slotByParity(i), winnerId);
    }
    // LB loser is eliminated — no write.
    return checkBlocked(writes, rounds) ?? { writes };
  }

  // Unknown round label — nothing to advance.
  return { writes: [] };
}

/** A write into a game that already has a result would corrupt it — block. */
function checkBlocked(
  writes: SlotWrite[],
  rounds: Map<string, GameRow[]>,
): { blocked: string } | null {
  const byId = new Map<string, GameRow>();
  for (const gs of rounds.values()) for (const g of gs) byId.set(g.id, g);
  for (const w of writes) {
    if (byId.get(w.gameId)?.winner_id) {
      return {
        blocked: `A later game (${w.round}) already has a result. Clear that result before editing this one.`,
      };
    }
  }
  return null;
}

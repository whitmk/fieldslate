// Playoff bracket generator harness — drives the REAL planner
// (src/lib/playoffs/bracket-plan.ts), the REAL single-elimination advancement
// (src/lib/playoffs/advancement.ts) and the manual-edit decisions
// (src/lib/playoffs/edit-game.ts). Run: `npm run sim:playoff-bracket`;
// mutants: `npm run sim:playoff-bracket:mutants`.
//
// WHAT WENT WRONG (SRALL Fall 2026, 50/70, generated 2026-10-05) and the part
// that pins each fix:
//   A  BYES. Six teams in an eight-slot bracket: seeds 1 and 2 were never
//      written anywhere and both round-1 winners were sent into one
//      semifinal. Now bye teams are pre-placed into round 2 in standard
//      bracket order (1 plays the 4/5 winner, 2 plays the 3/6 winner).
//   B  ADVANCEMENT by bracket position (game_number), not by index in the
//      round's compacted list — a full playthrough for 5, 6, 7 and 8 teams
//      under two winner policies, every write checked for target and slot.
//   C  SPACING from the division's duration + buffer (180 + 30), not the
//      hardcoded 105; a window close means the game must END by it.
//   D  MULTI-DATE spreading and round order: rounds consume one chronological
//      slot list; a later round never starts before the earlier round's games
//      end (+ buffer); never wraps back to the first slot.
//   E  NOT ENOUGH SLOTS → the game is saved TBD and the warning says why
//      (how many slots, how many needed, how many were skipped for order).
//   F  CLOSED DAY warning: a chosen weekday on which no selected field is
//      open is named, with the field; a too-short day is told apart from it.
//   G  The Dates step's default is the division's own days and windows.
//   H  Manual edit decisions: zero rows is an error, conflicts never gate.
//   S  Source wiring (weak by nature, stated): the I/O wrapper calls the
//      planner, the review step pre-flights and renders warnings verbatim,
//      the bracket view mounts the edit modal, the modal checks rows affected.
//
// ANTI-VACUITY counters (a zero fails the run): a bye team pre-placed, a
// later-round slot holding TWO pre-placed teams (5 teams), advancement writes
// applied, a LOWER seed advanced (so slot-by-position is not slot-by-seed), a
// TBD game produced, a slot skipped for round order, a closed day and a
// too-short day diagnosed, a round placed on a later DATE than the previous
// round, and a later round placed later the SAME day.
//
// ── MUTATION LOG (2026-10-05) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST.
// See playoff-bracket-mutants.ts for the list and the result.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bracketSizeFor,
  buildSingleElimination,
  buildSlotGrid,
  makeSlotPicker,
  planBracket,
  planSettingsFromDivision,
  playoffDefaultsFromDivision,
  singleElimFirstNumber,
  singleElimRoundSize,
  standardSeedOrder,
  type BracketIds,
  type GameInsert,
  type PlanSettings,
  type PlanVenue,
  type SlotGridInput,
} from "../../src/lib/playoffs/bracket-plan";
import {
  computeSingleElimAdvancement,
  getRoundOrder,
  type GameRow,
} from "../../src/lib/playoffs/advancement";
import {
  parseManualDateTime,
  playoffEditConflicts,
  playoffEditOutcome,
  playoffEditSaveEnabled,
} from "../../src/lib/playoffs/edit-game";
import { parseAvailability } from "../../src/lib/venues/availability";
import { DEFAULT_PLAYOFF_DATA, type SeededTeam } from "../../src/components/playoffs/playoff-wizard-types";

const ROOT = join(__dirname, "../..");
const failures: string[] = [];
let checks = 0;
function ok(cond: boolean, tag: string, label: string, detail = "") {
  checks++;
  if (cond) console.log(`  ok: [${tag}] ${label}`);
  else {
    failures.push(`[${tag}] ${label}`);
    console.error(`  FAIL: [${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try { fn(); } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    failures.push(`[CRASH-${name}] ${msg}`);
    console.error(`  FAIL: [CRASH-${name}] ${msg}`);
  }
}
const counters = {
  byeTeamsPrePlaced: 0,
  prePlacedBothSlots: 0,
  advancementWrites: 0,
  lowerSeedAdvanced: 0,
  tbdGames: 0,
  orderSkips: 0,
  closedDays: 0,
  tooShortDays: 0,
  laterDateRound: 0,
  sameDayLaterRound: 0,
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const IDS: BracketIds = { playoffId: "p1", leagueId: "l1", divisionId: "d1" };
const SRALL: PlanSettings = { durationMin: 180, bufferMin: 30, durationDefaulted: false, bufferDefaulted: false };

function seeds(n: number): SeededTeam[] {
  return Array.from({ length: n }, (_, i) => ({ team_id: `t${i + 1}`, team_name: `Seed ${i + 1}` }));
}
const seedOf = (teamId: string | null) => (teamId ? Number(teamId.slice(1)) : null);

/** A field open every day 08:00–22:00 (never the constraint). */
function openVenue(id: string, name = id): PlanVenue {
  const av: Record<string, { start: string; end: string }> = {};
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) av[d] = { start: "08:00", end: "22:00" };
  return { id, name, availability: parseAvailability(av) };
}
/** SRALL's real field: open Saturdays only, 09:00–22:00. */
function cclaVenue(): PlanVenue {
  return {
    id: "ccla", name: "50/70 @ CCLA (WSLL)",
    availability: parseAvailability({ Sa: { start: "09:00", end: "22:00", practice: true } }),
  };
}

/** Ten Saturdays, four slots each — more than any bracket here needs. */
function plentifulGrid(): SlotGridInput {
  return {
    startDate: "2026-11-07", endDate: "2027-01-09",
    playingDays: ["Sa"], dayWindows: { Sa: { start: "09:00", end: "21:00" } },
    venues: [openVenue("v1"), openVenue("v2")],
    durationMin: 90, bufferMin: 30,
  };
}

type Built = { games: GameInsert[]; B: number };
function buildSE(n: number, grid: SlotGridInput = plentifulGrid(), settings = { durationMin: grid.durationMin, bufferMin: grid.bufferMin }): Built {
  const { slots } = buildSlotGrid(grid);
  const games = buildSingleElimination(seeds(n), IDS, makeSlotPicker(slots, settings));
  return { games, B: bracketSizeFor(n) };
}
const roundIdxOf = (games: GameInsert[], round: string) =>
  [...new Set(games.map((g) => g.round))].sort((a, b) => getRoundOrder(a) - getRoundOrder(b)).indexOf(round);
const posOf = (g: GameInsert, B: number, games: GameInsert[]) =>
  g.game_number - singleElimFirstNumber(roundIdxOf(games, g.round), B);
const pair = (g: GameInsert) => `${seedOf(g.home_team_id)}v${seedOf(g.away_team_id)}`;

// ─── A: bracket structure and byes ───────────────────────────────────────────

section("A: structure and byes for 5, 6, 7 and 8 teams", () => {
  for (const n of [5, 6, 7, 8]) {
    const { games, B } = buildSE(n);
    ok(games.length === n - 1, "A1", `n=${n}: ${n - 1} games in a single-elimination bracket`, `got ${games.length}`);

    // Every team appears exactly once across round-1 games and pre-placed
    // later-round slots. The old builder dropped bye teams entirely.
    const seen = new Map<string, number>();
    for (const g of games) for (const t of [g.home_team_id, g.away_team_id]) if (t) seen.set(t, (seen.get(t) ?? 0) + 1);
    ok(
      seen.size === n && [...seen.values()].every((c) => c === 1),
      "A2", `n=${n}: every team is in the bracket exactly once`,
      `seen ${JSON.stringify([...seen.entries()])}`,
    );

    // Seeds 1 and 2 in opposite halves: their round-1 position (or the range
    // their pre-placed slot covers) lies in different halves of round 1.
    const r1Range = (teamId: string): [number, number] => {
      for (const g of games) {
        if (g.home_team_id !== teamId && g.away_team_id !== teamId) continue;
        const r = roundIdxOf(games, g.round);
        const p = posOf(g, B, games);
        const span = Math.pow(2, r);
        return [p * span, (p + 1) * span - 1];
      }
      return [-1, -1];
    };
    const half = B / 4;
    const [a0, a1] = r1Range("t1");
    const [b0, b1] = r1Range("t2");
    ok(
      a0 >= 0 && a1 < half && b0 >= half && b1 < B / 2,
      "A3", `n=${n}: seeds 1 and 2 are in opposite halves`,
      `seed1 r1 positions ${a0}-${a1}, seed2 ${b0}-${b1}, half=${half}`,
    );

    for (const g of games) {
      if (roundIdxOf(games, g.round) > 0 && (g.home_team_id || g.away_team_id)) counters.byeTeamsPrePlaced++;
      if (roundIdxOf(games, g.round) > 0 && g.home_team_id && g.away_team_id) counters.prePlacedBothSlots++;
    }
  }

  // Exact layouts the request named.
  {
    const { games, B } = buildSE(6);
    const r1 = games.filter((g) => g.round === "R1");
    ok(r1.map(pair).sort().join(" ") === "3v6 4v5", "A4", "n=6: round 1 is 4v5 and 3v6", r1.map(pair).join(" "));
    const sf = games.filter((g) => g.round === "SF").sort((a, b) => a.game_number - b.game_number);
    ok(
      sf.length === 2 && seedOf(sf[0].home_team_id) === 1 && sf[0].away_team_id === null &&
        seedOf(sf[1].home_team_id) === 2 && sf[1].away_team_id === null,
      "A4", "n=6: seed 1 waits in SF game 1, seed 2 in SF game 2",
      sf.map(pair).join(" "),
    );
    ok(
      r1.map((g) => g.game_number).sort().join(",") === "2,4" && sf.map((g) => g.game_number).join(",") === "5,6" &&
        games.find((g) => g.round === "F")?.game_number === 7,
      "A4", "n=6: positional game numbers (round-1 bye pairs leave 1 and 3 unused)",
      games.map((g) => `${g.round}#${g.game_number}`).join(" "),
    );
    ok(posOf(r1.find((g) => pair(g) === "4v5")!, B, games) === 1 && posOf(r1.find((g) => pair(g) === "3v6")!, B, games) === 3,
      "A4", "n=6: 4v5 is position 1 (seed 1's half), 3v6 is position 3 (seed 2's half)");
  }
  {
    const { games } = buildSE(5);
    const r1 = games.filter((g) => g.round === "R1");
    const sf = games.filter((g) => g.round === "SF").sort((a, b) => a.game_number - b.game_number);
    ok(r1.map(pair).join(" ") === "4v5", "A5", "n=5: the only round-1 game is 4v5", r1.map(pair).join(" "));
    ok(seedOf(sf[0].home_team_id) === 1 && sf[0].away_team_id === null, "A5", "n=5: seed 1 waits for the 4/5 winner");
    ok(seedOf(sf[1].home_team_id) === 2 && seedOf(sf[1].away_team_id) === 3, "A5", "n=5: seeds 2 and 3 meet directly in the other semifinal", pair(sf[1]));
  }
  {
    const { games } = buildSE(7);
    const r1 = games.filter((g) => g.round === "R1");
    ok(r1.map(pair).sort().join(" ") === "2v7 3v6 4v5", "A6", "n=7: round 1 is 4v5, 2v7, 3v6", r1.map(pair).join(" "));
    const sf0 = games.filter((g) => g.round === "SF").sort((a, b) => a.game_number - b.game_number)[0];
    ok(seedOf(sf0.home_team_id) === 1 && sf0.away_team_id === null, "A6", "n=7: only seed 1 has a bye");
  }
  {
    const { games } = buildSE(8);
    const r1 = games.filter((g) => g.round === "R1").sort((a, b) => a.game_number - b.game_number);
    ok(r1.map(pair).join(" ") === "1v8 4v5 2v7 3v6", "A7", "n=8: round 1 is 1v8, 4v5, 2v7, 3v6 in order", r1.map(pair).join(" "));
    ok(games.filter((g) => g.round !== "R1").every((g) => !g.home_team_id && !g.away_team_id), "A7", "n=8: no byes, later rounds all TBD");
    ok(r1.map((g) => g.game_number).join(",") === "1,2,3,4", "A7", "n=8: no gaps in round-1 numbering");
  }

  // The literal helper output, AFTER the structural checks so a layout mutant
  // dies at the property it breaks ([A3]) rather than at this transcription.
  ok(JSON.stringify(standardSeedOrder(8)) === "[1,8,4,5,2,7,3,6]", "A8", "standardSeedOrder(8) is 1,8,4,5,2,7,3,6");
  ok(JSON.stringify(standardSeedOrder(4)) === "[1,4,2,3]", "A8", "standardSeedOrder(4) is 1,4,2,3");
});

// ─── B: advancement by bracket position ──────────────────────────────────────

type Policy = "higher" | "lower";
function playThrough(n: number, policy: Policy, tagPrefix: string) {
  const { games: built, B } = buildSE(n);
  const rows: GameRow[] = built.map((g, i) => ({
    id: `g${i}`, round: g.round, game_number: g.game_number,
    home_team_id: g.home_team_id, away_team_id: g.away_team_id, winner_id: null,
  }));
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => getRoundOrder(a) - getRoundOrder(b));
  for (let ri = 0; ri < rounds.length; ri++) {
    const roundRows = rows.filter((r) => r.round === rounds[ri]).sort((a, b) => a.game_number - b.game_number);
    for (const g of roundRows) {
      ok(!!g.home_team_id && !!g.away_team_id, tagPrefix, `n=${n} ${policy}: ${g.round}#${g.game_number} has both teams when its turn comes`, `${g.home_team_id} v ${g.away_team_id}`);
      if (!g.home_team_id || !g.away_team_id) return;
      const hs = seedOf(g.home_team_id)!, as = seedOf(g.away_team_id)!;
      const winner = (policy === "higher" ? hs < as : hs > as) ? g.home_team_id : g.away_team_id;
      if (seedOf(winner)! > Math.min(hs, as)) counters.lowerSeedAdvanced++;
      const adv = computeSingleElimAdvancement(g, winner, rows);
      if ("blocked" in adv) { ok(false, tagPrefix, `n=${n}: advancement blocked unexpectedly`, adv.blocked); return; }
      if (ri === rounds.length - 1) {
        ok(adv.writes.length === 0, "B3", `n=${n} ${policy}: the final advances nowhere`);
      } else {
        const pos = g.game_number - singleElimFirstNumber(ri, B);
        const expectNumber = singleElimFirstNumber(ri + 1, B) + Math.floor(pos / 2);
        const expectField = pos % 2 === 0 ? "home_team_id" : "away_team_id";
        const w = adv.writes[0];
        const target = rows.find((r) => r.id === w?.gameId);
        ok(
          adv.writes.length === 1 && !!target && target.game_number === expectNumber && w.field === expectField && w.teamId === winner,
          "B1", `n=${n} ${policy}: ${g.round}#${g.game_number} (pos ${pos}) winner goes to game #${expectNumber} ${expectField}`,
          `wrote ${JSON.stringify(adv.writes)}`,
        );
        ok(!!target && target[expectField] === null, "B2", `n=${n} ${policy}: that slot was empty (a pre-placed bye team is never overwritten)`, `held ${target?.[expectField]}`);
        if (target) { target[expectField] = winner; counters.advancementWrites++; }
      }
      g.winner_id = winner;
    }
  }
  const final = rows.find((r) => r.round === rounds[rounds.length - 1])!;
  ok(!!final.winner_id, "B3", `n=${n} ${policy}: the bracket completes with a champion`);
  return { rows, final };
}

section("B: advancement playthroughs", () => {
  for (const n of [5, 6, 7, 8]) {
    const hi = playThrough(n, "higher", "B0");
    ok(seedOf(hi!.final.home_team_id) === 1 && seedOf(hi!.final.away_team_id) === 2 && seedOf(hi!.final.winner_id) === 1,
      "B4", `n=${n}: with favourites winning, the final is 1 vs 2 and seed 1 is champion`, `${pair(hi!.final as unknown as GameInsert)}`);
    playThrough(n, "lower", "B0");
  }
  // n=6, the request's wording: the 4/5 winner plays seed 1, the 3/6 winner plays seed 2.
  {
    const { games: built } = buildSE(6);
    const rows: GameRow[] = built.map((g, i) => ({ id: `g${i}`, round: g.round, game_number: g.game_number, home_team_id: g.home_team_id, away_team_id: g.away_team_id, winner_id: null }));
    const g45 = rows.find((r) => r.round === "R1" && seedOf(r.home_team_id) === 4)!;
    const g36 = rows.find((r) => r.round === "R1" && seedOf(r.home_team_id) === 3)!;
    const a = computeSingleElimAdvancement(g45, "t5", rows);
    const b = computeSingleElimAdvancement(g36, "t6", rows);
    const sf = rows.filter((r) => r.round === "SF").sort((x, y) => x.game_number - y.game_number);
    ok("writes" in a && a.writes[0]?.gameId === sf[0].id && a.writes[0]?.field === "away_team_id", "B5", "n=6: the 4/5 winner goes to seed 1's semifinal (away)", JSON.stringify(a));
    ok("writes" in b && b.writes[0]?.gameId === sf[1].id && b.writes[0]?.field === "away_team_id", "B5", "n=6: the 3/6 winner goes to seed 2's semifinal (away)", JSON.stringify(b));
  }
  // Legacy brackets (generated before positional numbering) still advance.
  {
    const rows: GameRow[] = [
      { id: "a", round: "R1", game_number: 1, home_team_id: "t1", away_team_id: "t4", winner_id: null },
      { id: "b", round: "R1", game_number: 2, home_team_id: "t2", away_team_id: "t3", winner_id: null },
      { id: "f", round: "F", game_number: 3, home_team_id: null, away_team_id: null, winner_id: null },
    ];
    const a = computeSingleElimAdvancement(rows[0], "t1", rows);
    const b = computeSingleElimAdvancement(rows[1], "t3", rows);
    ok("writes" in a && a.writes[0]?.gameId === "f" && a.writes[0].field === "home_team_id" &&
       "writes" in b && b.writes[0]?.gameId === "f" && b.writes[0].field === "away_team_id",
      "B6", "legacy 4-team bracket (compact numbering) advances exactly as before");
    const legacyBye: GameRow[] = [
      { id: "a", round: "R1", game_number: 1, home_team_id: "t2", away_team_id: "t3", winner_id: null },
      { id: "f", round: "F", game_number: 2, home_team_id: null, away_team_id: null, winner_id: null },
    ];
    const c = computeSingleElimAdvancement(legacyBye[0], "t2", legacyBye);
    ok("writes" in c && c.writes.length === 1 && c.writes[0].gameId === "f", "B6", "legacy bye bracket falls back to row order instead of crashing", JSON.stringify(c));
  }
});

// ─── C: spacing from division settings; END-by windows ───────────────────────

section("C: spacing and window semantics", () => {
  const grid: SlotGridInput = {
    startDate: "2026-11-07", endDate: "2026-11-07",
    playingDays: ["Sa"], dayWindows: { Sa: { start: "09:00", end: "17:00" } },
    venues: [cclaVenue()], durationMin: 180, bufferMin: 30,
  };
  const { slots } = buildSlotGrid(grid);
  ok(slots[1]?.time === "12:30", "C1", "the second start is duration + buffer after the first (9:00 → 12:30, not 10:45)", slots.map((s) => s.time).join(","));
  ok(!slots.some((s) => s.time === "16:00") && slots.length === 2, "C2", "a start whose game would end after the 17:00 window is not offered (no 16:00)", slots.map((s) => s.time).join(","));

  const shortField: PlanVenue = { id: "f", name: "Short", availability: parseAvailability({ Sa: { start: "09:00", end: "13:00" } }) };
  const g2 = buildSlotGrid({ ...grid, venues: [shortField] });
  ok(g2.slots.map((s) => s.time).join(",") === "09:00", "C3", "a field closing at 13:00 takes only the 9:00 game (12:30 would end 15:30)", g2.slots.map((s) => s.time).join(","));

  const s1 = planSettingsFromDivision({ game_duration: 180, buffer_minutes: 30 });
  ok(s1.durationMin === 180 && s1.bufferMin === 30 && !s1.durationDefaulted && !s1.bufferDefaulted, "C4", "division 180/30 is read as 180/30");
  const s2 = planSettingsFromDivision({});
  ok(s2.durationMin === 90 && s2.bufferMin === 15 && s2.durationDefaulted && s2.bufferDefaulted, "C4", "missing settings default to 90/15 AND say so");
  const s3 = planSettingsFromDivision({ game_duration: "abc", buffer_minutes: -5 });
  ok(s3.durationDefaulted && s3.bufferDefaulted, "C4", "garbage settings are defaulted and flagged");

  const g3 = buildSlotGrid({ ...grid, venues: [openVenue("o")], durationMin: 60, bufferMin: 0, dayWindows: { Sa: { start: "09:00", end: "12:00" } } });
  ok(g3.slots.map((s) => s.time).join(",") === "09:00,10:00,11:00", "C5", "60 + 0 steps hourly and the 11:00 game ends exactly at close", g3.slots.map((s) => s.time).join(","));
});

// ─── D: multi-date spreading and round order ─────────────────────────────────

const later = (a: { date: string; min: number }, b: { date: string; min: number }) =>
  a.date > b.date || (a.date === b.date && a.min >= b.min);
const minsOf = (t: string | null) => { const [h, m] = (t ?? "00:00").split(":").map(Number); return h * 60 + m; };

function checkRoundOrder(games: GameInsert[], settings: { durationMin: number; bufferMin: number }, tag: string, label: string) {
  const rounds = [...new Set(games.map((g) => g.round))].sort((a, b) => getRoundOrder(a) - getRoundOrder(b));
  let good = true;
  let detail = "";
  for (let i = 1; i < rounds.length; i++) {
    const prev = games.filter((g) => g.round === rounds[i - 1] && g.scheduled_date);
    const cur = games.filter((g) => g.round === rounds[i] && g.scheduled_date);
    if (!prev.length || !cur.length) continue;
    const prevEnd = prev.reduce((acc, g) => {
      const e = { date: g.scheduled_date!, min: minsOf(g.start_time) + settings.durationMin + settings.bufferMin };
      return later(e, acc) ? e : acc;
    }, { date: "", min: 0 });
    for (const g of cur) {
      const s = { date: g.scheduled_date!, min: minsOf(g.start_time) };
      if (!later(s, prevEnd)) { good = false; detail = `${g.round} at ${g.scheduled_date} ${g.start_time} but ${rounds[i - 1]} ends ${prevEnd.date} ${prevEnd.min}`; }
      if (s.date > prevEnd.date) counters.laterDateRound++;
      else if (s.date === prevEnd.date) counters.sameDayLaterRound++;
    }
  }
  ok(good, tag, label, detail);
}
function checkNoDoubleBooking(games: GameInsert[], tag: string) {
  const keys = games.filter((g) => g.scheduled_date).map((g) => `${g.scheduled_date} ${g.start_time} ${g.venue_id}`);
  ok(new Set(keys).size === keys.length, tag, "no two games share a date, time and field", keys.join(" | "));
}

section("D: multi-date spreading and round order", () => {
  // SRALL's exact shape, widened to three Saturdays: one field, closed Fridays.
  const grid: SlotGridInput = {
    startDate: "2026-11-06", endDate: "2026-11-21",
    playingDays: ["Sa", "Fr"],
    dayWindows: { Fr: { start: "17:00", end: "21:00" }, Sa: { start: "09:00", end: "17:00" } },
    venues: [cclaVenue()], durationMin: 180, bufferMin: 30,
  };
  const plan = planBracket({ format: "single_elimination", seeds: seeds(6), ids: IDS, grid, settings: SRALL, divisionName: "50/70" });
  const by = (round: string) => plan.games.filter((g) => g.round === round).sort((a, b) => a.game_number - b.game_number);
  ok(by("R1").map((g) => `${g.scheduled_date} ${g.start_time}`).join(" | ") === "2026-11-07 09:00 | 2026-11-07 12:30",
    "D0", "round 1 fills the first Saturday", by("R1").map((g) => `${g.scheduled_date} ${g.start_time}`).join(" | "));
  ok(by("SF").every((g) => g.scheduled_date === "2026-11-14"), "D1", "the semifinals move to the NEXT Saturday, not back onto round 1's day",
    by("SF").map((g) => `${g.scheduled_date} ${g.start_time}`).join(" | "));
  ok(by("F")[0]?.scheduled_date === "2026-11-21" && by("F")[0]?.start_time === "09:00", "D2", "the final lands on the third Saturday at 9:00",
    `${by("F")[0]?.scheduled_date} ${by("F")[0]?.start_time}`);
  checkRoundOrder(plan.games, SRALL, "D3", "no round starts before the previous round's games have ended");
  checkNoDoubleBooking(plan.games, "D4");
  ok(plan.tbdCount === 0 && plan.skippedForOrder === 0, "D5", "all five games placed, nothing skipped", `tbd=${plan.tbdCount} skipped=${plan.skippedForOrder}`);

  // Same-day round order with two fields: 8 teams, 90 + 30 → round 1 at 9:00
  // and 11:00 on both fields (ends 12:30), SF from 13:00, F from 15:00.
  const twoFields: SlotGridInput = {
    startDate: "2026-11-07", endDate: "2026-11-07", playingDays: ["Sa"],
    dayWindows: { Sa: { start: "09:00", end: "21:00" } },
    venues: [openVenue("v1"), openVenue("v2")], durationMin: 90, bufferMin: 30,
  };
  const p2 = planBracket({ format: "single_elimination", seeds: seeds(8), ids: IDS, grid: twoFields, settings: { ...SRALL, durationMin: 90, bufferMin: 30 }, divisionName: "X" });
  const sf2 = p2.games.filter((g) => g.round === "SF");
  ok(sf2.every((g) => g.start_time === "13:00") && p2.games.find((g) => g.round === "F")?.start_time === "15:00",
    "D6", "two fields, one day: SF at 13:00 on both fields, F at 15:00", p2.games.map((g) => `${g.round} ${g.start_time} ${g.venue_id}`).join(" | "));
  checkRoundOrder(p2.games, { durationMin: 90, bufferMin: 30 }, "D6", "two-field day keeps round order");

  // THREE fields: the next sequential slot (11:00 on field 2) is BEFORE round
  // 1's last game (11:00 on field 1) ends — it must be skipped, not used.
  const threeFields = { ...twoFields, venues: [openVenue("v1"), openVenue("v2"), openVenue("v3")] };
  const p3 = planBracket({ format: "single_elimination", seeds: seeds(8), ids: IDS, grid: threeFields, settings: { ...SRALL, durationMin: 90, bufferMin: 30 }, divisionName: "X" });
  const sf3 = p3.games.filter((g) => g.round === "SF");
  ok(sf3.every((g) => g.start_time === "13:00"), "D7", "three fields: the semifinals wait until 13:00 even though 11:00 slots were free on fields 2 and 3",
    p3.games.map((g) => `${g.round} ${g.start_time} ${g.venue_id}`).join(" | "));
  // Two 11:00 slots skipped before the SF, then the 13:00 slot on field 3
  // skipped before the F (it starts before the SFs end at 14:30 + 30).
  ok(p3.skippedForOrder === 3, "D8", "the slots skipped for round order are counted (two before the SF, one before the F)", `skipped=${p3.skippedForOrder}`);
  counters.orderSkips += p3.skippedForOrder;
  checkRoundOrder(p3.games, { durationMin: 90, bufferMin: 30 }, "D7", "three-field day keeps round order");
  checkNoDoubleBooking(p3.games, "D4");
});

// ─── E: not enough slots → TBD, with the reason ──────────────────────────────

section("E: not enough slots", () => {
  const oneSaturday: SlotGridInput = {
    startDate: "2026-11-06", endDate: "2026-11-07", playingDays: ["Sa", "Fr"],
    dayWindows: { Fr: { start: "17:00", end: "21:00" }, Sa: { start: "09:00", end: "17:00" } },
    venues: [cclaVenue()], durationMin: 180, bufferMin: 30,
  };
  const plan = planBracket({ format: "single_elimination", seeds: seeds(6), ids: IDS, grid: oneSaturday, settings: SRALL, divisionName: "50/70" });
  const tbd = plan.games.filter((g) => !g.scheduled_date);
  ok(plan.games.length === 5 && plan.tbdCount === 3 && tbd.every((g) => g.round !== "R1" && !g.start_time && !g.venue_id),
    "E1", "two slots for five games: round 1 is placed, the three later games are TBD (nothing is reused)",
    plan.games.map((g) => `${g.round} ${g.scheduled_date ?? "TBD"} ${g.start_time ?? ""}`).join(" | "));
  checkNoDoubleBooking(plan.games, "E1");
  counters.tbdGames += plan.tbdCount;
  const w = plan.warnings.find((x) => x.includes("could not be placed"));
  ok(!!w && w.includes("3 of 5 games") && w.includes("give 2 slots") && w.includes("needs 5") && w.includes("TBD"),
    "E2", "the warning says how many games, how many slots, and that they are saved TBD", w ?? "(none)");

  // Slots existed but fell before the earlier round had finished.
  const grid3: SlotGridInput = {
    startDate: "2026-11-07", endDate: "2026-11-07", playingDays: ["Sa"],
    dayWindows: { Sa: { start: "09:00", end: "17:00" } },
    venues: [openVenue("v1"), openVenue("v2"), openVenue("v3")], durationMin: 180, bufferMin: 30,
  };
  const p3 = planBracket({ format: "single_elimination", seeds: seeds(8), ids: IDS, grid: grid3, settings: SRALL, divisionName: "X" });
  ok(p3.slots.length === 6 && p3.tbdCount === 3 && p3.skippedForOrder === 2, "E3", "six slots, seven games: round 1 takes four, two 12:30 slots are skipped for order, three games are TBD",
    `slots=${p3.slots.length} tbd=${p3.tbdCount} skipped=${p3.skippedForOrder}`);
  const w3 = p3.warnings.find((x) => x.includes("could not be placed"));
  ok(!!w3 && w3.includes("2 slots were skipped because they fell before an earlier round's games had finished"),
    "E3", "the warning explains the skipped slots", w3 ?? "(none)");
  counters.orderSkips += p3.skippedForOrder;
  counters.tbdGames += p3.tbdCount;
});

// ─── F: closed-day and too-short warnings ────────────────────────────────────

section("F: closed-day warning", () => {
  const grid: SlotGridInput = {
    startDate: "2026-11-06", endDate: "2026-11-14", playingDays: ["Sa", "Fr"],
    dayWindows: { Fr: { start: "17:00", end: "21:00" }, Sa: { start: "09:00", end: "17:00" } },
    venues: [cclaVenue()], durationMin: 180, bufferMin: 30,
  };
  const plan = planBracket({ format: "single_elimination", seeds: seeds(6), ids: IDS, grid, settings: SRALL, divisionName: "50/70" });
  const fridays = plan.days.filter((d) => d.day === "Fr");
  ok(fridays.length === 2 && fridays.every((d) => d.kind === "closed"), "F1", "both Fridays are diagnosed CLOSED (the only field is closed Fridays)", JSON.stringify(fridays));
  counters.closedDays += fridays.filter((d) => d.kind === "closed").length;
  const w = plan.warnings.find((x) => x.includes("closed on Fridays"));
  ok(!!w && w.includes("50/70 @ CCLA (WSLL)") && w.includes("Fri, Nov 6") && w.includes("Fri, Nov 13") && w.includes("no games were placed"),
    "F1", "the closed-day warning names the dates, the weekday and the field", w ?? "(none)");
  ok(plan.days.filter((d) => d.day === "Sa").every((d) => d.kind === "ok"), "F3", "Saturdays are fine and get no warning");
  ok(!plan.warnings.some((x) => x.includes("Saturdays")), "F3", "no warning mentions Saturdays");

  const shortGrid: SlotGridInput = {
    ...grid, startDate: "2026-11-07", endDate: "2026-11-07", playingDays: ["Sa"],
    venues: [{ id: "s", name: "Short Field", availability: parseAvailability({ Sa: { start: "09:00", end: "11:00" } }) }],
  };
  const p2 = planBracket({ format: "single_elimination", seeds: seeds(4), ids: IDS, grid: shortGrid, settings: SRALL, divisionName: "50/70" });
  ok(p2.days[0]?.kind === "too_short", "F2", "a field open two hours for a three-hour game is TOO SHORT, not closed", JSON.stringify(p2.days));
  counters.tooShortDays += p2.days.filter((d) => d.kind === "too_short").length;
  const w2 = p2.warnings.find((x) => x.includes("no 180-minute game fits"));
  ok(!!w2 && w2.includes("Short Field") && w2.includes("is open, but"), "F2", "the too-short warning says the field IS open and the game does not fit", w2 ?? "(none)");

  // Availability unknown (read failed) passes through: Friday is not refused.
  const unknown: SlotGridInput = { ...grid, venues: [{ id: "u", name: "Unknown", availability: null }] };
  const p4 = buildSlotGrid(unknown);
  ok(p4.days.every((d) => d.kind === "ok") && p4.slots.some((s) => s.date === "2026-11-06"), "F4", "a venue whose hours could not be read passes through unfiltered");
});

// ─── G: Dates-step defaults from the division ────────────────────────────────

section("G: division day-window defaults", () => {
  const srall5070 = {
    day_windows: { Sa: { end: "19:00", start: "10:00" }, Su: { end: "17:00", start: "09:00" } },
    playing_days: ["Sa"], game_duration: 180, buffer_minutes: 30,
  };
  const d = playoffDefaultsFromDivision(srall5070, DEFAULT_PLAYOFF_DATA);
  ok(JSON.stringify(d.playing_days) === '["Sa"]', "G1", "a Saturday-only division starts the playoff on Saturdays only", JSON.stringify(d.playing_days));
  ok(JSON.stringify(d.day_windows) === '{"Sa":{"start":"10:00","end":"19:00"}}', "G1", "its Saturday window is the division's, and the Sunday orphan is dropped", JSON.stringify(d.day_windows));
  const e = playoffDefaultsFromDivision(null, DEFAULT_PLAYOFF_DATA);
  ok(JSON.stringify(e.playing_days) === JSON.stringify(DEFAULT_PLAYOFF_DATA.playing_days) && JSON.stringify(e.day_windows) === JSON.stringify(DEFAULT_PLAYOFF_DATA.day_windows),
    "G2", "no settings → the wizard's own defaults");
  const f = playoffDefaultsFromDivision({ playing_days: ["We", "bogus"], day_windows: { We: { start: "17:00", end: "16:00" } } }, DEFAULT_PLAYOFF_DATA);
  ok(JSON.stringify(f.playing_days) === '["We"]' && f.day_windows.We?.start === "09:00" && f.day_windows.We?.end === "17:00",
    "G3", "an invalid window falls back to 9–5 for that day; an unknown day code is dropped", JSON.stringify(f));
});

// ─── H: manual edit decisions ────────────────────────────────────────────────

section("H: manual edit decisions", () => {
  ok(playoffEditOutcome(0) !== null && /Nothing was saved/.test(playoffEditOutcome(0) ?? ""), "H1", "zero rows affected is an error, never success");
  ok(playoffEditOutcome(1) === null, "H2", "one row affected is success");
  const when = parseManualDateTime("2026-11-14", "15:15:00");
  ok(!!when && when.startMin === 915, "H3", "a Postgres-prefilled HH:MM:SS time parses (seconds tolerated)");
  const booked = playoffEditConflicts({
    when: when!, durationMin: 180, bufferMin: 30, divisionName: "50/70 playoffs", playingDays: ["Sa"],
    blackoutDates: new Set(), venue: { label: "CCLA", availabilityConfigured: true, availability: parseAvailability({ Sa: { start: "09:00", end: "22:00" } }) },
    // 12:00–15:00; a 15:15 start is inside the 30-minute buffer. (15:30 would
    // clear — the buffer EDGE is allowed, the manual-move sim pins that.)
    venueGames: [{ startMin: 720, durationMin: 180, label: "50/70 playoffs: A vs B" }],
    teamGames: [],
  });
  ok(booked.some((c) => c.kind === "venue_booked"), "H4", "a game ending 15:00 blocks a 15:15 start through the 30-minute buffer (candidateClearsSpan)", JSON.stringify(booked));
  ok(playoffEditSaveEnabled({ when, venueChosen: true, saving: false, conflicts: booked }), "H5", "conflicts never disable Save");
  const closed = playoffEditConflicts({
    when: parseManualDateTime("2026-11-13", "17:00")!, durationMin: 180, bufferMin: 30, divisionName: "50/70 playoffs", playingDays: ["Sa"],
    blackoutDates: new Set(), venue: { label: "CCLA", availabilityConfigured: true, availability: parseAvailability({ Sa: { start: "09:00", end: "22:00" } }) },
    venueGames: [], teamGames: [],
  });
  ok(closed.some((c) => c.kind === "venue_closed") && closed.some((c) => c.kind === "non_playing_day"), "H6", "a Friday at a Saturday-only field is flagged closed AND a non-playing day", JSON.stringify(closed));
  const unchecked = playoffEditConflicts({
    when: when!, durationMin: 180, bufferMin: 30, divisionName: "x", playingDays: ["Sa"], blackoutDates: new Set(),
    venue: { label: "CCLA", availabilityConfigured: true, availability: parseAvailability({ Sa: { start: "09:00", end: "22:00" } }) },
    venueGames: null, teamGames: null,
  });
  ok(unchecked.filter((c) => c.kind === "unchecked").length === 2, "H7", "failed reads say 'couldn't check', never all-clear");
});

// ─── S: source wiring ────────────────────────────────────────────────────────

section("S: source wiring", () => {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
  const gen = read("src/lib/playoffs/generate-bracket.ts");
  ok(gen.includes("planBracket(") && !/\b105\b/.test(gen) && !gen.includes("PLAYOFF_GAME_DURATION_MIN"), "S1", "generate-bracket.ts runs the planner and carries no hardcoded spacing");
  // Re-keyed 2026-10-08 (0107): the browser-side delete → insert is gone; the
  // only write is replace_playoff_games. Same property: every read happens
  // before the write, and the write exists (an index of -1 must not pass).
  {
    const read = gen.indexOf("loadPlanInputs(supabase, playoffId");
    const write = gen.indexOf('rpc("replace_playoff_games"');
    ok(read >= 0 && write >= 0 && read < write && !gen.includes('.from("playoff_games")'), "S1", "every read happens before the write (replace_playoff_games), and nothing writes playoff_games directly");
  }
  const review = read("src/components/playoffs/steps/step-review.tsx");
  ok(review.includes("preflightBracket(leagueId, data)") && review.includes("preflight.warnings.map") && review.includes("warnings.map((w, i)"), "S2", "the review step pre-flights and renders both warning lists verbatim");
  ok(!review.includes("fall outside venue availability"), "S2", "the old untrue success copy is gone");
  const view = read("src/components/playoffs/bracket-view.tsx");
  ok(view.includes("<EditPlayoffGameModal") && view.includes("onEdit={() => setEditingGame(g)}"), "S3", "the bracket list opens the edit modal");
  const modal = read("src/components/playoffs/edit-playoff-game-modal.tsx");
  ok(modal.includes('.eq("id", game.id)\n      .select("id")') && modal.includes("playoffEditOutcome((saved ?? []).length)"), "S4", "the edit save reads rows affected and refuses zero");
  ok(modal.includes("playoffEditConflicts({"), "S4", "the edit modal uses the shared conflict check");
  const division = read("src/components/playoffs/steps/step-division.tsx");
  ok(division.includes("playoffDefaultsFromDivision(div.settings, DEFAULT_PLAYOFF_DATA)") && division.includes('"id, name, team_count, settings"'), "S5", "picking a division seeds the Dates step from its settings");
  const adv = read("src/lib/playoffs/advancement.ts");
  ok(adv.includes("singleElimFirstNumber(roundIdx + 1, bracketSize)"), "S6", "advancement resolves the target by positional game number");
  const plan = read("src/lib/playoffs/bracket-plan.ts");
  ok(!plan.includes("Math.min(dateIdx"), "S7", "the wraparound clamp is gone");
  ok(singleElimRoundSize(0, 8) === 4 && singleElimFirstNumber(2, 8) === 7, "S7", "position helpers agree with the layout");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n── anti-vacuity counters");
for (const [name, n] of Object.entries(counters)) ok(n > 0, "AV", `counter ${name} fired`, `got ${n}`);
console.log("  counters:", JSON.stringify(counters));
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

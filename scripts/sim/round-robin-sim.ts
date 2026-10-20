// Harness for the playoff ROUND ROBIN as it exists today (step 1 of the
// two-stage playoffs build, 2026-10-19): `buildRoundRobin` and the slot picker
// through the real `planBracket`, the labels and the result-entry wording the
// round robin uses. Pure — no Supabase, no clock.
// Run: npm run sim:round-robin   Mutants: npm run sim:round-robin:mutants
//
// What it proves, for every team count from 2 to 16:
//   R0  the bracket has n(n-1)/2 games, the count the Seeding step states
//   N2  rounds are labelled RR1…RRk, with ⌊n/2⌋ games each, in order
//   R2  every game has two real teams from the seed list (no bye placeholder)
//   R3  no team plays twice in one round
//   R1  every pair of teams meets exactly once
//   R4  odd counts: each team sits out exactly one round
//   N1  game numbers run 1…N in round order
//   T   a round never starts before the previous round's games have ended
//       (plus the buffer); no field holds two games at once; a team is never
//       in two games at once; games that don't fit are saved with no date and
//       reported
//   L   empty slots read "TBD" (never "Winner of Game N"), round names, the
//       database result path, and the tied-score refusal sentence
//   X   a team removed in the Seeding step is in no game
//   K   KNOWN, NOT FIXED — current behaviour pinned so a fix flips it on
//       purpose: the first team is home in every game it plays, and a team can
//       play every round on the same day when there are enough fields
//
// Section order is load-bearing: each mutant must die FIRST at its own tag, so
// a check that would also catch an earlier rule's mutant runs after it. R0
// counts games (not labels) so the label mutant reaches N2; N2 runs before R3
// because R3 groups games by their label.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  planBracket,
  type BracketIds,
  type BracketPlan,
  type GameInsert,
  type PlanSettings,
  type PlanVenue,
  type SlotGridInput,
} from "../../src/lib/playoffs/bracket-plan";
import { bracketSummaryLine, planSeeds } from "../../src/lib/playoffs/seeding";
import { emptySlotLabel } from "../../src/lib/playoffs/bracket-labels";
import {
  clearOffered,
  playoffRoundLabel,
  resultErrorMessage,
  resultPath,
} from "../../src/lib/playoffs/playoff-result";
import { playoffRoundName } from "../../src/lib/public-schedule/view";
import type { GameRow } from "../../src/lib/playoffs/advancement";
import { parseAvailability } from "../../src/lib/venues/availability";
import type { SeededTeam } from "../../src/components/playoffs/playoff-wizard-types";

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
  oddCountsRun: 0,
  evenCountsRun: 0,
  sitOutsSeen: 0,
  pairsChecked: 0,
  roundBoundariesTimed: 0,
  slotsSkippedForOrder: 0,
  tbdGamesSeen: 0,
  sameDayRepeatsSeen: 0,
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const IDS: BracketIds = { playoffId: "p1", leagueId: "l1", divisionId: "d1" };
const SETTINGS: PlanSettings = { durationMin: 90, bufferMin: 30, durationDefaulted: false, bufferDefaulted: false };
const NAMES = [
  "Angels", "Bears", "Cubs", "Dodgers", "Expos", "Giants", "Lions", "Mets",
  "Padres", "Pirates", "Reds", "Royals", "Tigers", "Twins", "Twins B", "Yankees",
];
const COUNTS = Array.from({ length: 15 }, (_, i) => i + 2); // 2…16
function seedsOf(n: number): SeededTeam[] {
  return NAMES.slice(0, n).map((name, i) => ({ team_id: `t${i + 1}`, team_name: name }));
}
function openVenue(id: string): PlanVenue {
  const av: Record<string, { start: string; end: string }> = {};
  for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) av[d] = { start: "08:00", end: "22:00" };
  return { id, name: `Field ${id}`, availability: parseAvailability(av) };
}
function grid(fields: number, endDate = "2027-06-26"): SlotGridInput {
  return {
    startDate: "2026-11-07", endDate,
    playingDays: ["Sa"], dayWindows: { Sa: { start: "09:00", end: "21:00" } },
    venues: Array.from({ length: fields }, (_, i) => openVenue(`v${i + 1}`)),
    durationMin: SETTINGS.durationMin, bufferMin: SETTINGS.bufferMin,
  };
}
function plan(seeds: SeededTeam[], g: SlotGridInput = grid(2)): BracketPlan {
  return planBracket({ format: "round_robin", seeds, ids: IDS, grid: g, settings: SETTINGS, divisionName: "Majors" });
}
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const roundNo = (g: GameInsert) => Number(g.round.slice(2));
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const at = (g: GameInsert) => `${g.scheduled_date} ${g.start_time}`;
function overlaps(a: GameInsert, b: GameInsert): boolean {
  if (!a.scheduled_date || !b.scheduled_date || a.scheduled_date !== b.scheduled_date) return false;
  const as = minutes(a.start_time!), bs = minutes(b.start_time!);
  return as < bs + SETTINGS.durationMin && bs < as + SETTINGS.durationMin;
}
const expectedRounds = (n: number) => (n % 2 === 0 ? n - 1 : n);
const PLANS = new Map<number, GameInsert[]>(COUNTS.map((n) => [n, plan(seedsOf(n)).games]));
for (const n of COUNTS) { if (n % 2) counters.oddCountsRun++; else counters.evenCountsRun++; }

// ─── R0: game count ──────────────────────────────────────────────────────────

section("R0 game count", () => {
  for (const n of COUNTS) {
    const games = PLANS.get(n)!;
    const want = (n * (n - 1)) / 2;
    ok(games.length === want, "R0", `${n} teams → ${want} games`, `got ${games.length}`);
    ok(bracketSummaryLine("round_robin", n).endsWith(`· ${want} ${want === 1 ? "game" : "games"}`), "R0",
      `the Seeding step's line states ${want} for ${n} teams`, bracketSummaryLine("round_robin", n));
  }
});

// ─── N2: round labels ────────────────────────────────────────────────────────

section("N2 round labels", () => {
  for (const n of COUNTS) {
    const games = PLANS.get(n)!;
    const k = expectedRounds(n);
    const labels = [...new Set(games.map((g) => g.round))];
    const want = Array.from({ length: k }, (_, i) => `RR${i + 1}`);
    ok(JSON.stringify(labels) === JSON.stringify(want), "N2", `${n} teams: rounds RR1…RR${k}, in order`, labels.join(","));
    const perRound = Math.floor(n / 2);
    ok(want.every((r) => games.filter((g) => g.round === r).length === perRound), "N2", `${n} teams: ${perRound} game(s) in every round`);
  }
});

// ─── R2: real teams only ─────────────────────────────────────────────────────

section("R2 real teams", () => {
  for (const n of COUNTS) {
    const valid = new Set(seedsOf(n).map((s) => s.team_id));
    const games = PLANS.get(n)!;
    const bad = games.filter((g) => !g.home_team_id || !g.away_team_id || !valid.has(g.home_team_id) || !valid.has(g.away_team_id) || g.home_team_id === g.away_team_id);
    ok(bad.length === 0, "R2", `${n} teams: every game has two different teams from the list`, bad.map((g) => `${g.home_team_id}v${g.away_team_id}`).join(" "));
  }
});

// ─── R3: once per round ──────────────────────────────────────────────────────

section("R3 once per round", () => {
  for (const n of COUNTS) {
    const games = PLANS.get(n)!;
    let twice = "";
    for (const r of new Set(games.map((g) => g.round))) {
      const seen = new Set<string>();
      for (const g of games.filter((x) => x.round === r)) {
        for (const t of [g.home_team_id!, g.away_team_id!]) {
          if (seen.has(t)) twice = `${t} in ${r}`;
          seen.add(t);
        }
      }
    }
    ok(twice === "", "R3", `${n} teams: no team plays twice in one round`, twice);
  }
});

// ─── R1: every pair once ─────────────────────────────────────────────────────

section("R1 every pair once", () => {
  for (const n of COUNTS) {
    const games = PLANS.get(n)!;
    const met = new Map<string, number>();
    for (const g of games) {
      const k = pairKey(g.home_team_id!, g.away_team_id!);
      met.set(k, (met.get(k) ?? 0) + 1);
    }
    const ids = seedsOf(n).map((s) => s.team_id);
    let missing = 0, repeated = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        counters.pairsChecked++;
        const c = met.get(pairKey(ids[i], ids[j])) ?? 0;
        if (c === 0) missing++;
        if (c > 1) repeated++;
      }
    }
    ok(missing === 0 && repeated === 0, "R1", `${n} teams: every pair meets exactly once`, `${missing} missing, ${repeated} repeated`);
  }
});

// ─── R4: sit-outs ────────────────────────────────────────────────────────────

section("R4 sit-outs", () => {
  for (const n of COUNTS) {
    const games = PLANS.get(n)!;
    const ids = seedsOf(n).map((s) => s.team_id);
    const sits = new Map<string, number>(ids.map((t) => [t, 0]));
    for (const r of new Set(games.map((g) => g.round))) {
      const playing = new Set(games.filter((g) => g.round === r).flatMap((g) => [g.home_team_id!, g.away_team_id!]));
      for (const t of ids) if (!playing.has(t)) { sits.set(t, sits.get(t)! + 1); counters.sitOutsSeen++; }
    }
    const want = n % 2 ? 1 : 0;
    ok([...sits.values()].every((c) => c === want), "R4", `${n} teams: every team sits out ${want} round(s)`, JSON.stringify(Object.fromEntries(sits)));
  }
});

// ─── N1: game numbers ────────────────────────────────────────────────────────

section("N1 game numbers", () => {
  for (const n of COUNTS) {
    const games = PLANS.get(n)!;
    const nums = games.map((g) => g.game_number);
    ok(nums.every((x, i) => x === i + 1), "N1", `${n} teams: games numbered 1…${games.length}`, nums.join(","));
    ok(games.every((g, i) => i === 0 || roundNo(g) >= roundNo(games[i - 1])), "N1", `${n} teams: numbers follow round order`);
  }
});

// ─── T: timing ───────────────────────────────────────────────────────────────

section("T timing", () => {
  for (const fields of [1, 2, 4]) {
    for (const n of [5, 6, 7, 8, 10]) {
      const p = plan(seedsOf(n), grid(fields));
      counters.slotsSkippedForOrder += p.skippedForOrder;
      const games = p.games;
      ok(p.tbdCount === 0, "T1", `${n} teams on ${fields} field(s): every game gets a date`, `${p.tbdCount} TBD`);
      let early = "";
      for (let r = 2; r <= expectedRounds(n); r++) {
        const prev = games.filter((g) => roundNo(g) === r - 1);
        const cur = games.filter((g) => roundNo(g) === r);
        const prevEnd = prev.reduce((m, g) => {
          const e = `${g.scheduled_date} ${String(minutes(g.start_time!) + SETTINGS.durationMin + SETTINGS.bufferMin).padStart(4, "0")}`;
          return e > m ? e : m;
        }, "");
        const curStart = cur.reduce((m, g) => {
          const s = `${g.scheduled_date} ${String(minutes(g.start_time!)).padStart(4, "0")}`;
          return m === "" || s < m ? s : m;
        }, "");
        counters.roundBoundariesTimed++;
        if (curStart < prevEnd) early = `RR${r} starts ${curStart}, RR${r - 1} ends ${prevEnd}`;
      }
      ok(early === "", "T1", `${n} teams on ${fields} field(s): no round starts before the last one ended + buffer`, early);
      let field = "", team = "";
      for (let i = 0; i < games.length; i++) {
        for (let j = i + 1; j < games.length; j++) {
          const a = games[i], b = games[j];
          if (!overlaps(a, b)) continue;
          if (a.venue_id === b.venue_id) field = `${a.venue_id} at ${at(a)} / ${at(b)}`;
          const ta = [a.home_team_id, a.away_team_id], tb = [b.home_team_id, b.away_team_id];
          if (ta.some((t) => tb.includes(t))) team = `${at(a)} / ${at(b)}`;
        }
      }
      ok(field === "", "T2", `${n} teams on ${fields} field(s): no field holds two games at once`, field);
      ok(team === "", "T2", `${n} teams on ${fields} field(s): no team is in two games at once`, team);
    }
  }
  // Too few dates: the games that don't fit are saved with no date and reported.
  const tight = plan(seedsOf(8), grid(1, "2026-11-14"));
  counters.tbdGamesSeen += tight.tbdCount;
  const tbd = tight.games.filter((g) => g.scheduled_date === null);
  ok(tight.tbdCount > 0 && tbd.length === tight.tbdCount, "T3", "8 teams, 1 field, 2 Saturdays: the games that don't fit are counted", `${tight.tbdCount} TBD`);
  ok(tbd.every((g) => g.start_time === null && g.venue_id === null), "T3", "an unplaced game has no time and no field");
  ok(tight.warnings.some((w) => w.includes(`${tight.tbdCount} of 28 games could not be placed`)), "T3", "the warning says how many could not be placed", tight.warnings.join(" | "));
  const firstTbd = tight.games.findIndex((g) => g.scheduled_date === null);
  ok(firstTbd > 0 && tight.games.slice(firstTbd).every((g) => g.scheduled_date === null), "T3", "once dates run out, every later game is unplaced (no wraparound)");
});

// ─── L: labels and result entry ──────────────────────────────────────────────

section("L labels", () => {
  const games = PLANS.get(6)!;
  const rows: GameRow[] = games.map((g) => ({
    id: `g${g.game_number}`, round: g.round, game_number: g.game_number,
    home_team_id: null, away_team_id: null, winner_id: null,
  }));
  ok(rows.every((r) => emptySlotLabel(r, "home", rows, "round_robin") === "TBD" && emptySlotLabel(r, "away", rows, "round_robin") === "TBD"),
    "L1", "an empty round-robin slot reads TBD, never \"Winner of Game N\"");
  ok(playoffRoundLabel("RR3") === "Round 3" && playoffRoundLabel("RR12") === "Round 12", "L2", "admin round names: Round 3, Round 12");
  ok(playoffRoundName("RR3") === "Round robin", "L2", "public round name: Round robin");
  ok(resultPath("round_robin") === "database" && clearOffered("round_robin"), "L3", "round-robin results go through the database functions, and can be cleared");
  const tie = resultErrorMessage("ERROR: tied_score");
  ok(tie.includes("can't be tied") && tie.includes("one team must win"), "L4", "a tied score is refused with its own sentence", tie);
  const sql = readFileSync(join(ROOT, "supabase/migrations/0108_playoff_result_enter_clear.sql"), "utf8");
  ok(/if p_home_score = p_away_score then\s+raise exception 'tied_score'/.test(sql), "L4", "0108 refuses equal scores before anything is written");
});

// ─── X: removed teams ────────────────────────────────────────────────────────

section("X removed teams", () => {
  const all = seedsOf(8);
  const out = [all[2], all[6]];
  const seeds = planSeeds(all.filter((t) => !out.includes(t)), out);
  const games = plan(seeds).games;
  const present = new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]));
  ok(out.every((t) => !present.has(t.team_id)), "X1", "a team removed in the Seeding step plays no round-robin game");
  ok(games.length === 15, "X1", "6 teams left → 15 games", `got ${games.length}`);
});

// ─── K: KNOWN, NOT FIXED (pinned so a fix flips them on purpose) ─────────────

section("K known", () => {
  const n = 7;
  const games = PLANS.get(n)!;
  const home = new Map<string, number>();
  for (const g of games) home.set(g.home_team_id!, (home.get(g.home_team_id!) ?? 0) + 1);
  const spread = [...home.values()];
  ok(home.get("t1") === n - 1, "K1", "KNOWN: the first team in the list is home in every game it plays (6 of 6)", JSON.stringify(Object.fromEntries(home)));
  ok(Math.max(...spread) - Math.min(...spread) === 4, "K1", "KNOWN: home games range 2–6 across 7 teams", JSON.stringify(spread));
  // No limit on games per team per day: with enough fields every round lands
  // on the same Saturday.
  const wide = plan(seedsOf(6), grid(4)).games;
  const perDay = new Map<string, number>();
  for (const g of wide) for (const t of [g.home_team_id, g.away_team_id]) {
    const k = `${t}|${g.scheduled_date}`;
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const most = Math.max(...perDay.values());
  if (most > 1) counters.sameDayRepeatsSeen++;
  ok(most === 5 && new Set(wide.map((g) => g.scheduled_date)).size === 1, "K2",
    "KNOWN: 6 teams on 4 fields — all 15 games on one Saturday, every team plays 5 that day", `max ${most}`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n── anti-vacuity counters");
for (const [name, n] of Object.entries(counters)) ok(n > 0, "AV", `counter ${name} fired`, `got ${n}`);

console.log(`\n${checks} checks, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

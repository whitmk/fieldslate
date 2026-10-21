// Harness for the playoff game numbers people see (2026-10-20). Stored
// `game_number` is the BRACKET POSITION and keeps its gaps (a 6-team bracket
// stores 2, 4, 5, 6, 7); every "Game N" and "Winner of Game N" shows the
// game's number among the games that exist, 1..N in round order then
// position (bracket-labels `gameNumbering`). Drives the REAL generator,
// labels, print card, public rows, export CSV, seed confirm and reply
// parsers. Every expected value is a literal written by hand.
//
//   npm run sim:playoff-numbers            (three host zones)
//   npm run sim:playoff-numbers:mutants    (mutation pass, real source)
//
// Section order is load-bearing (each mutant must die FIRST at its own tag):
//   N0 stored numbers unchanged → N1 the numbering → N2 "Winner of Game N"
//   → N3 the "Game N" line (screen + print) → N4 public schedule → N5 export
//   CSV → N6 seed confirm → N7 result replies → N8 two-stage refusals → L
//   leak scan (source) → counters.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildSingleElimination, makeSlotPicker, type BracketIds, type GameInsert } from "../../src/lib/playoffs/bracket-plan";
import { singleElimPosition } from "../../src/lib/playoffs/advancement";
import { emptySlotLabel, gameNumbering, gameWhen } from "../../src/lib/playoffs/bracket-labels";
import { gameCardHtml, type PrintGame } from "../../src/lib/playoffs/bracket-print";
import { buildRows } from "../../src/lib/public-schedule/view";
import type { PublicPlayoffGame, PublicSeason } from "../../src/lib/public-schedule/types";
import { buildPlayoffCsv, type ExportGame } from "../../src/lib/playoffs/playoff-export";
import {
  planStage2,
  seedBlockedMessage,
  seedConfirm,
  stage1Status,
  twoStageBlockedMessage,
  type Stage2Game,
} from "../../src/lib/playoffs/two-stage";
import {
  blockedMessage,
  clearConfirm,
  clearPreviewOutcome,
  enterOutcome,
  type ResultNumbering,
} from "../../src/lib/playoffs/playoff-result";
import type { SeededTeam } from "../../src/components/playoffs/playoff-wizard-types";

const ROOT = join(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

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
  try {
    fn();
  } catch (e) {
    failures.push(`[CRASH-${name}] ${(e as Error).message}`);
    console.error(`  CRASH: ${name} — ${(e as Error).stack}`);
  }
}

const counters = { gapBracketsChecked: 0, fullBracketsChecked: 0, winnerLabels: 0, publicRows: 0, csvWinnerLabels: 0, replyMaps: 0 };

const IDS: BracketIds = { playoffId: "p1", leagueId: "l1", divisionId: "d1" };
const PICKER = () => makeSlotPicker([], { durationMin: 90, bufferMin: 15 });
const teams = (n: number): SeededTeam[] => Array.from({ length: n }, (_, i) => ({ team_id: `t${i + 1}`, team_name: `Team ${i + 1}` }));
const bracket = (n: number): GameInsert[] => buildSingleElimination(teams(n), IDS, PICKER());
const rows = (gs: GameInsert[]) => gs.map((g, i) => ({ ...g, id: `g${g.game_number}`, winner_id: null, _i: i }));
const ROUND_ORDER = ["R1", "R2", "R3", "R4", "QF", "SF", "F"];
const SIX = bracket(6);
const SIX_ROWS = rows(SIX);

// ── N0: the stored numbers are bracket positions and stay that way ────────────
section("N0 stored numbers unchanged", () => {
  ok(SIX.map((g) => `${g.round}:${g.game_number}`).join(" ") === "R1:2 R1:4 SF:5 SF:6 F:7", "N0",
    "6 teams store Games 2, 4, 5, 6, 7 (positions; advancement keys on them)", SIX.map((g) => `${g.round}:${g.game_number}`).join(" "));
});

// ── N1: the numbering ─────────────────────────────────────────────────────────
section("N1 the numbering", () => {
  const n6 = gameNumbering(SIX);
  ok([2, 4, 5, 6, 7].map(n6).join(",") === "1,2,3,4,5", "N1", "6 teams show Games 1–5", [2, 4, 5, 6, 7].map(n6).join(","));
  const shuffled = gameNumbering([SIX[3], SIX[0], SIX[4], SIX[2], SIX[1]]);
  ok([2, 4, 5, 6, 7].map(shuffled).join(",") === "1,2,3,4,5", "N1", "the order games arrive in doesn't matter");
  counters.gapBracketsChecked++;
  for (const n of [4, 8, 16]) {
    const b = bracket(n);
    const num = gameNumbering(b);
    ok(b.every((g) => num(g.game_number) === g.game_number), "N1", `${n} teams (full): every game shows its stored number`);
    counters.fullBracketsChecked++;
  }
  // The rule as stated — round order, then position — for every size.
  for (let n = 2; n <= 32; n++) {
    const b = bracket(n);
    const num = gameNumbering(b);
    const rs = rows(b);
    const rounds = ROUND_ORDER.filter((r) => rs.some((g) => g.round === r));
    const B = 2 ** Math.ceil(Math.log2(n));
    const pos = (g: (typeof rs)[number]) =>
      singleElimPosition(g, rounds.indexOf(g.round), B, rs.filter((x) => x.round === g.round));
    const byRule = [...rs].sort((a, c) => rounds.indexOf(a.round) - rounds.indexOf(c.round) || pos(a) - pos(c));
    ok(byRule.every((g, i) => num(g.game_number) === i + 1), "N1", `${n} teams: shown 1..${b.length} in round order, then position`);
  }
});

// ── N2: "Winner of Game N" ────────────────────────────────────────────────────
section("N2 Winner of Game N", () => {
  const sf = SIX_ROWS.filter((g) => g.round === "SF");
  const labels = sf.map((g) => [g.home_team_id ? "team" : emptySlotLabel(g, "home", SIX_ROWS, "single_elimination"),
                                g.away_team_id ? "team" : emptySlotLabel(g, "away", SIX_ROWS, "single_elimination")].join(" / "));
  ok(labels.join(" | ") === "team / Winner of Game 1 | team / Winner of Game 2", "N2",
    "6 teams: the semifinals wait for the winners of Games 1 and 2", labels.join(" | "));
  const f = SIX_ROWS.find((g) => g.round === "F")!;
  ok(`${emptySlotLabel(f, "home", SIX_ROWS, "single_elimination")} / ${emptySlotLabel(f, "away", SIX_ROWS, "single_elimination")}` ===
    "Winner of Game 3 / Winner of Game 4", "N2", "the final waits for Games 3 and 4");
  counters.winnerLabels += 4;
  const eight = rows(bracket(8));
  const f8 = eight.find((g) => g.round === "F")!;
  ok(emptySlotLabel(f8, "home", eight, "single_elimination") === "Winner of Game 5" &&
     emptySlotLabel(f8, "away", eight, "single_elimination") === "Winner of Game 6", "N2", "8 teams unchanged: final waits for Games 5 and 6");
});

// ── N3: the "Game N" line — screen helper and the printed card ────────────────
const asPrint = (g: (typeof SIX_ROWS)[number]): PrintGame => ({
  id: g.id, round: g.round, game_number: g.game_number, home_team_id: g.home_team_id, away_team_id: g.away_team_id,
  winner_id: null, status: "scheduled", home_score: null, away_score: null,
  scheduled_date: g.round === "F" ? null : "2026-11-14", start_time: "09:00",
  home_team_name: g.home_team_id ? `Team ${g.home_team_id.slice(1)}` : null,
  away_team_name: g.away_team_id ? `Team ${g.away_team_id.slice(1)}` : null, venue_name: "Andrews",
});
section("N3 the Game N line", () => {
  ok(gameWhen(SIX[0], SIX, "2026-11-14", "09:00") === "Game 1 · Sat 11/14 · 9:00 AM", "N3", "first round-1 game reads Game 1", gameWhen(SIX[0], SIX, "2026-11-14", "09:00"));
  ok(gameWhen(SIX[4], SIX, null, null) === "Game 5 · Date TBD", "N3", "the final reads Game 5");
  const print = SIX_ROWS.map(asPrint);
  const cards = print.map((g) => gameCardHtml(g, print, "single_elimination"));
  const whens = cards.map((h) => (h.match(/>(Game \d+[^<]*)</) ?? [])[1]);
  ok(whens.join(" | ") === "Game 1 · Sat 11/14 · 9:00 AM | Game 2 · Sat 11/14 · 9:00 AM | Game 3 · Sat 11/14 · 9:00 AM | Game 4 · Sat 11/14 · 9:00 AM | Game 5 · Date TBD",
    "N3", "the printed cards read Games 1–5", whens.join(" | "));
  ok(cards[2].includes("Winner of Game 1") && cards[3].includes("Winner of Game 2"), "N3", "the printed semifinals wait for Games 1 and 2");
});

// ── N4: the public schedule ───────────────────────────────────────────────────
const asPublic = (g: (typeof SIX_ROWS)[number], playoffId: string, stage?: number, seeds?: Stage2Game): PublicPlayoffGame => ({
  id: `${playoffId}-${g.id}`, playoff_id: playoffId, format: "single_elimination", division_id: "d1", round: g.round,
  game_number: g.game_number, scheduled_date: "2026-11-14", start_time: "09:00", status: "scheduled",
  home_team: g.home_team_id ? { id: g.home_team_id, name: `Team ${g.home_team_id.slice(1)}` } : null,
  away_team: g.away_team_id ? { id: g.away_team_id, name: `Team ${g.away_team_id.slice(1)}` } : null,
  venue: null as unknown as PublicPlayoffGame["venue"],
  ...(stage ? { stage, seed_home: seeds?.seed_home ?? null, seed_away: seeds?.seed_away ?? null } : {}),
});
const season = (pg: PublicPlayoffGame[]): PublicSeason => ({
  id: "s1", name: "Fall", start_date: null, end_date: null, divisions: [{ id: "d1", name: "Majors", game_duration: 90 }],
  unpublished: [], teams: [], games: [], playoff_games: pg,
});
section("N4 public schedule", () => {
  const pub = SIX_ROWS.map((g) => asPublic(g, "p1"));
  const r = buildRows(season(pub)).filter((x) => x.kind === "playoff").sort((a, b) => a.key.localeCompare(b.key));
  const labels = r.map((x) => x.playoffLabel);
  counters.publicRows += r.length;
  ok(labels.join(" | ") === "Playoffs · Round 1 · Game 1 | Playoffs · Round 1 · Game 2 | Playoffs · Semifinal · Game 3 | Playoffs · Semifinal · Game 4 | Playoffs · Final · Game 5",
    "N4", "the public rows read Games 1–5", labels.join(" | "));
  ok(r.some((x) => x.matchup.includes("Winner of Game 1")) && r.some((x) => x.matchup.includes("Winner of Game 2")), "N4", "the public semifinals wait for Games 1 and 2");
});

// ── N5: the export CSV ────────────────────────────────────────────────────────
section("N5 export CSV", () => {
  const ex: ExportGame[] = SIX_ROWS.map((g) => ({
    id: g.id, playoff_id: "p1", round: g.round, game_number: g.game_number, scheduled_date: "2026-11-14", start_time: "09:00",
    status: "scheduled", home_team_id: g.home_team_id, away_team_id: g.away_team_id,
    home_team_name: g.home_team_id ? `Team ${g.home_team_id.slice(1)}` : null,
    away_team_name: g.away_team_id ? `Team ${g.away_team_id.slice(1)}` : null, winner_id: null, venue_name: "Andrews",
  }));
  const csv = buildPlayoffCsv(ex, { divisionName: "Majors", durationMin: 90, pair: null, format: "single_elimination" });
  const winners = (csv.match(/Winner of Game \d+/g) ?? []).join(",");
  counters.csvWinnerLabels += (csv.match(/Winner of Game \d+/g) ?? []).length;
  ok(winners === "Winner of Game 1,Winner of Game 2,Winner of Game 3,Winner of Game 4", "N5", "the CSV's empty slots name Games 1–4", winners);
});

// ── N6: the seed confirm (two-stage Stage 2, top 6) ──────────────────────────
section("N6 seed confirm", () => {
  const plan = planStage2({ advance: 6, ids: IDS, grid: { startDate: "2026-11-14", endDate: "2026-11-14", playingDays: [], dayWindows: {}, venues: [] } as never,
    settings: { durationMin: 90, bufferMin: 15, durationDefaulted: false, bufferDefaulted: false }, divisionName: "Majors" });
  const s2 = plan.games;
  ok(s2.map((g) => g.game_number).join(",") === "2,4,5,6,7", "N6", "Stage 2 (top 6) stores 2, 4, 5, 6, 7 like a native bracket");
  const order = teams(7).map((t, i) => ({ ...t, team_name: ["Expos", "Bears", "Lions", "Mets", "Pirates", "Royals", "Giants"][i] }));
  const status = stage1Status([], "2026-11-09");
  const c = seedConfirm({ divisionName: "Majors", stage2Games: s2, order, advance: 6, status, teamName: () => "" });
  ok(c.lines.join(" | ") ===
    "Expos (1) — bye to Game 3 | Bears (2) — bye to Game 4 | Game 1: Mets (4) vs Pirates (5) · Date TBD | Game 2: Lions (3) vs Royals (6) · Date TBD",
    "N6", "the confirm sends byes to Games 3 and 4 and lists Games 1 and 2", c.lines.join(" | "));
});

// ── N7: result replies — positions from the database become shown numbers ─────
const NUM: ResultNumbering = { own: gameNumbering(SIX), nextStage: gameNumbering(SIX) };
section("N7a next game blocked", () => {
  const r = { committed: false, blocked: true, reason: "next_game_has_result", game_id: "g", next_game:
    { game_id: "x", game_number: 5, round: "SF", home_name: "Team 1", away_name: "Team 4", home_score: 3, away_score: 1 } };
  const e = enterOutcome(r, null, "g", NUM);
  counters.replyMaps++;
  ok(!e.ok && e.message === "Game 3 (Semifinals) already has a result (Team 1 3, Team 4 1). Clear that game's result first, then change this one.",
    "N7a", "stored 5 reads Game 3", e.ok ? "" : e.message);
});
section("N7b clear preview", () => {
  const pv = clearPreviewOutcome({ committed: false, blocked: false, game_id: "g4", game_number: 4, round: "R1",
    home_name: "Team 3", away_name: "Team 6", home_score: 2, away_score: 1, winner_name: "Team 3", on_public_schedule: false,
    removed: { game_id: "g6", game_number: 6, round: "SF", team_name: "Team 3" } }, null, "g4", NUM);
  counters.replyMaps++;
  ok(pv.ok && clearConfirm(pv.preview).lines.slice(0, 1).concat(clearConfirm(pv.preview).lines.slice(2, 3)).join(" | ") ===
    "Game 2 (Round 1) — Team 3 2, Team 6 1 (Team 3 won). | Team 3 will be removed from Game 4 (Semifinals) until this game has a result again.",
    "N7b", "stored 4 and 6 read Games 2 and 4", pv.ok ? clearConfirm(pv.preview).lines.join(" | ") : pv.message);
});
section("N7c next stage started", () => {
  const r = { blocked: true, reason: "next_stage_started", stage2_game_number: 2 };
  ok(blockedMessage(r, "edit", NUM) ===
    "The bracket has started (Game 1 has a result), so round-robin results can't be changed. Clear the bracket's results first, then change this one.",
    "N7c", "stored 2 in Stage 2 reads Game 1", blockedMessage(r, "edit", NUM));
  ok(!blockedMessage(r, "edit", { own: NUM.own, nextStage: null }).includes("Game 2"), "N7c", "an unknown Stage 2 names no stored position");
});

// ── N8: two-stage refusals ────────────────────────────────────────────────────
section("N8 two-stage refusals", () => {
  const n = gameNumbering(SIX);
  const t = twoStageBlockedMessage({ reasons: ["stage2_started"], stage2_game_number: 4 }, n);
  ok(t === "Nothing was saved. The bracket has started (Game 2 has a result), so neither stage can be rebuilt. Clear the bracket's results first.",
    "N8", "rebuild refusal: stored 4 reads Game 2", t);
  const s = seedBlockedMessage({ reason: "bracket_started", stage2_game_number: 4 }, n);
  ok(s === "Nothing was saved. The bracket has started (Game 2 has a result), so the seeds can't be changed. Clear the bracket's results first.",
    "N8", "seed refusal: stored 4 reads Game 2", s);
  ok(!twoStageBlockedMessage({ reasons: ["stage2_started"], stage2_game_number: 4 }, null).includes("Game 4"), "N8", "unknown numbering names no stored position");
});

// ── L: leak scan — no surface prints a stored position ────────────────────────
// A "Game N" whose N is a raw `game_number` (or `stage2_game_number`) is a
// leak. Round-robin labels (rrGameLabel) keep the stored number by design —
// round robins have no gaps — and attributes (data-game) are not shown.
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
section("L leak scan", () => {
  const LEAK = [
    /Game \$\{[^}]*game_number[^}]*\}/,          // `Game ${x.game_number}`
    /Game \{[^}]*game_number[^}]*\}/,            // JSX: Game {x.game_number}
    /Game \$\{[^}]*\bgameNumber\b[^}]*\}/,       // `Game ${b.gameNumber}` — allowed only where gameNumber is shown
    /Game \$\{n\}/,                              // `Game ${n}` from a raw reply field
  ];
  // Where `gameNumber` / `n` hold a SHOWN number (mapped at the boundary).
  const SHOWN_OK = new Set(["src/lib/playoffs/playoff-result.ts", "src/lib/playoffs/two-stage.ts"]);
  const hits: string[] = [];
  for (const f of walk("src")) {
    const lines = read(f).split("\n");
    lines.forEach((line, i) => {
      if (/rrGameLabel\(|data-game=/.test(line)) return;
      LEAK.forEach((re, k) => {
        const m = line.match(re);
        if (!m) return;
        if (/\b(shown|numbering|numberOf|shownGameNumber)\(/.test(m[0])) return;
        if (k >= 2 && SHOWN_OK.has(f)) return;
        hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    });
  }
  ok(hits.length === 0, "L", "no surface prints a raw game_number", hits.join("\n    "));
  const view = read("src/components/playoffs/bracket-view.tsx");
  const pieces = read("src/components/playoffs/bracket-pieces.tsx");
  ok(pieces.includes("Game {numberOf(game)}") && view.includes("gameNumbering(games)"), "L", "the screen card shows numberOf(game) from gameNumbering");
  const modal = read("src/components/playoffs/enter-result-modal.tsx");
  ok(modal.includes("own: gameNumbering(allGames)") && modal.includes("previewClearResult(game.id, numbering)") &&
     modal.includes("clearResult(game.id, numbering)") && modal.includes("allGames, format, numbering)"), "L", "the result modal maps every reply");
  const card = read("src/components/playoffs/two-stage-card.tsx");
  ok(card.includes("stage1LockedLine(gameNumbering(s2Games)(firstResult))") && card.includes("nextStageGames={s2Games}"), "L", "the two-stage card maps Stage 2 numbers");
  const io = read("src/lib/playoffs/two-stage-io.ts");
  ok(io.includes("twoStageBlockedMessage(r, await stage2Numbering(") && io.includes("gameNumbering(stage2Games))"), "L", "two-stage I/O maps Stage 2 numbers");
  // The two advancement rules are untouched by this change.
  ok(read("src/lib/playoffs/advancement.ts").includes("const target = next.find((g) => g.game_number === targetNumber) ?? next[targetPos];"), "L",
    "advancement still resolves targets by stored position");
});

section("counters", () => {
  for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `counter ${k} > 0`, String(v));
});

console.log(`\n${checks - failures.length}/${checks} checks passed  ${JSON.stringify(counters)}`);
if (failures.length) process.exit(1);

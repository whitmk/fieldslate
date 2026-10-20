// Harness for the printable playoff bracket and the bracket's slot labels —
// src/lib/playoffs/bracket-print.ts, bracket-labels.ts and the shared
// single-elimination rule in advancement.ts (singleElimTarget /
// singleElimFeeder). Brackets come from the REAL generator
// (bracket-print-fixtures.ts). Nothing reads a clock; runs under three zones.
//
// WHAT IT PINS (sections run in this order — a mutant must die at its own)
// - F: for 4-, 6-, 8-, 11- (the live Majors shape), 12-, 16- and 32-team
//   brackets, every slot's feeder (singleElimFeeder) is a game whose
//   singleElimTarget is exactly that slot; every non-first-round slot is
//   either fed or holds a bye team; and the public schedule's label
//   (openSlotLabel, view.ts) answers the same on every slot — it delegates to
//   emptySlotLabel since 2026-10-13 (its old positional copy is gone), so this
//   is a WIRING check: a view.ts that stops delegating fails here.
// - L: the labels, as literals — the Majors shape's "Winner of Game 2/6/8",
//   the semifinals and final; round 1, round robin and double elimination
//   read "TBD".
// - T: the trophy rule — an empty slot next to an undecided game is NOT a
//   winner; the printed card of an unplayed game with an empty slot carries no
//   winner highlight; the decided winner does.
// - G: the two-tone card — home row white, away row the light green, kept in
//   print (print-color-adjust); a winner in either row keeps its row's colour
//   and is shown by bold text + a trophy only.
// - D: the date line — "Game 9 · Thu 10/29 · 5:15 PM", the field on its own
//   line, "Game 11 · Date TBD", date without time, weekday in every zone.
// - P: the tree layout — round-1 cards sit beside the slot they feed (above
//   the target's centre for home, below for away, within one slot); one
//   connector per game that advances, ending at the exact row it fills; every
//   card inside the canvas; ≤16 teams at scale 1 within the landscape page;
//   32 teams scaled to fit; landscape page CSS.
//   P6: the ON-SCREEN tree runs the same layout with SCREEN_TREE — no
//   overlapping cards, one line per advancing game, each from the card's edge
//   into the exact row; SCREEN_TREE equals the card's band heights.
// - C: contrast — the heading, placeholder, meta and "Printed" colours ≥ 7:1
//   on white, lines and borders ≥ 4.5:1, and the document actually uses them.
// - S: wiring (source greps — weak by nature, stated): the modal prints
//   through buildBracketPrintHtml landscape; the bracket view and the result
//   modal take names from slotName and winners from slotWon.
//
// ANTI-VACUITY: counters for feeder labels checked, bye seats seen, the
// null-winner/null-slot trophy case, connectors checked, a scaled layout.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:bracket-print:mutants, three zones). Run log in
// scripts/sim/bracket-print-mutants.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { singleElimFeeder, singleElimTarget } from "../../src/lib/playoffs/advancement";
import { emptySlotLabel, gameWhen, gameWhenLine, slotWon } from "../../src/lib/playoffs/bracket-labels";
import {
  CARD,
  CARD_H,
  MAX_SCALE,
  PAGE,
  PRINT_TREE,
  SCALE_UP_BELOW,
  SCREEN_TREE,
  PRINT_COLORS,
  buildBracketPrintHtml,
  gameCardHtml,
  printDocument,
  singleElimLayout,
  type PrintGame,
} from "../../src/lib/playoffs/bracket-print";
import { openSlotLabel } from "../../src/lib/public-schedule/view";
import type { PublicPlayoffGame } from "../../src/lib/public-schedule/types";
import { doubleElim, playedFour, roundRobin, singleElim } from "./bracket-print-fixtures";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    fails++;
    console.log(`  FAIL: [CRASH-${name}] ${(e as Error).message}`);
  }
}
const counters = { feederLabels: 0, byeSeats: 0, nullTrophyCase: 0, connectors: 0, scaledLayout: 0, scaledUp: 0, awayWinner: 0, screenLines: 0 };

const SIZES = [4, 6, 8, 11, 12, 16, 32];
const byNum = (gs: PrintGame[], n: number) => gs.find((g) => g.game_number === n)!;
const toPublic = (g: PrintGame): PublicPlayoffGame => ({
  id: g.id, playoff_id: "p", format: "single_elimination", division_id: "d", round: g.round,
  game_number: g.game_number, scheduled_date: g.scheduled_date, start_time: g.start_time, status: g.status,
  home_team: g.home_team_id ? { id: g.home_team_id, name: g.home_team_name ?? "" } : null,
  away_team: g.away_team_id ? { id: g.away_team_id, name: g.away_team_name ?? "" } : null,
  venue: null as unknown as PublicPlayoffGame["venue"],
});

// ─── F: feeders agree with advancement, and with the public page ────────────

section("F", () => {
  for (const n of SIZES) {
    const games = singleElim(n, 0);
    const pub = games.map(toPublic);
    const firstRound = games.reduce((a, g) => (g.game_number < a.game_number ? g : a)).round;
    for (const g of games) {
      for (const side of ["home", "away"] as const) {
        const field = side === "home" ? "home_team_id" : "away_team_id";
        const feeder = singleElimFeeder(g, field, games);
        if (feeder) {
          const t = singleElimTarget(feeder, games);
          ok(!!t && t.target.id === g.id && t.field === field, "[F1]",
            `${n} teams: game ${feeder.game_number} is called the feeder of game ${g.game_number} ${side}, but advances to ${t ? `${t.target.game_number} ${t.field}` : "nothing"}`);
          counters.feederLabels++;
        } else if (g.round !== firstRound) {
          ok(!!g[field], "[F2]", `${n} teams: game ${g.game_number} ${side} has no feeder and no team`);
          if (g[field]) counters.byeSeats++;
        }
        const ours = g[field] ? null : emptySlotLabel(g, side, games, "single_elimination");
        const theirs = g[field] ? null : openSlotLabel(toPublic(g), side, pub);
        ok(ours === theirs, "[F3]", `${n} teams: game ${g.game_number} ${side} — print says ${ours}, public page says ${theirs}`);
      }
    }
  }
});

// ─── L: labels as literals ───────────────────────────────────────────────────

section("L", () => {
  const m = singleElim(11, 0);
  const lab = (n: number, side: "home" | "away") => emptySlotLabel(byNum(m, n), side, m, "single_elimination");
  ok(JSON.stringify(m.filter((g) => g.round === "R1").map((g) => g.game_number)) === "[2,6,8]", "[L1]", "the Majors shape: round-1 games 2, 6, 8");
  // Labels SHOW numbers (bracket-labels gameNumbering, 2026-10-20): the 10
  // games that exist — stored 2, 6, 8, 9…15 — read Games 1–10.
  ok(lab(9, "away") === "Winner of Game 1" && lab(11, "away") === "Winner of Game 2" && lab(12, "away") === "Winner of Game 3", "[L1]",
    `round 2: ${lab(9, "away")} / ${lab(11, "away")} / ${lab(12, "away")}`);
  ok(lab(13, "home") === "Winner of Game 4" && lab(13, "away") === "Winner of Game 5" && lab(14, "home") === "Winner of Game 6"
     && lab(14, "away") === "Winner of Game 7" && lab(15, "home") === "Winner of Game 8" && lab(15, "away") === "Winner of Game 9", "[L1]",
    "semifinals and final");
  ok(byNum(m, 10).home_team_id !== null && byNum(m, 10).away_team_id !== null, "[L1]", "game 10's two teams both arrived by bye");
  ok(lab(2, "home") === "TBD", "[L2]", "a round-1 slot has no feeder: TBD");
  const rr = roundRobin(6);
  ok(emptySlotLabel(rr[0], "home", rr, "round_robin") === "TBD", "[L2]", "round robin: TBD");
  const de = doubleElim(8);
  const gf = de.find((g) => g.round === "GF")!;
  ok(emptySlotLabel(gf, "home", de, "double_elimination") === "TBD", "[L2]", "double elimination: TBD");
  ok(emptySlotLabel(byNum(m, 13), "home", m, "double_elimination") === "TBD", "[L2]", "the format decides, not the shape");
});

// ─── T: the trophy rule ──────────────────────────────────────────────────────

section("T", () => {
  ok(!slotWon(null, null), "[T1]", "an empty slot in an undecided game is not the winner");
  counters.nullTrophyCase++;
  ok(!slotWon(undefined, null) && !slotWon(null, "a") && !slotWon("a", null) && !slotWon("a", "b") && slotWon("a", "a"), "[T1]", "only a decided, matching slot wins");
  const g = playedFour();
  const final = byNum(g, 3);
  const finalCard = gameCardHtml(final, g, "single_elimination");
  ok(!finalCard.includes("data-trophy"), "[T2]", "an unplayed game with an empty slot prints no trophy");
  const g1Card = gameCardHtml(byNum(g, 1), g, "single_elimination");
  ok((g1Card.match(/data-trophy/g) ?? []).length === 1 && /data-row="home"[^]*data-trophy[^]*data-row="away"/.test(g1Card), "[T2]", "the decided game shows exactly one trophy, on its winner (home)");
  ok(finalCard.includes("Winner of Game 2") && !finalCard.includes(">TBD<"), "[T3]", "the final's empty slot names its feeder");
});

// ─── G: the two-tone card; the winner is never a row colour ─────────────────

const rowBg = (card: string, side: "home" | "away") => {
  const m = card.match(new RegExp(`data-row="${side}" style="[^"]*?background:([^;"]+);([^"]*)"`));
  return m ? { bg: m[1], rest: m[2] } : null;
};

section("G", () => {
  const m = singleElim(11, 5);
  for (const g of m) {
    const c = gameCardHtml(g, m, "single_elimination");
    const home = rowBg(c, "home"), away = rowBg(c, "away");
    ok(home?.bg === "white" && away?.bg === PRINT_COLORS.awayRowBg, "[G1]", `game ${g.game_number}: home ${home?.bg}, away ${away?.bg}`);
    ok(!!away && away.rest.includes("-webkit-print-color-adjust:exact") && away.rest.includes("print-color-adjust:exact"), "[G1]",
      `game ${g.game_number}: the away row's green is not kept in print`);
  }
  const doc = printDocument("", "t", "landscape");
  ok(doc.includes("-webkit-print-color-adjust: exact") && doc.includes("print-color-adjust: exact"), "[G1]", "the document keeps backgrounds in print");
  // A winner in either row keeps that row's normal colour: bold + trophy only.
  const g = playedFour();
  const g1 = gameCardHtml(byNum(g, 1), g, "single_elimination");
  const g2game = byNum(g, 2);
  g2game.status = "completed"; g2game.home_score = 1; g2game.away_score = 4; g2game.winner_id = g2game.away_team_id;
  const g2 = gameCardHtml(g2game, g, "single_elimination");
  ok(rowBg(g1, "home")?.bg === "white" && rowBg(g2, "away")?.bg === PRINT_COLORS.awayRowBg
     && (g1 + g2).match(/background:[^;"]+/g)!.every((b) => b === "background:white" || b === `background:${PRINT_COLORS.awayRowBg}` || b === `background:${PRINT_COLORS.border}`),
    "[G2]", "a winner's row is coloured like any other row of its side");
  ok(/data-row="away"[^]*font-weight:700[^]*data-trophy/.test(g2), "[G2]", "an away winner is bold with a trophy");
  counters.awayWinner++;
});

// ─── D: the date line ────────────────────────────────────────────────────────

section("D", () => {
  // A full (gapless) bracket of 12: shown numbers equal stored ones here; the
  // gap case is sim:playoff-numbers.
  const G = (n: number) => ({ game_number: n });
  const FULL = Array.from({ length: 12 }, (_, i) => G(i + 1));
  ok(gameWhen(G(9), FULL, "2026-10-29", "17:15:00") === "Game 9 · Thu 10/29 · 5:15 PM", "[D1]", gameWhen(G(9), FULL, "2026-10-29", "17:15:00"));
  ok(gameWhenLine(G(4), FULL, "2026-11-07", "10:45", "Andrews") === "Game 4 · Sat 11/7 · 10:45 AM · Andrews", "[D1]", "Whit's example");
  ok(gameWhen(G(11), FULL, null, null) === "Game 11 · Date TBD" && gameWhenLine(G(11), FULL, null, null, "Andrews") === "Game 11 · Date TBD", "[D1]", "undated");
  ok(gameWhen(G(3), FULL, "2026-11-01", null) === "Game 3 · Sun 11/1", "[D1]", "date without time");
  const m = singleElim(11, 5);
  const card = gameCardHtml(byNum(m, 9), m, "single_elimination");
  // Stored 9 is the 4th game that exists; stored 11 the 6th.
  ok(card.includes("Game 4 · Thu 10/29 · 5:15 PM") && card.includes("Polley Field @ Ives Park (SLL)"), "[D2]", "the printed card carries the date, time and field");
  const undated = gameCardHtml(byNum(m, 11), m, "single_elimination");
  ok(undated.includes("Game 6 · Date TBD"), "[D2]", "an undated card says Date TBD");
});

// ─── P: the tree layout ──────────────────────────────────────────────────────

section("P", () => {
  for (const n of SIZES) {
    const games = singleElim(n, 0);
    const L = singleElimLayout(games);
    const card = new Map(L.cards.map((c) => [c.game.id, c]));
    const centre = (id: string) => card.get(id)!.y + CARD_H / 2;
    let advancing = 0;
    for (const c of L.cards) {
      ok(c.x >= 0 && c.y >= 0 && c.x + CARD.width <= L.width + 0.5 && c.y + CARD_H <= L.height + 0.5, "[P1]",
        `${n} teams: game ${c.game.game_number} outside the canvas`);
      const t = singleElimTarget(c.game, games);
      if (!t) continue;
      advancing++;
      const tc = card.get(t.target.id)!;
      const slotSpan = (tc.y + CARD_H / 2) - card.get(c.game.id)!.y;
      const above = centre(c.game.id) < centre(t.target.id);
      ok(above === (t.field === "home_team_id") && Math.abs(centre(c.game.id) - centre(t.target.id)) <= Math.abs(slotSpan) + CARD_H,
        "[P2]", `${n} teams: game ${c.game.game_number} is not beside the ${t.field} of game ${t.target.game_number}`);
    }
    const fromSet = new Set(L.connectors.map((c) => c.from));
    ok(L.connectors.length === advancing && fromSet.size === advancing, "[P3]",
      `${n} teams: ${L.connectors.length} connectors for ${advancing} advancing games`);
    for (const con of L.connectors) {
      const to = L.cards.find((c) => c.game.game_number === con.to)!;
      const [ex, ey] = con.points[con.points.length - 1];
      const rowY = to.y + 1 + CARD.metaH + (con.side === "home_team_id" ? CARD.rowH / 2 : CARD.rowH + 1 + CARD.rowH / 2);
      ok(Math.abs(ex - to.x) < 0.5 && Math.abs(ey - rowY) < 0.5, "[P3]", `${n} teams: line ${con.from}→${con.to} ends off its row`);
      counters.connectors++;
    }
    const fits = L.width * L.scale <= PAGE.width + 0.5 && L.height * L.scale <= PAGE.height;
    if (n <= 8) {
      ok(L.scale > 1 && L.scale <= MAX_SCALE && fits && L.height < SCALE_UP_BELOW * PAGE.height, "[P4]",
        `${n} teams: a small bracket should scale up (≤ ${MAX_SCALE}) and still fit — scale ${L.scale}`);
      ok(10 * L.scale <= 14.0001, "[P4]", `${n} teams: team names ${10 * L.scale}pt exceed 14pt`);
      if (L.scale > 1) counters.scaledUp++;
    } else if (n <= 16) {
      ok(L.scale === 1 && fits, "[P4]", `${n} teams: scale ${L.scale}, ${L.width}×${L.height} on ${PAGE.width}×${PAGE.height}`);
    } else {
      ok(L.scale < 1 && L.width * L.scale <= PAGE.width + 0.5 && L.height * L.scale <= PAGE.height, "[P4]", `${n} teams: scaled ${L.scale} still does not fit`);
      if (L.scale < 1) counters.scaledLayout++;
    }
  }
  const doc = printDocument(buildBracketPrintHtml(singleElim(11, 5), "single_elimination", "L", "Majors", "October 13, 2026"), "t", "landscape");
  ok(doc.includes("size: letter landscape"), "[P5]", "the bracket prints landscape");

  // The ON-SCREEN tree: the same layout with the screen card's dimensions.
  ok(JSON.stringify(singleElimLayout(singleElim(11, 0))) === JSON.stringify(singleElimLayout(singleElim(11, 0), PRINT_TREE)), "[P6]",
    "the print's default dimensions are PRINT_TREE");
  for (const n of SIZES) {
    const games = singleElim(n, 0);
    const L = singleElimLayout(games, SCREEN_TREE);
    const D = SCREEN_TREE;
    const byRound = new Map<number, typeof L.cards>();
    for (const c of L.cards) byRound.set(c.round, [...(byRound.get(c.round) ?? []), c]);
    for (const cs of byRound.values()) {
      const ys = cs.map((c) => c.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) ok(ys[i] - ys[i - 1] >= D.cardH, "[P6]", `${n} teams on screen: two cards overlap`);
    }
    let advancing = 0;
    for (const c of L.cards) {
      if (!singleElimTarget(c.game, games)) continue;
      advancing++;
    }
    ok(L.connectors.length === advancing, "[P6]", `${n} teams on screen: ${L.connectors.length} lines for ${advancing} advancing games`);
    for (const con of L.connectors) {
      const from = L.cards.find((c) => c.game.game_number === con.from)!;
      const to = L.cards.find((c) => c.game.game_number === con.to)!;
      const [sx, sy] = con.points[0];
      const [ex, ey] = con.points[con.points.length - 1];
      const rowY = to.y + D.rowTop + (con.side === "home_team_id" ? D.rowH / 2 : D.rowH + D.divider + D.rowH / 2);
      ok(Math.abs(sx - (from.x + D.cardW)) < 0.5 && Math.abs(sy - (from.y + D.rowTop + D.rowH + D.divider / 2)) < 0.5 && Math.abs(ex - to.x) < 0.5 && Math.abs(ey - rowY) < 0.5,
        "[P6]", `${n} teams on screen: line ${con.from}→${con.to} does not run from the card's edge at its row divider into the target row`);
      counters.screenLines++;
    }
  }
  ok(SCREEN_TREE.cardH === 1 + 40 + 32 + 1 + 32 + 32 + 1 && SCREEN_TREE.rowTop === 41 && SCREEN_TREE.rowH === 32, "[P6]",
    "SCREEN_TREE matches the card's bands (h-10, h-8 ×2 + divider, h-8, borders)");
});

// ─── C: contrast ─────────────────────────────────────────────────────────────

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (hex: string) => 1.05 / (lum(hex) + 0.05);
const contrastOn = (fg: string, bg: string) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

section("C", () => {
  for (const k of ["text", "heading", "meta", "placeholder"] as const) {
    ok(contrast(PRINT_COLORS[k]) >= 7, "[C1]", `${k} ${PRINT_COLORS[k]} contrast ${contrast(PRINT_COLORS[k]).toFixed(2)}`);
  }
  for (const k of ["text", "winText", "meta", "placeholder"] as const) {
    const r = contrastOn(PRINT_COLORS[k], PRINT_COLORS.awayRowBg);
    ok(r >= 7, "[C1]", `${k} on the away-row green: ${r.toFixed(2)}`);
  }
  for (const k of ["line", "border"] as const) {
    ok(contrast(PRINT_COLORS[k]) >= 4.5, "[C1]", `${k} ${PRINT_COLORS[k]} contrast ${contrast(PRINT_COLORS[k]).toFixed(2)}`);
  }
  const html = buildBracketPrintHtml(singleElim(11, 5), "single_elimination", "L", "Majors", "October 13, 2026");
  ok(html.includes(`color:${PRINT_COLORS.heading}">Round 1<`), "[C2]", "round headings use the heading colour");
  ok(html.includes(`color:${PRINT_COLORS.meta}">Printed`), "[C2]", "the Printed line uses the meta colour");
  ok(html.includes(`color:${PRINT_COLORS.placeholder};font-style:italic">Winner of Game 2<`), "[C2]", "placeholders use the placeholder colour");
  ok(contrastOn(PRINT_COLORS.awayRowBg, "#ffffff") >= 1.08, "[C3]", "the away-row green is visibly different from white");
  ok(html.includes(`stroke="${PRINT_COLORS.line}"`), "[C2]", "lines use the line colour");
});

// ─── S: wiring ───────────────────────────────────────────────────────────────

section("S", () => {
  const modal = read("src/components/playoffs/playoff-export-modal.tsx");
  ok(modal.includes("buildBracketPrintHtml(games, format, leagueName, divisionName, printedOn())") && modal.includes('"landscape",')
     && !modal.includes("function buildBracketHtml"), "[S1]", "the export modal prints the shared builder, landscape");
  const view = read("src/components/playoffs/bracket-view.tsx");
  ok((view.match(/slotWon\(game\.winner_id, game\.(home|away)_team_id\)/g) ?? []).length === 4
     && !/game\.winner_id === game\.(home|away)_team_id/.test(view), "[S2]", "both bracket renderings decide winners with slotWon");
  ok(view.includes("slotName(side === \"home\" ? g.home_team_name : g.away_team_name, g, side, games, format)")
     && view.includes('name={labelOf(game, "home")}') && !view.includes('"TBD vs TBD"'), "[S3]", "the bracket view names empty slots with slotName");
  ok(view.includes("${away ? AWAY_ROW_BG : \"bg-white\"}") && view.includes('const AWAY_ROW_BG = "bg-[#e6f4ea]";')
     && !/won \? "bg-/.test(view) && /name=\{labelOf\(game, "away"\)\}\s*\n\s*away\n/.test(view), "[S5]", "the on-screen card is two-tone and never colours the winner's row");
  const result = read("src/components/playoffs/enter-result-modal.tsx");
  ok(result.includes('slotName(game.home_team_name, game, "home", allGames, format)') && !result.includes('?? "Home"'), "[S4]", "the result modal names empty slots with slotName");
  ok(view.includes("const L = singleElimLayout(games, SCREEN_TREE);") && !view.includes("function gameTop(") && !view.includes("V_SLOT")
     && view.includes("style={{ height: SCREEN_TREE.cardH }}") && view.includes('className="h-10 flex-none border-b')
     && view.includes("flex h-8 flex-none items-center gap-2 px-2.5") && view.includes("flex h-8 flex-none items-center border-t"),
    "[S7]", "the on-screen tree uses the shared layout and the card keeps the bands SCREEN_TREE measures");
  const pub = read("src/lib/public-schedule/view.ts");
  ok(pub.includes("return emptySlotLabel(asRow(game), side, bracket.map(asRow), game.format);") && !pub.includes("singleElimFirstNumber"),
    "[S6]", "the public page has no label arithmetic of its own");
});

for (const [name, n] of Object.entries(counters)) ok(n > 0, "[AV]", `counter ${name} is ${n}`);
console.log(`bracket-print: ${checks - fails}/${checks} checks passed  ${JSON.stringify(counters)}`);
if (fails) process.exit(1);

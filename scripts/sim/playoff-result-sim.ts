// Harness for entering and clearing a playoff result — the pure decisions and
// sentences in src/lib/playoffs/playoff-result.ts, the routing in
// enter-result.ts, and the CROSS-CHECK of the advancement rule. The database
// side (0108: enter_playoff_result, clear_playoff_result,
// playoff_single_elim_target) is proven by scripts/sim/playoff-result-sim.sql.
//
// Nothing here reads a clock or depends on the host zone; it runs under three
// zones anyway, like the other wording sims. Every expected value is a literal.
//
// WHAT IT PINS (sections run in this order — a mutant must die at its own)
// - XC: the table between the XC-TABLE-BEGIN / XC-TABLE-END markers in
//   playoff-result-sim.sql (the ONE copy, which the SQL harness runs through
//   playoff_single_elim_target) is parsed out of that file. Its bracket layout
//   must equal buildSingleElimination's output for 4, 6 and 8 teams, and
//   computeSingleElimAdvancement must return every target and slot in it. A
//   missing, duplicated or malformed block is a failure, never a skip.
// - R: routing — single elimination and round robin go to the database,
//   double elimination keeps the browser path and is never offered a clear;
//   the result button shows on a game with a result even when a slot is
//   empty; Save needs both teams.
// - E: every refusal key 0108 raises (read from the migration file) has a
//   sentence; every sentence says nothing was saved or how to start over; an
//   unknown error is never success.
// - O: outcomes — a reply is success only when committed FOR THE GAME ASKED
//   ABOUT; a preview that came back committed is not a preview; a blocked
//   reply names the later game and its result and says to clear it first.
// - C: the clear confirm's lines, exactly.
// - S: source wiring (greps — weak by nature, stated): the two RPCs are
//   called only from enter-result.ts / clear-result.ts; the only direct
//   playoff_games writes left are in the double-elimination browser path; the
//   modal and the bracket view use the shared pieces.
//
// ANTI-VACUITY: counters for cross-check targets compared, bye seats in the
// table, a blocked reply rendered, a reply for another game refused. A zero
// fails the run.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:playoff-result:mutants, all three zones). See the run log in
// scripts/sim/playoff-result-mutants.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSingleElimination } from "../../src/lib/playoffs/bracket-plan";
import { computeSingleElimAdvancement, type GameRow } from "../../src/lib/playoffs/advancement";
import {
  DOUBLE_ELIM_CLEAR_REFUSAL,
  NOTHING,
  RESULT_REFUSAL_KEYS,
  clearCommitOutcome,
  clearConfirm,
  clearOffered,
  clearPreviewOutcome,
  enterOutcome,
  nextGameBlockedMessage,
  resultButtonShown,
  resultErrorMessage,
  resultPath,
  saveBlockedReason,
} from "../../src/lib/playoffs/playoff-result";

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

const counters = { xcTargets: 0, byeSeats: 0, blockedRendered: 0, otherGameRefused: 0 };

// ─── XC: the cross-check ─────────────────────────────────────────────────────

type XcRow = {
  n: number; round: string; gameNumber: number;
  homeSeed: number | null; awaySeed: number | null;
  targetNumber: number | null; targetField: string | null;
};

section("XC", () => {
  const sql = read("scripts/sim/playoff-result-sim.sql");
  const lines = sql.split("\n");
  const begins = lines.filter((l) => l.includes("XC-TABLE-BEGIN"));
  const ends = lines.filter((l) => l.includes("XC-TABLE-END"));
  // The header mentions the markers in prose; the block markers are the lines
  // that are exactly the marker comment.
  const bIdx = lines.findIndex((l) => l.trim() === "-- XC-TABLE-BEGIN");
  const eIdx = lines.findIndex((l) => l.trim() === "-- XC-TABLE-END");
  ok(lines.filter((l) => l.trim() === "-- XC-TABLE-BEGIN").length === 1
     && lines.filter((l) => l.trim() === "-- XC-TABLE-END").length === 1
     && bIdx >= 0 && eIdx > bIdx,
    "[XC1]", `the table block must appear exactly once (begin lines ${begins.length}, end lines ${ends.length})`);
  if (!(bIdx >= 0 && eIdx > bIdx)) return;

  const ROW = /^\(\s*(\d+),\s*'([^']+)',\s*(\d+),\s*(\d+|null),\s*(\d+|null),\s*(\d+|null),\s*('[^']+'|null)\s*\),?$/;
  const rows: XcRow[] = [];
  for (const raw of lines.slice(bIdx + 1, eIdx)) {
    const l = raw.trim();
    if (l === "") continue;
    const m = l.match(ROW);
    ok(!!m, "[XC1]", `unreadable table line: ${l}`);
    if (!m) continue;
    const n = (v: string) => (v === "null" ? null : Number(v));
    rows.push({
      n: Number(m[1]), round: m[2], gameNumber: Number(m[3]),
      homeSeed: n(m[4]), awaySeed: n(m[5]), targetNumber: n(m[6]),
      targetField: m[7] === "null" ? null : m[7].slice(1, -1),
    });
  }
  ok(rows.length === 15 && rows.filter((r) => r.targetNumber !== null).length === 12,
    "[XC1]", `the table is not 15 games / 12 targets: ${rows.length}`);

  for (const size of [4, 6, 8]) {
    const table = rows.filter((r) => r.n === size).sort((a, b) => a.gameNumber - b.gameNumber);
    const seeds = Array.from({ length: size }, (_, i) => ({ team_id: `S${i + 1}`, team_name: `S${i + 1}` }));
    const built = buildSingleElimination(
      seeds,
      { playoffId: "p", leagueId: "l", divisionId: "d" },
      { pick: () => null, skippedForOrder: () => 0 },
    );
    const seedOf = (id: string | null) => (id ? Number(id.slice(1)) : null);
    const layout = built
      .map((g) => `${g.round}#${g.game_number} ${seedOf(g.home_team_id)}v${seedOf(g.away_team_id)}`)
      .sort().join(" | ");
    const tableLayout = table
      .map((r) => `${r.round}#${r.gameNumber} ${r.homeSeed}v${r.awaySeed}`)
      .sort().join(" | ");
    ok(layout === tableLayout, "[XC1]", `${size}-team layout differs from the generator:\n      generator ${layout}\n      table     ${tableLayout}`);

    const games: GameRow[] = built.map((g, i) => ({
      id: `g${i}`, round: g.round, game_number: g.game_number,
      home_team_id: g.home_team_id, away_team_id: g.away_team_id, winner_id: null,
    }));
    for (const r of table) {
      const game = games.find((g) => g.game_number === r.gameNumber);
      ok(!!game, "[XC1]", `${size}-team game ${r.gameNumber} not in the generated bracket`);
      if (!game) continue;
      const adv = computeSingleElimAdvancement(game, "W", games);
      ok(!("blocked" in adv), "[XC1]", `${size}-team game ${r.gameNumber} blocked`);
      if ("blocked" in adv) continue;
      const w = adv.writes[0] ?? null;
      const target = w ? games.find((g) => g.id === w.gameId)!.game_number : null;
      ok(target === r.targetNumber && (w?.field ?? null) === r.targetField, "[XC1]",
        `${size}-team game ${r.gameNumber}: advancement.ts says (${target}, ${w?.field ?? null}), table says (${r.targetNumber}, ${r.targetField})`);
      if (r.targetNumber !== null) counters.xcTargets++;
    }
    for (const r of table) {
      if (r.round !== "R1" && (r.homeSeed !== null) !== (r.awaySeed !== null)) counters.byeSeats++;
    }
  }
});

// ─── R: routing ──────────────────────────────────────────────────────────────

section("R", () => {
  ok(resultPath("single_elimination") === "database" && resultPath("round_robin") === "database", "[R1]", "single elimination and round robin go to the database");
  ok(resultPath("double_elimination") === "browser", "[R1]", "double elimination keeps the browser path");
  ok(clearOffered("single_elimination") && clearOffered("round_robin") && !clearOffered("double_elimination"), "[R2]", "clear offered for single / round robin only");
  ok(resultButtonShown(false, true) && resultButtonShown(true, false) && !resultButtonShown(false, false), "[R3]", "the result button shows with a result even when a slot is empty");
  ok(saveBlockedReason("a", null) === "Both teams have to be set before a result can be entered." && saveBlockedReason("a", "b") === null, "[R4]", "Save needs both teams");
});

// ─── E: refusals ─────────────────────────────────────────────────────────────

section("E", () => {
  const mig = read("supabase/migrations/0108_playoff_result_enter_clear.sql");
  const keys = [...new Set([...mig.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]))];
  ok(keys.length >= 12, "[E1]", `expected the migration's refusal keys, found ${keys.length}`);
  for (const k of keys) {
    ok(RESULT_REFUSAL_KEYS.includes(k), "[E1]", `0108 raises '${k}' with no sentence`);
    const s = resultErrorMessage(`ERROR: ${k}`);
    ok(s.startsWith(NOTHING) || s === DOUBLE_ELIM_CLEAR_REFUSAL, "[E2]", `'${k}' does not say nothing was saved: ${s}`);
  }
  for (const k of ["slot_occupied", "advancement_mismatch", "format_not_supported"]) {
    ok(resultErrorMessage(k).includes("delete the bracket and build it again"), "[E3]", `'${k}' leaves no way out`);
  }
  ok(resultErrorMessage("format_not_supported") === "Clearing results isn't available for double-elimination brackets yet. To start over, delete the bracket and build it again — deleting is allowed even with results.", "[E3]", "the double-elimination wording");
  ok(resultErrorMessage("boom") === `${NOTHING} boom`, "[E4]", "an unknown error says nothing was saved");
});

// ─── O: outcomes ─────────────────────────────────────────────────────────────

const NEXT = { game_number: 5, round: "F", home_name: "Expos", away_name: "Mets", home_score: 5, away_score: 3 };
const PREVIEW = {
  committed: false, blocked: false, game_id: "g2", game_number: 2, round: "R1",
  home_name: "Expos", away_name: "Bears", home_score: 4, away_score: 2, winner_name: "Expos",
  on_public_schedule: true,
  removed: { game_id: "g5", game_number: 5, round: "F", field: "home_team_id", team_name: "Expos" },
};

section("O", () => {
  ok(enterOutcome({ committed: true, game_id: "g1" }, null, "g1").ok, "[O1]", "a committed reply for this game is success");
  const other = enterOutcome({ committed: true, game_id: "g9" }, null, "g1");
  ok(!other.ok, "[O1]", "a committed reply for ANOTHER game is not success");
  if (!other.ok) counters.otherGameRefused++;
  ok(!enterOutcome({ committed: false, game_id: "g1" }, null, "g1").ok && !enterOutcome(null, null, "g1").ok, "[O1]", "an uncommitted or empty reply is not success");
  const err = enterOutcome(null, { message: "P0001: plan_required" }, "g1");
  ok(!err.ok && err.message === "Nothing was saved. Playoff brackets are part of the Elite plan.", "[O1]", JSON.stringify(err));

  const blocked = enterOutcome({ committed: false, blocked: true, reason: "next_game_has_result", game_id: "g1", next_game: NEXT }, null, "g1");
  ok(!blocked.ok && blocked.message === "Game 5 (Final) already has a result (Expos 5, Mets 3). Clear that game's result first, then change this one.", "[O2]", JSON.stringify(blocked));
  if (!blocked.ok) counters.blockedRendered++;
  const blockedClear = clearCommitOutcome({ committed: false, blocked: true, game_id: "g1", next_game: NEXT }, null, "g1");
  ok(!blockedClear.ok && blockedClear.message === "Game 5 (Final) already has a result (Expos 5, Mets 3). Clear that game's result first, then clear this one.", "[O2]", JSON.stringify(blockedClear));
  ok(nextGameBlockedMessage(null, "clear") === "A later game already has a result. Clear that game's result first, then clear this one.", "[O2]", "an unreadable next game still says what to do");

  const pv = clearPreviewOutcome(PREVIEW, null, "g2");
  ok(pv.ok && pv.preview.removed?.gameNumber === 5 && pv.preview.onPublicSchedule, "[O3]", JSON.stringify(pv));
  ok(!clearPreviewOutcome({ ...PREVIEW, committed: true }, null, "g2").ok, "[O3]", "a preview that came back committed is not a preview");
  ok(!clearPreviewOutcome(PREVIEW, null, "g3").ok, "[O3]", "a preview for another game is refused");
  ok(!clearPreviewOutcome({ ...PREVIEW, removed: { team_name: "x" } }, null, "g2").ok, "[O3]", "an unreadable removal is refused, never dropped");
  ok(!clearPreviewOutcome({ ...PREVIEW, on_public_schedule: undefined }, null, "g2").ok, "[O3]", "an unreadable public flag is refused");

  ok(clearCommitOutcome({ ...PREVIEW, committed: true }, null, "g2").ok, "[O4]", "a committed clear for this game is success");
  ok(!clearCommitOutcome({ ...PREVIEW, committed: true, game_id: "g9" }, null, "g2").ok, "[O4]", "a committed clear for another game is not success");
  ok(!clearCommitOutcome(PREVIEW, null, "g2").ok, "[O4]", "an uncommitted reply to a commit is not success");
  const zr = clearCommitOutcome(null, { message: "nothing_saved" }, "g2");
  ok(!zr.ok && zr.message === "Nothing was saved. The game changed while you were looking at it. Refresh the page and try again.", "[O4]", JSON.stringify(zr));
});

// ─── C: the confirm ──────────────────────────────────────────────────────────

section("C", () => {
  const pv = clearPreviewOutcome(PREVIEW, null, "g2");
  if (!pv.ok) { ok(false, "[C1]", "fixture preview unreadable"); return; }
  const c = clearConfirm(pv.preview);
  ok(c.title === "Clear this result?", "[C1]", c.title);
  ok(JSON.stringify(c.lines) === JSON.stringify([
    "Game 2 (Round 1) — Expos 4, Bears 2 (Expos won).",
    "The score and winner will be removed and the game goes back to scheduled.",
    "Expos will be removed from Game 5 (Final) until this game has a result again.",
    "This is on your public schedule — the change shows there within a minute.",
  ]), "[C1]", JSON.stringify(c.lines));
  const rr = clearConfirm({ ...pv.preview, round: "RR2", removed: null, onPublicSchedule: false });
  ok(JSON.stringify(rr.lines) === JSON.stringify([
    "Game 2 (Round 2) — Expos 4, Bears 2 (Expos won).",
    "The score and winner will be removed and the game goes back to scheduled.",
  ]), "[C2]", JSON.stringify(rr.lines));
});

// ─── S: source wiring ────────────────────────────────────────────────────────

section("S", () => {
  const enter = read("src/lib/playoffs/enter-result.ts");
  const [dbPart, browserPart] = enter.split("async function enterDoubleElimResultInBrowser(");
  ok(dbPart.includes('  if (resultPath(format) === "database") {\n    const supabase = createClient();\n    const { data, error } = await supabase.rpc("enter_playoff_result"')
     && dbPart.includes("enterOutcome(data, error, payload.gameId)")
     && !dbPart.includes('.from("playoff_games")'), "[S1]", "single / round robin call the function and write nothing directly");
  ok(!!browserPart && browserPart.includes("computeDoubleElimAdvancement") && !browserPart.includes("computeSingleElimAdvancement"),
    "[S1]", "the browser path is double elimination only");
  const clear = read("src/lib/playoffs/clear-result.ts");
  ok(clear.includes('rpc("clear_playoff_result"') && clear.includes("p_commit: false") && clear.includes("p_commit: true")
     && clear.includes("clearCommitOutcome(data, error, gameId)"), "[S2]", "clear previews, then commits, and reads the outcome");
  const modal = read("src/components/playoffs/enter-result-modal.tsx");
  ok(modal.includes("previewClearResult(game.id)") && modal.includes("clearResult(game.id)")
     && modal.includes("clearConfirm(clearPreview)") && modal.includes("<ConfirmDialog")
     && modal.includes("isDone && clearOffered(format)"), "[S3]", "the modal previews, confirms with the shared dialog, and offers clear only where allowed");
  ok(modal.indexOf("<ConfirmDialog") > modal.lastIndexOf('onClick={onClose}>'), "[S3]", "the confirm renders outside the modal backdrop");
  const view = read("src/components/playoffs/bracket-view.tsx");
  ok((view.match(/resultButtonShown\(bothTeams, isDone\)/g) ?? []).length === 2, "[S4]", "both bracket renderings use the shared button rule");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

for (const [name, n] of Object.entries(counters)) ok(n > 0, "[AV]", `counter ${name} is ${n}`);
ok(counters.xcTargets === 12 && counters.byeSeats === 2, "[AV]", JSON.stringify(counters));
console.log(`playoff-result: ${checks - fails}/${checks} checks passed  ${JSON.stringify(counters)}`);
if (fails) process.exit(1);

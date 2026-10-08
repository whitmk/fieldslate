// Harness for deleting and rebuilding a playoff bracket — the pure decisions
// and sentences in src/lib/playoffs/bracket-delete.ts. The database side (0107:
// delete_playoff_bracket, replace_playoff_games) is proven separately by
// scripts/sim/playoff-bracket-delete-sim.sql.
//
// Nothing here reads a clock or depends on the host zone; it runs under three
// zones anyway (UTC, America/Los_Angeles, Pacific/Kiritimati), like the other
// wording sims. Every expected value is a literal.
//
// WHAT IT PINS (sections run in this order — a mutant must die at its own)
// - P: the RPC replies parse into counts, and ANY missing, negative,
//   fractional or non-numeric count makes the whole reply unreadable (null) —
//   never a default of 0.
// - Z: "couldn't count" is NEVER shown as 0: an unreadable delete preview
//   renders the couldn't-count sentence and no zero anywhere; an unreadable
//   rebuild preview renders its own sentence and does not block.
// - D: the delete confirm states games, dated games and results, exactly; a
//   bracket with no games says so; "This can't be undone." is last.
// - U: the public-schedule warnings — none at 0, singular and plural, and
//   the rebuild's three cases (on now and after, on now only, after only).
// - R: rebuild review — results block (preview flag OR a non-zero count),
//   with the exact refusal sentence; an unblocked rebuild states what it
//   replaces; a brand-new bracket states nothing.
// - E: every refusal key 0107 raises (read from the migration file) has a
//   sentence that says nothing was saved; an unknown error is never success;
//   a commit is success only when it comes back committed WITH readable
//   counts; a blocked reply is the results refusal.
// - A: Add bracket on a division that already has one is blocked, with the
//   pointer to Edit setup / delete; a division without one is not.
// - L: the payloads — settings never carry a division; games never carry the
//   bracket's ids or a status; a disabled cross-division opponent is null.
//
// ANTI-VACUITY: counters for a confirm with results, a public warning, a
// couldn't-count confirm, a blocked rebuild, an Add-bracket block. A zero
// fails the run.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:bracket-delete:mutants, all three zones). See the run log in
// scripts/sim/bracket-delete-mutants.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRACKET_REFUSAL_KEYS,
  COULDNT_COUNT,
  REBUILD_COULDNT_COUNT,
  addBracketBlock,
  bracketErrorMessage,
  commitOutcome,
  deleteConfirm,
  deletedLine,
  gamesPayload,
  generatedPublicLine,
  parseDeleteCounts,
  parseRebuildCounts,
  publicDeleteWarning,
  publicRebuildWarning,
  rebuildReview,
  resultsBlockSentence,
  settingsPayload,
} from "../../src/lib/playoffs/bracket-delete";
import { DEFAULT_PLAYOFF_DATA } from "../../src/components/playoffs/playoff-wizard-types";
import type { GameInsert } from "../../src/lib/playoffs/bracket-plan";

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

const counters = {
  confirmWithResults: 0,
  publicWarningShown: 0,
  couldntCountShown: 0,
  rebuildBlocked: 0,
  addBracketBlocked: 0,
};

const ROOT = join(__dirname, "../..");

const DEL_OK = { committed: false, blocked: false, reasons: [], games: 5, dated_games: 2, games_with_results: 0, public_games: 2 };
const REB_OK = { ...DEL_OK, new_games: 7, new_dated_games: 4, public_games_after: 4 };

// ── P ─────────────────────────────────────────────────────────────────────────
section("P", () => {
  const c = parseDeleteCounts(DEL_OK);
  ok(!!c && c.games === 5 && c.datedGames === 2 && c.gamesWithResults === 0 && c.publicGames === 2, "[P1]", JSON.stringify(c));
  const bad: unknown[] = [
    { ...DEL_OK, games: undefined },
    { ...DEL_OK, public_games: null },
    { ...DEL_OK, games_with_results: -1 },
    { ...DEL_OK, dated_games: 1.5 },
    { ...DEL_OK, games: "5" },
    { ...DEL_OK, public_games: Number.NaN },
    null,
    "oops",
  ];
  for (const b of bad) ok(parseDeleteCounts(b) === null, "[P2]", `unreadable reply parsed: ${JSON.stringify(b)}`);
  const r = parseRebuildCounts(REB_OK);
  ok(!!r && r.newGames === 7 && r.newDatedGames === 4 && r.publicGamesAfter === 4 && r.blocked === false, "[P3]", JSON.stringify(r));
  ok(parseRebuildCounts({ ...REB_OK, new_games: undefined }) === null, "[P4]", "missing new_games");
  ok(parseRebuildCounts({ ...REB_OK, blocked: undefined }) === null, "[P4]", "missing blocked");
});

// ── Z ─────────────────────────────────────────────────────────────────────────
section("Z", () => {
  const z = deleteConfirm("Majors", null);
  ok(z.lines[0] === COULDNT_COUNT && z.lines.length === 2 && z.lines[1] === "This can't be undone.", "[Z1]", JSON.stringify(z.lines));
  ok(!/\b0\b/.test([...z.lines, z.publicWarning ?? ""].join(" ")), "[Z1]", "a zero appears in a couldn't-count confirm");
  ok(z.publicWarning === null, "[Z1]", "public warning on an uncounted confirm");
  if (z.lines.includes(COULDNT_COUNT)) counters.couldntCountShown++;
  // End to end: a reply missing one count is couldn't-count, not zeros.
  const e2e = deleteConfirm("Majors", parseDeleteCounts({ games: 5, dated_games: 2, games_with_results: 1 }));
  ok(e2e.lines[0] === COULDNT_COUNT, "[Z2]", JSON.stringify(e2e.lines));
  const rz = rebuildReview(null);
  ok(rz.lines[0] === REBUILD_COULDNT_COUNT && !rz.blocked && rz.refusal === null && rz.publicWarning === null, "[Z3]", JSON.stringify(rz));
  ok(!/\b0\b/.test(rz.lines.join(" ")), "[Z3]", "a zero appears in an uncounted review");
});

// ── D ─────────────────────────────────────────────────────────────────────────
section("D", () => {
  const d = deleteConfirm("50/70", { games: 5, datedGames: 2, gamesWithResults: 0, publicGames: 0 });
  ok(d.title === "Delete the 50/70 playoff bracket?", "[D1]", d.title);
  ok(JSON.stringify(d.lines) === JSON.stringify([
    "This deletes the bracket and all 5 of its games (2 with a date).",
    "This can't be undone.",
  ]), "[D1]", JSON.stringify(d.lines));
  const r = deleteConfirm("T-Ball", { games: 7, datedGames: 7, gamesWithResults: 2, publicGames: 7 });
  ok(JSON.stringify(r.lines) === JSON.stringify([
    "This deletes the bracket and all 7 of its games (all have dates).",
    "2 games have a result entered. Those results are deleted too.",
    "This can't be undone.",
  ]), "[D2]", JSON.stringify(r.lines));
  if (r.lines.some((l) => l.includes("result entered"))) counters.confirmWithResults++;
  const one = deleteConfirm("AA", { games: 1, datedGames: 0, gamesWithResults: 1, publicGames: 0 });
  ok(JSON.stringify(one.lines) === JSON.stringify([
    "This deletes the bracket and its 1 game (none have dates yet).",
    "1 game has a result entered. That result is deleted too.",
    "This can't be undone.",
  ]), "[D3]", JSON.stringify(one.lines));
  const empty = deleteConfirm("Rookies", { games: 0, datedGames: 0, gamesWithResults: 0, publicGames: 0 });
  ok(JSON.stringify(empty.lines) === JSON.stringify([
    "This deletes the bracket's setup. It has no games yet.",
    "This can't be undone.",
  ]), "[D4]", JSON.stringify(empty.lines));
  ok(deletedLine("50/70", { games: 5, datedGames: 2, gamesWithResults: 0, publicGames: 2 }) ===
    "The 50/70 playoff bracket and its 5 games were deleted.", "[D5]");
  ok(deletedLine("50/70", null) === "The 50/70 playoff bracket was deleted.", "[D5]", "uncounted success line");
});

// ── U ─────────────────────────────────────────────────────────────────────────
section("U", () => {
  const w = deleteConfirm("T-Ball", { games: 7, datedGames: 7, gamesWithResults: 0, publicGames: 7 }).publicWarning;
  ok(w === "7 of these games are on your public schedule right now. Families will stop seeing them there within a minute, and they drop off calendars subscribed to that schedule.", "[U1]", String(w));
  if (w) counters.publicWarningShown++;
  ok(publicDeleteWarning(1) === "1 of these games is on your public schedule right now. Families will stop seeing it there within a minute, and it drops off calendars subscribed to that schedule.", "[U1]", "singular");
  ok(publicDeleteWarning(0) === null, "[U2]", "a warning at 0");
  ok(publicRebuildWarning(0, 0) === null, "[U2]", "a rebuild warning at 0/0");
  ok(publicRebuildWarning(2, 4) === "2 of this bracket's games are on your public schedule now. Families will see the new dates and times there within a minute.", "[U3]", String(publicRebuildWarning(2, 4)));
  ok(publicRebuildWarning(2, 0) === "2 of this bracket's games are on your public schedule now. The new games have no dates yet, so they will disappear from it within a minute.", "[U4]", String(publicRebuildWarning(2, 0)));
  ok(publicRebuildWarning(0, 3) === "3 of the new games will appear on your public schedule within a minute.", "[U5]", String(publicRebuildWarning(0, 3)));
  const rb = parseRebuildCounts({ ...REB_OK, committed: true });
  ok(generatedPublicLine(rb) === "4 of these games are now on your public schedule.", "[U6]", String(generatedPublicLine(rb)));
  ok(generatedPublicLine(null) === null && generatedPublicLine(parseRebuildCounts({ ...REB_OK, public_games_after: 0 })) === null, "[U6]", "public line with nothing public");
});

// ── R ─────────────────────────────────────────────────────────────────────────
section("R", () => {
  const blocked = rebuildReview(parseRebuildCounts({ ...REB_OK, blocked: true, games_with_results: 2 }));
  ok(blocked.blocked && blocked.refusal === "This bracket can't be rebuilt: 2 games have a result entered. Results must be cleared before a bracket is rebuilt.", "[R1]", JSON.stringify(blocked));
  if (blocked.blocked) counters.rebuildBlocked++;
  // A non-zero result count blocks even if the flag were missing its meaning.
  const byCount = rebuildReview(parseRebuildCounts({ ...REB_OK, blocked: false, games_with_results: 1 }));
  ok(byCount.blocked && byCount.refusal === resultsBlockSentence(1), "[R2]", JSON.stringify(byCount));
  ok(resultsBlockSentence(1) === "This bracket can't be rebuilt: 1 game has a result entered. Results must be cleared before a bracket is rebuilt.", "[R2]", "singular");
  const okRev = rebuildReview(parseRebuildCounts(REB_OK));
  ok(!okRev.blocked && JSON.stringify(okRev.lines) === JSON.stringify(["Generating replaces this bracket's 5 games with 7 new games."]), "[R3]", JSON.stringify(okRev));
  ok(okRev.publicWarning === publicRebuildWarning(2, 4), "[R3]", "public warning on the review");
  const fresh = rebuildReview(parseRebuildCounts({ ...REB_OK, games: 0, dated_games: 0, public_games: 0, public_games_after: 0 }));
  ok(!fresh.blocked && fresh.lines.length === 0 && fresh.publicWarning === null, "[R4]", JSON.stringify(fresh));
});

// ── E ─────────────────────────────────────────────────────────────────────────
section("E", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/0107_playoff_bracket_delete_rebuild.sql"), "utf8");
  const raised = [...new Set([...sql.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]))];
  ok(raised.length >= 10, "[E0]", `found ${raised.length} refusal keys in 0107`);
  const all = [...raised, "results_entered"];
  const missing = all.filter((k) => !BRACKET_REFUSAL_KEYS.includes(k));
  ok(missing.length === 0, "[E1]", `refusal keys with no sentence: ${missing.join(", ")}`);
  for (const k of all) ok(bracketErrorMessage(`ERROR: ${k}`).startsWith("Nothing was saved."), "[E2]", `${k} → ${bracketErrorMessage(k)}`);
  // Distinct keys get distinct sentences (no key swallowed by another's match).
  ok(new Set(all.map((k) => bracketErrorMessage(k))).size === all.length, "[E3]", "two keys share a sentence");
  ok(bracketErrorMessage('date/time field value out of range: "2026-02-30"').startsWith("Nothing was saved."), "[E4]", "an unknown error is never success");
  const del = (raw: unknown) => parseDeleteCounts(raw);
  ok(!commitOutcome(null, { message: "plan_required" }, del).ok, "[E5]", "an error reported as success");
  ok(!commitOutcome({ ...DEL_OK, committed: false }, null, del).ok, "[E5]", "an uncommitted reply reported as success");
  ok(!commitOutcome({ committed: true }, null, del).ok, "[E5]", "a committed reply without counts reported as success");
  ok(!commitOutcome(null, null, del).ok, "[E5]", "no reply reported as success");
  const good = commitOutcome({ ...DEL_OK, committed: true }, null, del);
  ok(good.ok && good.counts.games === 5, "[E6]", JSON.stringify(good));
  const blk = commitOutcome({ ...REB_OK, blocked: true, games_with_results: 2 }, null, (raw) => parseRebuildCounts(raw));
  ok(!blk.ok && blk.message === bracketErrorMessage("results_entered") && blk.blockedCounts?.gamesWithResults === 2, "[E7]", JSON.stringify(blk));
});

// ── A ─────────────────────────────────────────────────────────────────────────
section("A", () => {
  const b = addBracketBlock("50/70", true);
  ok(b === "50/70 already has a playoff bracket. To change it, use Edit setup on its card; to start over, delete it there first.", "[A1]", String(b));
  if (b) counters.addBracketBlocked++;
  ok(addBracketBlock("Majors", false) === null, "[A2]", "a division with no bracket blocked");
});

// ── L ─────────────────────────────────────────────────────────────────────────
section("L", () => {
  const data = { ...DEFAULT_PLAYOFF_DATA, division_id: "d1", division_name: "Majors", start_date: "2026-11-07", cross_division_enabled: false, cross_division_opponent_id: "d2" };
  const s = settingsPayload(data) as Record<string, unknown>;
  ok(!("division_id" in s) && !("division_name" in s) && !("cross_division_opponent_name" in s), "[L1]", `settings carry: ${Object.keys(s).join(", ")}`);
  ok(s.cross_division_opponent_id === null && s.end_date === null && s.start_date === "2026-11-07", "[L2]", JSON.stringify(s));
  ok(JSON.stringify(Object.keys(s).sort()) === JSON.stringify(["cross_division_enabled", "cross_division_opponent_id", "day_windows", "end_date", "format", "playing_days", "seeding", "start_date", "venue_assignments"]), "[L2]", Object.keys(s).join(","));
  const cross = settingsPayload({ ...data, cross_division_enabled: true }) as Record<string, unknown>;
  ok(cross.cross_division_opponent_id === "d2", "[L2]", "an enabled opponent dropped");
  const g: GameInsert = { playoff_id: "p", league_id: "l", division_id: "d", round: "R1", game_number: 2, home_team_id: "t1", away_team_id: "t2", venue_id: "v", scheduled_date: "2026-11-07", start_time: "09:00", status: "scheduled" };
  const gp = gamesPayload([g])[0] as Record<string, unknown>;
  ok(!("playoff_id" in gp) && !("league_id" in gp) && !("division_id" in gp) && !("status" in gp), "[L3]", Object.keys(gp).join(","));
  ok(gp.round === "R1" && gp.game_number === 2 && gp.home_team_id === "t1" && gp.venue_id === "v" && gp.scheduled_date === "2026-11-07" && gp.start_time === "09:00", "[L3]", JSON.stringify(gp));
});

// ── S ─────────────────────────────────────────────────────────────────────────
// Source wiring — greps, weak by nature (they check the code is CALLED, not
// that it behaves); the behaviour is pinned above and in the SQL harness.
section("S", () => {
  const src = (f: string) => readFileSync(join(ROOT, f), "utf8");
  const gen = src("src/lib/playoffs/generate-bracket.ts");
  const review = src("src/components/playoffs/steps/step-review.tsx");
  const div = src("src/components/playoffs/steps/step-division.tsx");
  const page = src("src/components/playoffs/playoffs-page-client.tsx");
  const del = src("src/lib/playoffs/delete-bracket.ts");
  // S1: the generator writes only through replace_playoff_games.
  ok(!/from\("playoff_games"\)/.test(gen) && !/from\("playoffs"\)/.test(gen), "[S1]", "generate-bracket.ts writes a playoff table directly");
  ok(/rpc\("replace_playoff_games"[\s\S]{0,200}p_commit: true/.test(gen), "[S1]", "generateBracket does not commit through replace_playoff_games");
  // S2: a new bracket's setup is an INSERT, never an upsert (no overwrite).
  ok(/from\("playoffs"\)\s*\.insert\(/.test(review) && !/\.upsert\(/.test(review), "[S2]", "the review step upserts the bracket row");
  // S3: Generate is disabled while the preview says results block it.
  ok(/disabled=\{[^}]*review\?\.blocked/.test(review), "[S3]", "Generate not disabled on a blocked rebuild");
  ok(/previewRebuild\(/.test(review) && /rebuildReview\(/.test(review), "[S3]", "the review does not run the rebuild preview");
  // S4: the division step blocks rather than overwrites.
  ok(!/will overwrite/i.test(div) && /addBracketBlock\(/.test(div) && /disabled=\{disabled\}/.test(div), "[S4]", "the division step offers an overwrite");
  // S5: the card's delete runs the preview first and keeps the dialog open
  // with the refusal.
  ok(/previewBracketDelete\(/.test(page) && /deleteConfirm\(/.test(page) && /error=\{deleteError\}/.test(page), "[S5]", "the delete confirm is not filled from the preview / does not show refusals");
  ok(/rpc\("delete_playoff_bracket"[\s\S]{0,120}p_commit: false/.test(del) && /rpc\("delete_playoff_bracket"[\s\S]{0,120}p_commit: true/.test(del), "[S5]", "delete-bracket.ts does not call the preview and the commit");
  // S6: the success screen no longer claims a draft.
  ok(!/saved as a draft/.test(review), "[S6]", "success text still says 'saved as a draft'");
});

for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));
console.log(`TZ=${process.env.TZ ?? "(host)"}  ${checks - fails}/${checks} checks passed`);
console.log(`counters: ${JSON.stringify(counters)}`);
process.exit(fails ? 1 : 0);

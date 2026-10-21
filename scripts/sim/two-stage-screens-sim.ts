// Harness for two-stage playoffs' screens (steps 4–5, 2026-10-20): the pure
// pieces the wizard, the two-stage card, the Seed screen, the public page and
// the export call. Drives the REAL functions; every expected value is a
// literal written from the approved mockup (docs/mockups/two-stage-playoffs.html)
// or worked out by hand — never recomputed with the code under test.
//
//   npm run sim:two-stage-screens            (three host zones)
//   npm run sim:two-stage-screens:mutants    (mutation pass, real source)
//
// Section order is load-bearing (each mutant must die FIRST at its own tag):
//   E export CSV → K card wording (K5: the re-check note from 0113's
//   stage1_changes) → Y payloads → V replies → B result
//   refusals → PL public labels → D delete confirm → R review → S wiring
// then ANTI-VACUITY COUNTERS — a zero counter fails the run.
//
// The screens themselves were checked on a scratch route at 1280px and 375px
// (deleted after); this harness proves the words and decisions they render.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPlayoffCsv,
  exportDuration,
  exportRound,
  noDurationNote,
  type ExportGame,
} from "../../src/lib/playoffs/playoff-export";
import {
  advancingReviewLine,
  cutLine,
  neverPlayedLine,
  parseTwoStageCounts,
  perDayLine,
  planStage2,
  recordsFootnote,
  seededLine,
  seedOutcome,
  stage1FitLine,
  stage1HeaderPill,
  stage1LockedLine,
  parseStage1Changes,
  stage1ChangesNote,
  stage1RecheckNote,
  stage1SettingsPayload,
  stage1Status,
  stage2Button,
  stage2FitLine,
  stage2GamesPayload,
  stage2HeaderPill,
  stage2SettingsPayload,
  stageRange,
  stageReviewLine,
  teamsReviewLine,
  twoStageBlockedMessage,
  twoStageCardLine,
  twoStageErrorMessage,
  twoStagePublicLine,
  twoStageReviewLines,
  type Stage1Change,
  type Stage1Game,
  type Stage2Game,
} from "../../src/lib/playoffs/two-stage";
import { blockedMessage, clearPreviewOutcome, enterOutcome, type ResultNumbering } from "../../src/lib/playoffs/playoff-result";
import { gameNumbering } from "../../src/lib/playoffs/bracket-labels";
import { deleteConfirm } from "../../src/lib/playoffs/bracket-delete";
import { buildRows } from "../../src/lib/public-schedule/view";
import type { PublicPlayoffGame, PublicSeason } from "../../src/lib/public-schedule/types";
import { DEFAULT_PLAYOFF_DATA, type PlayoffWizardData } from "../../src/components/playoffs/playoff-wizard-types";
import type { PlanSettings } from "../../src/lib/playoffs/bracket-plan";

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
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    failures.push(`[CRASH-${name}] ${msg}`);
    console.error(`  FAIL: [CRASH-${name}] ${msg}`);
  }
}
const counters = { changedGamesNamed: 0, csvRows: 0, blankEnds: 0, seedPlaceholders: 0, rrLabels: 0, blockedSentences: 0, pills: 0 };

// ── Fixtures ──────────────────────────────────────────────────────────────────
// The mockup's Majors: Stage 2 for the top 6 on Sat/Sun Nov 14–22, two fields,
// 120-minute games, 1 game per team per day.
const SETTINGS: PlanSettings = { durationMin: 120, bufferMin: 0, durationDefaulted: false, bufferDefaulted: false };
const STAGE2 = planStage2({
  advance: 6,
  ids: { playoffId: "s2", leagueId: "L", divisionId: "dMaj" },
  grid: {
    startDate: "2026-11-14",
    endDate: "2026-11-22",
    playingDays: ["Sa", "Su"],
    dayWindows: { Sa: { start: "09:00", end: "17:00" }, Su: { start: "10:00", end: "18:00" } },
    venues: [
      { id: "vA", name: "Andrews", availability: null },
      { id: "vP", name: "Perry", availability: null },
    ],
    durationMin: 120,
    bufferMin: 0,
  },
  settings: SETTINGS,
  divisionName: "Majors",
});
const VENUE: Record<string, string> = { vA: "Monroe Complex — Andrews", vP: "Monroe Complex — Perry" };
const s2Export: ExportGame[] = STAGE2.games.map((g) => ({
  id: `g${g.game_number}`,
  playoff_id: "s2",
  round: g.round,
  game_number: g.game_number,
  scheduled_date: g.scheduled_date,
  start_time: g.start_time,
  status: "scheduled",
  home_team_id: null,
  away_team_id: null,
  home_team_name: null,
  away_team_name: null,
  winner_id: null,
  seed_home: g.seed_home,
  seed_away: g.seed_away,
  venue_name: g.venue_id ? VENUE[g.venue_id] : null,
}));
const RR13: ExportGame = {
  id: "r13", playoff_id: "s1", round: "RR5", game_number: 13, scheduled_date: "2026-11-01", start_time: "10:00",
  status: "scheduled", home_team_id: "tExpos", away_team_id: "tMets", home_team_name: "Expos", away_team_name: "Mets",
  winner_id: null, venue_name: "Monroe Complex — Andrews",
};
const PAIR = { stage1Id: "s1", stage2Id: "s2" };
const HEADER = `"Start_Date","Start_Time","End_Date","End_Time","Title","Location","Event_Type"`;

// ── E: the export CSV ─────────────────────────────────────────────────────────
section("E1 the division's length, never a guess", () => {
  ok(exportDuration(120) === 120 && exportDuration("105") === 105, "E1", "a set length is used");
  ok(exportDuration(null) === null && exportDuration(0) === null && exportDuration("abc") === null && exportDuration(undefined) === null,
    "E1", "an unset or unusable length is null — never 90");
  ok(noDurationNote("Majors") === "Majors has no game length set, so End is blank in this file. Set it on the division to fill it in.",
    "E1", "the note says End is blank");
});

section("E2 End = start + the division's length", () => {
  // An ordinary bracket game with both teams: End alone is under test here
  // (round names are E4's, empty slots E3's — run 1's ordering fault).
  const plain = { ...RR13, playoff_id: "x", round: "SF", game_number: 5 };
  // The rest of its bracket: names come from the WHOLE bracket (the last round
  // is the Final), so a lone "SF" game would be a 2-team Final.
  const plainFinal = { ...plain, id: "xF", round: "F", game_number: 7, scheduled_date: "2026-11-08" };
  const csv = buildPlayoffCsv([plain, plainFinal], { divisionName: "Majors", durationMin: 120, pair: null, format: "single_elimination" });
  const lines = csv.split("\r\n");
  counters.csvRows += lines.length - 1;
  ok(lines[0] === HEADER, "E2", "the columns are unchanged", lines[0]);
  ok(lines[1] === `"11/01/2026","10:00 AM","11/01/2026","12:00 PM","Majors Playoffs - Semifinals: Expos vs Mets","Monroe Complex — Andrews","Game"`,
    "E2", "a game ends 120 minutes after it starts", lines[1]);
  const blank = buildPlayoffCsv([plain, plainFinal], { divisionName: "Majors", durationMin: null, pair: null, format: "single_elimination" }).split("\r\n")[1];
  ok(blank === `"11/01/2026","10:00 AM","11/01/2026","","Majors Playoffs - Semifinals: Expos vs Mets","Monroe Complex — Andrews","Game"`,
    "E2", "no length → End is blank", blank);
  if (blank.includes(`"11/01/2026",""`)) counters.blankEnds++;
});

section("E3 placeholders, not dropped rows", () => {
  const lines = buildPlayoffCsv(s2Export, { divisionName: "Majors", durationMin: 120, pair: PAIR, format: "round_robin" }).split("\r\n");
  ok(lines.length === 6, "E3", "all 5 dated bracket games are exported before seeding", String(lines.length - 1));
  ok(lines[1] === `"11/14/2026","09:00 AM","11/14/2026","11:00 AM","Majors Playoffs - Bracket · Round 1: Seed 4 vs Seed 5","Monroe Complex — Andrews","Game"`,
    "E3", "round 1 reads Seed 4 vs Seed 5", lines[1]);
  ok(lines[3] === `"11/15/2026","10:00 AM","11/15/2026","12:00 PM","Majors Playoffs - Bracket · Semifinals: Seed 1 vs Winner of Game 1","Monroe Complex — Andrews","Game"`,
    "E3", "a bye seed waits in the semifinal (stored 5, 2 show as Games 3, 1)", lines[3]);
  counters.seedPlaceholders += lines.filter((l) => l.includes("Seed ")).length;
  ok(lines[5] === `"11/21/2026","09:00 AM","11/21/2026","11:00 AM","Majors Playoffs - Bracket · Final: Winner of Game 3 vs Winner of Game 4","Monroe Complex — Andrews","Game"`,
    "E3", "the final reads Winner of Game 3 vs Winner of Game 4 (stored 5, 6)", lines[5]);
  const seeded = s2Export.map((g) => (g.game_number === 2 ? { ...g, home_team_id: "t1", home_team_name: "Mets", away_team_id: "t2", away_team_name: "Pirates" } : g));
  const after = buildPlayoffCsv(seeded, { divisionName: "Majors", durationMin: 120, pair: PAIR, format: "round_robin" }).split("\r\n")[1];
  ok(after.includes("Round 1: Mets vs Pirates"), "E3", "after seeding the names replace the seeds", after);
});

section("E4 round names", () => {
  const rrLine = buildPlayoffCsv([RR13], { divisionName: "Majors", durationMin: 120, pair: PAIR, format: "round_robin" }).split("\r\n")[1];
  ok(rrLine.includes("Majors Playoffs - Round robin · RR Game 13: Expos vs Mets"), "E4", "a round-robin row in the CSV", rrLine);
  // The game's whole bracket: an 8-team tree (R1, SF, F).
  const EIGHT = [{ round: "R1", game_number: 2 }, { round: "SF", game_number: 5 }, { round: "F", game_number: 7 }];
  ok(exportRound(RR13, PAIR, [RR13]) === "Round robin · RR Game 13", "E4", "Stage 1 reads RR Game N");
  counters.rrLabels++;
  ok(exportRound({ playoff_id: "s2", round: "R1", game_number: 2 }, PAIR, EIGHT) === "Bracket · Round 1", "E4", "Stage 2 names the bracket");
  ok(exportRound({ playoff_id: "x", round: "SF", game_number: 5 }, null, EIGHT) === "Semifinals", "E4", "an ordinary bracket is unchanged");
  const plain: ExportGame = { ...s2Export.find((g) => g.game_number === 5)!, playoff_id: "x", seed_home: null, seed_away: null, home_team_id: "tE", home_team_name: "Expos" };
  const plainAll = s2Export.map((g) => ({ ...g, playoff_id: "x", seed_home: null, seed_away: null })).map((g) => (g.game_number === 5 ? plain : g));
  const line = buildPlayoffCsv(plainAll, { divisionName: "Majors", durationMin: 120, pair: null, format: "single_elimination" })
    .split("\r\n").find((l) => l.includes("Semifinals")) ?? "";
  ok(line.includes("Majors Playoffs - Semifinals: Expos vs Winner of Game 1"), "E4", "an ordinary bracket's empty slot reads Winner of Game N (stored 2 shows as 1)", line);
});

// ── K: the card's pills, buttons and lines ────────────────────────────────────
const rr = (n: number, p: Partial<Stage1Game>): Stage1Game => ({
  id: `r${n}`, game_number: n, home_team_id: "a", away_team_id: "b", home_score: null, away_score: null,
  winner_id: null, status: "scheduled", scheduled_date: "2026-10-24", ...p,
});
const played = (n: number) => rr(n, { home_score: 5, away_score: 3, winner_id: "a", status: "completed" });
const TODAY = "2026-11-09";
const done = stage1Status([played(1), played(2)], TODAY);
const inProg = stage1Status([played(1), rr(2, { scheduled_date: "2026-11-12" })], TODAY);
const anyway = stage1Status([played(1), rr(8, { status: "cancelled", scheduled_date: "2026-10-25" })], TODAY);

section("K1 Stage 1 pill", () => {
  ok(JSON.stringify(stage1HeaderPill(done, false)) === `{"text":"Done · 2 of 2","tone":"green"}`, "K1", "done is green");
  ok(JSON.stringify(stage1HeaderPill(inProg, false)) === `{"text":"1 of 2 played","tone":"gray"}`, "K1", "in progress is gray");
  ok(JSON.stringify(stage1HeaderPill(anyway, false)) === `{"text":"1 of 2 played · 1 never played","tone":"amber"}`, "K1", "never played is amber");
  ok(JSON.stringify(stage1HeaderPill(done, true)) === `{"text":"Locked","tone":"gray"}`, "K1", "locked once the bracket starts");
  counters.pills += 4;
});

section("K2 Stage 2 pill", () => {
  const p = (seeded: boolean, recheck: boolean, first: number | null, status = done) =>
    stage2HeaderPill({ seeded, recheck, firstResultGame: first, status }).text;
  ok(p(false, false, null, inProg) === "Not seeded", "K2", "not seeded while the round robin runs");
  ok(p(false, false, null, done) === "Ready to seed", "K2", "ready once it is over");
  ok(p(false, false, null, anyway) === "Ready to seed", "K2", "ready with games never played");
  ok(p(true, false, null) === "Seeded", "K2", "seeded");
  ok(p(true, true, null) === "Re-check seeds", "K2", "a re-check is owed");
  ok(p(true, true, 2) === "In progress", "K2", "a bracket result wins over everything");
  counters.pills += 6;
});

section("K3 Stage 2 button", () => {
  const b = (seeded: boolean, first: number | null, status = done) => stage2Button({ seeded, recheck: false, firstResultGame: first, status });
  ok(JSON.stringify(b(false, null)) === `{"label":"Seed Stage 2","disabledReason":null}`, "K3", "Seed Stage 2 when done");
  ok(JSON.stringify(b(false, null, anyway)) === `{"label":"Seed anyway","disabledReason":null}`, "K3", "Seed anyway when games were never played");
  const off = b(false, null, inProg);
  ok(off.label === "Seed Stage 2" && off.disabledReason === "You can seed Stage 2 once every round-robin game has a result, or once the only games left without one are rained out, have no date, or are already past. 1 of 2 still need one.",
    "K3", "disabled with the reason while a game is to come", String(off.disabledReason));
  ok(JSON.stringify(b(true, null)) === `{"label":"Change seeds","disabledReason":null}`, "K3", "Change seeds before the bracket starts");
  ok(JSON.stringify(b(true, 2)) === `{"label":"Change seeds","disabledReason":"The bracket has started, so the seeds can't be changed."}`,
    "K3", "Change seeds is off once the bracket has a result");
});

section("K4 lines", () => {
  const name = (id: string | null) => ({ m: "Mets", g: "Giants", l: "Lions", r: "Royals" } as Record<string, string>)[id ?? ""] ?? "TBD";
  const s = stage1Status([
    played(1),
    rr(8, { status: "cancelled", scheduled_date: "2026-10-25", home_team_id: "m", away_team_id: "g" }),
    rr(17, { scheduled_date: "2026-11-07", home_team_id: "l", away_team_id: "r" }),
  ], TODAY);
  ok(s.kind === "seed_anyway", "K4", "fixture is Seed anyway");
  if (s.kind === "seed_anyway") {
    const line = neverPlayedLine(s.neverPlayed, name);
    ok(line === "Never played: RR Game 8 (Mets vs Giants, rained out Oct 25) and RR Game 17 (Lions vs Royals, Nov 7, no result). Enter a result if they were played; otherwise records leave them out.",
      "K4", "the never-played line names each game, why and when", line);
  }
  ok(stage1LockedLine(2) === "The bracket has started (Game 2 has a result), so round-robin results can't be changed. To change one, clear the bracket's results first.",
    "K4", "the locked line");
  ok(seededLine("2026-11-09", "Jenn M.", ["Giants"]) === "Seeded Nov 9 by Jenn M. · Not advancing: Giants", "K4", "seeded line");
  ok(seededLine("2026-11-09", null, []) === "Seeded Nov 9", "K4", "seeded line without a name");
  ok(stage1RecheckNote("2026-11-10") === "A round-robin result changed after you seeded the bracket (Nov 10). The seeds didn't move. Check the records above and make sure the seeds still match your league's rules.",
    "K4", "the re-check note");
  ok(recordsFootnote(21, 0) === "Records count the 21 round-robin games only. Regular-season games aren't included." &&
    recordsFootnote(21, 2) === "Records leave out 2 games that were never played. Regular-season games aren't included.", "K4", "records footnote");
  ok(cutLine(6) === "↑ Top 6 advance · not advancing ↓", "K4", "cut line");
  ok(stageRange("2026-10-24", "2026-11-08") === "Oct 24 – Nov 8" && stageRange("2026-11-14", "2026-11-22") === "Nov 14 – 22" &&
    stageRange("2026-10-24", "2026-10-24") === "Oct 24" && stageRange(null, "2026-10-24") === null, "K4", "stage range");
  ok(twoStageCardLine(7, 6) === "Round robin, then bracket · 7 teams · top 6 advance", "K4", "card line");
});

section("K5 re-check note from the stored changes", () => {
  const T = [
    { team_id: "e", team_name: "Expos" }, { team_id: "g", team_name: "Giants" },
    { team_id: "m", team_name: "Mets" }, { team_id: "r", team_name: "Royals" },
  ];
  const name = (id: string | null) => T.find((t) => t.team_id === id)?.team_name ?? "TBD";
  const res = (n: number, h: string, a: string, hs: number | null, as: number | null) =>
    rr(n, { home_team_id: h, away_team_id: a, home_score: hs, away_score: as, status: hs === null ? "scheduled" : "completed" });
  const ch = (n: number, h: string, a: string, was: [number, number] | null, now: [number, number] | null): Stage1Change => ({
    game_number: n, home_team_id: h, away_team_id: a,
    was_home: was?.[0] ?? null, was_away: was?.[1] ?? null, now_home: now?.[0] ?? null, now_away: now?.[1] ?? null,
  });
  const note = (changes: Stage1Change[] | null, games: Stage1Game[], changedOn: string | null = "2026-11-10") => {
    const n = stage1ChangesNote({ changes, games, teams: T, teamName: name, changedOn });
    counters.changedGamesNamed += (n.match(/RR Game \d+/g) ?? []).length;
    return n;
  };
  // By hand: RR1 Mets 2–6 Expos, RR2 Royals 1–4 Expos, RR3 Mets 5–0 Giants,
  // RR19 Mets 4–6 Royals now (was Mets 5–3). Mets 1-2 now, 2-1 before;
  // Royals 1-1 now, 0-2 before; Expos and Giants unchanged.
  const base = [res(1, "m", "e", 2, 6), res(2, "r", "e", 1, 4), res(3, "m", "g", 5, 0), res(19, "m", "r", 4, 6)];
  const one = note([ch(19, "m", "r", [5, 3], [4, 6])], base);
  ok(one === "A round-robin result changed after you seeded the bracket. RR Game 19 is now Royals 6, Mets 4 (was Mets 5, Royals 3). Mets are now 1-2 (were 2-1); Royals are now 1-1 (were 0-2). Check the seeds still match your league's rules.",
    "K5", "one changed game: its score before and after, and the records that moved", one);
  // RR3 then cleared too: Mets 0-2 now (2-1 before), Giants 0-0 now (0-1 before).
  const cleared = [res(1, "m", "e", 2, 6), res(2, "r", "e", 1, 4), res(3, "m", "g", null, null), res(19, "m", "r", 4, 6)];
  const two = note([ch(19, "m", "r", [5, 3], [4, 6]), ch(3, "m", "g", [5, 0], null)], cleared);
  ok(two === "Round-robin results changed after you seeded the bracket. RR Game 3's result was cleared (was Mets 5, Giants 0); RR Game 19 is now Royals 6, Mets 4 (was Mets 5, Royals 3). Giants are now 0-0 (were 0-1); Mets are now 0-2 (were 2-1); Royals are now 1-1 (were 0-2). Check the seeds still match your league's rules.",
    "K5", "two games, in game order, a cleared one included", two);
  const fresh = note([ch(20, "g", "e", null, [2, 7])], [res(20, "g", "e", 2, 7)]);
  ok(fresh === "A round-robin result changed after you seeded the bracket. RR Game 20 is now Expos 7, Giants 2 (it had no result). Expos are now 1-0 (were 0-0); Giants are now 0-1 (were 0-0). Check the seeds still match your league's rules.",
    "K5", "a game that had no result at seeding", fresh);
  const back = note([ch(19, "m", "r", [5, 3], [5, 3])], [res(19, "m", "r", 5, 3)]);
  ok(back === "A round-robin result changed after you seeded the bracket (Nov 10). The seeds didn't move. Check the records above and make sure the seeds still match your league's rules.",
    "K5", "a result that ended where it started names no game (the plain note)", back);
  ok(note(null, base, null) === "A round-robin result changed after you seeded the bracket. The seeds didn't move. Check the records above and make sure the seeds still match your league's rules.",
    "K5", "unreadable changes and no date: the plain note without a date");
  ok(JSON.stringify(parseStage1Changes([{ game_number: 19, home_team_id: "m", away_team_id: "r", was_home: 5, was_away: 3, now_home: null, now_away: null }])) ===
    `[{"game_number":19,"home_team_id":"m","away_team_id":"r","was_home":5,"was_away":3,"now_home":null,"now_away":null}]`,
    "K5", "the stored shape parses");
  ok(parseStage1Changes("[]") === null && parseStage1Changes([{ game_number: "19" }]) === null &&
    parseStage1Changes([{ game_number: 19, home_team_id: "m", away_team_id: "r", was_home: "5" }]) === null &&
    JSON.stringify(parseStage1Changes([])) === "[]", "K5", "anything else is unreadable (null), never guessed");
});

// ── Y: what the wizard sends ──────────────────────────────────────────────────
const TEAMS = [{ team_id: "t1", team_name: "Bears" }, { team_id: "t2", team_name: "Expos" }];
const V1 = [{ venue_id: "vA", allow_games: true, allow_practices: false }];
const V2 = [{ venue_id: "vP", allow_games: true, allow_practices: false }];
const DATA: PlayoffWizardData = {
  ...DEFAULT_PLAYOFF_DATA,
  division_id: "dMaj", division_name: "Majors", format: "round_robin", two_stage: true, advance_count: 6,
  seeding: [...TEAMS, { team_id: "t3", team_name: "Cubs" }], excluded: [{ team_id: "t3", team_name: "Cubs" }],
  start_date: "2026-10-24", end_date: "2026-11-08", games_per_team_per_day: 2, venue_assignments: V1,
  stage2: { ...DEFAULT_PLAYOFF_DATA.stage2, start_date: "2026-11-14", end_date: "2026-11-22", venue_assignments: V2, games_per_team_per_day: 1, same_fields: true },
};

section("Y1 Stage 1 settings", () => {
  const s = stage1SettingsPayload(DATA, TEAMS);
  ok(JSON.stringify(Object.keys(s).sort()) === `["day_windows","end_date","format","games_per_team_per_day","playing_days","seeding","start_date","venue_assignments"]`,
    "Y1", "Stage 1 carries exactly its columns", Object.keys(s).join(","));
  ok(s.format === "round_robin" && s.seeding === TEAMS && s.games_per_team_per_day === 2 && s.venue_assignments === V1, "Y1", "the teams in, the daily limit, the fields");
});

section("Y2 Stage 2 settings", () => {
  const same = stage2SettingsPayload(DATA);
  ok(same.format === "single_elimination" && same.seeding.length === 0 && same.advance_count === 6 && same.games_per_team_per_day === 1,
    "Y2", "no teams, the advancing count, its own limit");
  ok(same.venue_assignments === V1, "Y2", "Same fields as Stage 1 → Stage 1's fields");
  const own = stage2SettingsPayload({ ...DATA, stage2: { ...DATA.stage2, same_fields: false } });
  ok(own.venue_assignments === V2, "Y2", "its own fields when that is off");
  ok(same.start_date === "2026-11-14" && same.end_date === "2026-11-22", "Y2", "its own dates");
});

section("Y3 Stage 2 games carry seeds, never teams", () => {
  const withTeam = STAGE2.games.map((g, i) => (i === 0 ? { ...g, home_team_id: "leak", away_team_id: "leak" } : g)) as Stage2Game[];
  const p = stage2GamesPayload(withTeam);
  ok(p.every((g) => g.home_team_id === null && g.away_team_id === null), "Y3", "no team ids reach the function");
  ok(p[0].seed_home === withTeam[0].seed_home && p.some((g) => g.seed_home === 1), "Y3", "seeds are kept");
});

// ── V: replies ────────────────────────────────────────────────────────────────
const fallback = (raw: string) => `FALLBACK ${raw}`;
section("V1 counts", () => {
  const good = { rebuild_stage1: true, keeps_seeds: false, stage1_games: 21, stage2_games: 5, new_stage1_games: 21, new_stage2_games: 5, public_games: 0, public_games_after: 3 };
  ok(JSON.stringify(parseTwoStageCounts(good)) === `{"rebuildStage1":true,"keepsSeeds":false,"stage1Games":21,"stage2Games":5,"newStage1Games":21,"newStage2Games":5,"publicGames":0,"publicGamesAfter":3}`,
    "V1", "a full reply parses");
  const { public_games_after: _gone, ...missing } = good;
  void _gone;
  ok(parseTwoStageCounts(missing) === null && parseTwoStageCounts({ ...good, stage2_games: -1 }) === null, "V1", "a missing or negative count is unreadable, never zero");
});

// Full (gapless) brackets: shown numbers equal stored ones here; the gap
// case is sim:playoff-numbers.
const FULL7 = gameNumbering(Array.from({ length: 7 }, (_, i) => ({ game_number: i + 1 })));
const FULL_R: ResultNumbering = { own: FULL7, nextStage: FULL7 };

section("V2 blocked rebuilds", () => {
  ok(twoStageBlockedMessage({ blocked: true, reasons: ["stage2_started"], stage2_game_number: 2 }, FULL7) ===
    "Nothing was saved. The bracket has started (Game 2 has a result), so neither stage can be rebuilt. Clear the bracket's results first.",
    "V2", "the bracket started");
  ok(twoStageBlockedMessage({ blocked: true, reasons: ["results_entered"], games_with_results: 3 }, FULL7) ===
    "Nothing was saved. The round robin has 3 results entered, so only Stage 2's dates, days and fields can change now.",
    "V2", "round-robin results");
  counters.blockedSentences += 2;
});

section("V3 refusals", () => {
  ok(twoStageErrorMessage("ERROR: stage_order", fallback) === "Nothing was saved. Stage 2 has to start after Stage 1's last date.", "V3", "stage order");
  ok(twoStageErrorMessage("ERROR: invalid_order", fallback).startsWith("Nothing was saved. The seed list doesn't match"), "V3", "invalid order");
  ok(twoStageErrorMessage("ERROR: plan_required", fallback) === "FALLBACK ERROR: plan_required", "V3", "shared keys fall through");
});

section("V4 seeding replies", () => {
  const reply = { committed: false, blocked: false, stage2_id: "s2", advance_count: 6, reseed: false, never_played: [] };
  const pre = seedOutcome(reply, null, "s2", false, fallback, FULL7);
  ok(pre.ok, "V4", "a preview for this Stage 2 is accepted");
  ok(!seedOutcome(reply, null, "s2", true, fallback, FULL7).ok, "V4", "a preview never counts as a save");
  ok(!seedOutcome({ ...reply, committed: true }, null, "s2", false, fallback, FULL7).ok, "V4", "a committed reply to a preview is refused");
  ok(!seedOutcome({ ...reply, stage2_id: "other" }, null, "s2", false, fallback, FULL7).ok, "V4", "a reply for another bracket is refused");
  ok(!seedOutcome({ ...reply, never_played: [{ game_number: 8, reason: "weather" }] }, null, "s2", false, fallback, FULL7).ok, "V4", "an unknown reason is unreadable");
  const started = seedOutcome({ committed: false, blocked: true, reason: "bracket_started", stage2_game_number: 2 }, null, "s2", true, fallback, FULL7);
  ok(!started.ok && started.message === "Nothing was saved. The bracket has started (Game 2 has a result), so the seeds can't be changed. Clear the bracket's results first.",
    "V4", "bracket started", started.ok ? "" : started.message);
  const early = seedOutcome({ committed: false, blocked: true, reason: "stage1_in_progress", upcoming: 3 }, null, "s2", false, fallback, FULL7);
  ok(!early.ok && early.message === "Nothing was saved. The round robin isn't over yet: 3 games are still to come. Seed Stage 2 once every game has a result, or once the only ones left are rained out, undated or past.",
    "V4", "round robin not over", early.ok ? "" : early.message);
  counters.blockedSentences += 2;
});

// ── B: result refusals ────────────────────────────────────────────────────────
section("B1 the bracket has started", () => {
  const want = "The bracket has started (Game 2 has a result), so round-robin results can't be changed. Clear the bracket's results first, then change this one.";
  const r = { committed: false, blocked: true, reason: "next_stage_started", stage2_game_number: 2 };
  ok(blockedMessage(r, "edit", FULL_R) === want, "B1", "the sentence");
  const e = enterOutcome(r, null, "g", FULL_R);
  ok(!e.ok && e.message === want, "B1", "enter refuses with it");
  const c = clearPreviewOutcome(r, null, "g", FULL_R);
  ok(!c.ok && c.message === want, "B1", "clear refuses with it");
  ok(blockedMessage({ blocked: true, reason: "next_game_has_result", next_game: { game_number: 5, round: "SF", home_name: "A", away_name: "B", home_score: 3, away_score: 1 } }, "clear", FULL_R) ===
    "Game 5 (Semifinals) already has a result (A 3, B 1). Clear that game's result first, then clear this one.", "B1", "the 0108 refusal is unchanged");
  counters.blockedSentences += 2;
});

// ── PL: the public page ───────────────────────────────────────────────────────
const VEN = { name: "Andrews", location: { name: "Monroe Complex" }, address: null, home_park: true };
const pg = (p: Partial<PublicPlayoffGame> & { id: string; round: string; game_number: number }): PublicPlayoffGame => ({
  playoff_id: "s2", format: "single_elimination", division_id: "dMaj", scheduled_date: null, start_time: null,
  status: "scheduled", home_team: null, away_team: null, venue: VEN, stage: 2, seed_home: null, seed_away: null, ...p,
});
const PUBLIC: PublicSeason = {
  id: "s", name: "Fall 2026", start_date: "2026-08-31", end_date: "2026-11-30",
  divisions: [{ id: "dMaj", name: "Majors", game_duration: 120 }, { id: "dMin", name: "Minors", game_duration: 105 }],
  unpublished: [], teams: [], games: [],
  playoff_games: [
    ...STAGE2.games.map((g) => pg({
      id: `p${g.game_number}`, round: g.round, game_number: g.game_number, seed_home: g.seed_home, seed_away: g.seed_away,
      scheduled_date: g.scheduled_date, start_time: g.start_time,
    })),
    pg({ id: "p13", playoff_id: "s1", format: "round_robin", stage: 1, round: "RR5", game_number: 13, scheduled_date: "2026-11-01", start_time: "10:00",
      home_team: { id: "tE", name: "Expos" }, away_team: { id: "tM", name: "Mets" } }),
    pg({ id: "o1", playoff_id: "pMin", division_id: "dMin", stage: 1, round: "R1", game_number: 1, scheduled_date: "2026-11-01", start_time: "09:00",
      home_team: { id: "tC", name: "Cubs" }, away_team: { id: "tT", name: "Twins" } }),
    // The rest of that 8-team bracket, undated (not rows): names come from the
    // whole bracket, so without them "R1" would be a 2-team Final.
    pg({ id: "o5", playoff_id: "pMin", division_id: "dMin", stage: 1, round: "SF", game_number: 5, scheduled_date: null, start_time: null }),
    pg({ id: "o7", playoff_id: "pMin", division_id: "dMin", stage: 1, round: "F", game_number: 7, scheduled_date: null, start_time: null }),
  ],
};

section("PL1 labels and placeholders", () => {
  const rows = buildRows(PUBLIC);
  const row = (k: string) => rows.find((r) => r.key === k);
  ok(row("p-p2")?.matchup === "Seed 4 vs Seed 5" && row("p-p2")?.playoffLabel === "Playoffs · Bracket · Round 1 · Game 1",
    "PL1", "Stage 2 round 1 before seeding", `${row("p-p2")?.matchup} / ${row("p-p2")?.playoffLabel}`);
  ok(row("p-p5")?.matchup === "Seed 1 vs Winner of Game 1" && row("p-p5")?.playoffLabel === "Playoffs · Bracket · Semifinal · Game 3",
    "PL1", "a bye seed in the semifinal", `${row("p-p5")?.matchup} / ${row("p-p5")?.playoffLabel}`);
  ok(row("p-p13")?.playoffLabel === "Playoffs · Round robin · RR Game 13" && row("p-p13")?.matchup === "Expos vs Mets",
    "PL1", "a round-robin game of a two-stage setup", String(row("p-p13")?.playoffLabel));
  ok(row("p-o1")?.playoffLabel === "Playoffs · Round 1 · Game 1", "PL1", "an ordinary bracket is unchanged", String(row("p-o1")?.playoffLabel));
  counters.seedPlaceholders += rows.filter((r) => r.matchup.includes("Seed ")).length;
});

// ── D: deleting a pair ────────────────────────────────────────────────────────
section("D1 the confirm names both stages", () => {
  const counts = { games: 26, datedGames: 26, gamesWithResults: 3, publicGames: 0, notNeededGames: 0 };
  const pair = deleteConfirm("Majors", counts, true);
  ok(pair.title === "Delete the Majors playoffs (round robin and bracket)?", "D1", "title", pair.title);
  ok(pair.lines[0] === "This deletes both stages and all 26 of their games (all have dates).", "D1", "first line", pair.lines[0]);
  const one = deleteConfirm("Majors", counts);
  ok(one.title === "Delete the Majors playoff bracket?" && one.lines[0] === "This deletes the bracket and all 26 of its games (all have dates).",
    "D1", "an ordinary bracket reads as before");
});

// ── R: Review ─────────────────────────────────────────────────────────────────
section("R1 the fit lines", () => {
  ok(stage1FitLine(21, 28) === "all 21 games fit (28 slots).", "R1", "Stage 1");
  const l = stage2FitLine(STAGE2.games);
  ok(l === "all 5 games fit — round 1 Sat 11/14, semifinals Sun 11/15, final Sat 11/21.", "R1", "Stage 2 names each round's day", l);
  ok(teamsReviewLine(7, ["Cubs"]) === "7 (Cubs left out)" && teamsReviewLine(7, []) === "7", "R1", "teams");
  ok(advancingReviewLine(6) === "Top 6 · byes for seeds 1–2" && advancingReviewLine(4) === "Top 4", "R1", "advancing");
  ok(stageReviewLine(21, "2026-10-24", "2026-11-08", ["Sa", "Su"]) === "21 games · Oct 24 – Nov 8 · Sat, Sun" &&
    stageReviewLine(5, "2026-11-14", "2026-11-22", ["Sa", "Su"]) === "5 games · Nov 14 – 22 · Sat, Sun", "R1", "stage line");
  ok(perDayLine(1) === "1 game per team per day" && perDayLine(2) === "2 games per team per day", "R1", "per day");
  ok(twoStagePublicLine(0) === null && twoStagePublicLine(3) === "3 of these games are now on your public schedule.", "R1", "public line");
});

section("R2 rebuild lines", () => {
  const base = { rebuildStage1: true, keepsSeeds: false, stage1Games: 21, stage2Games: 5, newStage1Games: 21, newStage2Games: 5, publicGames: 0, publicGamesAfter: 0 };
  ok(JSON.stringify(twoStageReviewLines(base)) === `["Generating replaces both stages' 26 games with 26 new games."]`, "R2", "a full rebuild");
  ok(JSON.stringify(twoStageReviewLines({ ...base, rebuildStage1: false, keepsSeeds: true })) ===
    `["The round robin has results, so only Stage 2 is rebuilt: its 5 games are replaced with 5 new games. The seeds you set are kept."]`,
    "R2", "a Stage-2-only rebuild keeps the seeds");
  ok(twoStageReviewLines({ ...base, stage1Games: 0, stage2Games: 0 }).length === 0, "R2", "a new setup says nothing about replacing");
});

// ── S: wiring (source greps — weak by nature) ─────────────────────────────────
section("S1 wiring", () => {
  const modal = read("src/components/playoffs/playoff-export-modal.tsx");
  ok(modal.includes("buildPlayoffCsv(allGames, { divisionName, durationMin, pair, format })") && !modal.includes("addMinsFmt") && !/,\s*90\)/.test(modal),
    "S1", "the export uses the shared builder; no hardcoded 90");
  ok(modal.includes('"game_duration:settings->game_duration"') && !modal.includes("divisions(settings)"), "S1", "the export reads the projected key only");
  const page = read("src/components/playoffs/playoffs-page-client.tsx");
  ok(page.includes("<TwoStageCard") && page.includes("stage2ByParent.has(deleting.playoff.id)"), "S1", "the page renders pairs as one card and deletes them whole");
  const wizard = read("src/components/playoffs/playoff-wizard.tsx");
  ok(wizard.includes("<StepTwoStageReview") && wizard.includes("TWO_STAGE_STEPS"), "S1", "the wizard has the two-stage steps");
});

section("S2 re-check note wiring", () => {
  const card = read("src/components/playoffs/two-stage-card.tsx");
  ok(/\.select\("[^"]*stage1_changed_at, stage1_changes"\)/.test(card), "S2", "the card reads stage1_changes with Stage 2's row");
  ok(card.includes("stage1ChangesNote({") && card.includes("changes: parseStage1Changes(rows.stage2.stage1_changes)") &&
    !card.includes("stage1RecheckNote("), "S2", "the card renders the note from the stored changes, never the plain note directly");
});

// ── Counters ──────────────────────────────────────────────────────────────────
section("counters", () => {
  for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `counter ${k} > 0`, String(v));
});

console.log(`\n${checks - failures.length}/${checks} checks passed  ${JSON.stringify(counters)}`);
if (failures.length) process.exit(1);

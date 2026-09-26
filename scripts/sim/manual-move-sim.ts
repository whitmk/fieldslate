// Harness for "Enter a time manually" on the reschedule picker's MOVE variant
// (src/lib/schedule/manual-move.ts + the wiring in rainout-reschedule-modal.tsx
// and manual-move-form.tsx).
//
// WHAT IT PINS
// - A: the escape hatch exists on the MOVE variant only, and no interleague
//   game can reach the move variant — together, no interleague game reaches
//   manual edit. The four picker render paths ungated for interleague all use
//   the RAINOUT variant; that is why the variant check is the guard.
// - B: every conflict the form must NAME is named, with what it steps on —
//   field booked (real spans, the arriving division's buffer), a team already
//   playing, outside hours / closed / hours unset, a non-playing day, a
//   blackout — and a read that FAILED says "couldn't check", never all-clear.
//   Boundary fixtures pin the predicates to the picker's own (a game ending
//   exactly at the buffer edge clears; a team game ending at the start clears).
// - C: the save-time lock re-read refuses on a locked division and on an
//   UNREADABLE lock.
// - D: conflicts never disable Save (the deliberate divergence from Add Game).
// - E: native-input parsing — the house HH:MM(:SS) / YYYY-MM-DD guard.
// - S: source wiring — the modal renders the form and the link only under the
//   move-variant check, and the form saves only after the lock refusal check.
//
// ANTI-VACUITY: counters for a conflicting save and a clean save that each
// reached "Save enabled", every conflict kind produced at least once, and an
// interleague game actually routed. A zero fails the run.
//
// ── MUTATION LOG (2026-09-26) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   MM1  manualEntryAvailable true for every variant (interleague reaches
//        manual edit through an ungated rainout render path)     → [A1]
//   MM2  field-booked notice suppressed when a booking overlaps    → [B1]
//   MM3  lock gate skipped at save (locked → no refusal)           → [C2]
//   MM4  a failed occupancy read reads as all-clear                → [B8]
//   MM5  conflicts disable Save (Add-Game-style blocking)          → [D1]
// RESULT: 5/5 killed, each FIRST at its own assertion.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fmtMins,
  manualEntryAvailable,
  manualMoveConflicts,
  manualSaveEnabled,
  manualSaveLockRefusal,
  parseManualDateTime,
  type ManualConflict,
  type ManualConflictInput,
  type ManualConflictKind,
} from "@/lib/schedule/manual-move";
import { routeMoveTarget } from "@/lib/schedule/panel-reschedule-route";
import { lockedReason } from "@/lib/schedule/division-lock";
import { parseAvailability } from "@/lib/venues/availability";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const kindsSeen = new Set<ManualConflictKind>();
const counters = { conflictingSaveEnabled: 0, cleanSaveEnabled: 0, interleagueRouted: 0 };

// 2026-10-10 is a Saturday; 2026-10-14 a Wednesday; 2026-10-13 a Tuesday.
const SAT = "2026-10-10";
const WED = "2026-10-14";
const TUE = "2026-10-13";

const andrews = {
  label: "SRALL Monroe Complex — Andrews",
  availabilityConfigured: true,
  availability: parseAvailability({
    Sa: { start: "08:00", end: "20:00" },
    We: { start: "17:00", end: "21:00" },
  }),
};

function input(over: Partial<ManualConflictInput> & { date?: string; time?: string }): ManualConflictInput {
  const when = parseManualDateTime(over.date ?? SAT, over.time ?? "10:00");
  if (!when) throw new Error("fixture: bad date/time");
  return {
    when,
    durationMin: 105,
    bufferMin: 15,
    divisionName: "Minors",
    playingDays: ["Sa"],
    blackoutDates: new Set<string>(),
    venue: andrews,
    venueGames: [],
    teamGames: [],
    ...over,
  };
}

function run(name: string, p: ManualConflictInput): ManualConflict[] {
  const c = manualMoveConflicts(p);
  for (const x of c) kindsSeen.add(x.kind);
  const enabled = manualSaveEnabled({ when: p.when, venueChosen: true, saving: false, conflicts: c });
  if (enabled && c.length > 0) counters.conflictingSaveEnabled++;
  if (enabled && c.length === 0) counters.cleanSaveEnabled++;
  void name;
  return c;
}
const kinds = (c: ManualConflict[]) => c.map((x) => x.kind).sort().join(",");

function partA() {
  ok(
    manualEntryAvailable("move") && !manualEntryAvailable("rainout"),
    "[A1] the manual link exists on the MOVE variant only",
  );
  // No interleague game reaches the move variant (plain route), in any context.
  const NOW = Date.parse("2026-09-26T12:00:00Z");
  const il = [
    { status: "scheduled", scheduled_at: "2026-10-10T15:30:00+00:00", interleague_org_id: "io", away_team_id: null, interleague_org: { name: "Westside LL" } },
    { status: "scheduled", scheduled_at: "2026-10-10T15:30:00+00:00", interleague_org_id: "io", away_team_id: "t_anomaly", interleague_org: { name: "Westside LL" } },
    { status: "pending_interleague", scheduled_at: "2026-10-10T15:30:00+00:00", interleague_org_id: "io", away_team_id: null },
  ];
  let reachedMove = 0;
  for (const g of il) {
    for (const locked of [false, true]) {
      for (const canReschedule of [false, true]) {
        const r = routeMoveTarget(g, { locked, canReschedule, divisionName: "AA", nowMs: NOW });
        counters.interleagueRouted++;
        if (r.kind === "plain") reachedMove++;
      }
    }
  }
  ok(reachedMove === 0, "[A2] no interleague game reaches the move variant (hence manual edit)");
}

function partB() {
  const clean = run("clean", input({}));
  ok(clean.length === 0, "[B0] a clean Saturday slot on an open field: no notices", kinds(clean));

  // Field booked — Majors 1:00–3:00 PM (120 min). 2:30 overlaps outright.
  const booked = [{ startMin: 13 * 60, durationMin: 120, label: "Majors: Giants vs Dodgers" }];
  const c1 = run("booked", input({ time: "14:30", venueGames: booked }));
  const b1 = c1.find((c) => c.kind === "venue_booked");
  ok(
    !!b1 && b1.text.includes("Andrews") && b1.text.includes("1:00 PM–3:00 PM") &&
      b1.text.includes("Giants vs Dodgers"),
    "[B1] field already booked: named, with the booking's real span and matchup",
    JSON.stringify(c1),
  );
  // The arriving division's buffer (15): 3:10 is inside it, 3:15 clears.
  const c1b = run("buffer-in", input({ time: "15:10", venueGames: booked }));
  const c1c = run("buffer-edge", input({ time: "15:15", venueGames: booked }));
  ok(
    c1b.some((c) => c.kind === "venue_booked") && !c1c.some((c) => c.kind === "venue_booked"),
    "[B2] the arriving division's buffer applies exactly (3:10 flagged, 3:15 clear)",
  );

  // Team already playing — Mets 10:00–11:30; no buffer on team spans.
  const team = [{ startMin: 600, durationMin: 90, teamName: "Mets", label: "Mets vs Cubs at Perry" }];
  const c2 = run("team", input({ time: "11:00", teamGames: team }));
  const t2 = c2.find((c) => c.kind === "team_busy");
  ok(
    !!t2 && t2.text.startsWith("Mets already plays 10:00 AM–11:30 AM") && t2.text.includes("Perry"),
    "[B3] a team already playing then: named, with its game",
    JSON.stringify(c2),
  );
  ok(
    !run("team-edge", input({ time: "11:30", teamGames: team })).some((c) => c.kind === "team_busy"),
    "[B3b] a team game ending exactly at the start does not conflict",
  );

  // Hours — Wednesday 5–9 PM; a 105-min game at 7:30 runs to 9:15.
  const c3 = run("hours", input({ date: WED, time: "19:30" }));
  const h3 = c3.find((c) => c.kind === "outside_hours");
  ok(
    !!h3 && h3.text.includes("open 5:00 PM–9:00 PM") && h3.text.includes("7:30 PM–9:15 PM"),
    "[B4] outside the field's hours: names the window and the game's span (must END by close)",
    JSON.stringify(c3),
  );
  ok(
    !run("hours-edge", input({ date: WED, time: "19:15" })).some((c) => c.kind === "outside_hours"),
    "[B4b] a game ending exactly at close is inside the hours",
  );
  const c4 = run("closed", input({ date: TUE, time: "18:00" }));
  ok(
    c4.some((c) => c.kind === "venue_closed" && c.text.includes("Tuesdays")),
    "[B5] field closed that day",
    kinds(c4),
  );
  const c5 = run(
    "unset",
    input({ venue: { label: "Oracle", availabilityConfigured: false, availability: {} } }),
  );
  ok(
    c5.some((c) => c.kind === "venue_hours_unset" && c.text.includes("Oracle")),
    "[B6] hours not set: says it couldn't check them",
  );

  // Non-playing day and blackout.
  ok(
    c3.some((c) => c.kind === "non_playing_day" && c.text === "Minors doesn't play on Wednesdays."),
    "[B7] a day the division doesn't play",
    kinds(c3),
  );
  const c6 = run("blackout", input({ blackoutDates: new Set([SAT]) }));
  ok(c6.some((c) => c.kind === "blackout"), "[B7b] a blackout date");

  // Failed reads are reported, never all-clear.
  const c7 = run("venue-read-failed", input({ venueGames: null }));
  ok(
    c7.some((c) => c.kind === "unchecked" && c.text.includes("Andrews")),
    "[B8] a failed field-occupancy read says it couldn't check",
    JSON.stringify(c7),
  );
  const c8 = run("team-read-failed", input({ teamGames: null }));
  ok(
    c8.some((c) => c.kind === "unchecked" && c.text.includes("team")),
    "[B8b] a failed team read says it couldn't check",
  );

  // Every notice carries a sentence.
  const all = [...c1, ...c1b, ...c2, ...c3, ...c4, ...c5, ...c6, ...c7, ...c8];
  ok(all.every((c) => c.text.trim().length > 0), "[B9] every notice has a sentence");
  ok(fmtMins(13 * 60 + 5) === "1:05 PM" && fmtMins(0) === "12:00 AM", "[B10] time formatting");
}

function partC() {
  ok(
    manualSaveLockRefusal({ ok: true, locked: false }, "AA") === null,
    "[C1] unlocked: no refusal",
  );
  ok(
    manualSaveLockRefusal({ ok: true, locked: true }, "AA") === lockedReason("AA", "move"),
    "[C2] locked at save: refused with the shared 'move' sentence",
  );
  const r3 = manualSaveLockRefusal({ ok: false, message: "timeout" }, "AA");
  ok(
    !!r3 && r3.includes("nothing was saved"),
    "[C3] an UNREADABLE lock refuses — never reads as unlocked",
  );
}

function partD() {
  const when = parseManualDateTime(SAT, "14:30");
  const heavy = manualMoveConflicts(
    input({
      time: "14:30",
      venueGames: null,
      teamGames: [{ startMin: 14 * 60, durationMin: 90, teamName: "Mets", label: "x" }],
      blackoutDates: new Set([SAT]),
    }),
  );
  ok(
    heavy.length >= 3 &&
      manualSaveEnabled({ when, venueChosen: true, saving: false, conflicts: heavy }),
    "[D1] Save stays enabled with conflicts (and with an unchecked read) — never a gate",
  );
  ok(
    !manualSaveEnabled({ when: null, venueChosen: true, saving: false, conflicts: [] }) &&
      !manualSaveEnabled({ when, venueChosen: false, saving: false, conflicts: [] }) &&
      !manualSaveEnabled({ when, venueChosen: true, saving: true, conflicts: [] }),
    "[D2] only a missing date/time, a missing field, or an in-flight save disables it",
  );
}

function partE() {
  const w = parseManualDateTime(SAT, "15:30");
  ok(
    w?.isoString === "2026-10-10T15:30:00" && w.startMin === 930,
    "[E1] bare wall-clock string, same shape as the picker's save",
    JSON.stringify(w),
  );
  ok(parseManualDateTime(SAT, "15:30:00")?.isoString === "2026-10-10T15:30:00", "[E2] HH:MM:SS tolerated");
  ok(
    parseManualDateTime(SAT, "") === null &&
      parseManualDateTime("", "15:30") === null &&
      parseManualDateTime(SAT, "25:00") === null &&
      parseManualDateTime("10/10/2026", "15:30") === null,
    "[E3] empty (uncommitted AM/PM), malformed and out-of-range inputs are rejected",
  );
}

function partS() {
  const root = join(__dirname, "..", "..", "src", "components", "divisions");
  const modal = readFileSync(join(root, "rainout-reschedule-modal.tsx"), "utf8");
  const form = readFileSync(join(root, "manual-move-form.tsx"), "utf8");
  ok(
    modal.includes("const manualAllowed = manualEntryAvailable(variant);") &&
      modal.includes(") : manualAllowed && manual ? (") &&
      modal.includes("{manualAllowed && !manual && !done && !picked && ("),
    "[S1] the modal renders the form AND the link only under the move-variant check",
  );
  const refuseAt = form.indexOf("manualSaveLockRefusal(read");
  const updateAt = form.indexOf('.from("games")\n      .update(');
  ok(
    refuseAt > 0 && updateAt > refuseAt,
    "[S2] the form checks the lock refusal BEFORE it writes",
  );
  ok(
    form.includes("fetchDivisionLocks(supabase, [divisionId])"),
    "[S3] the lock is re-read at save",
  );
}

function main() {
  console.log("\nmanual-move sim");
  partA();
  partB();
  partC();
  partD();
  partE();
  partS();
  const wanted: ManualConflictKind[] = [
    "venue_booked", "team_busy", "venue_hours_unset", "venue_closed",
    "outside_hours", "non_playing_day", "blackout", "unchecked",
  ];
  for (const k of wanted) ok(kindsSeen.has(k), `[AV] conflict kind ${k} produced`);
  for (const [name, n] of Object.entries(counters)) {
    ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  }
  console.log("  counters:", JSON.stringify(counters), "kinds:", kindsSeen.size);
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}

main();

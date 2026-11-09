// sim:volunteer-slots — the volunteer game-role slot rules (0121), driving the
// REAL src/lib/volunteers/slots.ts. Pure: no database, no clock (every "now"
// is a literal).
//
//   VT  the VSLOT case table (read out of scripts/sim/volunteer-claims-sim.sql,
//       the ONE copy the 0121 proof also runs): spot sets per game and the
//       refusal for the first one
//   VC  the VCHANGE case table: change/cancel allowed only > 24 hours ahead
//   P   table parsing: both blocks found once, every row read
//   S   status → slot state
//   K   spot counts are clamped 1–10; a role with 0 spots carries none
//   O   overlap: same date, half-open, the game's own duration (90 when the
//       division has none), shift spans, different dates never overlap
//   W   wallClockNow in three zones, across the November clock change
//   L   the role's lead: spot start = game start − lead, clamped 0–120
//
// Every FAIL line is collected; a section that throws is recorded as
// [CRASH-…] and the run continues. Run under three host zones by the npm
// script — nothing here may depend on the host's zone.
//
// MUTATION LOG (npm run sim:volunteer-slots:mutants): see the mutants file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canChangeSpot,
  claimRefusal,
  gameSlotState,
  gameSpan,
  leadOf,
  overlapsHeld,
  shiftSpan,
  slotTargets,
  spotStartWall,
  wallClockNow,
  type SlotGame,
  type VolunteerRole,
} from "../../src/lib/volunteers/slots";

const ROOT = join(__dirname, "../..");
const failures: string[] = [];
let checks = 0;
const counters: Record<string, number> = {
  refusal_null: 0, refusal_no_slot: 0, refusal_rained_out: 0, refusal_closed: 0, refusal_past: 0,
  refusal_unpublished: 0, refusal_signups_closed: 0, targets0: 0, targets1: 0, targets2: 0,
  change_allowed: 0, change_refused: 0, lead_rows: 0,
};

function ok(cond: boolean, tag: string, msg: string, detail?: string) {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${msg}${detail ? `\n      ${detail}` : ""}`);
}
function section(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    failures.push(`FAIL: [CRASH-${name}] ${(e as Error).stack ?? e}`);
  }
}

type Cell = string | number | boolean | null;
export function parseBlock(src: string, name: string): Cell[][] {
  const lines = src.split("\n");
  const begin = lines.filter((l) => l.trim() === `-- ${name}-TABLE-BEGIN`).length;
  const end = lines.filter((l) => l.trim() === `-- ${name}-TABLE-END`).length;
  if (begin !== 1 || end !== 1) throw new Error(`${name}: expected each marker exactly once, found ${begin}/${end}`);
  const from = lines.findIndex((l) => l.trim() === `-- ${name}-TABLE-BEGIN`);
  const to = lines.findIndex((l) => l.trim() === `-- ${name}-TABLE-END`);
  const rows: Cell[][] = [];
  for (const raw of lines.slice(from + 1, to)) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^\((.*)\),?$/.exec(l);
    if (!m) throw new Error(`${name}: unreadable row: ${l}`);
    rows.push(
      m[1].split(",").map((c) => {
        const v = c.trim();
        if (v === "null") return null;
        if (v === "true") return true;
        if (v === "false") return false;
        if (/^'.*'$/.test(v)) return v.slice(1, -1);
        if (/^-?\d+$/.test(v)) return Number(v);
        throw new Error(`${name}: unreadable cell ${v} in ${l}`);
      }),
    );
  }
  return rows;
}

const NOW = "2026-11-10T12:00";
const WHEN: Record<string, string> = {
  past: "2026-11-09T12:00:00+00:00",
  started: "2026-11-10T11:59:00+00:00",
  now: "2026-11-10T12:00:00+00:00",
  soon: "2026-11-10T12:30:00+00:00",
  future: "2026-11-20T10:00:00+00:00",
};

const src = readFileSync(join(ROOT, "scripts/sim/volunteer-claims-sim.sql"), "utf8");
let slotRows: Cell[][] = [];
let changeRows: Cell[][] = [];

section("P", () => {
  slotRows = parseBlock(src, "VSLOT");
  changeRows = parseBlock(src, "VCHANGE");
  ok(slotRows.length === 32, "P1", `VSLOT has 32 rows, read ${slotRows.length}`);
  ok(changeRows.length === 12, "P1", `VCHANGE has 12 rows, read ${changeRows.length}`);
  ok(slotRows.every((r) => r.length === 14), "P1", "every VSLOT row has 14 cells");
  ok(changeRows.every((r) => r.length === 5), "P1", "every VCHANGE row has 5 cells");
  let threw = false;
  try {
    parseBlock(src + "\n-- VSLOT-TABLE-BEGIN\n", "VSLOT");
  } catch {
    threw = true;
  }
  ok(threw, "P2", "a second BEGIN marker is refused, never read");
});

section("VT", () => {
  for (const r of slotRows) {
    const [id, status, il, isAway, hasAway, kind, hIn, aIn, locked, when, open, targets, refusal, lead] = r as [
      string, string, boolean, boolean, boolean, "per_game" | "per_team", boolean, boolean, string, string, boolean, number, string | null, number,
    ];
    const game: SlotGame = {
      id: `g-${id}`,
      scheduledAt: WHEN[when],
      status,
      homeTeamId: "tH",
      awayTeamId: hasAway ? "tA" : null,
      interleagueOrgId: il ? "partner" : null,
      isAway,
    };
    const role: VolunteerRole = {
      id: "role", kind, spots: 2, signupsOpen: open, leadMinutes: lead,
      divisionIds: [...(hIn ? ["H"] : []), ...(aIn ? ["A"] : [])],
    };
    const teamDivision = new Map([["tH", "H"], ["tA", "A"]]);
    const lockedSet = new Set(locked === "both" ? ["H", "A"] : locked === "home" ? ["H"] : locked === "away" ? ["A"] : []);
    const got = slotTargets(game, [role], teamDivision);
    ok(got.length === targets, "VT1", `${id}: ${targets} spot sets`, `got ${got.length}: ${JSON.stringify(got)}`);
    const first = got[0] ?? null;
    const why = claimRefusal({ game, target: first, role, lockedDivisionIds: lockedSet, nowWall: NOW });
    ok(why === refusal, "VT1", `${id}: refusal ${refusal}`, `got ${why}`);
    if (kind === "per_team" && got.length === 2) {
      ok(got[0].forTeamId === "tH" && got[1].forTeamId === "tA", "VT2", `${id}: home team's spots first, then away`);
    }
    if (kind === "per_game") ok(got.every((t) => t.forTeamId === null), "VT2", `${id}: per-game spots name no team`);
    counters[`refusal_${refusal ?? "null"}`]++;
    counters[`targets${targets}`]++;
  }
});

section("VC", () => {
  for (const r of changeRows) {
    const [id, gameStart, now, allowed, lead] = r as [string, string, string, boolean, number];
    const start = spotStartWall(gameStart, lead);
    ok(start !== null && canChangeSpot(start, now) === allowed, "VC1", `${id}: change ${allowed ? "allowed" : "refused"}`);
    if (lead > 0) counters.lead_rows++;
    counters[allowed ? "change_allowed" : "change_refused"]++;
  }
  ok(!canChangeSpot("garbage", NOW), "VC2", "an unreadable start never allows a change");
});

section("S", () => {
  ok(gameSlotState("scheduled") === "open", "S1", "scheduled → open");
  ok(gameSlotState("reschedule_pending") === "may_move", "S1", "reschedule_pending → may_move");
  ok(gameSlotState("cancelled") === "rained_out", "S1", "cancelled → rained_out");
  ok(gameSlotState("pending_interleague") === "none", "S1", "pending_interleague → none");
  ok(gameSlotState("completed") === "closed", "S1", "completed → closed");
  ok(gameSlotState("anything_new") === "closed", "S1", "an unknown status takes no new claims");
});

section("K", () => {
  const game: SlotGame = { id: "g", scheduledAt: WHEN.future, status: "scheduled", homeTeamId: "tH", awayTeamId: "tA", interleagueOrgId: null, isAway: false };
  const td = new Map([["tH", "H"], ["tA", "H"]]);
  const r = (spots: number): VolunteerRole => ({ id: "r", kind: "per_game", spots, signupsOpen: true, divisionIds: ["H"] });
  ok(slotTargets(game, [r(0)], td).length === 0, "K1", "0 spots → no spot set");
  ok(slotTargets(game, [r(11)], td)[0]?.spots === 10, "K1", "11 spots clamp to 10");
  ok(slotTargets(game, [r(2.7)], td)[0]?.spots === 2, "K1", "2.7 spots → 2");
  ok(slotTargets({ ...game, scheduledAt: null }, [r(2)], td).length === 0, "K2", "an undated game carries no spots");
  ok(slotTargets({ ...game, homeTeamId: null }, [r(2)], td).length === 0, "K2", "no home team → no spots");
  ok(slotTargets(game, [r(2)], new Map()).length === 0, "K2", "a team with no division carries no spots");
  const two = slotTargets(game, [r(2), { ...r(1), id: "r2", kind: "per_team" }], td);
  ok(two.length === 3, "K3", "two roles: one per-game set + two per-team sets", JSON.stringify(two));
});

section("O", () => {
  const g = gameSpan("2026-11-14T10:00:00+00:00", { game_duration: 120 });
  ok(g?.startMin === 600 && g.durationMin === 120 && g.date === "2026-11-14", "O1", "game span = start + its division's duration");
  ok(gameSpan("2026-11-14T10:00:00+00:00", {})?.durationMin === 90, "O1", "no duration → 90");
  ok(gameSpan("2026-11-14T10:00:00+00:00", { game_duration: "x" })?.durationMin === 90, "O1", "unusable duration → 90");
  ok(gameSpan("bad", {}) === null, "O1", "an unreadable time has no span");
  const shift = shiftSpan("2026-11-14", "11:30:00", "13:30:00");
  ok(shift?.startMin === 690 && shift.durationMin === 120, "O2", "shift span = start → end");
  ok(shiftSpan("2026-11-14", "13:00", "13:00") === null, "O2", "a zero-length shift has no span");
  ok(g !== null && shift !== null && overlapsHeld(shift, [g]), "O3", "a shift 11:30 overlaps a game 10:00–12:00");
  const touching = shiftSpan("2026-11-14", "12:00", "13:00");
  ok(g !== null && touching !== null && !overlapsHeld(touching, [g]), "O3", "touching endpoints do not overlap");
  const otherDay = shiftSpan("2026-11-15", "10:00", "11:00");
  ok(g !== null && otherDay !== null && !overlapsHeld(otherDay, [g]), "O3", "a different date never overlaps");
  ok(!overlapsHeld(g!, []), "O3", "nothing held → no overlap");
  const led = gameSpan("2026-11-14T10:00:00+00:00", { game_duration: 120 }, 45);
  ok(led?.startMin === 555 && led.durationMin === 165, "O4", "a 45-minute lead starts the span at 9:15 and ends it at game end", JSON.stringify(led));
  const early = shiftSpan("2026-11-14", "09:00", "09:30");
  ok(led !== null && early !== null && overlapsHeld(early, [led]), "O4", "a 9:00–9:30 shift overlaps a spot that starts 9:15");
  ok(g !== null && early !== null && !overlapsHeld(early, [g]), "O4", "…and not the same game's 10:00 spot with no lead");
  ok(gameSpan("2026-11-14T00:30:00+00:00", {}, 60)?.date === "2026-11-13", "O4", "a lead past midnight lands on the day before");
});

section("L", () => {
  ok(spotStartWall("2026-11-14T09:00:00+00:00", 45) === "2026-11-14T08:15", "L1", "9:00 game, 45-minute lead → 8:15");
  ok(spotStartWall("2026-11-14T09:00:00+00:00", 0) === "2026-11-14T09:00", "L1", "no lead → the game's start");
  ok(spotStartWall("2026-11-14T09:00:00+00:00", 500) === "2026-11-14T07:00", "L2", "a lead over 120 is capped at 120");
  ok(spotStartWall("2026-11-14T09:00:00+00:00", -30) === "2026-11-14T09:00", "L2", "a negative lead is 0");
  ok(leadOf({ leadMinutes: 999 }) === 120 && leadOf({}) === 0 && leadOf(null) === 0 && leadOf({ leadMinutes: 12.9 }) === 12, "L2", "leadOf clamps");
  ok(spotStartWall("garbage", 10) === null, "L3", "an unreadable time has no spot start");
});

section("W", () => {
  const at = new Date("2026-11-10T20:00:00Z");
  ok(wallClockNow("America/Los_Angeles", at) === "2026-11-10T12:00", "W1", "Los Angeles", wallClockNow("America/Los_Angeles", at));
  ok(wallClockNow("America/Chicago", at) === "2026-11-10T14:00", "W1", "Chicago", wallClockNow("America/Chicago", at));
  ok(wallClockNow("Pacific/Honolulu", at) === "2026-11-10T10:00", "W1", "Honolulu");
  ok(wallClockNow("America/Los_Angeles", new Date("2026-11-01T08:30:00Z")) === "2026-11-01T01:30", "W2", "LA after the clock change");
  ok(wallClockNow("America/Los_Angeles", new Date("2026-11-01T07:30:00Z")) === "2026-11-01T00:30", "W2", "LA before the clock change");
  ok(wallClockNow("America/New_York", new Date("2026-11-11T04:59:00Z")) === "2026-11-10T23:59", "W3", "New York just before midnight");
  let threw = false;
  try {
    wallClockNow("Not/AZone", at);
  } catch {
    threw = true;
  }
  ok(threw, "W4", "an unknown zone throws, never a wrong clock");
});

for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);

if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${failures.length} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`sim:volunteer-slots — ${checks} checks pass (TZ=${process.env.TZ ?? "host"}); counters ${JSON.stringify(counters)}`);

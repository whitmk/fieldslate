// Harness for the daylight flags: src/lib/daylight/flags.ts (pure) over the
// shared sunset math in src/lib/sun/.
//
//   npm run sim:daylight            (three host zones)
//   npm run sim:daylight:mutants    (mutation pass, real source)
//
// SOURCE OF TRUTH: the approved mockup, docs/mockups/daylight-flags.html —
// its Santa Rosa sunsets (Oct 22 6:23 PM, Oct 24 6:21, Oct 31 6:12, Nov 7
// 5:05) and its playoff cards (Nov 7 2:00 PM, 3-hour game → "Ends 5 min
// before sunset"; Nov 14 → "Ends 1 min after sunset"). "Start by" is the
// founder's 2026-10-14 decision: a time that carries NO flag (4:00 PM for
// the mockup's Giants vs Rays, not the mockup's 4:20, which is Near).
//
// FIXED "NOW": today is 2026-10-14 in the league's timezone, passed in. The
// module reads no clock.
//
// RUN UNDER THREE ZONES (UTC, America/Los_Angeles, Pacific/Kiritimati): every
// expected value is a literal, so a host zone leaking in fails.
//
// SECTIONS RUN IN THIS ORDER ON PURPOSE — a mutant must die FIRST at its own
// assertion (CLAUDE.md, "killed by the RIGHT assertion"):
//   T  sunsets, and the DST fall-back (Oct 31 vs Nov 7)      ← DL2 (T1)
//   K  kinds: after / near / clear                           ← DL4 (K1)
//   F  the same game clear on Oct 31, Near on Nov 7 (DST)
//   B  boundaries: exactly 20 before = Near, 21 = clear;
//      exactly at sunset = Near, 1 after = After             ← DL3 (B1), DL13 (B3)
//   L  a lit field never flags                               ← DL1 (L1)
//   A  away interleague / no field never flag                ← DL5 (A1)
//   R  rained out (cancelled) / completed never flag         ← DL7 (R1)
//   P  a game dated before today never flags                 ← DL10 (P1)
//   C  no city / unknown city / off / error → no flags       ← DL9 (C2)
//   D  duration through durationFromSettings                 ← DL12 (D1)
//   S  "start by" lands on a time with NO flag               ← DL8 (S1)
//   Z  timezone mismatch: computed in the city, warned       ← DL11 (Z1)
//   W  sentences, verbatim
//   X  playoff cards from the mockup; picker slots
// then ANTI-VACUITY COUNTERS — a zero counter fails the run.
//
// The leak mutant (a flag reaching a public reader) lives in
// `npm run sim:daylight-leaks`, which owns the outbound fence.
//
// MUTATION LOG: see the bottom of this file.

import {
  daylightBracketChipText,
  daylightChipText,
  daylightExplanation,
  daylightFilterLabel,
  daylightFlag,
  daylightPickNotice,
  daylightState,
  daylightStatusLine,
  fmtClock,
  partsFromScheduledAt,
  slotDaylightFlag,
  sunsetLabel,
  sunsetMinuteOn,
  timezoneMismatchLine,
  type DaylightFlag,
  type DaylightGame,
  type DaylightState,
} from "@/lib/daylight/flags";
import { cityById } from "@/lib/sun/us-cities";

let failures = 0;
let checks = 0;
function ok(cond: boolean, tag: string, detail?: string) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${tag}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    failures++;
    console.log(`  FAIL: [CRASH-${name}] ${(e as Error).stack ?? e}`);
  }
}

// ── counters (anti-vacuity) ─────────────────────────────────────────────
const counters = { after: 0, near: 0, clear: 0, litSkipped: 0, awaySkipped: 0, noFieldSkipped: 0, dstFlip: 0 };

// ── fixtures ────────────────────────────────────────────────────────────
const TODAY = "2026-10-14";
const SANTA_ROSA: DaylightState = { kind: "on", city: cityById("ca-santa-rosa") };
const UNLIT = { has_lights: false };
const LIT = { has_lights: true };

function game(over: Partial<DaylightGame>): DaylightGame {
  return { date: "2026-10-22", startTime: "17:15", rawDuration: 120, venue: UNLIT, isAway: false, status: "scheduled", ...over };
}
function flag(over: Partial<DaylightGame>, state: DaylightState = SANTA_ROSA, today = TODAY): DaylightFlag | null {
  const f = daylightFlag(game(over), state, today);
  if (f?.kind === "after") counters.after++;
  else if (f?.kind === "near") counters.near++;
  else counters.clear++;
  return f;
}
const show = (f: DaylightFlag | null) => JSON.stringify(f && { kind: f.kind, minutes: f.minutes, sunset: fmtClock(f.sunsetMin) });

// ── T: sunsets, Santa Rosa, and the DST fall-back ───────────────────────
section("T", () => {
  const sr = cityById("ca-santa-rosa");
  const at = (d: string, want: string, tag: string) => {
    const got = fmtClock(sunsetMinuteOn(d, sr));
    ok(got === want, tag, `${d}: got ${got}, want ${want}`);
  };
  // (DL2, DST ignored: Oct 31 → 5:12 PM.)
  at("2026-10-31", "6:12 PM", "[T1] Oct 31 sunset 6:12 PM (still daylight time)");
  at("2026-11-07", "5:05 PM", "[T2] Nov 7 sunset 5:05 PM (clocks fell back Nov 1)");
  at("2026-10-22", "6:23 PM", "[T3] Oct 22 sunset 6:23 PM");
  at("2026-10-24", "6:21 PM", "[T4] Oct 24 sunset 6:21 PM");
  const jump = sunsetMinuteOn("2026-11-01", sr) - sunsetMinuteOn("2026-10-31", sr);
  if (jump < -55) counters.dstFlip++;
  ok(jump <= -60 && jump >= -63, "[T5] Nov 1 sunset is about an hour earlier on the clock", `jump ${jump}`);
  ok(sunsetLabel("2026-10-22", sr) === "Sunset 6:23 PM", "[T6] sunset label", sunsetLabel("2026-10-22", sr));
});

// ── K: kinds ────────────────────────────────────────────────────────────
section("K", () => {
  // Mockup row 1: Giants vs Rays, Thu Oct 22, 5:15–7:15 PM, Galvin 2 → 52 after.
  const giants = flag({});
  ok(giants?.kind === "after" && giants.minutes === 52, "[K1] Oct 22 5:15–7:15 PM: After, 52 min", show(giants));
  // Mockup: Nationals vs Guardians, Sat Oct 24, 4:15–6:15 PM → 6 before.
  const nats = flag({ date: "2026-10-24", startTime: "16:15" });
  ok(nats?.kind === "near" && nats.minutes === 6, "[K2] Oct 24 4:15–6:15 PM: Near, 6 min", show(nats));
  // Mockup: Mariners vs Angels, Oct 24, 3:30–5:30 PM → clear.
  const mariners = flag({ date: "2026-10-24", startTime: "15:30" });
  ok(mariners === null, "[K3] Oct 24 3:30–5:30 PM: no flag", show(mariners));
});

// ── F: the DST fall-back on a flag (after K, so a kind mutant dies at K) ─
section("F", () => {
  // The same 3:00 PM, 2-hour game: clear on Oct 31, Near on Nov 7.
  const oct31 = flag({ date: "2026-10-31", startTime: "15:00" });
  const nov7 = flag({ date: "2026-11-07", startTime: "15:00" });
  ok(oct31 === null, "[F1] Oct 31 3:00–5:00 PM: no flag", show(oct31));
  ok(nov7?.kind === "near" && nov7.minutes === 5, "[F2] Nov 7 3:00–5:00 PM: 5 min before sunset", show(nov7));
});

// ── B: boundaries (Oct 22, sunset 6:23 PM = 1103) ───────────────────────
section("B", () => {
  // 2-hour games. End 6:03 (20 before) → Near; 6:02 (21 before) → clear.
  const at20 = flag({ startTime: "16:03" });
  ok(at20?.kind === "near" && at20.minutes === 20, "[B1] ends exactly 20 min before sunset: Near", show(at20));
  const at21 = flag({ startTime: "16:02" });
  ok(at21 === null, "[B2] ends 21 min before sunset: no flag", show(at21));
  // End 6:23 (at sunset) → Near 0; 6:24 → After 1.
  const atSunset = flag({ startTime: "16:23" });
  ok(atSunset?.kind === "near" && atSunset.minutes === 0, "[B3] ends exactly at sunset: Near", show(atSunset));
  const after1 = flag({ startTime: "16:24" });
  ok(after1?.kind === "after" && after1.minutes === 1, "[B4] ends 1 min after sunset: After", show(after1));
  ok(atSunset !== null && daylightChipText(atSunset) === "Ends at sunset", "[B5] at-sunset chip");
});

// ── L: lights ───────────────────────────────────────────────────────────
section("L", () => {
  // Mockup: Athletics vs Phillies, Oct 22 5:15–7:15 PM, Rincon Valley Field 1 (lights).
  const lit = flag({ venue: LIT });
  if (lit === null) counters.litSkipped++;
  ok(lit === null, "[L1] a lit field never flags, even 52 min after sunset", show(lit));
  const litSlot = slotDaylightFlag({ date: "2026-11-07", startTime: "16:00" }, 120, LIT, SANTA_ROSA);
  ok(litSlot === null, "[L2] a lit field's slot gets no dot", show(litSlot));
});

// ── A: away interleague and no field ────────────────────────────────────
section("A", () => {
  const away = flag({ isAway: true });
  if (away === null) counters.awaySkipped++;
  ok(away === null, "[A1] an away interleague game never flags", show(away));
  const none = flag({ venue: null });
  if (none === null) counters.noFieldSkipped++;
  ok(none === null, "[A2] a game with no field never flags", show(none));
  // A pending interleague game at OUR field is flagged (decision 7).
  const pending = flag({ status: "pending_interleague" });
  ok(pending?.kind === "after", "[A3] pending interleague at our field: flagged", show(pending));
  const resched = flag({ status: "reschedule_pending" });
  ok(resched?.kind === "after", "[A4] reschedule_pending: flagged at its current time", show(resched));
});

// ── R: rained out and finished games ────────────────────────────────────
section("R", () => {
  const rained = flag({ status: "cancelled" });
  ok(rained === null, "[R1] a rained-out (cancelled) game never flags", show(rained));
  const done = flag({ status: "completed" });
  ok(done === null, "[R2] a completed game never flags", show(done));
});

// ── P: past ─────────────────────────────────────────────────────────────
section("P", () => {
  const past = flag({ date: "2026-10-13" });
  ok(past === null, "[P1] a game dated before today never flags", show(past));
  const todayGame = flag({ date: "2026-10-14" });
  ok(todayGame?.kind === "after", "[P2] a game today is still flagged", show(todayGame));
});

// ── C: city state ───────────────────────────────────────────────────────
section("C", () => {
  const none = daylightState({ sunsetCity: null, enabled: true });
  ok(none.kind === "no_city" && flag({}, none) === null, "[C1] no city: no flags");
  const unknown = daylightState({ sunsetCity: "xx-gone", enabled: true });
  ok(unknown.kind === "unknown_city" && flag({}, unknown) === null, "[C2] unknown stored city: no flags, never a fallback", unknown.kind);
  const off = daylightState({ sunsetCity: "ca-santa-rosa", enabled: false });
  ok(off.kind === "off" && flag({}, off) === null && daylightStatusLine(off) === null, "[C3] toggle off: no flags, no prompt");
  const err = daylightState(null);
  ok(err.kind === "error" && flag({}, err) === null, "[C4] unreadable settings: no flags");
  ok(daylightStatusLine(none) === "Pick your league's city in Settings to see games that end after sunset.", "[C5] no-city prompt", daylightStatusLine(none) ?? "null");
  ok(daylightStatusLine(unknown) === "Your league's city for sunset times isn't recognized. Pick it again in Settings.", "[C6] unknown-city line");
  ok(daylightStatusLine(err) === "Couldn't check daylight for these games.", "[C7] error line, never silent");
  const on = daylightState({ sunsetCity: "ca-santa-rosa", enabled: true });
  ok(on.kind === "on" && on.city.name === "Santa Rosa" && daylightStatusLine(on) === null, "[C8] city set: on");
});

// ── D: duration, one rule ───────────────────────────────────────────────
section("D", () => {
  // A non-numeric or zero setting resolves to 90 (durationFromSettings), never NaN or 0.
  // 5:15 PM + 90 = 6:45 → 22 after sunset (6:23).
  const junk = flag({ rawDuration: "abc" });
  ok(junk?.kind === "after" && junk.minutes === 22, "[D1] unusable duration → 90 minutes", show(junk));
  const zero = flag({ rawDuration: 0 });
  ok(zero?.kind === "after" && zero.minutes === 22, "[D2] zero duration → 90 minutes", show(zero));
  const str = flag({ rawDuration: "105" });
  ok(str?.kind === "after" && str.minutes === 37, "[D3] numeric string honoured (105)", show(str));
  // Start with seconds (playoff `time` columns).
  const secs = flag({ startTime: "17:15:00" });
  ok(secs?.kind === "after" && secs.minutes === 52, "[D4] HH:MM:SS start", show(secs));
  const parts = partsFromScheduledAt("2026-10-22T17:15:00+00:00");
  ok(parts.date === "2026-10-22" && parts.startTime === "17:15", "[D5] scheduled_at read as wall clock", JSON.stringify(parts));
});

// ── S: "start by" ───────────────────────────────────────────────────────
section("S", () => {
  const giants = flag({})!;
  // Sunset 6:23 − 21 − 120 = 4:02 → grid → 4:00 PM. (DL8, near ignored: 4:20.)
  ok(giants.startByMin === 16 * 60, "[S1] Giants vs Rays: start by 4:00 PM", fmtClock(giants.startByMin ?? -1));
  const check = flag({ startTime: fmtHHMM(giants.startByMin!) });
  ok(check === null, "[S2] starting at the start-by time carries no flag", show(check));
  // A 3-hour playoff game on Nov 14 (sunset 4:59): 4:59 − 21 − 180 = 1:38 → 1:35 PM.
  const p = flag({ date: "2026-11-14", startTime: "14:00", rawDuration: 180 })!;
  ok(p.startByMin === 13 * 60 + 35, "[S3] Nov 14 3-hour game: start by 1:35 PM", fmtClock(p.startByMin ?? -1));
});

// ── Z: timezone mismatch ────────────────────────────────────────────────
section("Z", () => {
  const phx = cityById("az-phoenix");
  const line = timezoneMismatchLine(phx, "America/Los_Angeles");
  ok(line === "Phoenix is on Arizona time (no daylight time), but your league's timezone is set to Pacific time. Sunset times are figured for Phoenix, so check the timezone setting.", "[Z1] mismatch warned in Settings", line ?? "null");
  ok(timezoneMismatchLine(phx, "America/Phoenix") === null, "[Z2] matching zone: no warning");
  ok(timezoneMismatchLine(cityById("ca-santa-rosa"), "America/Los_Angeles") === null, "[Z3] Santa Rosa + Pacific: no warning");
  // Computed in the CITY's clock: Phoenix sunset Oct 31 is 5:37 PM. A 3:30–5:30
  // game is Near (7 before) whatever the league's timezone says.
  const f = daylightFlag(game({ date: "2026-10-31", startTime: "15:30" }), { kind: "on", city: phx }, TODAY);
  ok(f?.kind === "near" && f.minutes === 7 && fmtClock(f.sunsetMin) === "5:37 PM", "[Z4] mismatch: flag uses the city's sunset", show(f));
});

// ── W: sentences ────────────────────────────────────────────────────────
section("W", () => {
  const giants = flag({})!;
  const w1 = daylightExplanation(giants, "Galvin Park — Field 2");
  ok(w1 === "Ends 52 minutes after sunset. Sunset that day is 6:23 PM, and Galvin Park — Field 2 has no lights. To finish in daylight, start by 4:00 PM.", "[W1] explanation, after", w1);
  const nats = flag({ date: "2026-10-24", startTime: "16:15" })!;
  const w2 = daylightExplanation(nats, "Andrews — Field 2");
  ok(w2 === "Ends 6 minutes before sunset. Sunset that day is 6:21 PM, and Andrews — Field 2 has no lights. To finish more than 20 minutes before sunset, start by 4:00 PM.", "[W2] explanation, near", w2);
  // Mockup picker: Oct 31, 4:30 PM at Galvin 2, 2-hour game → 18 after 6:12.
  const pick = slotDaylightFlag({ date: "2026-10-31", startTime: "16:30" }, 120, UNLIT, SANTA_ROSA)!;
  const w3 = daylightPickNotice(pick, "Galvin Park — Field 2");
  ok(w3 === "This time ends 18 minutes after sunset (6:12 PM on Oct 31). Galvin Park — Field 2 has no lights. You can still save it.", "[W3] picker notice", w3);
  ok(daylightChipText(giants) === "52 min after sunset" && daylightChipText(nats) === "6 min before sunset", "[W4] row chips");
  ok(daylightFilterLabel(3) === "Daylight: 3 games" && daylightFilterLabel(1) === "Daylight: 1 game", "[W5] filter label");
  const one = flag({ startTime: "16:24" })!;
  ok(daylightExplanation(one, "F").startsWith("Ends 1 minute after sunset."), "[W6] singular minute");
});

// ── X: playoff cards and picker slots (mockup) ──────────────────────────
section("X", () => {
  // Game 1, Sat 11/7 10:45 AM, 3 hours → clear. Game 2, 2:00 PM → 5 before. Game 4, Sat 11/14 2:00 PM → 1 after.
  const g1 = flag({ date: "2026-11-07", startTime: "10:45", rawDuration: 180 });
  const g2 = flag({ date: "2026-11-07", startTime: "14:00", rawDuration: 180 });
  const g4 = flag({ date: "2026-11-14", startTime: "14:00", rawDuration: 180 });
  ok(g1 === null, "[X1] bracket Game 1: no flag", show(g1));
  ok(g2 !== null && daylightBracketChipText(g2) === "Ends 5 min before sunset", "[X2] bracket Game 2: Ends 5 min before sunset", show(g2));
  ok(g4 !== null && daylightBracketChipText(g4) === "Ends 1 min after sunset", "[X3] bracket Game 4: Ends 1 min after sunset", show(g4));
  // Picker, Sat Oct 31 (sunset 6:12): 10:00 and 12:30 clear; 4:00 PM Galvin 2 ends 6:00 → 12 before (dot).
  const slot = (d: string, t: string) => slotDaylightFlag({ date: d, startTime: t }, 120, UNLIT, SANTA_ROSA);
  ok(slot("2026-10-31", "10:00") === null && slot("2026-10-31", "12:30") === null, "[X4] morning slots: no dot");
  ok(slot("2026-10-31", "16:00")?.kind === "near", "[X5] Oct 31 4:00 PM slot: near dot");
  // Nov 7 (sunset 5:05): 2:45 PM ends 4:45 → 20 before → Near.
  ok(slot("2026-11-07", "14:45")?.kind === "near", "[X6] Nov 7 2:45 PM slot: near dot");
  // A slot dated before today still gets its dot: the admin is choosing it now.
  ok(slot("2026-10-01", "17:15")?.kind === "after", "[X7] slots ignore today");
});

// ── counters ────────────────────────────────────────────────────────────
for (const [k, v] of Object.entries(counters)) ok(v > 0, `[COUNT-${k}] fired`, `counter ${k} = ${v}`);

function fmtHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

console.log(`daylight (${process.env.TZ ?? "host"}): ${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);

// MUTATION LOG
// 2026-10-14, first pass: 12 mutants, 11 killed at their own assertion; DL4
// (after/near swapped) died first at T7 — a HARNESS ordering fault: section T
// checked a flag's KIND (the Oct 31 vs Nov 7 game) before K. Those two
// fixtures moved to section F after K; DL4 now dies at K1, DL2 still at T1.

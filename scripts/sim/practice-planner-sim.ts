// Harness for the practice field calculator's math: src/lib/practice-planner/
// (plus the shared sunset + city list in src/lib/sun/, moved there 2026-10-14)
// — the pure module the public page (/tools/practice-field-calculator) calls,
// and that a later in-app version must reuse.
//
//   npm run sim:practice-planner            (three host zones)
//   npm run sim:practice-planner:mutants    (mutation pass, real source)
//
// SOURCE OF TRUTH: the approved mockup's script,
// docs/mockups/practice-field-calculator.html. Section K pins the example
// league's answers from it (60-ft 6/14, 50/70 2/4, 90-ft 2/3) and section S
// the Santa Rosa sunsets (±3 min). If K goes red after a change, the change
// diverged from the mockup — fix the change, never the literals.
//
// RUN UNDER THREE ZONES (UTC, America/Los_Angeles, Pacific/Kiritimati): every
// expected value is a literal, so a host zone leaking into the sunset or
// date math fails instead of agreeing with itself.
//
// SECTIONS RUN IN THIS ORDER ON PURPOSE — a mutant must die FIRST at its own
// assertion (CLAUDE.md, "killed by the RIGHT assertion"). Every F fixture is
// small enough to check by hand; the hand answer is in its comment, and the
// mutated answer beside it, so each fixture is known to SEPARATE real from
// mutated code before the runner proves it:
//   F1  4 teams, 1x 90 min, Mon, 5–8pm, 1/field → 2 fields (control)
//   F2  same, 2 teams per field → 1 field                    ← PP2
//   F3a 2 teams, 1x 90 min, 5–8pm, 0 min between → 1 field   (control)
//   F3  same, 5 min between → 2 fields                       ← PP3
//   F4  once a day per team                                  ← PP4
//   F5  same-nights preference: Tue, Thu                     ← PP1
//   F6  busiest night, never the week's sum                  ← PP6
//   F7  fewest allowed days first                            ← PP7
//   F8  a practice longer than its window is skipped         ← PP8
//   F9  load tie → fewer of this division's practices        ← PP9
//   F10 packing sort: narrowest window first                 ← PP12
//   K   the example league (the mockup's known answers)
//   S   sunset, Santa Rosa                                   ← PP5 (S2)
//       + the shared city list: pinned ids, no fallback, zones ← PP20 (S8), PP19 (S9), PP21 (S10)
//   D   daylight: from / until / never / ok / between / gap  ← PP15 (D1), PP10 (D2), PP11 (D3)
//   L   daylight is judged at the practices' ACTUAL end       ← PP13 (L1)
//   W   warnings; W5 the never wording                      ← PP16 (W5)
//   T   totals; too-long practices left out                   ← PP14 (T2)
//   R   city-request text, incl. a season across New Year
//   N   day lists ("Mon–Fri", "Mon, Wed, Fri") and busiest-night ties ← PP18 (N1), PP17 (N8)
//   P   the in-app options: the given city always wins (null = no
//       daylight), earliest sunset, lit skips daylight only ← PP27 (P1),
//       PP26 (P2), PP24 (P3), PP25 (P4)
//   G   the public calculator's output equals the golden recorded before
//       the in-app planner's module change (14 cases + first render)
// then ANTI-VACUITY COUNTERS — a zero counter fails the run.
//
// MUTATION LOG: see the bottom of this file.

import { computeMode, distribute } from "@/lib/practice-planner/plan";
import { busiestLabel, computePlan, requestText } from "@/lib/practice-planner/report";
import { daylightFor, sunsetMinutes, type DaylightResult } from "@/lib/sun/sunset";
import { cityById, cityByIdOrNull, cityTimezone, US_CITIES } from "@/lib/sun/us-cities";
import { ORG_TIMEZONES } from "@/lib/calendar/timezones";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE_LEAGUE } from "@/lib/practice-planner/example-league";
import { fmtDate, fmtTime, formatDayList, parseIsoDate } from "@/lib/practice-planner/format";
import type { DivisionInput, ModeResult, PlanCore, PlannerInput } from "@/lib/practice-planner/types";
import { captureGolden, GOLDEN_CASES, type Golden } from "./practice-planner-golden";

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
const counters = {
  sharedFieldBlocks: 0, // a block carrying 2+ teams was placed
  fieldReused: 0, // a field held 2+ blocks
  skippedBlocks: 0, // a practice longer than its window was skipped
  daylight: new Set<DaylightResult["kind"]>(),
};
function count(r: ModeResult) {
  for (const nights of Object.values(r.byType)) {
    for (const n of nights) {
      counters.skippedBlocks += n.skipped;
      for (const f of n.fields) {
        if (f.length > 1) counters.fieldReused++;
        for (const b of f) if (b.teams > 1) counters.sharedFieldBlocks++;
      }
    }
  }
}

// ── fixtures ────────────────────────────────────────────────────────────
function div(over: Partial<DivisionInput>): DivisionInput {
  return {
    name: "D",
    teams: 4,
    perWeek: 1,
    lengthMin: 90,
    days: [0],
    start: "17:00",
    end: "20:00",
    fieldType: "diamond60",
    teamsPerField: 1,
    ...over,
  };
}
function league(divisions: DivisionInput[], over: Partial<PlannerInput> = {}): PlannerInput {
  return { seasonStart: "2027-03-01", seasonEnd: "2027-03-31", cityId: "ca-sacramento", minutesBetween: 0, divisions, ...over };
}
function need(input: PlannerInput, mode: "spread" | "sameNights" = "spread"): number {
  const r = computeMode(input, mode);
  count(r);
  return r.need.diamond60.fields;
}
/** practices per day [Mon..Sun] for division i on 60-ft diamonds */
function perDay(input: PlannerInput, mode: "spread" | "sameNights", i: number): number[] {
  const dem = distribute(input, mode).diamond60;
  return dem.map((day) => day.find((x) => x.division === i)?.practices ?? 0);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── F: hand-checkable fixtures ──────────────────────────────────────────
section("F", () => {
  // F1: 4 blocks of 90 in 5–8pm → two per field → 2 fields, either mode.
  const f1 = league([div({})]);
  ok(need(f1) === 2 && need(f1, "sameNights") === 2, "[F1]", `got ${need(f1)} / ${need(f1, "sameNights")}`);

  // F2: 2 teams per field → 2 blocks → 1 field. (PP2, per ignored: 4 blocks → 2.)
  const f2 = league([div({ teamsPerField: 2 })]);
  ok(need(f2) === 1, "[F2] teams per field", `got ${need(f2)}`);

  // F3a: 90 + 90 = 180 = the 3h window → one field with nothing between.
  const f3a = league([div({ teams: 2 })]);
  ok(need(f3a) === 1, "[F3a] no changeover", `got ${need(f3a)}`);
  // F3: 90 + 5 + 90 = 185 > 180 → 2 fields. (PP3, changeover ignored: 1.)
  const f3 = league([div({ teams: 2 })], { minutesBetween: 5 });
  ok(need(f3) === 2, "[F3] changeover", `got ${need(f3)}`);

  // F4: A (Wed only, 2 teams) loads Wed with 180. B (1 team, 2x, Mon/Wed):
  // practice 1 → Mon (0); practice 2 → Mon is the team's day already, so
  // Wed. (PP4, cap removed: Mon 90 < Wed 180 → Mon twice.)
  const f4 = league([div({ name: "A", teams: 2, days: [2] }), div({ name: "B", teams: 1, perWeek: 2, days: [0, 2] })]);
  ok(eq(perDay(f4, "spread", 1), [1, 0, 1, 0, 0, 0, 0]), "[F4] once a day per team", JSON.stringify(perDay(f4, "spread", 1)));

  // F5: 2 teams, 2x, Mon–Fri, same nights → Tue and Thu, 2 each.
  // (PP1, calendar order: Mon and Tue.)
  const f5 = league([div({ teams: 2, perWeek: 2, days: [0, 1, 2, 3, 4] })]);
  ok(eq(perDay(f5, "sameNights", 0), [0, 2, 0, 2, 0, 0, 0]), "[F5] same-nights preference", JSON.stringify(perDay(f5, "sameNights", 0)));

  // F6: 4 teams, 1x, Mon/Tue → 2 a night, 1 field each night → request 1.
  // (PP6, sum over nights: 2.)
  const f6 = league([div({ days: [0, 1] })]);
  ok(need(f6) === 1, "[F6] busiest night, not the sum", `got ${need(f6)}`);

  // F7: windows fit ONE 90-min practice per field. B (Mon/Tue, 2 teams) is
  // listed first, A (Mon only, 2 teams) second. Fewest days first: A → Mon 2;
  // B → Tue 2 → 2 fields. (PP7, list order: B → Mon 1, Tue 1; A → Mon 2
  // more → Mon 3 → 3 fields.)
  const one = { start: "17:00", end: "18:30" };
  const f7 = league([div({ name: "B", teams: 2, days: [0, 1], ...one }), div({ name: "A", teams: 2, days: [0], ...one })]);
  ok(need(f7) === 2, "[F7] fewest allowed days first", `got ${need(f7)}`);

  // F8: 120 minutes in a 60-minute window → nothing placed, 1 skipped.
  // (PP8, counted anyway: 1 field.)
  const f8 = league([div({ teams: 1, lengthMin: 120, start: "17:00", end: "18:00" })]);
  const r8 = computeMode(f8, "spread");
  count(r8);
  ok(r8.need.diamond60.fields === 0 && r8.byType.diamond60[0].skipped === 1, "[F8] too-long practice skipped",
    `fields ${r8.need.diamond60.fields}, skipped ${r8.byType.diamond60[0].skipped}`);

  // F9: A (Tue only, 1 team) loads Tue with 90. B (2 teams, 1x, Mon/Tue):
  // practice 1 → Mon (0 < 90); practice 2 → Mon 90 = Tue 90, B has 1 on Mon
  // and 0 on Tue → Tue. (PP9, no per-division tie-break: Mon, calendar order.)
  const f9 = league([div({ name: "A", teams: 1, days: [1] }), div({ name: "B", teams: 2, days: [0, 1] })]);
  ok(eq(perDay(f9, "spread", 1), [1, 1, 0, 0, 0, 0, 0]), "[F9] tie → fewer of this division", JSON.stringify(perDay(f9, "spread", 1)));

  // F10: X (5–8pm) is listed before Y (5–6:30pm, room for exactly one 90).
  // Narrowest first: Y at 5:00 on field 1, X fits after it at 6:30 → 1 field.
  // (PP12, sort removed: X takes 5:00, Y has nowhere on field 1 → 2.)
  const f10 = league([div({ name: "X", teams: 1 }), div({ name: "Y", teams: 1, start: "17:00", end: "18:30" })]);
  ok(need(f10) === 1, "[F10] narrowest window packs first", `got ${need(f10)}`);
});

// ── K: the example league (the mockup's known answers) ──────────────────
const SANTA_ROSA = { ...EXAMPLE_LEAGUE, cityId: "ca-santa-rosa" };
section("K", () => {
  const p = computePlan(SANTA_ROSA);
  count(p.spread);
  count(p.sameNights);
  const got = (z: "diamond60" | "diamond5070" | "diamond90") => [p.spread.need[z].fields, p.sameNights.need[z].fields];
  ok(eq(got("diamond60"), [6, 14]), "[K1] 60-ft 6 spread / 14 same nights", JSON.stringify(got("diamond60")));
  ok(eq(got("diamond5070"), [2, 4]), "[K2] 50/70 2 / 4", JSON.stringify(got("diamond5070")));
  ok(eq(got("diamond90"), [2, 3]), "[K3] 90-ft 2 / 3", JSON.stringify(got("diamond90")));
  ok(eq(p.inUse, ["diamond60", "diamond5070", "diamond90"]), "[K4] field types in use", JSON.stringify(p.inUse));
  // The page default is Sacramento; the field counts don't depend on the city.
  const s = computePlan(EXAMPLE_LEAGUE);
  ok(EXAMPLE_LEAGUE.cityId === "ca-sacramento" && s.spread.need.diamond60.fields === 6, "[K5] default city Sacramento");
});

// ── S: sunset, Santa Rosa (NOAA approximation, ±3 min) ──────────────────
section("S", () => {
  const sr = cityById("ca-santa-rosa");
  const near = (d: string, hhmm: number, tag: string) => {
    const got = sunsetMinutes(parseIsoDate(d), sr);
    ok(Math.abs(got - hhmm) <= 3, tag, `${d}: got ${got.toFixed(1)} min, want ${hhmm} ±3`);
  };
  near("2027-02-22", 17 * 60 + 57, "[S1] Feb 22 ≈ 5:57pm");
  near("2027-03-15", 19 * 60 + 18, "[S2] Mar 15 ≈ 7:18pm (after DST)");
  near("2027-05-29", 20 * 60 + 27, "[S3] May 29 ≈ 8:27pm");
  // No DST in Arizona: the day DST starts moves Phoenix's sunset by about a minute, not an hour.
  const phx = cityById("az-phoenix");
  const jump = sunsetMinutes(parseIsoDate("2027-03-14"), phx) - sunsetMinutes(parseIsoDate("2027-03-13"), phx);
  ok(Math.abs(jump) < 3, "[S4] Arizona has no DST", `jump ${jump.toFixed(1)}`);
  // The city list: unique ids, every state plus DC, the two named cities present.
  const ids = new Set(US_CITIES.map((c) => c.id));
  ok(ids.size === US_CITIES.length, "[S5] city ids unique");
  ok(new Set(US_CITIES.map((c) => c.state)).size === 51, "[S6] 50 states + DC");
  ok(ids.has("ca-santa-rosa") && ids.has("ca-sacramento"), "[S7] Santa Rosa and Sacramento listed");
  // A league STORES a city id (daylight flags), so the list may only GROW: every
  // pinned id must still exist. Adding a city adds an id; append it to the pin.
  const pinned: string[] = JSON.parse(readFileSync(join(__dirname, "fixtures", "sun-city-ids.json"), "utf8"));
  const missing = pinned.filter((id) => !ids.has(id));
  ok(pinned.length >= 142 && missing.length === 0, "[S8] pinned city ids all still exist (additions only)", missing.join(", "));
  // A stored key that no longer exists is "no city" — never the calculator's Sacramento fallback.
  ok(cityByIdOrNull("xx-nowhere") === null && cityByIdOrNull(null) === null && cityByIdOrNull("ca-santa-rosa")?.name === "Santa Rosa", "[S9] cityByIdOrNull: unknown → null");
  const zones = new Set(ORG_TIMEZONES.map((z) => z.id));
  const unmapped = US_CITIES.filter((c) => !zones.has(cityTimezone(c) ?? "")).map((c) => c.id);
  ok(unmapped.length === 0 && cityTimezone(cityById("az-phoenix")) === "America/Phoenix" && cityTimezone(cityById("co-denver")) === "America/Denver", "[S10] every city maps to a league timezone", unmapped.join(", "));
});

// ── D: daylight, Sacramento ─────────────────────────────────────────────
section("D", () => {
  const sac = cityById("ca-sacramento");
  const day = (end: string, a: string, b: string) => {
    const [h, m] = end.split(":").map(Number);
    const r = daylightFor(h * 60 + m, parseIsoDate(a), parseIsoDate(b), sac);
    counters.daylight.add(r.kind);
    return JSON.stringify(r, (k, v) => (k === "from" || k === "until" ? fmtDate(v) : v));
  };
  // Spring: dark at the start, light from Apr 17 (Phoenix; a no-DST city).
  const phx = daylightFor(19 * 60, parseIsoDate("2027-03-01"), parseIsoDate("2027-04-30"), cityById("az-phoenix"));
  counters.daylight.add(phx.kind);
  ok(phx.kind === "from" && fmtDate(phx.from) === "Apr 17", "[D1] spring: works from", JSON.stringify(phx));
  // Fall: 7:30pm works through Sep 5 (sunset 7:29pm on Sep 6). (PP10: no warning.)
  const d2 = day("19:30", "2027-08-15", "2027-11-15");
  ok(d2 === '{"kind":"until","until":"Sep 5"}', "[D2] fall: works until", d2);
  // Never: 8pm in Oct–Nov. (PP11: reported as fine.)
  const d3 = day("20:00", "2027-10-01", "2027-11-30");
  ok(d3 === '{"kind":"never"}', "[D3] never this season", d3);
  const d4 = day("19:00", "2027-05-01", "2027-06-30");
  ok(d4 === '{"kind":"ok"}', "[D4] daylight all season", d4);
  const d5 = day("20:15", "2027-04-01", "2027-09-30");
  ok(d5 === '{"kind":"between","from":"May 20","until":"Aug 2"}', "[D5] a season spanning summer", d5);
  // 5:30pm, Oct–Mar: fine until DST ends (Nov 7), back from Feb 3.
  const d6 = day("17:30", "2027-10-01", "2028-03-31");
  ok(d6 === '{"kind":"gap","until":"Nov 6","from":"Feb 3"}', "[D6] a season spanning winter", d6);
});

// ── L: daylight at the practices' actual end, not the window's ───────────
section("L", () => {
  // Window 5–8pm, but one 60-minute practice a week packs at 5pm and ends at
  // 6pm. Sunset in Sacramento is 7:58pm on May 1 and later after that, so
  // there is nothing to warn about. (PP13, window end: 8pm is after the May 1
  // sunset → "an 8pm finish works from May 4".)
  const l1 = computePlan(
    league([div({ name: "Early", teams: 1, lengthMin: 60 })], { seasonStart: "2027-05-01", seasonEnd: "2027-06-30" }),
  );
  ok(l1.warnings.spread.length === 0 && l1.warnings.sameNights.length === 0, "[L1] practices end before sunset: no warning",
    JSON.stringify(l1.warnings));
});

// ── W: warnings, verbatim ───────────────────────────────────────────────
section("W", () => {
  ok(
    // Spread: T-Ball's one block a night ends 6pm; 50/70 (one 90 in a 5:30–8
    // window per field) 7pm; Rookie's second block 7:15pm; Juniors (two
    // fields at 5:30) 7:30pm; Minors and Majors fill to 8pm.
    eq(computePlan(SANTA_ROSA).warnings.spread, [
      "Daylight: T-Ball runs until 6pm, but sunset on Feb 22 is 5:57pm. Without lights, a 6pm finish works from Feb 26.",
      "Daylight: 50/70 runs until 7pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7pm finish works from Mar 14.",
      "Daylight: Rookie runs until 7:15pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7:15pm finish works from Mar 14.",
      "Daylight: Juniors runs until 7:30pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7:30pm finish works from Mar 28.",
      "Daylight: Minors AA, Minors AAA, Majors run until 8pm, but sunset on Feb 22 is 5:57pm. Without lights, an 8pm finish works from Apr 29.",
    ]),
    "[W1] example league daylight warnings (spread)",
    JSON.stringify(computePlan(SANTA_ROSA).warnings.spread),
  );
  ok(
    eq(computePlan(SANTA_ROSA).warnings.sameNights, [
      "Daylight: T-Ball, 50/70 run until 7pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7pm finish works from Mar 14.",
      "Daylight: Rookie, Juniors run until 7:30pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7:30pm finish works from Mar 28.",
      "Daylight: Minors AA, Minors AAA, Majors run until 8pm, but sunset on Feb 22 is 5:57pm. Without lights, an 8pm finish works from Apr 29.",
    ]),
    "[W1b] example league daylight warnings (same nights)",
    JSON.stringify(computePlan(SANTA_ROSA).warnings.sameNights),
  );
  // 6–7:30pm window, 90 minutes: every practice runs 6–7:30pm.
  const fall = computePlan(
    league([div({ name: "Fall Ball", start: "18:00", end: "19:30" })], { seasonStart: "2027-08-15", seasonEnd: "2027-11-15" }),
  );
  ok(
    eq(fall.warnings.spread, [
      "Daylight: Fall Ball runs until 7:30pm, but sunset on Sep 6 is 7:29pm. Without lights, a 7:30pm finish works until Sep 5.",
    ]),
    "[W2] fall wording",
    JSON.stringify(fall.warnings.spread),
  );
  const extra = computePlan(
    league(
      [div({ name: "Big", teams: 1, perWeek: 3, days: [0, 2] }), div({ name: "Long", teams: 1, lengthMin: 120, end: "18:00" })],
      { seasonStart: "2027-05-01", seasonEnd: "2027-06-30" },
    ),
  );
  ok(
    // Big's practices end 6:30pm (no daylight line); Long places nothing.
    eq(extra.warnings.spread, [
      "Big practices 3 times a week but only has 2 days picked. Counted as 2.",
      "Long's 120-minute practice doesn't fit between 5pm and 6pm. Those practices aren't counted.",
    ]),
    "[W3] per-week and length warnings",
    JSON.stringify(extra.warnings.spread),
  );
  ok(computePlan(league([div({})], { seasonEnd: "2027-02-01" })).seasonError === "Practices end before they start.", "[W4] dates reversed");
  // "Never" wording: one 90-minute practice at 7–8:30pm, Sep–Nov. Sunset on
  // Sep 1 is 7:36pm and only gets earlier, so the practice ends after sunset
  // every day of the season. (PP16, the never sentence dropped: no warning.)
  const owls = computePlan(
    league([div({ name: "Night Owls", teams: 1, start: "19:00", end: "20:30" })], { seasonStart: "2027-09-01", seasonEnd: "2027-11-30" }),
  );
  ok(
    eq(owls.warnings.spread, [
      "Daylight: Night Owls runs until 8:30pm, but sunset on Sep 1 is 7:36pm. Without lights, an 8:30pm finish doesn't work at any point this season.",
    ]),
    "[W5] never-this-season wording",
    JSON.stringify(owls.warnings.spread),
  );
});

// ── T: season totals ────────────────────────────────────────────────────
section("T", () => {
  // 76 practices; 6030 field-minutes = 100.5 h/week; Feb 22–May 29 = 97 days = 14 weeks; 1407 h.
  const t = computePlan(SANTA_ROSA).totals;
  ok(eq(t, { teamPracticesPerWeek: 76, fieldHoursPerWeek: 101, weeks: 14, fieldHoursSeason: 1407 }), "[T1] example totals", JSON.stringify(t));
  // 4 × 90 min fit (6 h/week); "Long" (120 min in a 1h window) is left out,
  // as its warning says. Mar 1–31 = 31 days = 5 weeks → 30 h.
  // (PP14, counted: 5 practices, 8 h/week, 40 h.)
  const t2 = computePlan(league([div({}), div({ name: "Long", teams: 1, lengthMin: 120, end: "18:00" })])).totals;
  ok(eq(t2, { teamPracticesPerWeek: 4, fieldHoursPerWeek: 6, weeks: 5, fieldHoursSeason: 30 }), "[T2] too-long practices not in totals",
    JSON.stringify(t2));
});

// ── R: copy for city request ────────────────────────────────────────────
section("R", () => {
  const input = league([div({ name: "Minors", days: [1, 3] })], { seasonStart: "2027-02-22", seasonEnd: "2027-05-29" });
  const p = computePlan(input);
  const want = [
    "Practice field request: Feb 22 to May 29, 2027",
    "",
    "60-ft diamonds: 1 at the busiest time",
    "  Tuesday: 1 field, 5pm to 8pm",
    "  Thursday: 1 field, 5pm to 8pm",
    "",
    "Based on: Minors (4 teams, 1x/week, 90 min).",
  ].join("\n");
  const got = requestText(input, p.spread, p.inUse);
  ok(got === want, "[R1] city request text", JSON.stringify(got));
  // Across New Year: both years.
  const nye = league([div({ name: "Winter" })], { seasonStart: "2026-11-01", seasonEnd: "2027-02-28" });
  const first = requestText(nye, computePlan(nye).spread, ["diamond60"]).split("\n")[0];
  ok(first === "Practice field request: Nov 1, 2026 to Feb 28, 2027", "[R2] season across New Year names both years", first);
});

// ── N: day lists and the busiest night ──────────────────────────────────
section("N", () => {
  const dl = (days: number[], want: string, tag: string) => {
    const got = formatDayList(days);
    ok(got === want, tag, `${JSON.stringify(days)} → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  // (PP18, no ranges: "Mon, Tue, Wed, Thu, Fri".)
  dl([0, 1, 2, 3, 4], "Mon–Fri", "[N1] five in a row → range");
  dl([0, 1, 2], "Mon–Wed", "[N2] three in a row → range");
  dl([0, 2, 4], "Mon, Wed, Fri", "[N3] no run → listed");
  dl([0, 1, 3], "Mon, Tue, Thu", "[N4] two in a row stay listed");
  dl([0, 1, 2, 4, 5, 6], "Mon–Wed, Fri–Sun", "[N5] two ranges");
  dl([4, 0, 2, 2], "Mon, Wed, Fri", "[N6] any order, duplicates once");
  dl([], "", "[N7] none");
  // Ties. Example league, spread: every weeknight needs 6 60-ft diamonds.
  // (PP17, ties dropped: "Monday".)
  const ex = computePlan(SANTA_ROSA);
  ok(busiestLabel(ex.spread.need.diamond60) === "Mon–Fri", "[N8] busiest tie → day range",
    busiestLabel(ex.spread.need.diamond60));
  // Same nights in the example: T-Ball's one practice is Tuesday only, so
  // Tuesday (14) beats Thursday (13) — a single busiest night, full name.
  ok(busiestLabel(ex.sameNights.need.diamond60) === "Tuesday", "[N9a] example same nights: one busiest night",
    busiestLabel(ex.sameNights.need.diamond60));
  // F5's league: 2 teams, 2x, same nights → Tue and Thu, 1 field each: a tie
  // that isn't a run.
  const f5 = computeMode(league([div({ teams: 2, perWeek: 2, days: [0, 1, 2, 3, 4] })]), "sameNights").need.diamond60;
  ok(busiestLabel(f5) === "Tue, Thu", "[N9] busiest tie, not a run → listed", busiestLabel(f5));
  // A single busiest night keeps its full name: F7's league (Mon 2, Tue 2)
  // ties, so use one division that only practices Wednesday.
  const one = computeMode(league([div({ days: [2] })]), "spread").need.diamond60;
  ok(busiestLabel(one) === "Wednesday" && eq(one.peakDays, [2]), "[N10] single busiest night → full name", JSON.stringify(one));
  ok(busiestLabel(computeMode(league([]), "spread").need.diamond60) === "—", "[N11] no practices → dash");
});

// ── P: the in-app planner's options (2026-10-21) ────────────────────────
// computePlan(core, { city }): the league's city resolved by the app (or
// null), a per-division `lit` flag, and the earliest sunset. None of this may
// reach the calculator's no-options path — section G pins that, and PP28
// (earliestSunset added without options) dies there. Literals were computed
// once by hand-run of the module (Santa Rosa, Feb 22 – May 29, 2027) and
// match the in-app mockup.
let optionsCases = 0;
section("P", () => {
  const sr = cityById("ca-santa-rosa");
  const { cityId: _drop, ...rest } = EXAMPLE_LEAGUE;
  void _drop;
  const core: PlanCore = rest;
  const majorsLit: PlanCore = { ...core, divisions: core.divisions.map((d) => (d.name === "Majors" ? { ...d, lit: true } : d)) };

  // ORDER: the city checks run before the lit checks. The lit fixtures'
  // input has no city id at all, so a stray cityById call (PP27) would
  // otherwise surface at the lit assertion first instead of at P1.
  // P1: the GIVEN city wins, even when the object also carries another
  // city's id (the app's input has none; this proves cityById is never
  // consulted). (PP27, cityById(input.cityId) when a city is given: New York.)
  const elsewhere = { ...core, cityId: "ny-new-york" } as PlanCore;
  const given = computePlan(elsewhere, { city: sr });
  optionsCases++;
  ok(given.warnings.spread.length === 5 &&
    given.warnings.spread[4] === "Daylight: Minors AA, Minors AAA, Majors run until 8pm, but sunset on Feb 22 is 5:57pm. Without lights, an 8pm finish works from Apr 29." &&
    given.earliestSunset !== undefined && given.earliestSunset !== null &&
    fmtDate(given.earliestSunset.date) === "Feb 22" && fmtTime(given.earliestSunset.minutes) === "5:57pm",
    "[P1] the given city wins over any city id", JSON.stringify({ w: given.warnings.spread, e: given.earliestSunset }));
  // Earliest sunset in a fall season: the LAST day, after the clock change
  // (Nov 1 drops to 5:11pm, Nov 7 is 5:05pm) — never the first day's 7:42pm.
  const fall = computePlan({ ...core, seasonStart: "2026-08-31", seasonEnd: "2026-11-07" }, { city: sr });
  optionsCases++;
  ok(fall.earliestSunset != null && fmtDate(fall.earliestSunset.date) === "Nov 7" && fmtTime(fall.earliestSunset.minutes) === "5:05pm",
    "[P1b] a fall season's earliest sunset is its last day", JSON.stringify(fall.earliestSunset));

  // P2: city null → no daylight at all, no sunset, earliestSunset null (the
  // key present, because options were given) — never a fallback city, even
  // with a city id on the object. (PP26, null falls back to cityById.)
  const none = computePlan({ ...core, cityId: "ca-santa-rosa" } as PlanCore, { city: null });
  optionsCases++;
  ok(none.warnings.spread.length === 0 && none.warnings.sameNights.length === 0 && none.sunsetAtStart === null &&
    "earliestSunset" in none && none.earliestSunset === null,
    "[P2] no city: no daylight, no sunset, no fallback", JSON.stringify({ w: none.warnings, s: none.sunsetAtStart, e: none.earliestSunset }));
  // P3: Majors on lit fields leaves the daylight warnings; everyone else's
  // stay. (PP24, lit ignored: "Minors AA, Minors AAA, Majors run until 8pm".)
  const lit = computePlan(majorsLit, { city: sr });
  optionsCases++;
  ok(eq(lit.warnings.spread, [
    "Daylight: T-Ball runs until 6pm, but sunset on Feb 22 is 5:57pm. Without lights, a 6pm finish works from Feb 26.",
    "Daylight: 50/70 runs until 7pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7pm finish works from Mar 14.",
    "Daylight: Rookie runs until 7:15pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7:15pm finish works from Mar 14.",
    "Daylight: Juniors runs until 7:30pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7:30pm finish works from Mar 28.",
    "Daylight: Minors AA, Minors AAA run until 8pm, but sunset on Feb 22 is 5:57pm. Without lights, an 8pm finish works from Apr 29.",
  ]) && eq(lit.warnings.sameNights, [
    "Daylight: T-Ball, 50/70 run until 7pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7pm finish works from Mar 14.",
    "Daylight: Rookie, Juniors run until 7:30pm, but sunset on Feb 22 is 5:57pm. Without lights, a 7:30pm finish works from Mar 28.",
    "Daylight: Minors AA, Minors AAA run until 8pm, but sunset on Feb 22 is 5:57pm. Without lights, an 8pm finish works from Apr 29.",
  ]), "[P3] a lit division is skipped by the daylight check", JSON.stringify(lit.warnings));

  // P4: ...and by NOTHING else — the same counts, totals and request text as
  // with no lit division. (PP25, lit dropped from the counts: 60-ft 5 / 12.)
  const plain = computePlan(core, { city: sr });
  ok(lit.spread.need.diamond60.fields === 6 && lit.sameNights.need.diamond60.fields === 14 &&
    eq(lit.spread, plain.spread) && eq(lit.sameNights, plain.sameNights) && eq(lit.totals, plain.totals) &&
    lit.totals?.teamPracticesPerWeek === 76 &&
    requestText(majorsLit, lit.spread, lit.inUse) === requestText(core, plain.spread, plain.inUse) &&
    requestText(majorsLit, lit.spread, lit.inUse).includes("Majors (6 teams, 2x/week, 90 min)"),
    "[P4] a lit division still counts everywhere else",
    `${lit.spread.need.diamond60.fields}/${lit.sameNights.need.diamond60.fields}, ${lit.totals?.teamPracticesPerWeek}`);

  // Options with bad dates: earliestSunset null, the season error as usual.
  const bad = computePlan({ ...core, seasonStart: "" }, { city: sr });
  ok(bad.earliestSunset === null && bad.seasonError === "Pick a start and end date for practices.", "[P5] bad dates: no earliest sunset");
});

// ── G: the public calculator's output is byte-identical to the golden ───
// Recorded 2026-10-21 from the tree before the in-app planner's module
// change (practice-planner-golden.ts says what is captured). Runs LAST so
// every mutant above still dies first at its own assertion. A red G means the
// calculator's output changed — fix the change; re-record only on Whit's
// decision.
let goldenCases = 0;
section("G", () => {
  const golden = JSON.parse(readFileSync(join(process.cwd(), "scripts/sim/fixtures/practice-planner-golden.json"), "utf8")) as Golden;
  const now = captureGolden();
  ok(eq(Object.keys(golden.cases), GOLDEN_CASES.map((c) => c.name)), "[G0] the golden holds every case, in order",
    `${Object.keys(golden.cases).join(", ")}`);
  for (const c of GOLDEN_CASES) {
    const want = golden.cases[c.name];
    const got = now.cases[c.name];
    if (!want) continue;
    goldenCases++;
    ok(JSON.stringify(got.plan) === JSON.stringify(want.plan), `[G1-${c.name}] computePlan unchanged`);
    ok(got.requestSpread === want.requestSpread && got.requestSameNights === want.requestSameNights,
      `[G2-${c.name}] request text unchanged`);
  }
  ok(now.calculatorFirstRender === golden.calculatorFirstRender, "[G3] calculator first render unchanged",
    `${now.calculatorFirstRender.length} vs ${golden.calculatorFirstRender.length} chars`);
});

// ── anti-vacuity ────────────────────────────────────────────────────────
ok(goldenCases >= 14, "[C5] the golden compared every case", `${goldenCases}`);
ok(optionsCases >= 4, "[C6] the in-app options were exercised", `${optionsCases}`);
ok(counters.sharedFieldBlocks > 0, "[C1] a shared-field block was placed");
ok(counters.fieldReused > 0, "[C2] a field held more than one block");
ok(counters.skippedBlocks > 0, "[C3] a too-long practice was skipped");
for (const k of ["ok", "from", "until", "between", "gap", "never"] as const) {
  ok(counters.daylight.has(k), `[C4-${k}] daylight case "${k}" exercised`);
}

console.log(`practice-planner (${process.env.TZ ?? "host"}): ${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);

// MUTATION LOG
// 2026-10-12, first run: 12/12 killed FIRST at their own assertion under all
// three zones (PP1→F5, PP2→F2, PP3→F3, PP4→F4, PP5→S2, PP6→F6, PP7→F7,
// PP8→F8, PP9→F9, PP10→D2, PP11→D3, PP12→F10).
// - PP3's fixture was corrected BEFORE the run (founder review): two 90-min
//   blocks in a 3h05 window fit one field with or without 5 minutes between
//   (90+5+90 = 185), so that fixture could not tell real from mutated. F3 now
//   uses a 3h00 window (2 fields with the changeover, 1 without) and F3a pins
//   the 1-field control, which stays GREEN under PP3 — the mutant dies at F3,
//   not before it.
// - Each F fixture's comment carries the real AND the mutated answer, worked
//   by hand, so the separation is stated before the runner proves it.
// 2026-10-12, second change (founder flags 1–3): PP13 (daylight judged at the
// window end again) → L1, PP14 (too-long practices back in the totals) → T2.
// W1/W2/W3 were re-keyed BECAUSE THE RULE CHANGED, not loosened: daylight is
// now judged where practices actually end, so the example league's lines
// moved (T-Ball 6pm, 50/70 7pm, Rookie 7:15pm, Juniors 7:30pm — each checked
// by hand against the packed nights), W2's window moved to 6–7:30pm so it
// still tests "works until" at 7:30pm, and W3's "Big" (done by 6:30pm) lost
// its daylight line, which is the fix working.
// 2026-10-12, coverage audit (founder): every daylight outcome needs a
// passing fixture AND a mutant that dies at it. "Until" had both (D2/PP10,
// wording W2). "Never" kept D3/PP11 but its WORDING lost its only fixture when
// Juniors moved to 7:30pm → W5 + PP16. "From" had fixtures (D1, W1) but no
// mutant → PP15 (dies at D1).
// 2026-10-12, polish (founder): daylight tail reworded to "a <time> finish
// works from / until <date>" and "doesn't work at any point this season" —
// W1/W1b/W2/W5 re-keyed to the new words (times and dates unchanged), PP16's
// target moved with the sentence; every earlier mutant still dies where it
// did. New: N (day lists + busiest ties), PP17 (ties dropped → N8), PP18 (no
// range compression → N1).
// - Only literal fixed in the harness itself: W3's spring date. I guessed
//   May 3; sunset in Sacramento gains about a minute a day from 7:58pm on
//   May 1, so 8pm first holds on May 4. The code was right.
// 2026-10-14, shared sun module (daylight flags): sunset.ts and us-cities.ts
// moved to src/lib/sun/ (one copy, imported by the calculator AND
// src/lib/daylight). PP5/PP10/PP11/PP15 now target src/lib/sun/sunset.ts and
// die where they did. New in S: S8 pins the city ids (a league stores one;
// additions only) ← PP20; S9 cityByIdOrNull never falls back ← PP19; S10
// every city maps to one of the seven league timezones ← PP21. 64 checks.
// 2026-10-21, in-app planner steps 1–2: section G (the calculator golden,
// PP22 → G3, PP23 → G1, PP28 → G1) and section P (the in-app options). First
// pass of P: PP27 (cityById consulted when a city is given) was KILLED AT THE
// WRONG ASSERTION — P1 (then the lit check) died first, because the lit
// fixture's input carries no city id and cityById(undefined) is Sacramento.
// A harness ordering fault: the city checks now run first and are P1/P2, the
// lit checks P3/P4, and each mutant dies at its own tag. 28/28.

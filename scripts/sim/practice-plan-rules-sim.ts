// Harness for the in-app practice planner's app rules (src/lib/practice-plans/):
// opening a saved plan, the New plan prefill, the lit-fields line, the words.
//
//   npm run sim:practice-plan-rules            (three host zones)
//   npm run sim:practice-plan-rules:mutants    (mutation pass, real source)
//
// Sections, in this order (a mutant must die FIRST at its own assertion; each
// fixture's comment says what the real code and the mutant answer):
//   L   loader: a good plan opens; an unknown version, a bad input, a bad mode
//       → "can't open", never a throw                  ← RU1 (L2), RU2 (L3)
//   P   prefill: the most recent season WITH TEAMS, dated before undated,
//       archived counts, newest created breaks a tie  ← RU3 (P1), RU4 (P2),
//       RU5 (P3), RU6 (P4)
//   H   the "6 in Fall 2026" hint; none for a duplicated name ← RU7 (H2)
//   N   a new plan's input passes the save check, inside every limit,
//       each change counted for the planner's note ← RU8 (N2), RU12 (N2b),
//       RU13 (N2c)
//   T   the lit-fields line and the city request text ← RU10 (T2), RU9 (T3),
//       RU11 (T4)
//   R   the plans list (5a): replies, the edited line, the prefill query,
//       wiring                     ← RU16 (R1), RU14 (R2), RU15 (R3)
//   W   words, verbatim, and the daylight-leaks fence (source reads)
// then ANTI-VACUITY COUNTERS.
//
// MUTATION LOG: see the bottom of this file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE_DIVISIONS, NEW_DIVISION } from "@/lib/practice-planner/example-league";
import { computeMode, fieldTypesInUse } from "@/lib/practice-planner/plan";
import { computePlan, requestText } from "@/lib/practice-planner/report";
import { cityById } from "@/lib/sun/us-cities";
import { loadPlan, upgradePlanInput, type PlanInput, type PlanRow } from "@/lib/practice-plans/load";
import { INPUT_LIMITS, PLAN_INPUT_VERSION, practicePlanInputProblem } from "@/lib/practice-plans/plan-input";
import { newPlanInput, parsePrefillAdjustmentQuery, pickPrefill, prefillAdjustmentQuery, teamHint, type PrefillRow } from "@/lib/practice-plans/prefill";
import { litLine, planRequestText } from "@/lib/practice-plans/request";
import { editedLabel, planDatesLabel, planErrorKey, planSummaryLine, saveOutcome, writeOutcome } from "@/lib/practice-plans/list";
import {
  CANT_OPEN_PLAN,
  earliestSunsetLine,
  litFieldsLine,
  newPlanSource,
  noTeamsLine,
  planErrorMessage,
  prefillAdjustedLine,
  staleSaveLine,
  teamHintLine,
} from "@/lib/practice-plans/words";

const ROOT = process.cwd();
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
const counters = { opened: 0, refused: 0, picks: 0, hints: 0, litLines: 0 };

const BASE_INPUT: PlanInput = {
  seasonStart: "2027-02-22",
  seasonEnd: "2027-05-29",
  minutesBetween: 0,
  divisions: EXAMPLE_DIVISIONS.map((d, i) => ({ ...d, days: [...d.days], id: `d${i + 1}`, ...(d.name === "Majors" ? { lit: true } : {}) })),
};
const row = (over: Partial<PlanRow>): PlanRow => ({
  id: "p1", name: "Spring 2027", input: BASE_INPUT, input_version: PLAN_INPUT_VERSION, mode: "spread", updated_at: "2026-10-21T17:56:59.356+00:00", ...over,
});

// ── L: opening a saved plan ─────────────────────────────────────────────
section("L", () => {
  // L1: a good version-1 plan opens with its input, mode and stamp as stored.
  const good = loadPlan(row({ mode: "sameNights" }));
  ok(good.ok && good.plan.input === BASE_INPUT && good.plan.mode === "sameNights" && good.plan.updatedAt === "2026-10-21T17:56:59.356+00:00",
    "[L1] a good plan opens", JSON.stringify(good).slice(0, 160));
  if (good.ok) counters.opened++;
  ok(upgradePlanInput(PLAN_INPUT_VERSION, BASE_INPUT)?.input === BASE_INPUT, "[L1b] the current version needs no upgrade");

  // L2: a version this code doesn't know → can't open. (RU1, one version too
  // far allowed: version 2 opens.)
  for (const v of [PLAN_INPUT_VERSION + 1, 0, -1, 1.5, Number.NaN]) {
    const r = loadPlan(row({ input_version: v }));
    ok(!r.ok && r.message === CANT_OPEN_PLAN && r.why === "version", `[L2] version ${v} can't open`, JSON.stringify(r).slice(0, 120));
    if (!r.ok) counters.refused++;
  }

  // L3: an input the save check refuses → can't open, with its key. (RU2,
  // no check: the plan opens.)
  const bad: [unknown, string][] = [
    [{ ...BASE_INPUT, cityId: "ca-santa-rosa" }, "city_not_allowed"],
    [{ ...BASE_INPUT, divisions: [{ ...BASE_INPUT.divisions[0], teams: 61 }] }, "teams"],
    ["not a plan", "not_an_object"],
    [null, "not_an_object"],
    [undefined, "not_an_object"],
    [{ seasonStart: "", seasonEnd: "" }, "missing_key"],
  ];
  for (const [input, why] of bad) {
    let r;
    try {
      r = loadPlan(row({ input }));
    } catch (e) {
      ok(false, "[L3] never throws", String(e));
      continue;
    }
    ok(!r.ok && r.message === CANT_OPEN_PLAN && r.why === why, `[L3] ${why} can't open`, JSON.stringify(r).slice(0, 120));
    if (!r.ok) counters.refused++;
  }

  // L4: a mode the planner doesn't know.
  const mode = loadPlan(row({ mode: "both" }));
  ok(!mode.ok && mode.why === "mode", "[L4] an unknown mode can't open");
});

// ── P: the New plan prefill ─────────────────────────────────────────────
const div = (season: Omit<PrefillRow, "divisionId" | "divisionName" | "divisionCreatedAt" | "teamCount">, id: string, name: string, teams: number, created = "2026-01-01T00:00:00Z"): PrefillRow =>
  ({ ...season, divisionId: id, divisionName: name, divisionCreatedAt: created, teamCount: teams });
const season = (id: string, name: string, start: string | null, created: string, archived: string | null = null) =>
  ({ seasonId: id, seasonName: name, seasonStart: start, seasonCreatedAt: created, seasonArchivedAt: archived });

section("P", () => {
  // P1: Spring 2027 starts latest but has no teams yet; Fall 2026 has teams.
  // → Fall 2026. (RU3, no-teams seasons not skipped: Spring 2027.)
  const fall = season("s-fall", "Fall 2026", "2026-09-01", "2026-07-01T00:00:00Z");
  const spring = season("s-spring", "Spring 2027", "2027-02-01", "2026-10-15T00:00:00Z");
  const older = season("s-old", "Spring 2026", "2026-03-01", "2026-01-10T00:00:00Z", "2026-07-01T00:00:00Z");
  const p1 = pickPrefill([
    div(spring, "v1", "Majors", 0), div(spring, "v2", "Minors", 0),
    div(fall, "f2", "Minors", 8, "2026-07-02T00:00:00Z"), div(fall, "f1", "Majors", 6, "2026-07-01T00:00:00Z"), div(fall, "f3", "Seniors", 0, "2026-07-03T00:00:00Z"),
    div(older, "o1", "Majors", 5),
  ]);
  counters.picks++;
  ok(p1.season?.name === "Fall 2026", "[P1] the most recent season WITH teams", JSON.stringify(p1.season));
  // P1b: its divisions oldest first, counts as read — a 0-team division kept.
  ok(JSON.stringify(p1.divisions) === JSON.stringify([{ name: "Majors", teams: 6 }, { name: "Minors", teams: 8 }, { name: "Seniors", teams: 0 }]),
    "[P1b] the season's divisions, oldest first, live counts", JSON.stringify(p1.divisions));

  // P2: an undated season created later loses to a dated one. (RU4, undated
  // first: "Undated".)
  const undated = season("s-undated", "Undated", null, "2026-10-20T00:00:00Z");
  const dated = season("s-dated", "Fall 2025", "2025-09-01", "2025-07-01T00:00:00Z");
  const p2 = pickPrefill([div(undated, "u1", "Majors", 4), div(dated, "d1", "Majors", 6)]);
  counters.picks++;
  ok(p2.season?.name === "Fall 2025", "[P2] a dated season before an undated one", JSON.stringify(p2.season));

  // P3: an ARCHIVED season counts. (RU5, archived skipped: "Spring 2025".)
  const archived = season("s-arch", "Fall 2025", "2025-09-01", "2025-07-01T00:00:00Z", "2025-12-01T00:00:00Z");
  const old2 = season("s-old2", "Spring 2025", "2025-03-01", "2025-01-01T00:00:00Z");
  const p3 = pickPrefill([div(archived, "a1", "Majors", 6), div(old2, "b1", "Majors", 5)]);
  counters.picks++;
  ok(p3.season?.name === "Fall 2025", "[P3] an archived season counts", JSON.stringify(p3.season));

  // P4: two seasons with the same start date → the newest created. (RU6,
  // reversed: "First copy".)
  const first = season("s-a", "First copy", "2026-09-01", "2026-06-01T00:00:00Z");
  const second = season("s-b", "Second copy", "2026-09-01", "2026-06-02T00:00:00Z");
  const p4 = pickPrefill([div(first, "x1", "Majors", 6), div(second, "y1", "Majors", 7)]);
  counters.picks++;
  ok(p4.season?.name === "Second copy", "[P4] same start date → the newest created", JSON.stringify(p4.season));

  // P5: no seasons, or none with teams → an empty planner.
  const none = pickPrefill([]);
  const empty = pickPrefill([div(spring, "v1", "Majors", 0)]);
  ok(none.season === null && none.divisions.length === 0 && empty.season === null && empty.divisions.length === 0,
    "[P5] no season with teams → no rows", JSON.stringify([none, empty]));
});

// ── H: the team-count hint ──────────────────────────────────────────────
section("H", () => {
  const prefill = { season: { id: "s", name: "Fall 2026" }, divisions: [{ name: "Majors", teams: 6 }, { name: "AAA", teams: 4 }, { name: "aaa ", teams: 5 }] };
  // H1: matched lowercased and trimmed.
  const h1 = teamHint(prefill, "  majors ");
  ok(h1?.count === 6 && h1.seasonName === "Fall 2026", "[H1] hint by lowercased, trimmed name", JSON.stringify(h1));
  if (h1) counters.hints++;
  // H2: two divisions named "AAA" (ignoring case and spaces) → no hint. (RU7,
  // the first match: 4.)
  ok(teamHint(prefill, "AAA") === null, "[H2] a duplicated name gets no hint", JSON.stringify(teamHint(prefill, "AAA")));
  // H3: no match, no season.
  ok(teamHint(prefill, "Seniors") === null && teamHint({ season: null, divisions: [] }, "Majors") === null, "[H3] no match / no season → no hint");
});

// ── N: a new plan's input ───────────────────────────────────────────────
section("N", () => {
  const L = INPUT_LIMITS;
  // N1: prefilled rows take NEW_DIVISION's defaults, ids d1.., no dates — and
  // pass the save check; nothing adjusted.
  const { input: n1, adjustments: a1 } = newPlanInput({ season: { id: "s", name: "Fall 2026" }, divisions: [{ name: "Majors", teams: 6 }, { name: "Minors", teams: 8 }] });
  ok(practicePlanInputProblem(n1) === null && n1.seasonStart === "" && n1.seasonEnd === "" && n1.minutesBetween === 0 &&
    n1.divisions.length === 2 && n1.divisions[1].name === "Minors" && n1.divisions[1].teams === 8 && n1.divisions[1].id === "d2" &&
    n1.divisions[0].lengthMin === NEW_DIVISION.lengthMin && n1.divisions[0].fieldType === NEW_DIVISION.fieldType &&
    n1.divisions[0].days !== NEW_DIVISION.days && a1.dropped === 0 && a1.shortened === 0 && a1.capped === 0,
    "[N1] a new plan from the prefill", JSON.stringify(n1).slice(0, 200));
  // One prefill over every limit: a 70-team division, a 65-character name
  // (code points), 41 divisions in all — read from INPUT_LIMITS (40/60/60,
  // the limits 0117 checks).
  const over = { season: { id: "s", name: "Fall 2026" }, divisions: [{ name: "⚾".repeat(65), teams: 70 }, ...Array.from({ length: 40 }, (_, i) => ({ name: `D${i}`, teams: 2 }))] };
  const { input: n2, adjustments: a2 } = newPlanInput(over);
  // N2: the count capped at the limit and counted. (RU8, no cap: 70.)
  ok(n2.divisions[0].teams === L.teams.max && a2.capped === 1, "[N2] a team count over the limit is capped and counted",
    `${n2.divisions[0].teams}, capped ${a2.capped}`);
  // N2b: the name cut at the limit and counted. (RU12, no cut: 65.)
  ok(Array.from(n2.divisions[0].name).length === L.divisionName.maxChars && a2.shortened === 1, "[N2b] a long name is cut and counted",
    `${Array.from(n2.divisions[0].name).length}, shortened ${a2.shortened}`);
  // N2c: divisions past the limit left out and counted — the limit is
  // INPUT_LIMITS', never a retyped number. (RU13, a retyped 30: 30 kept.)
  ok(n2.divisions.length === L.divisions.max && a2.dropped === 1, "[N2c] divisions past the limit are left out and counted",
    `${n2.divisions.length}, dropped ${a2.dropped}`);
  ok(practicePlanInputProblem(n2) === null, "[N2d] the adjusted plan passes the save check", String(practicePlanInputProblem(n2)));
  // N3: no prefill → an empty planner that still saves.
  const { input: n3 } = newPlanInput({ season: null, divisions: [] });
  ok(n3.divisions.length === 0 && practicePlanInputProblem(n3) === null, "[N3] an empty plan saves");
  // N4: the note says exactly what changed; nothing changed → no note.
  const lim = { divisions: L.divisions.max, nameChars: L.divisionName.maxChars, teams: L.teams.max };
  ok(prefillAdjustedLine("Fall 2026", a2, lim) === "From Fall 2026: 1 division left out (a plan holds 40); 1 name shortened to 60 characters; 1 team count lowered to 60." &&
    prefillAdjustedLine("Fall 2026", { dropped: 3, shortened: 0, capped: 2 }, lim) === "From Fall 2026: 3 divisions left out (a plan holds 40); 2 team counts lowered to 60." &&
    prefillAdjustedLine("Fall 2026", a1, lim) === null,
    "[N4] the prefill note", String(prefillAdjustedLine("Fall 2026", a2, lim)));
});

// ── T: the lit-fields line and the city request ─────────────────────────
section("T", () => {
  const two: PlanInput = { ...BASE_INPUT, divisions: BASE_INPUT.divisions.map((d) => (d.name === "Juniors" ? { ...d, lit: true } : d)) };
  // T1: lit divisions in plan order.
  ok(litLine(BASE_INPUT) === "On lit fields: Majors." && litLine(two) === "On lit fields: Majors, Juniors.", "[T1] the lit line names lit divisions",
    `${litLine(BASE_INPUT)} | ${litLine(two)}`);
  counters.litLines += 2;
  // T2: nothing lit → no line. (RU10, "On lit fields: ." anyway.)
  const none: PlanInput = { ...BASE_INPUT, divisions: BASE_INPUT.divisions.map(({ lit: _l, ...d }) => { void _l; return d; }) };
  ok(litLine(none) === null && litFieldsLine([]) === null, "[T2] nothing lit → no line", String(litLine(none)));
  // T3: a lit division the request doesn't count (0 teams) isn't named.
  // (RU9, counted or not: "Majors, Ghost".)
  const ghost: PlanInput = { ...BASE_INPUT, divisions: [...BASE_INPUT.divisions, { ...BASE_INPUT.divisions[0], name: "Ghost", teams: 0, lit: true, id: "dx" }] };
  ok(litLine(ghost) === "On lit fields: Majors.", "[T3] a lit division with no teams isn't named", String(litLine(ghost)));
  // T4: the clipboard text is the module's text, a blank line, the lit line;
  // with nothing lit, exactly the module's text. (RU11, lit line dropped.)
  const r = computeMode(BASE_INPUT, "spread");
  const inUse = fieldTypesInUse(BASE_INPUT);
  ok(planRequestText(BASE_INPUT, r, inUse) === `${requestText(BASE_INPUT, r, inUse)}\n\nOn lit fields: Majors.`,
    "[T4] the city request ends with the lit line", planRequestText(BASE_INPUT, r, inUse).slice(-60));
  ok(planRequestText(none, r, inUse) === requestText(none, r, inUse), "[T4b] nothing lit → the module's text exactly");
});

// ── R: the plans list's lines and the plan functions' replies (5a) ──────
section("R", () => {
  // R1: create / copy / delete succeed only on a committed reply naming a
  // plan id. (RU16, the id not required: a reply without one reads as done.)
  const w1 = writeOutcome({ committed: true, id: "p9", updated_at: "2026-10-21T17:56:59.356+00:00" }, null);
  ok(w1.ok && w1.id === "p9" && w1.updatedAt === "2026-10-21T17:56:59.356+00:00" &&
    !writeOutcome({ committed: true }, null).ok && !writeOutcome(null, null).ok && !writeOutcome({ committed: false, id: "x" }, null).ok,
    "[R1] a write is done only when committed with a plan id");
  const refused = writeOutcome(null, { message: "not_authorized" });
  ok(!refused.ok && refused.message === planErrorMessage("not_authorized") &&
    planErrorKey({ message: "invalid_input:teams" }) === "invalid_input" && planErrorKey({ message: "boom" }) === "unknown" && planErrorKey(null) === null,
    "[R1b] refusals worded by key");
  // R2: a stale save is never a save; who and when come through. (RU14, the
  // stale branch removed: an error instead of the named stale state.)
  const st = saveOutcome({ committed: false, status: "stale", updated_at: "2026-10-21T17:57:00.001+00:00", updated_by_name: "Jenn M." }, null);
  ok(st.kind === "stale" && st.byName === "Jenn M." && st.updatedAt === "2026-10-21T17:57:00.001+00:00" &&
    saveOutcome({ committed: true, status: "saved", updated_at: "2026-10-21T17:57:00.002+00:00" }, null).kind === "saved" &&
    saveOutcome({ committed: true, status: "stale", updated_at: "x" }, null).kind === "error" &&
    saveOutcome({ committed: false, status: "stale", updated_at: "2026-10-21T17:57:00.001+00:00" }, null).kind === "stale",
    "[R2] save replies: saved, stale (with who), anything else an error", JSON.stringify(st));
  // R3: "edited" is a date in the LEAGUE's timezone. 06:30Z on Oct 21 is
  // still Oct 20 in Los Angeles. (RU15, the UTC date: "today".)
  const now = new Date("2026-10-21T20:00:00Z");
  ok(editedLabel("2026-10-21T17:00:00Z", "America/Los_Angeles", now) === "today" &&
    editedLabel("2026-10-21T06:30:00Z", "America/Los_Angeles", now) === "Oct 20" &&
    editedLabel("2025-12-04T17:00:00Z", "America/Los_Angeles", now) === "Dec 4, 2025" &&
    editedLabel("not a date", "America/Los_Angeles", now) === "—",
    "[R3] the edited line in the league's timezone", editedLabel("2026-10-21T06:30:00Z", "America/Los_Angeles", now));
  // R4: the prefill note travels to the planner through the URL and back.
  const q = prefillAdjustmentQuery("Fall 2026", { dropped: 1, shortened: 0, capped: 2 });
  const back = parsePrefillAdjustmentQuery(Object.fromEntries(new URLSearchParams(q.slice(1))));
  ok(back?.seasonName === "Fall 2026" && back.adjustments.dropped === 1 && back.adjustments.capped === 2 &&
    prefillAdjustmentQuery("Fall 2026", { dropped: 0, shortened: 0, capped: 0 }) === "" &&
    parsePrefillAdjustmentQuery({ from: "X", adjusted: "1.2" }) === null && parsePrefillAdjustmentQuery({}) === null,
    "[R4] the prefill note's query round trip", q);
  // R5: the list's lines.
  ok(planSummaryLine(BASE_INPUT, "spread") === "6 60-ft diamonds · 2 50/70 diamonds · 2 90-ft diamonds" &&
    planSummaryLine({ ...BASE_INPUT, divisions: [] }, "spread") === "No practices yet" &&
    planDatesLabel(BASE_INPUT) === "Feb 22 to May 29, 2027" && planDatesLabel({ ...BASE_INPUT, seasonStart: "" }) === "No dates yet",
    "[R5] the list's summary and dates", planSummaryLine(BASE_INPUT, "spread"));
  // R6: wiring (source reads — weak by nature): the page gates Pro+ with the
  // calculator link; the sidebar item is its own Pro route; every RPC in the
  // list carries the house @ts-expect-error.
  const page = readFileSync(join(ROOT, "src/app/(dashboard)/dashboard/field-requests/page.tsx"), "utf8");
  const side = readFileSync(join(ROOT, "src/components/dashboard/sidebar.tsx"), "utf8");
  const list = readFileSync(join(ROOT, "src/components/field-requests/plans-list-client.tsx"), "utf8");
  const rpcs = list.match(/\.rpc\(\s*\/\/ @ts-expect-error[^\n]*\n\s*"(\w+)"/g) ?? [];
  ok(/if \(!isProPlus\(plan\)\)/.test(page) && /secondaryLink=\{\{ href: "\/tools\/practice-field-calculator"/.test(page) &&
    /href: "\/dashboard\/field-requests", label: "Field requests", icon: ClipboardList, tier: "pro"/.test(side) &&
    rpcs.length === 4 && (list.match(/\.rpc\(/g) ?? []).length === 4,
    "[R6] gate, sidebar item and RPC calls wired", `${rpcs.length} rpc calls`);
});

// ── W: words, verbatim, and the fence ───────────────────────────────────
section("W", () => {
  const sr = cityById("ca-santa-rosa");
  const { cityId: _c, ...core } = { ...BASE_INPUT, cityId: "x" };
  void _c;
  const plan = computePlan(core, { city: sr });
  ok(plan.earliestSunset != null &&
    earliestSunsetLine(sr, plan.earliestSunset, ["Majors"]) === "Earliest sunset in Santa Rosa this season: 5:57pm on Feb 22. Majors is on lit fields and isn't checked." &&
    earliestSunsetLine(sr, plan.earliestSunset, []) === "Earliest sunset in Santa Rosa this season: 5:57pm on Feb 22." &&
    earliestSunsetLine(sr, plan.earliestSunset, ["Majors", "Juniors"]).endsWith("Majors and Juniors are on lit fields and aren't checked."),
    "[W1] the earliest-sunset line (the mockup's words)");
  ok(teamHintLine(6, "Fall 2026") === "6 in Fall 2026" &&
    noTeamsLine("Seniors", "Fall 2026") === "No Seniors in Fall 2026. Not counted until you enter teams." &&
    newPlanSource("Fall 2026") === "Starts with your divisions and team counts from Fall 2026, your most recent season with teams. You can change anything." &&
    newPlanSource(null) === "No season has teams yet, so the plan starts empty. Add your divisions." &&
    staleSaveLine(null, "2:41 PM") === "Someone else saved this plan at 2:41 PM. Reload to see their changes, or keep yours." &&
    staleSaveLine("Jenn M.", "2:41 PM").startsWith("Jenn M. saved"),
    "[W2] the planner's sentences");
  // W3: the fence — no daylight-flag module or sunset math in the app rules,
  // and nothing here imports the marketing calculator.
  for (const f of ["words.ts", "load.ts", "prefill.ts", "request.ts", "plan-input.ts"]) {
    const src = readFileSync(join(ROOT, "src/lib/practice-plans", f), "utf8");
    ok(!/from\s+["'][^"']*\/lib\/daylight/.test(src) && !/from\s+["'][^"']*\/sun\/sunset["']/.test(src) && !/components\/marketing/.test(src),
      `[W3] ${f} stays outside the daylight fence and the marketing calculator`);
  }
});

// ── anti-vacuity ────────────────────────────────────────────────────────
ok(counters.opened >= 1 && counters.refused >= 11, "[C1] plans opened and refused", JSON.stringify(counters));
ok(counters.picks >= 4 && counters.hints >= 1 && counters.litLines >= 2, "[C2] prefill picks, hints and lit lines ran", JSON.stringify(counters));

console.log(`practice-plan-rules (${process.env.TZ ?? "host"}): ${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);

// MUTATION LOG
// 2026-10-21, first pass (step 4 of the in-app practice planner): 11/11
// killed FIRST at their own assertion under all three zones — RU1 L2, RU2 L3,
// RU3 P1, RU4 P2, RU5 P3, RU6 P4, RU7 H2, RU8 N2, RU9 T3, RU10 T2, RU11 T4.
// Fixture order was set BEFORE the run so each could only die at its own
// line: P1 has no undated season (else RU4 would die there), P2's dated
// season is not archived (else RU5 would), and no fixture before P4 has two
// seasons on one start date (else RU6 would). Found while writing the
// harness, before any mutant ran: a null stored input read as "unknown
// version", because upgradePlanInput used null for both "can't upgrade" and
// the input itself — it now returns { input } | null.
// 2026-10-21, caps made visible (Whit): newPlanInput returns its adjustments
// (dropped / shortened / capped) for prefillAdjustedLine; N2 split into N2,
// N2b, N2c so each cap has its own line. New: RU12 (name not cut) → N2b,
// RU13 (division cap retyped as 30) → N2c.
// 2026-10-21, step 5a: section R for the plans list; RU14 → R2, RU15 → R3,
// RU16 → R1.

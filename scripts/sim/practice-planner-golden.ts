// The public calculator's output, captured as one JSON-able object — the
// golden that pins it byte-for-byte while src/lib/practice-planner/ gains the
// in-app planner's additive options (a resolved city or none, a per-division
// `lit` flag, the earliest sunset). Decided 2026-10-21: the calculator must
// produce byte-identical output after that change.
//
// What is captured, per fixture: computePlan(input) whole (both modes, field
// types in use, warnings, totals, sunset at start, season error), plus
// requestText for both modes; and the calculator's first render (its server
// markup, which is deterministic by design — fixed example league, no clock).
//
// The fixtures cover every daylight outcome and season shape (spring, fall
// across the November clock change, summer- and winter-spanning, New Year), a
// no-DST city, an unknown city id (the calculator's Sacramento fallback —
// pinned on purpose), bad and reversed dates, and the division edge cases
// (too long for its window, more per week than days, 0 teams, no days, shared
// fields, minutes between, all six field types).
//
// Recorded by practice-planner-golden-record.ts into
// fixtures/practice-planner-golden.json; compared by practice-planner-sim.ts
// section G. Re-record ONLY on Whit's decision — a red G means the
// calculator's output changed.

import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EXAMPLE_LEAGUE } from "@/lib/practice-planner/example-league";
import { computePlan, requestText } from "@/lib/practice-planner/report";
import type { DivisionInput, PlannerInput } from "@/lib/practice-planner/types";
import { PracticeFieldCalculator } from "@/components/marketing/practice-calculator/calculator";

// tsx compiles JSX with the classic runtime, which reads a global React
// (the bracket-pieces sim does the same).
(globalThis as { React?: unknown }).React = React;

function div(over: Partial<DivisionInput>): DivisionInput {
  return {
    name: "D",
    teams: 4,
    perWeek: 2,
    lengthMin: 90,
    days: [0, 1, 2, 3, 4],
    start: "17:30",
    end: "20:00",
    fieldType: "diamond60",
    teamsPerField: 1,
    ...over,
  };
}

const EDGE_DIVISIONS: DivisionInput[] = [
  div({ name: "Too long", teams: 2, lengthMin: 150, start: "17:00", end: "18:30" }),
  div({ name: "Five a week", teams: 3, perWeek: 5, days: [1, 3] }),
  div({ name: "No teams", teams: 0 }),
  div({ name: "No days", days: [] }),
  div({ name: "Halves", teams: 6, teamsPerField: 2, fieldType: "diamond5070" }),
  div({ name: "Thirds", teams: 9, perWeek: 1, teamsPerField: 3, fieldType: "softball", days: [5, 6], start: "09:00", end: "13:00" }),
  div({ name: "Quarters", teams: 8, teamsPerField: 4, fieldType: "soccerSmall", lengthMin: 60 }),
  div({ name: "Big field", teams: 4, fieldType: "soccerFull", lengthMin: 105, start: "18:00", end: "21:00" }),
  div({ name: "Ninety", teams: 3, fieldType: "diamond90", lengthMin: 120, days: [0, 2, 4] }),
];

export const GOLDEN_CASES: { name: string; input: PlannerInput }[] = [
  { name: "example-sacramento", input: EXAMPLE_LEAGUE },
  { name: "example-santa-rosa-spring", input: { ...EXAMPLE_LEAGUE, cityId: "ca-santa-rosa" } },
  { name: "example-santa-rosa-fall", input: { ...EXAMPLE_LEAGUE, cityId: "ca-santa-rosa", seasonStart: "2026-08-31", seasonEnd: "2026-11-07" } },
  { name: "example-summer-span", input: { ...EXAMPLE_LEAGUE, cityId: "ca-santa-rosa", seasonStart: "2027-04-05", seasonEnd: "2027-09-25" } },
  { name: "example-winter-span", input: { ...EXAMPLE_LEAGUE, cityId: "ca-santa-rosa", seasonStart: "2026-10-05", seasonEnd: "2027-03-27" } },
  { name: "example-new-year", input: { ...EXAMPLE_LEAGUE, cityId: "ny-new-york", seasonStart: "2026-11-30", seasonEnd: "2027-02-27" } },
  { name: "example-phoenix", input: { ...EXAMPLE_LEAGUE, cityId: "az-phoenix" } },
  { name: "example-unknown-city", input: { ...EXAMPLE_LEAGUE, cityId: "zz-nowhere" } },
  { name: "example-minutes-between", input: { ...EXAMPLE_LEAGUE, minutesBetween: 10 } },
  { name: "dates-missing", input: { ...EXAMPLE_LEAGUE, seasonStart: "", seasonEnd: "" } },
  { name: "dates-reversed", input: { ...EXAMPLE_LEAGUE, seasonStart: "2027-05-29", seasonEnd: "2027-02-22" } },
  { name: "edge-divisions", input: { ...EXAMPLE_LEAGUE, cityId: "co-denver", divisions: EDGE_DIVISIONS } },
  { name: "edge-divisions-fall", input: { ...EXAMPLE_LEAGUE, cityId: "co-denver", seasonStart: "2026-09-08", seasonEnd: "2026-11-14", divisions: EDGE_DIVISIONS } },
  { name: "no-divisions", input: { ...EXAMPLE_LEAGUE, divisions: [] } },
];

export type GoldenCase = {
  plan: ReturnType<typeof computePlan>;
  requestSpread: string;
  requestSameNights: string;
};

export type Golden = { cases: Record<string, GoldenCase>; calculatorFirstRender: string };

export function captureGolden(): Golden {
  const cases: Record<string, GoldenCase> = {};
  for (const c of GOLDEN_CASES) {
    const plan = computePlan(c.input);
    cases[c.name] = {
      plan,
      requestSpread: requestText(c.input, plan.spread, plan.inUse),
      requestSameNights: requestText(c.input, plan.sameNights, plan.inUse),
    };
  }
  return { cases, calculatorFirstRender: renderToStaticMarkup(createElement(PracticeFieldCalculator)) };
}

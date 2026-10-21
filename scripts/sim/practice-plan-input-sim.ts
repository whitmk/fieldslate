// Harness for the saved practice plan's input check — the TypeScript twin
// (src/lib/practice-plans/plan-input.ts) of 0117's practice_plan_input_problem.
//
//   npm run sim:practice-plan-input            (three host zones)
//   npm run sim:practice-plan-input:mutants    (mutation pass, real source)
//
// ONE TABLE: the rows between the PLANINPUT-TABLE-BEGIN / -END lines in
// scripts/sim/practice-plans-sim.sql (the 0117 proof). That proof runs them
// through the database function; this harness parses the SAME block and runs
// them through practicePlanInputProblem. Never a second copy.
//
// Sections, in this order (a mutant must die FIRST at its own assertion):
//   XT  every table row → the expected problem key (the twin agrees with the
//       table, so with the database)                         ← PI1, PI2, PI3
//   E   for every limit in INPUT_LIMITS, the just-inside row (accepted) and
//       the just-outside row (refused, with its key) are IN the table — so the
//       table, and through XV1 the database, holds the same limits ← PI4
//   L   the public calculator's own form stays inside INPUT_LIMITS (teams,
//       per week, practice lengths, teams per field, minutes between, field
//       types) — source reads, weak by nature                ← PI5
// then ANTI-VACUITY COUNTERS: every problem key appears in the table, and
// both accepted and refused rows ran.
//
// MUTATION LOG: see the bottom of this file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_TYPE_IDS } from "@/lib/practice-planner/constants";
import { INPUT_LIMITS, practicePlanInputProblem, type PlanInputProblem } from "@/lib/practice-plans/plan-input";

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

// ── the shared table ────────────────────────────────────────────────────
type Row = { label: string; kind: string; patch: string; want: string | null; input: unknown };
function readTable(): Row[] {
  const lines = readFileSync(join(ROOT, "scripts/sim/practice-plans-sim.sql"), "utf8").split("\n");
  const begin = lines.findIndex((l) => l.trim() === "-- PLANINPUT-TABLE-BEGIN");
  const end = lines.findIndex((l) => l.trim() === "-- PLANINPUT-TABLE-END");
  if (begin < 0 || end < begin) throw new Error("PLANINPUT-TABLE markers not found exactly as expected");
  if (lines.filter((l) => l.trim() === "-- PLANINPUT-TABLE-BEGIN").length !== 1 || lines.filter((l) => l.trim() === "-- PLANINPUT-TABLE-END").length !== 1) {
    throw new Error("a PLANINPUT-TABLE marker line appears more than once — a second copy?");
  }
  const ROW = /^\s*\('((?:[^']|'')*)', '([a-z]+)', '((?:[^']|'')*)', (null|'([a-z_]+)')\),?\s*$/;
  // A commented-out row ("-- (…") is no row at all, in SQL and here.
  const raw = lines.slice(begin + 1, end).filter((l) => !l.trim().startsWith("--")).map((l, i) => {
    const m = ROW.exec(l);
    if (!m) throw new Error(`table line ${i + 1} doesn't parse: ${l.slice(0, 80)}`);
    return { label: m[1].replace(/''/g, "'"), kind: m[2], patch: m[3].replace(/''/g, "'"), want: m[5] ?? null };
  });
  // Built exactly as the proof's pg_temp.h117_table() builds them.
  const base = raw.find((r) => r.label === "base");
  if (!base || base.kind !== "raw") throw new Error("the table has no raw 'base' row");
  const B = JSON.parse(base.patch) as Record<string, unknown> & { divisions: Record<string, unknown>[] };
  const D = B.divisions[0];
  const without = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
  return raw.map((r) => {
    const p = JSON.parse(r.patch);
    let input: unknown;
    switch (r.kind) {
      case "raw": input = p; break;
      case "top": input = { ...B, ...p }; break;
      case "topdel": input = without(B, p); break;
      case "div": input = { ...B, divisions: [{ ...D, ...p }] }; break;
      case "divdel": input = { ...B, divisions: [without(D, p)] }; break;
      case "divs": input = { ...B, divisions: Array.from({ length: p }, () => D) }; break;
      case "adddiv": input = { ...B, divisions: [D, { ...D, ...p }] }; break;
      default: throw new Error(`unknown row kind ${r.kind}`);
    }
    return { ...r, input };
  });
}

/** Key-order-free comparison (jsonb reorders keys; the table is jsonb). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const counters = { accepted: 0, refused: 0, keys: new Set<string>(), edges: 0 };
let table: Row[] = [];

// ── XT: the twin agrees with every row ──────────────────────────────────
section("XT", () => {
  table = readTable();
  ok(table.length >= 90, "[XT0] the table parsed", `${table.length} rows`);
  for (const r of table) {
    const got = practicePlanInputProblem(r.input);
    if (r.want === null) counters.accepted++;
    else {
      counters.refused++;
      counters.keys.add(r.want);
    }
    ok(got === r.want, `[XT1] ${r.label}`, `got ${got}, want ${r.want}`);
  }
});

// ── E: every limit's edges are in the table ─────────────────────────────
section("E", () => {
  const D = { name: "Majors", teams: 6, perWeek: 2, lengthMin: 90, days: [0, 1, 2, 3, 4], start: "17:00", end: "20:00", fieldType: "diamond60", teamsPerField: 1 };
  const B = { seasonStart: "2027-02-22", seasonEnd: "2027-05-29", minutesBetween: 0, divisions: [D] };
  const top = (o: Record<string, unknown>) => ({ ...B, ...o });
  const div = (o: Record<string, unknown>) => ({ ...B, divisions: [{ ...D, ...o }] });
  const byCanon = new Map(table.map((r) => [canon(r.input), r]));
  const need = (tag: string, input: unknown, want: PlanInputProblem | null) => {
    counters.edges++;
    const r = byCanon.get(canon(input));
    ok(r !== undefined && r.want === want, `[E-${tag}]`, r ? `row "${r.label}" wants ${r.want}, expected ${want}` : "no such row in the table");
  };
  const L = INPUT_LIMITS;
  need("year-min-in", top({ seasonStart: `${L.yearMin}-01-01` }), null);
  need("year-min-out", top({ seasonStart: `${L.yearMin - 1}-12-31` }), "season_start");
  need("year-max-in", top({ seasonEnd: `${L.yearMax}-12-31` }), null);
  need("year-max-out", top({ seasonEnd: `${L.yearMax + 1}-01-01` }), "season_end");
  need("minutes-min-in", top({ minutesBetween: L.minutesBetween.min }), null);
  need("minutes-max-in", top({ minutesBetween: L.minutesBetween.max }), null);
  need("minutes-min-out", top({ minutesBetween: L.minutesBetween.min - 1 }), "minutes_between");
  need("minutes-max-out", top({ minutesBetween: L.minutesBetween.max + 1 }), "minutes_between");
  need("divisions-max-in", top({ divisions: Array.from({ length: L.divisions.max }, () => D) }), null);
  need("divisions-max-out", top({ divisions: Array.from({ length: L.divisions.max + 1 }, () => D) }), "division_count");
  need("name-max-in", div({ name: "N".repeat(L.divisionName.maxChars) }), null);
  need("name-max-out", div({ name: "N".repeat(L.divisionName.maxChars + 1) }), "division_name");
  const ints: [string, { min: number; max: number }, PlanInputProblem][] = [
    ["teams", L.teams, "teams"],
    ["perWeek", L.perWeek, "per_week"],
    ["lengthMin", L.lengthMin, "length"],
    ["teamsPerField", L.teamsPerField, "teams_per_field"],
  ];
  for (const [k, lim, key] of ints) {
    need(`${k}-min-in`, div({ [k]: lim.min }), null);
    need(`${k}-max-in`, div({ [k]: lim.max }), null);
    need(`${k}-min-out`, div({ [k]: lim.min - 1 }), key);
    need(`${k}-max-out`, div({ [k]: lim.max + 1 }), key);
  }
  need("id-min-in", div({ id: "a".repeat(L.id.minChars) }), null);
  need("id-max-in", div({ id: "i".repeat(L.id.maxChars) }), null);
  need("id-min-out", div({ id: "" }), "id");
  need("id-max-out", div({ id: "i".repeat(L.id.maxChars + 1) }), "id");
  need("days-all", div({ days: [6, 5, 4, 3, 2, 1, 0] }), null);
  need("days-out", div({ days: [7] }), "days");
  for (const f of FIELD_TYPE_IDS) need(`field-type-${f}`, div({ fieldType: f }), null);
  need("city-refused", top({ cityId: "ca-santa-rosa" }), "city_not_allowed");
});

// ── L: the calculator's own form stays inside the limits ────────────────
section("L", () => {
  const row = readFileSync(join(ROOT, "src/components/marketing/practice-calculator/division-row.tsx"), "utf8");
  const calc = readFileSync(join(ROOT, "src/components/marketing/practice-calculator/calculator.tsx"), "utf8");
  const L = INPUT_LIMITS;
  const bound = (src: string, label: string) => {
    const m = new RegExp(`label="${label}" value=\\{d\\.\\w+\\} min=\\{(\\d+)\\} max=\\{(\\d+)\\}`).exec(src);
    return m ? { min: Number(m[1]), max: Number(m[2]) } : null;
  };
  const teams = bound(row, "Teams");
  const perWeek = bound(row, "Per week");
  ok(teams !== null && teams.min >= L.teams.min && teams.max <= L.teams.max, "[L1] calculator teams within the limits", JSON.stringify(teams));
  ok(perWeek !== null && perWeek.min >= L.perWeek.min && perWeek.max <= L.perWeek.max, "[L1] calculator per week within the limits", JSON.stringify(perWeek));
  const lengths = /const LENGTHS = \[([\d, ]+)\];/.exec(row)?.[1].split(",").map(Number) ?? [];
  ok(lengths.length > 0 && lengths.every((n) => n >= L.lengthMin.min && n <= L.lengthMin.max), "[L2] calculator lengths within the limits", lengths.join(","));
  const per = /\{\[([\d, ]+)\]\.map\(\(n\) => \(\s*<option/.exec(row)?.[1].split(",").map(Number) ?? [];
  ok(per.length > 0 && per.every((n) => n >= L.teamsPerField.min && n <= L.teamsPerField.max), "[L3] calculator teams per field within the limits", per.join(","));
  const mb = /min=\{(\d+)\}\s*max=\{(\d+)\}\s*step=\{5\}/.exec(calc);
  ok(mb !== null && Number(mb[1]) >= L.minutesBetween.min && Number(mb[2]) <= L.minutesBetween.max, "[L4] calculator minutes between within the limits", mb?.[0]);
});

// ── anti-vacuity ────────────────────────────────────────────────────────
const ALL_KEYS: PlanInputProblem[] = [
  "not_an_object", "city_not_allowed", "unknown_key", "missing_key", "season_start", "season_end", "minutes_between",
  "divisions", "division_count", "division_not_object", "division_unknown_key", "division_missing_key", "division_name",
  "teams", "per_week", "length", "days", "start", "end", "field_type", "teams_per_field", "lit", "id",
];
for (const k of ALL_KEYS) ok(counters.keys.has(k), `[C1-${k}] the table refuses something with ${k}`);
ok(counters.accepted >= 20 && counters.refused >= 50, "[C2] accepted and refused rows both ran", `${counters.accepted} / ${counters.refused}`);
ok(counters.edges >= 41, "[C3] every limit's edges were looked up", `${counters.edges}`);

console.log(`practice-plan-input (${process.env.TZ ?? "host"}): ${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);

// MUTATION LOG
// 2026-10-21, first pass (step 3 of the in-app practice planner): 5/5
// killed at their own assertion under all three zones — PI1 → XT1 (teams
// limit 61), PI2 → XT1 (cityId not refused), PI3 → XT1 (duplicate days),
// PI4 → E-teams-max-out (the table loses that row), PI5 → L1 (the
// calculator's form allows 8 a week). The table later moved to the patch
// format (one row = a patch on the 'base' row); re-run 5/5 after that.

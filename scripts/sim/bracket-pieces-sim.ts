// Harness for the bracket's presentation pieces (bracket-pieces.tsx +
// series-card.tsx), split out of bracket-view.tsx on 2026-10-20 so the public
// bracket page can render them with no admin code behind them.
//
//   G  ADMIN RENDER UNCHANGED — the tree / column view and every list row of
//      eight brackets (byes, seeds, series, round robin, double elimination,
//      daylight chips on every third dated game, every button kind), rendered
//      with BracketView's glue, must equal byte-for-byte the golden recorded
//      from the PRE-split tree (fixtures/bracket-pieces-golden.json, recorded
//      2026-10-20 from 2a16646 with the four pieces exported temporarily). If
//      G fails, an admin screen changed — fix the pieces, never re-record
//      without Whit's decision.
//   P  PUBLIC RENDER — the same pieces with no callbacks and no chip: no
//      <button>, no action row, no daylight chip; the team names, scores and
//      "Winner of Game N" labels still there.
//   F  IMPORT FENCE — every module reachable from bracket-pieces.tsx (following
//      @/ and relative imports) is free of data access, modals, daylight and
//      the admin wrapper; neither file names a daylight field.
//
// Run: npm run sim:bracket-pieces (+ :mutants).
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { BracketTree, ColumnView, ListGameRow } from "../../src/components/playoffs/bracket-pieces";
import { DaylightChip } from "../../src/components/daylight/daylight-pieces";
import { cases, glue, type FixtureGame } from "./bracket-pieces-fixtures";

(globalThis as { React?: unknown }).React = React;

const ROOT = join(__dirname, "../..");
let checks = 0;
let fails = 0;
function ok(cond: boolean, tag: string, what: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: [${tag}] ${what}${detail ? ` — ${detail}` : ""}`);
  }
}
const counters = { goldenCases: 0, goldenChips: 0, goldenButtons: 0, goldenSeriesGroups: 0, publicCards: 0, publicScores: 0, fencedModules: 0 };

const noop = () => {};

function render(c: ReturnType<typeof cases>[number], admin: boolean) {
  const G = glue(c);
  const chipOf = admin
    ? (g: FixtureGame) => {
        const flag = G.flagOf(g);
        return flag ? h(DaylightChip, { flag, variant: "bracket" }) : null;
      }
    : undefined;
  const acts = admin ? { onEnterResult: noop, onEdit: noop } : {};
  const view = c.format === "single_elimination"
    ? h(BracketTree<FixtureGame>, { games: G.games, championshipRound: G.championshipRound, labelOf: G.labelOf, numberOf: G.numberOf, chipOf, teamName: G.teamName, ...acts })
    : h(ColumnView<FixtureGame>, { rounds: G.rounds, championshipRound: G.championshipRound, labelOf: G.labelOf, numberOf: G.numberOf, chipOf, ...acts });
  const list = G.games
    .map((g) =>
      renderToStaticMarkup(
        h(ListGameRow<FixtureGame>, {
          game: g, isChampionship: g.round === G.championshipRound, labelOf: G.labelOf, numberOf: G.numberOf, chipOf,
          series: G.seriesInfo(g), roundName: G.roundName(g), ...acts,
        }),
      ),
    )
    .join("\n");
  return { view: renderToStaticMarkup(view), list };
}

// ─── G: the admin render is byte-identical to the pre-split golden ──────────
{
  const golden = JSON.parse(readFileSync(join(ROOT, "scripts/sim/fixtures/bracket-pieces-golden.json"), "utf8")) as Record<string, { view: string; list: string }>;
  const all = cases();
  ok(Object.keys(golden).length === all.length, "G", "the golden holds every case", `${Object.keys(golden).length} vs ${all.length}`);
  for (const c of all) {
    const want = golden[c.name];
    const got = render(c, true);
    if (!want) { ok(false, "G", `golden case ${c.name} exists`); continue; }
    const diffAt = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `at ${i}: got …${a.slice(Math.max(0, i - 40), i + 60)}… want …${b.slice(Math.max(0, i - 40), i + 60)}…`; };
    ok(got.view === want.view, "G", `${c.name}: the tree / column view is unchanged`, got.view === want.view ? "" : diffAt(got.view, want.view));
    ok(got.list === want.list, "G", `${c.name}: every list row is unchanged`, got.list === want.list ? "" : diffAt(got.list, want.list));
    counters.goldenCases++;
    counters.goldenChips += (want.view + want.list).split("data-daylight-chip").length - 1;
    counters.goldenButtons += (want.view + want.list).split("<button").length - 1;
    counters.goldenSeriesGroups += want.view.split("data-series-group").length - 1;
  }
}

// ─── P: the public render — no buttons, no action row, no chip ──────────────
{
  for (const c of cases()) {
    const got = render(c, false);
    const html = got.view + got.list;
    ok(!html.includes("<button"), "P", `${c.name}: no button anywhere`);
    ok(!html.includes("flex h-8 flex-none items-center border-t"), "P", `${c.name}: no card has an action row`);
    ok(!html.includes("data-daylight-chip"), "P", `${c.name}: no daylight chip`);
    const names = c.games.flatMap((g) => [g.home_team_name, g.away_team_name]).filter((n): n is string => !!n);
    ok(names.every((n) => html.includes(n.replace(/&/g, "&amp;"))), "P", `${c.name}: every team name still shows`);
    for (const g of c.games) {
      if (g.home_score != null && g.status === "completed") {
        counters.publicScores++;
        ok(got.list.includes(`>${g.home_score}<`), "P", `${c.name}: a played game's score still shows (${g.id})`);
      }
    }
    counters.publicCards += (got.view.split("rounded-lg border border-gray-100 bg-white shadow-sm").length - 1);
  }
}

// ─── F: the import fence ─────────────────────────────────────────────────────
{
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = join(dirname(from), spec);
    else return null; // a package
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
    return existsSync(base) ? base : null;
  };
  const IMPORT = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
  const start = join(ROOT, "src/components/playoffs/bracket-pieces.tsx");
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(IMPORT)) {
      const r = resolve(f, m[1]);
      if (r) queue.push(r);
    }
  }
  const reach = [...seen].map((f) => relative(ROOT, f)).sort();
  counters.fencedModules = reach.length;
  const BAD = /supabase|daylight|-modal\.tsx$|bracket-view\.tsx$|use-[a-z-]+\.tsx?$/;
  const bad = reach.filter((f) => BAD.test(f));
  ok(bad.length === 0, "F", "nothing reachable from bracket-pieces is data access, a modal, daylight or the admin wrapper", bad.join(", "));
  ok(reach.includes("src/components/playoffs/series-card.tsx"), "F", "the walk reaches series-card.tsx (it is fenced too)");
  for (const f of ["src/components/playoffs/bracket-pieces.tsx", "src/components/playoffs/series-card.tsx"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    ok(!/has_lights|sunset|DaylightFlag|DaylightChip|createClient|\.rpc\(|\.from\(/.test(src), "F", `${f} names no daylight field and reads no data`);
  }
}

for (const [name, n] of Object.entries(counters)) ok(n > 0, "AV", `counter ${name} is ${n}`);
console.log(`bracket-pieces: ${checks - fails}/${checks} checks passed  ${JSON.stringify(counters)}`);
if (fails) process.exit(1);

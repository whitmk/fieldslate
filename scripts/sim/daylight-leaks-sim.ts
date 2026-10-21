// The daylight flags are ADMIN-ONLY (decided 2026-10-14): never on a print,
// an export, an email, a calendar feed, the public league schedule or a
// partner token page. This harness is the fence.
//
//   npm run sim:daylight-leaks            (source scans; no clock, no zone)
//   npm run sim:daylight-leaks:mutants    (mutation pass, real source)
//
// WHAT IT CHECKS, IN THIS ORDER (a mutant must die FIRST at its own tag):
//   F1  IMPORT FENCE — no outbound file imports src/lib/daylight or
//       src/components/daylight, directly OR THROUGH ANY CHAIN of @/ and
//       relative imports (2026-10-20: the public bracket page renders the
//       Playoffs page's pieces, so a direct-only check would pass a public
//       file that imports an admin component which imports daylight).
//       Outbound = every file under the token / public / API routes, the
//       public-schedule, public-bracket and calendar libs, the interleague and
//       email libs, the shared bracket pieces, and each print / export file by
//       name.
//   W1  WORD SCAN — no outbound file mentions a daylight field or word
//       (has_lights, sunset, .daylight, daylightLit, daylight_flags, …).
//       Plain "daylight" alone is allowed: the timezone files describe
//       daylight-SAVING time. The free calculator (src/components/marketing)
//       is outside the scan — it is public and shows its own sunset.
//   W2  PRINT SLICE — the division panel's print region (a slice of the
//       admin file) never reads a daylight field.
//   P1  The Schedule page hands the print region the UNFILTERED games
//       (`games={games}`) — never the Daylight-filtered list.
//   D1  DB TOKEN FUNCTIONS — the latest body of every get_*_by_token function
//       in supabase/migrations (comments stripped) never names has_lights,
//       sunset_city or daylight_flags_enabled. (The live catalog is checked
//       by daylight-flags-sim.sql K1.)
//   S1  ONE SOURCE — nothing under src outside src/lib/daylight and the
//       practice calculator imports the sunset math, and no file outside
//       src/lib/daylight hand-writes a daylight sentence.
//   N1  EXPECTED NON-SURFACE — "Record where it was played" (past games only,
//       and past games never show flags) imports and reads nothing daylight.
//   S2  WIRING (anti-vacuity) — every admin surface the founder listed
//       imports the shared daylight pieces, so the fence is not guarding an
//       empty feature.
//   then COUNTERS: files fenced, token functions scanned, surfaces wired —
//   a zero fails the run.
//
// Source greps are weak by nature (stated, as in sim:game-notes); the import
// fence is the strong half, and the word scan catches a field read without
// an import (the print region receives the same game objects).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
let checks = 0;
function ok(cond: boolean, tag: string, detail?: string) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${tag}${detail ? ` — ${detail}` : ""}`);
  }
}

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...walk(relative(ROOT, p)));
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative(ROOT, p));
  }
  return out;
}

// ── Outbound surfaces ───────────────────────────────────────────────────
const OUTBOUND_DIRS = [
  "src/app/s", // public league schedule + its feed
  "src/app/schedule", // partner token schedule
  "src/app/invite",
  "src/app/reschedule",
  "src/app/calendar", // team calendar feed
  "src/app/org-invite",
  "src/app/api", // every route: emails, feeds, token actions
  "src/lib/public-schedule",
  "src/components/public-schedule",
  "src/lib/public-bracket", // the public bracket page (0116)
  "src/components/public-bracket",
  "src/lib/calendar",
  "src/lib/interleague", // partner emails and token-page wording
  "src/lib/orgs",
  "src/components/export",
];
const OUTBOUND_FILES = [
  // The bracket's presentation pieces — rendered by the public bracket page.
  "src/components/playoffs/bracket-pieces.tsx",
  "src/components/playoffs/series-card.tsx",
  "src/lib/email.ts",
  "src/components/schedule/schedule-print-region.tsx",
  "src/components/schedule/schedule-print-button.tsx",
  "src/lib/playoffs/bracket-print.ts",
  "src/components/playoffs/playoff-export-modal.tsx",
  "src/lib/schedule/sports-connect-export.ts",
  "src/lib/schedule/generic-games-export.ts",
  "src/lib/schedule/export-games.ts",
  "src/components/divisions/export-picker-modal.tsx",
  "src/components/practices/practice-export-modal.tsx",
  "src/components/interleague/reschedule-form.tsx",
  "src/components/interleague/invite-form.tsx",
  "src/app/(dashboard)/dashboard/umpires/print-all/page.tsx",
  "src/app/(dashboard)/dashboard/umpires/[id]/page.tsx",
  "src/components/umpires/auto-print-on-load.tsx",
  "src/components/umpires/manual-print-button.tsx",
  "src/components/umpires/umpire-schedule-actions.tsx",
  "src/components/umpires/pay-report-modal.tsx",
];
const outbound = [...new Set([...OUTBOUND_DIRS.flatMap(walk), ...OUTBOUND_FILES])].sort();
let fenced = 0;

const IMPORTS_DAYLIGHT = /from\s+["'][^"']*\/(lib|components)\/daylight(\/[^"']*)?["']|from\s+["']\.{1,2}\/(\.\.\/)*daylight\/[^"']*["']/;
// `.daylight` is matched only in its FLAG shape (`x.daylight &&`, `?.`, `??`,
// or `.daylight.kind|minutes|…`, or a `daylight={…}` prop): the calendar
// feed's timezone object legitimately has `z.daylight.offset` (daylight-
// saving time), which must not trip the scan.
const DAYLIGHT_WORDS =
  /has_lights|hasLights|sunset|daylight_flags|sunset_city|\.daylight(\s*(&&|\?\?|\?\.)|\.(kind|minutes|sunsetMin|startByMin|endMin)\b)|\bdaylight=\{|\bdaylight(Lit|Flag|Chip|State|Explanation|Pick|Status|View|Dot|Load|Count|Only|Today)\b|Daylight(Flag|Chip|Explanation|PickNotice|StatusLine|Filter|Card|State)\b/;

// ── F1: import fence (follows every import chain) ───────────────────────
const IMPORT_SPEC = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(from, "..", spec);
  else return null; // a package
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(join(ROOT, base + ext))) return base + ext;
  return existsSync(join(ROOT, base)) && statSync(join(ROOT, base)).isFile() ? base : null;
}
const IN_DAYLIGHT = /^src\/(lib|components)\/daylight\//;
let reachedModules = 0;
{
  const bad: string[] = [];
  for (const f of outbound) {
    if (!existsSync(join(ROOT, f))) {
      bad.push(`${f} (listed but missing — update the fence list)`);
      continue;
    }
    fenced++;
    if (IMPORTS_DAYLIGHT.test(read(f))) {
      bad.push(f);
      continue;
    }
    // Walk every chain from this file; report the first path into daylight.
    const via = new Map<string, string>([[f, ""]]);
    const queue = [f];
    let hit: string | null = null;
    while (queue.length && !hit) {
      const cur = queue.shift()!;
      for (const m of read(cur).matchAll(IMPORT_SPEC)) {
        if (/^(import|export)\s+type\s/.test(m[0])) continue; // types carry no code
        const r = resolveImport(cur, m[1]);
        if (!r || via.has(r)) continue;
        via.set(r, cur);
        if (IN_DAYLIGHT.test(r)) { hit = r; break; }
        queue.push(r);
      }
    }
    reachedModules += via.size;
    if (hit) {
      const chain: string[] = [];
      for (let x: string = hit; x; x = via.get(x) ?? "") chain.unshift(x);
      bad.push(chain.join(" → "));
    }
  }
  ok(bad.length === 0, "[F1] no outbound file reaches the daylight module or pieces through any import chain", bad.join("; "));
}
ok(reachedModules > fenced, "[AV] the import walk went past the fenced files themselves", `${reachedModules} visits`);

// ── W1: word scan ───────────────────────────────────────────────────────
{
  const bad = outbound.filter((f) => existsSync(join(ROOT, f)) && DAYLIGHT_WORDS.test(read(f)));
  ok(bad.length === 0, "[W1] no outbound file mentions a daylight field or word", bad.join(", "));
}

// ── W2: the division panel's print slice ────────────────────────────────
{
  const panel = read("src/components/divisions/division-schedule-panel.tsx");
  const start = panel.indexOf('className="fieldslate-print-region hidden"');
  const end = panel.indexOf("{/* ── Bulk rainout confirmation modal", start);
  const slice = start >= 0 && end > start ? panel.slice(start, end) : "";
  ok(slice.length > 200, "[W2] panel print slice found", `length ${slice.length}`);
  ok(slice.length > 200 && !DAYLIGHT_WORDS.test(slice) && !/\bdl\./.test(slice),
    "[W2] the division panel's print region never reads a daylight field");
}

// ── P1: the print gets the unfiltered games ─────────────────────────────
{
  const page = read("src/app/(dashboard)/dashboard/schedule/page.tsx");
  ok(/<SchedulePrintRegion games=\{games\} /.test(page) && !/<SchedulePrintRegion games=\{shownGames\}/.test(page),
    "[P1] the Schedule print region receives the unfiltered games, never the Daylight-filtered list");
}

// ── D1: DB token functions ──────────────────────────────────────────────
let tokenFns = 0;
{
  const dir = "supabase/migrations";
  const files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".sql")).sort();
  const latest = new Map<string, string>(); // fn → body (last definition wins)
  for (const f of files) {
    const sql = read(join(dir, f));
    const re = /create\s+or\s+replace\s+function\s+public\.(get_[a-z_]+_by_token)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const after = sql.slice(m.index);
      const open = /\$([a-z_]*)\$/i.exec(after);
      if (!open) continue;
      const tag = open[0];
      const bodyStart = open.index + tag.length;
      const bodyEnd = after.indexOf(tag, bodyStart);
      const body = after.slice(bodyStart, bodyEnd);
      latest.set(m[1].toLowerCase(), body.replace(/--[^\n]*/g, ""));
    }
  }
  const bad: string[] = [];
  for (const [fn, body] of latest) {
    tokenFns++;
    if (/has_lights|sunset_city|daylight_flags_enabled/.test(body)) bad.push(fn);
  }
  ok(tokenFns >= 6 && bad.length === 0, "[D1] no token function body names a daylight column", `${tokenFns} scanned; ${bad.join(", ")}`);
}

// ── S1: one source ──────────────────────────────────────────────────────
{
  const all = walk("src");
  const sunImporters = all.filter(
    (f) =>
      /from\s+["'][^"']*\/sun\/sunset["']/.test(read(f)) &&
      !f.startsWith("src/lib/daylight/") &&
      !f.startsWith("src/lib/practice-planner/") &&
      !f.startsWith("src/components/marketing/"),
  );
  ok(sunImporters.length === 0, "[S1] only src/lib/daylight (and the calculator) read the sunset math", sunImporters.join(", "));
  const handWritten = all.filter(
    (f) =>
      /min (after|before) sunset|minutes (after|before) sunset|Ends at sunset/.test(read(f)) &&
      !f.startsWith("src/lib/daylight/") &&
      !f.startsWith("src/lib/practice-planner/") &&
      !f.startsWith("src/components/marketing/"),
  );
  ok(handWritten.length === 0, "[S1] no daylight sentence hand-written outside src/lib/daylight", handWritten.join(", "));
}

// ── S2: wiring (anti-vacuity) ───────────────────────────────────────────
let wired = 0;
{
  const SURFACES = [
    "src/components/schedule/schedule-list.tsx",
    "src/components/schedule/schedule-calendar.tsx",
    "src/components/schedule/schedule-week-grid.tsx",
    "src/components/divisions/division-schedule-panel.tsx",
    "src/components/playoffs/bracket-view.tsx",
    "src/components/playoffs/edit-playoff-game-modal.tsx",
    "src/components/divisions/rainout-reschedule-modal.tsx",
    "src/components/divisions/manual-move-form.tsx",
    "src/components/interleague/resolve-edit-modal.tsx",
    "src/components/schedule/add-game-modal.tsx",
  ];
  for (const f of SURFACES) {
    const src = read(f);
    const has = src.includes('from "@/components/daylight/daylight-pieces"');
    if (has) wired++;
    ok(has, "[S2] admin surface renders the shared daylight pieces", f);
  }
  // EXPECTED NON-SURFACES (decided 2026-10-14): "Record where it was played"
  // is only ever about a game that already happened, and past games never
  // show flags — so it must not import or read anything daylight.
  const NON_SURFACES = ["src/components/schedule/record-played-modal.tsx", "src/lib/schedule/record-played.ts"];
  for (const f of NON_SURFACES) {
    const src = read(f);
    ok(!IMPORTS_DAYLIGHT.test(src) && !DAYLIGHT_WORDS.test(src), "[N1] record-played shows no daylight (past games are never flagged)", f);
  }
  const page = read("src/app/(dashboard)/dashboard/schedule/page.tsx");
  ok(page.includes("gamesRowDaylight(g, raw, daylight, daylightToday)") && page.includes("<DaylightFilter"),
    "[S2] the Schedule page computes flags with gamesRowDaylight and offers the filter");
}

// ── counters ────────────────────────────────────────────────────────────
ok(fenced >= 60, "[COUNT-fenced] outbound files fenced", String(fenced));
ok(tokenFns >= 6, "[COUNT-tokenFns] token functions scanned", String(tokenFns));
ok(wired >= 10, "[COUNT-wired] admin surfaces wired", String(wired));

console.log(`daylight-leaks: ${checks} checks, ${failures} failed (fenced ${fenced} files, ${reachedModules} module visits through their imports, ${tokenFns} token functions, ${wired} surfaces)`);
process.exit(failures ? 1 : 0);

// MUTATION LOG: see daylight-leaks-mutants.ts runs (bottom of this file).

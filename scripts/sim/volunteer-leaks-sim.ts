// Volunteer data stays inside the volunteer feature (decided 2026-11-08):
// never in the activity log, a print, an export (the admin CSV, when it is
// built, is the one exception), a calendar feed, the public schedule or
// bracket page, a partner token page, or any token route other than the
// volunteer sign-up and manage routes. This harness is the fence.
//
//   npm run sim:volunteer-leaks            (source scans; no clock, no zone)
//   npm run sim:volunteer-leaks:mutants    (mutation pass, real source)
//
// WHAT IT CHECKS, IN THIS ORDER (a mutant must die FIRST at its own tag):
//   F1  IMPORT FENCE — no outbound file reaches src/lib/volunteers or
//       src/components/volunteers through ANY chain of @/ and relative
//       imports (type-only imports skipped). Outbound = the token / public /
//       API routes (minus the volunteer routes themselves), the public-
//       schedule, public-bracket, calendar, interleague, orgs and email libs,
//       the bracket pieces, and every print / export file by name — the same
//       list as sim:daylight-leaks.
//   W1  WORD SCAN — no outbound file names a volunteer table, function or
//       personal column (volunteer_claims, volunteer_signup_page, email_lc,
//       first_initial, …). Plain "volunteer" is allowed: the marketing copy and
//       the snack shack wizard use the ordinary word.
//   (U1, below, runs here — before A1 — so an officials file that reaches
//   the volunteer code dies at U1 even when it also reaches the log.)
//   A1  ACTIVITY LOG — no file that imports the volunteer code imports the
//       activity log, and no migration function body (latest definition,
//       comments stripped) both names a volunteer table and writes
//       activity_log.
//   D1  DB TOKEN FUNCTIONS — the latest body of every get_*_by_token function
//       never names a volunteer table.
//   V1  THE PUBLIC SIGN-UP READ — volunteer_signup_page and
//       volunteer_season_spots (latest bodies) never name last_name,
//       first_initial or email_lc: a filled spot reads "Taken", never a name.
//       (The manage page shows the volunteer their OWN name — allowed.)
//   U1  THE OFFICIALS FENCE (0123, decided 2026-11-09) — nothing under
//       src/lib/umpires, src/components/umpires or the officials pages
//       reaches the volunteer code or names a volunteer table, and no
//       database function outside the volunteer set (latest body) reads
//       volunteer_official_links / volunteer_official_no_shows: the tracker
//       counts officials' games, but assignment, auto-assign and pay never
//       read what it stores.
//   S1  WIRING (anti-vacuity) — the Settings card, the outbox drain and the
//       tracker page use the volunteer code, so the fence is not guarding
//       nothing.
//   then COUNTERS: files fenced, token functions scanned, volunteer
//   functions scanned — a zero fails the run.
//
// Source greps are weak by nature (as in sim:daylight-leaks); the import
// fence and the latest-body scans are the strong half. The live catalog's
// "no names on the page" is the SQL proof's P3 (volunteer-claims-sim.sql).
// The admin CSVs (signupsCsv 2026-11-08, trackerCsv 2026-11-09) live inside
// src/lib/volunteers, so they are inside the fence by construction; a CSV
// built anywhere else goes in CSV_ALLOWED with the decision's date.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { latestSqlBodies } from "./sql-latest";

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
  "src/app/s",
  "src/app/schedule",
  "src/app/invite",
  "src/app/reschedule",
  "src/app/calendar",
  "src/app/org-invite",
  "src/app/api",
  "src/lib/public-schedule",
  "src/components/public-schedule",
  "src/lib/public-bracket",
  "src/components/public-bracket",
  "src/lib/calendar",
  "src/lib/interleague",
  "src/lib/orgs",
  "src/components/export",
];
const OUTBOUND_FILES = [
  "src/components/playoffs/bracket-pieces.tsx",
  "src/components/playoffs/series-card.tsx",
  "src/lib/email.ts",
  "src/lib/activity-log.ts",
  "src/components/dashboard/activity-log-panel.tsx",
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
  "src/components/interleague/schedule-game-actions.tsx",
  "src/components/interleague/reschedule-request-modal.tsx",
  "src/app/(dashboard)/dashboard/umpires/print-all/page.tsx",
  "src/app/(dashboard)/dashboard/umpires/[id]/page.tsx",
  "src/components/umpires/auto-print-on-load.tsx",
  "src/components/umpires/manual-print-button.tsx",
  "src/components/umpires/umpire-schedule-actions.tsx",
  "src/components/umpires/pay-report-modal.tsx",
  "src/components/field-requests/plan-print-region.tsx",
  "src/components/snack-shack/snack-shack-print-region.tsx",
  "src/lib/snack-shack/print.ts",
];
// The volunteer routes themselves: the outbox drain now; the sign-up and
// manage routes and pages when they are built. These are the token routes
// allowed to read volunteer data.
const ALLOWED_PREFIXES = ["src/app/api/volunteers/", "src/app/v/"];
// The admin CSV export of sign-ups — the one export allowed (none yet).
const CSV_ALLOWED: string[] = [];

const outbound = [...new Set([...OUTBOUND_DIRS.flatMap(walk), ...OUTBOUND_FILES])]
  .filter((f) => !ALLOWED_PREFIXES.some((p) => f.startsWith(p)) && !CSV_ALLOWED.includes(f))
  .sort();

const IN_VOLUNTEERS = /^src\/(lib|components)\/volunteers\//;
const VOLUNTEER_WORDS =
  /volunteer_(claims|roles|role_divisions|settings|outbox|manage_links|rate_events|trigger_failures|signup_page|season_spots|claim|cancel|keep_spot|manage_page|archive_holds|failure_count|admin_state|goals|team_family_counts|family_members|official_links|official_no_shows|tracker|tracker_families|admin_nudge)\b|\b(set_volunteer_goal|set_team_family_count|set_official_counts_for|set_official_no_show|merge_volunteer_families|separate_volunteer_family_member)\b|\bfrom\(\s*["']volunteers["']\)|\bfirst_initial\b|\bemail_lc\b|@\/(lib|components)\/volunteers\//;
const VOLUNTEER_TABLES =
  /\bvolunteer_(claims|roles|role_divisions|manage_links|outbox|settings|goals|team_family_counts|family_members|official_links|official_no_shows)\b|\bpublic\.volunteers\b/;

// ── F1: import fence (follows every import chain) ───────────────────────
const IMPORT_SPEC = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(from, "..", spec);
  else return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(join(ROOT, base + ext))) return base + ext;
  return existsSync(join(ROOT, base)) && statSync(join(ROOT, base)).isFile() ? base : null;
}
/** Every module reachable from f (code imports only), with the parent map. */
function reach(f: string): Map<string, string> {
  const via = new Map<string, string>([[f, ""]]);
  const queue = [f];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const m of read(cur).matchAll(IMPORT_SPEC)) {
      if (/^(import|export)\s+type\s/.test(m[0])) continue;
      const r = resolveImport(cur, m[1]);
      if (!r || via.has(r)) continue;
      via.set(r, cur);
      queue.push(r);
    }
  }
  return via;
}
let fenced = 0;
let visits = 0;
{
  const bad: string[] = [];
  for (const f of outbound) {
    if (!existsSync(join(ROOT, f))) {
      bad.push(`${f} (listed but missing — update the fence list)`);
      continue;
    }
    fenced++;
    const via = reach(f);
    visits += via.size;
    const hit = [...via.keys()].find((x) => IN_VOLUNTEERS.test(x));
    if (hit) {
      const chain: string[] = [];
      for (let x: string = hit; x; x = via.get(x) ?? "") chain.unshift(x);
      bad.push(chain.join(" → "));
    }
  }
  ok(bad.length === 0, "[F1] no outbound file reaches the volunteer code through any import chain", bad.join("; "));
}
ok(visits > fenced, "[AV] the import walk went past the fenced files themselves", `${visits} visits`);

// ── W1: word scan ───────────────────────────────────────────────────────
{
  const bad = outbound.filter((f) => existsSync(join(ROOT, f)) && VOLUNTEER_WORDS.test(read(f)));
  ok(bad.length === 0, "[W1] no outbound file names a volunteer table, function or personal column", bad.join(", "));
}

// ── latest migration bodies — the ONE resolver (sql-latest.ts) ─────────
const latest = latestSqlBodies(); // fn → latest body, comments stripped

// ── U1: the officials fence (0123) ──────────────────────────────────────
let officialFiles = 0;
{
  const files = [...walk("src/lib/umpires"), ...walk("src/components/umpires"), ...walk("src/app/(dashboard)/dashboard/umpires")];
  const bad: string[] = [];
  for (const f of files) {
    officialFiles++;
    const via = reach(f);
    const hit = [...via.keys()].find((x) => IN_VOLUNTEERS.test(x));
    if (hit || VOLUNTEER_WORDS.test(read(f))) bad.push(hit ? `${f} → ${hit}` : f);
  }
  ok(bad.length === 0, "[U1] no officials file reaches the volunteer code or names a volunteer table", bad.join(", "));
  const VOLUNTEER_SET = /^(volunteer_|set_volunteer_goal$|set_team_family_count$|set_official_counts_for$|set_official_no_show$|merge_volunteer_families$|separate_volunteer_family_member$|wipe_volunteer_data_on_archive$)/;
  const badSql = [...latest]
    .filter(([fn, body]) => !VOLUNTEER_SET.test(fn) && /\bvolunteer_official_(links|no_shows)\b/.test(body))
    .map(([fn]) => fn);
  ok(badSql.length === 0, "[U1] no database function outside the volunteer set reads the officials' tracker tables", badSql.join(", "));
}

// ── A1: the activity log ────────────────────────────────────────────────
{
  const all = walk("src");
  const badTs = all.filter((f) => {
    if (IN_VOLUNTEERS.test(f) || f === "src/lib/activity-log.ts") return false;
    const via = reach(f);
    const touchesVolunteers = [...via.keys()].some((x) => IN_VOLUNTEERS.test(x)) || VOLUNTEER_WORDS.test(read(f));
    return touchesVolunteers && via.has("src/lib/activity-log.ts");
  });
  const volunteerSelf = all.filter((f) => IN_VOLUNTEERS.test(f) && reach(f).has("src/lib/activity-log.ts"));
  ok(badTs.length === 0 && volunteerSelf.length === 0, "[A1] no volunteer code reaches the activity log",
    [...badTs, ...volunteerSelf].join(", "));
  const badSql = [...latest].filter(([, body]) => VOLUNTEER_TABLES.test(body) && /\bactivity_log\b/.test(body)).map(([fn]) => fn);
  ok(badSql.length === 0, "[A1] no database function both reads volunteer data and writes the activity log", badSql.join(", "));
}

// ── D1: DB token functions ──────────────────────────────────────────────
let tokenFns = 0;
{
  const bad: string[] = [];
  for (const [fn, body] of latest) {
    if (!/^get_[a-z_]+_by_token$/.test(fn)) continue;
    tokenFns++;
    if (VOLUNTEER_TABLES.test(body)) bad.push(fn);
  }
  ok(bad.length === 0, "[D1] no token function body names a volunteer table", bad.join(", "));
}

// ── V1: the public sign-up read names nobody ────────────────────────────
let volunteerFns = 0;
{
  for (const fn of ["volunteer_signup_page", "volunteer_season_spots"]) {
    const body = latest.get(fn);
    ok(body !== undefined, "[V1] public sign-up read found", fn);
    if (body === undefined) continue;
    volunteerFns++;
    const named = ["last_name", "first_initial", "email_lc"].filter((w) => new RegExp(`\\b${w}\\b`).test(body));
    ok(named.length === 0, "[V1] the public sign-up read never names a volunteer", `${fn}: ${named.join(", ")}`);
  }
}

// ── S1: wiring (anti-vacuity) ───────────────────────────────────────────
let wired = 0;
{
  const SURFACES: [string, RegExp][] = [
    ["src/components/settings/volunteers-card.tsx", /from\s+["']@\/lib\/volunteers\//],
    ["src/app/api/volunteers/outbox/drain/route.ts", /from\s+["']@\/lib\/volunteers\/drain-runner["']/],
    ["src/app/(dashboard)/dashboard/volunteers/tracker/page.tsx", /from\s+["']@\/lib\/volunteers\/tracker["']/],
  ];
  for (const [f, re] of SURFACES) {
    const has = existsSync(join(ROOT, f)) && re.test(read(f));
    if (has) wired++;
    ok(has, "[S1] volunteer surface uses the volunteer code", f);
  }
}

// ── counters ────────────────────────────────────────────────────────────
ok(fenced >= 60, "[COUNT-fenced] outbound files fenced", String(fenced));
ok(tokenFns >= 6, "[COUNT-tokenFns] token functions scanned", String(tokenFns));
ok(volunteerFns >= 2, "[COUNT-volunteerFns] public sign-up functions scanned", String(volunteerFns));
ok(wired >= 3, "[COUNT-wired] volunteer surfaces wired", String(wired));
ok(officialFiles >= 20, "[COUNT-officialFiles] officials files fenced", String(officialFiles));

console.log(`volunteer-leaks: ${checks} checks, ${failures} failed (fenced ${fenced} files, ${visits} module visits, ${tokenFns} token functions, ${volunteerFns} sign-up functions, ${wired} surfaces)`);
process.exit(failures ? 1 : 0);

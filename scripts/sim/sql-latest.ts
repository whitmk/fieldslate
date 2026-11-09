// Which migration holds the LIVE definition of each SQL function — the ONE
// resolver the leak fence (sim:volunteer-leaks) and the mutant-target check
// (sim:mutant-targets, and every mutation pass through mutant-runner.ts) use.
//
// Why (2026-11-09): a later migration that re-creates a function makes every
// older copy of its body dead text. A mutant aimed at the old copy mutates
// nothing a reader sees — the fence reads the latest body, so the mutant
// "survives" for the wrong reason, or a sim that reads one fixed file keeps
// passing on the dead copy. sim:volunteer-leaks VL4/VL6 sat that way from the
// 0122 merge (0122 re-created save_volunteer_role and volunteer_signup_page)
// until 2026-11-09.
//
// A function is keyed by NAME (all overloads together): a later migration
// that defines any overload of a name supersedes earlier bodies of that name.
// That is the conservative choice — it can only flag more, never miss one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
export const MIGRATIONS_DIR = "supabase/migrations";

export type SqlFunctionDef = {
  name: string;
  /** Repo-relative migration path. */
  file: string;
  /** Offsets of the body (between the dollar quotes) in the file. */
  bodyStart: number;
  bodyEnd: number;
  body: string;
};

const DEF = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi;

/** Every function definition in one SQL text, in order. */
export function functionDefsIn(file: string, sql: string): SqlFunctionDef[] {
  const out: SqlFunctionDef[] = [];
  DEF.lastIndex = 0;
  for (let m = DEF.exec(sql); m; m = DEF.exec(sql)) {
    const after = sql.slice(m.index);
    const open = /\$([a-z_]*)\$/i.exec(after);
    if (!open) continue;
    const bodyStart = m.index + open.index + open[0].length;
    const close = sql.indexOf(open[0], bodyStart);
    if (close < 0) continue;
    out.push({ name: m[1].toLowerCase(), file, bodyStart, bodyEnd: close, body: sql.slice(bodyStart, close) });
  }
  return out;
}

/** Migration files in apply order (their numbered names). */
export function migrationFiles(): string[] {
  return readdirSync(join(ROOT, MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => `${MIGRATIONS_DIR}/${f}`);
}

let cache: { all: SqlFunctionDef[]; latest: Map<string, SqlFunctionDef> } | null = null;

/** All definitions across every migration, and the latest per name. Pass
 *  `read` to resolve against edited text (the mutant runner does, for the
 *  file it is about to mutate). */
export function sqlFunctions(read?: (file: string) => string) {
  const useCache = read === undefined;
  if (useCache && cache) return cache;
  const load = read ?? ((f: string) => readFileSync(join(ROOT, f), "utf8"));
  const all: SqlFunctionDef[] = [];
  for (const f of migrationFiles()) all.push(...functionDefsIn(f, load(f)));
  const latest = new Map<string, SqlFunctionDef>();
  for (const d of all) latest.set(d.name, d); // later files (and later in a file) win
  const res = { all, latest };
  if (useCache) cache = res;
  return res;
}

/** Latest body per function name, `--` comments stripped (the fence's view). */
export function latestSqlBodies(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, d] of sqlFunctions().latest) out.set(name, d.body.replace(/--[^\n]*/g, ""));
  return out;
}

/** If `index` in `file` lies inside a function body that a LATER definition
 *  supersedes, the function and the file holding its live body; else null
 *  (not in a function body, not a migration, or this IS the live body). */
export function shadowedAt(file: string, src: string, index: number): { name: string; liveFile: string } | null {
  if (!file.startsWith(`${MIGRATIONS_DIR}/`) || index < 0) return null;
  const here = functionDefsIn(file, src).find((d) => index >= d.bodyStart && index < d.bodyEnd);
  if (!here) return null;
  const live = sqlFunctions().latest.get(here.name);
  if (!live) return null;
  if (live.file === file && live.bodyStart === here.bodyStart) return null;
  return { name: here.name, liveFile: live.file };
}

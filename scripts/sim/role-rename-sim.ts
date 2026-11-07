// Harness for the app half of 0118 (renaming an official role). The database
// half — the cascade, the grants, the refusals — is proven by
// scripts/sim/rename-official-role-sim.sql (rolled back, test org). This one
// drives src/lib/umpires/role-rename.ts and checks the wiring.
//
// ASSERTIONS
//   N1  same name = trimmed + case-insensitive ("Plate" = " plate ")
//   N2  a case-only rename of the role itself is not a clash
//   N3  another role's name, in any case, is a clash
//   O1  every refusal key has its own sentence (name_taken → ROLE_NAME_TAKEN …)
//   O2  an unknown error → "Couldn't rename the role. Nothing was changed."
//   O3  a committed reply for this role parses, counts and all
//   O4  a reply naming ANOTHER role is an error, never a success
//   O5  a reply that isn't committed, or lacks a count, is an error
//   L1  the after-rename note, singular/plural, and none when nothing moved
//   S1  no file in src writes official_roles.name directly (source scan —
//       the database grant is the real guard; this catches our own code)
//   S2  the roles manager renames through rename_official_role
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:role-rename:mutants).
//   RR1 name compare loses toLowerCase                 → [N1]
//   RR2 clash check counts the role itself              → [N2]
//   RR3 a reply for another role id is accepted         → [O4]
//   RR4 name_taken worded as the generic error          → [O1]
//   RR5 the manager writes the name directly again      → [S1]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ROLE_NAME_TAKEN,
  renameClash,
  renameOutcome,
  renamedLine,
  sameRoleName,
} from "../../src/lib/umpires/role-rename";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROOT = join(__dirname, "../..");
const ROLES = [
  { id: "p", name: "Plate" },
  { id: "b", name: "Base" },
];
const GENERIC = "Couldn't rename the role. Nothing was changed.";

ok(sameRoleName("Plate", " plate ") && sameRoleName("BASE", "base") && !sameRoleName("Plate", "Plate umpire"), "[N1]");
ok(!renameClash(ROLES, "p", "plate"), "[N2]", "a case-only rename of the role itself must not clash");
ok(renameClash(ROLES, "p", " base ") && renameClash(ROLES, "p", "BASE"), "[N3]");

const err = (k: string) => renameOutcome(null, { message: k }, "p", "Plate umpire");
const msg = (o: ReturnType<typeof renameOutcome>) => (o.ok ? "OK" : o.message);
ok(
  msg(err("name_taken")) === ROLE_NAME_TAKEN &&
    msg(err("name_required")) === "Enter a role name." &&
    msg(err("not_authorized")) === "You don't have permission to rename roles in this season." &&
    msg(err("role_not_found")) === "That role no longer exists — refresh the page." &&
    msg(err("assignment_role_conflict")) ===
      "Some games already have an assignment named “Plate umpire”, so renaming would put two on one game. Nothing was changed." &&
    msg(err("rate_role_conflict")) === "A pay rate named “Plate umpire” already exists for this season. Nothing was changed.",
  "[O1]",
  JSON.stringify(["name_taken", "name_required", "not_authorized", "role_not_found", "assignment_role_conflict", "rate_role_conflict"].map((k) => msg(err(k)))),
);
ok(msg(err("permission denied for table official_roles")) === GENERIC, "[O2]");

const good = { committed: true, changed: true, role_id: "p", name: "Plate umpire", assignments: 2, rates: 1, divisions: 2 };
const o3 = renameOutcome(good, null, "p", "Plate umpire");
ok(o3.ok && o3.name === "Plate umpire" && o3.assignments === 2 && o3.rates === 1 && o3.divisions === 2, "[O3]", JSON.stringify(o3));
ok(msg(renameOutcome({ ...good, role_id: "b" }, null, "p", "Plate umpire")) === GENERIC, "[O4]");
ok(
  msg(renameOutcome({ ...good, committed: false }, null, "p", "x")) === GENERIC &&
    msg(renameOutcome({ ...good, assignments: undefined }, null, "p", "x")) === GENERIC &&
    msg(renameOutcome(null, null, "p", "x")) === GENERIC,
  "[O5]",
);

const l = (a: number, r: number, changed = true) =>
  renamedLine({ ok: true, name: "Plate umpire", changed, assignments: a, rates: r, divisions: 0 });
ok(
  l(2, 1) === "Renamed to “Plate umpire” — 2 assignments and 1 pay rate updated too." &&
    l(1, 0) === "Renamed to “Plate umpire” — 1 assignment updated too." &&
    l(0, 0) === null &&
    l(3, 3, false) === null,
  "[L1]",
  JSON.stringify([l(2, 1), l(1, 0), l(0, 0)]),
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const writers = walk(join(ROOT, "src")).filter((f) =>
  /from\("official_roles"\)[\s\S]{0,160}?\.update\(\s*\{[^}]*\bname\b/.test(readFileSync(f, "utf8")),
);
ok(writers.length === 0, "[S1]", `direct official_roles.name writes: ${writers.map((f) => f.replace(ROOT + "/", "")).join(", ")}`);
const manager = readFileSync(join(ROOT, "src/components/umpires/official-roles-manager.tsx"), "utf8");
ok(manager.includes('"rename_official_role" as never') && manager.includes("renameOutcome(data, rpcErr, editingId, name)"), "[S2]");

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);

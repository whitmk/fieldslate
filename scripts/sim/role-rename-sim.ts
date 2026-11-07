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
//   E1  ensureSeasonRoleIds' rule: " PLATE " resolves to the existing "Plate"
//       (its id and CANONICAL name), nothing to create
//   E2  a new name is created once even when requested in two cases
//   E3  a legacy season with two roles of one key resolves to the lower
//       sort_order
//   E4  end to end through ensureSeasonRoleIds + the officials fake: no
//       case-variant role row is created, the new one is, canonical names back
//   S3  the three writers write the canonical name: UmpireSlots (insert AND
//       reassign), auto-assign, pay settings (source grep — weak by nature)
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:role-rename:mutants).
//   RR1 name compare loses toLowerCase                 → [N1]
//   RR2 clash check counts the role itself              → [N2]
//   RR3 a reply for another role id is accepted         → [O4]
//   RR4 name_taken worded as the generic error          → [O1]
//   RR5 the manager writes the name directly again      → [S1]
//   RR6 roleKey loses toLowerCase (case variants miss)  → [E1]
//   RR7 a name requested twice is created twice         → [E2]
//   RR8 legacy tie resolved to the HIGHER sort_order    → [E3]
//   RR9 UmpireSlots inserts the slot label, not the role → [S3]
// First run (2026-11-07): E4 RED on the real code — after creating "Field",
// ensureSeasonRoleIds re-resolved only the created spellings, so a second
// request "FIELD" came back unresolved (text with no role). Fixed in roles.ts
// (re-resolve every requested name); E4 is that bug's assertion.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureSeasonRoleIds, resolveRequestedRoles } from "../../src/lib/umpires/roles";
import { FakeClient } from "./officials-fake";
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

// ── E: ensureSeasonRoleIds resolves case-insensitively ──────────────────────
const SEASON_ROLES = [
  { id: "p", name: "Plate", sort_order: 0 },
  { id: "b", name: "Base", sort_order: 1 },
];
const e1 = resolveRequestedRoles(SEASON_ROLES, [" PLATE "]);
ok(
  JSON.stringify([...e1.resolved]) === JSON.stringify([["PLATE", { id: "p", name: "Plate" }]]) && e1.toCreate.length === 0,
  "[E1]",
  JSON.stringify({ resolved: [...e1.resolved], toCreate: e1.toCreate }),
);
const e2 = resolveRequestedRoles(SEASON_ROLES, ["Field", " field", "", "base"]);
ok(
  JSON.stringify(e2.toCreate) === JSON.stringify(["Field"]) && e2.resolved.get("base")?.name === "Base",
  "[E2]",
  JSON.stringify({ resolved: [...e2.resolved], toCreate: e2.toCreate }),
);
const e3 = resolveRequestedRoles(
  [{ id: "late", name: "plate", sort_order: 5 }, { id: "early", name: "Plate", sort_order: 0 }],
  ["PLATE"],
);
ok(e3.resolved.get("PLATE")?.id === "early" && e3.resolved.get("PLATE")?.name === "Plate", "[E3]", JSON.stringify([...e3.resolved]));

async function endToEnd() {
  const fake = new FakeClient({
    leagues: [], divisions: [], teams: [], games: [], umpires: [], official_conflicts: [],
    official_availability: [], official_blackouts: [], game_umpires: [], profiles: [],
    official_roles: [
      { id: "p", season_id: "s1", name: "Plate", sort_order: 0 },
      { id: "x", season_id: "s2", name: "field", sort_order: 0 },
    ],
  });
  const map = await ensureSeasonRoleIds(fake.asClient() as never, "s1", [" PLATE ", "Field", "FIELD"]);
  const s1 = fake.db.official_roles.filter((r) => r.season_id === "s1").map((r) => r.name).sort();
  ok(
    JSON.stringify(s1) === JSON.stringify(["Field", "Plate"]) &&
      map.get("PLATE")?.name === "Plate" && map.get("PLATE")?.id === "p" &&
      map.get("Field")?.name === "Field" && map.get("FIELD")?.name === "Field" &&
      map.get("Field")?.id === map.get("FIELD")?.id,
    "[E4]",
    JSON.stringify({ s1, map: [...map] }),
  );
}

function wiring() {
  const slots = readFileSync(join(ROOT, "src/components/umpires/umpire-slots.tsx"), "utf8");
  const auto = readFileSync(join(ROOT, "src/lib/umpires/auto-assign.ts"), "utf8");
  const pay = readFileSync(join(ROOT, "src/components/umpires/league-pay-settings.tsx"), "utf8");
  ok(
    slots.includes("{ game_id: game.id, umpire_id: nextUmpireId, role: roleText, role_id: roleId }") &&
      slots.includes(".update({ umpire_id: nextUmpireId, role: roleText, role_id: roleId } as never)") &&
      auto.includes("return { text: hit?.name ?? label, id: hit?.id ?? null };") &&
      auto.includes("        role_id: slot.id,") &&
      pay.includes("role: resolvedRoles.get(role.trim())?.name ?? role,"),
    "[S3]",
    "every writer must write the role's canonical name",
  );
}

endToEnd()
  .then(wiring)
  .catch((e) => ok(false, "[CRASH]", (e as Error).stack ?? String(e)))
  .finally(() => {
    console.log(`${checks - fails}/${checks} checks passed`);
    process.exit(fails ? 1 : 0);
  });

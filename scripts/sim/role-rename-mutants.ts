// Mutation pass for role-rename-sim.ts — applied to the REAL source, restored
// and verified byte-for-byte; killed only at the assertion written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/umpires/role-rename.ts";
const MANAGER = "src/components/umpires/official-roles-manager.tsx";
const ROLES = "src/lib/umpires/roles.ts";
const SLOTS = "src/components/umpires/umpire-slots.tsx";

const MUTANTS: Mutant[] = [
  { id: "RR1", what: "name compare loses toLowerCase", file: LIB,
    find: "  return a.trim().toLowerCase() === b.trim().toLowerCase();",
    replace: "  return a.trim() === b.trim();", expect: "N1" },
  { id: "RR2", what: "clash check counts the role itself", file: LIB,
    find: "  return roles.some((r) => r.id !== roleId && sameRoleName(r.name, newName));",
    replace: "  return roles.some((r) => sameRoleName(r.name, newName));", expect: "N2" },
  { id: "RR3", what: "a reply for another role id is accepted", file: LIB,
    find: "    r.role_id !== roleId ||\n",
    replace: "", expect: "O4" },
  { id: "RR4", what: "name_taken worded as the generic error", file: LIB,
    find: '    if (m.includes("name_taken")) return { ok: false, message: ROLE_NAME_TAKEN };\n',
    replace: "", expect: "O1" },
  { id: "RR5", what: "the manager writes the name directly again", file: MANAGER,
    find: "    const { data, error: rpcErr } = await supabase.rpc(",
    replace: '    await supabase.from("official_roles").update({ name } as never).eq("id", editingId);\n    const { data, error: rpcErr } = await supabase.rpc(',
    expect: "S1" },
  { id: "RR6", what: "roleKey loses toLowerCase (case variants miss)", file: ROLES,
    find: "  return name.trim().toLowerCase();",
    replace: "  return name.trim();", expect: "E1" },
  { id: "RR7", what: "a name requested twice is created twice", file: ROLES,
    find: "    } else if (!creating.has(roleKey(name))) {",
    replace: "    } else if (true) {", expect: "E2" },
  { id: "RR8", what: "legacy tie resolved to the HIGHER sort_order", file: ROLES,
    find: "    if (!cur || r.sort_order < cur.sort_order) byKey.set(",
    replace: "    if (!cur || r.sort_order > cur.sort_order) byKey.set(", expect: "E3" },
  { id: "RR9", what: "UmpireSlots inserts the slot label, not the role", file: SLOTS,
    find: "          { game_id: game.id, umpire_id: nextUmpireId, role: roleText, role_id: roleId },",
    replace: "          { game_id: game.id, umpire_id: nextUmpireId, role, role_id: roleId },", expect: "S3" },
];

runMutants({ sim: "scripts/sim/role-rename-sim.ts", mutants: MUTANTS });

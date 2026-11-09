// Mutation pass for volunteer-roles-sim.ts — one mutant per rule, each must
// fail FIRST at its own assertion (mutant-runner.ts restores every file).
import { runMutants, type Mutant } from "./mutant-runner";

const RS = "src/lib/volunteers/roles-screen.ts";
const MUTANTS: Mutant[] = [
  {
    id: "VR1", what: "per-game roles labelled per team", file: RS,
    find: "  return kind === \"per_game\" ? `${spots} per home game` : `${spots} per our team, per game`;",
    replace: "  return `${spots} per our team, per game`;",
    expect: "R1",
  },
  {
    id: "VR2", what: "\"All\" never shown", file: RS,
    find: "  if (picked.length === divisions.length) return \"All\";\n",
    replace: "",
    expect: "R2",
  },
  {
    id: "VR3", what: "slot count counts games, not spots", file: RS,
    find: "    for (const x of t) spots += x.spots;",
    replace: "    spots += 1;",
    expect: "R3",
  },
  {
    id: "VR4", what: "Filled counts canceled sign-ups", file: RS,
    find: "    if (c.status !== \"active\" || !c.role_id) continue;",
    replace: "    if (!c.role_id) continue;",
    expect: "R4",
  },
  {
    id: "VR5", what: "an unreadable preview saves straight away", file: RS,
    find: "  if (typeof n !== \"number\" || !Number.isInteger(n) || n < 0) return { kind: \"error\" };",
    replace: "  if (typeof n !== \"number\" || !Number.isInteger(n) || n < 0) return { kind: \"go\" };",
    expect: "R5",
  },
  {
    id: "VR6", what: "unknown counts leave the kind open", file: RS,
    find: "  if (active === null) return true;",
    replace: "  if (active === null) return false;",
    expect: "R6",
  },
  {
    id: "VR7", what: "a role with no division can be sent", file: RS,
    find: "  if (d.divisionIds.length === 0) return \"Pick at least one division.\";\n",
    replace: "",
    expect: "R7",
  },
  {
    id: "VR8", what: "name_taken shown as the generic error", file: "src/lib/volunteers/words.ts",
    find: "  if (m.includes(\"name_taken\")) return \"This season already has a role with that name.\";\n",
    replace: "",
    expect: "R8",
  },
  {
    id: "VR9", what: "the editor commits without a preview", file: "src/components/volunteers/roles-screen.tsx",
    find: "    const r = await call(fn, false);",
    replace: "    const r = await call(fn, true);",
    expect: "W1",
  },
  {
    id: "VR10", what: "the editor shows hand-typed old kind words", file: "src/components/volunteers/roles-screen.tsx",
    find: "{k === \"per_game\" ? W.KIND_PER_GAME_DETAIL : W.KIND_PER_TEAM_DETAIL}",
    replace: "{k === \"per_game\" ? \"Like field prep or announcer. Home games only.\" : W.KIND_PER_TEAM_DETAIL}",
    expect: "W2",
  },
  {
    id: "VR11", what: "a volunteer sentence says slots again", file: "src/lib/volunteers/words.ts",
    find: "answer get spots once they're agreed.",
    replace: "answer get slots once they're agreed.",
    expect: "W2",
  },
];

runMutants({
  sim: "scripts/sim/volunteer-roles-sim.ts",
  mutants: MUTANTS,
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
});

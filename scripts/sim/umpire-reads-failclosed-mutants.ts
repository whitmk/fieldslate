// Mutation pass for umpire-reads-failclosed-sim.ts. Each mutant is applied to
// the REAL source, the sim runs (three zones), the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const CONFLICTS = "src/lib/umpires/conflicts.ts";
const ENGINE = "src/lib/umpires/auto-assign.ts";

const auto = (id: string, check: string, expect: string, what: string): Mutant => ({
  id, what, file: ENGINE,
  find: `  if (${check}) return unreadable(`,
  replace: `  if (false && ${check}) return unreadable(`,
  expect,
});

const MUTANTS: Mutant[] = [
  {
    id: "MR1", what: "manual conflict read error discarded", file: CONFLICTS,
    find: "  if (!read.ok) return { ok: false };\n  return { ok: true, conflict:",
    replace: "  if (!read.ok) return { ok: true, conflict: null };\n  return { ok: true, conflict:",
    expect: "M1",
  },
  {
    id: "MR2", what: "manual blackout read error discarded", file: CONFLICTS,
    find: "  if (error) return { ok: false };\n  return { ok: true, blackout:",
    replace: "  if (false && error) return { ok: false };\n  return { ok: true, blackout:",
    expect: "M2",
  },
  {
    id: "MR3", what: "wording ignores an unreadable conflict check", file: CONFLICTS,
    find: "  if (!conflictCheck.ok) {",
    replace: "  if (false) {",
    expect: "W1",
  },
  {
    id: "MR4", what: "wording ignores an unreadable blackout check", file: CONFLICTS,
    find: "  if (!blackoutCheck.ok) {",
    replace: "  if (false) {",
    expect: "W2",
  },
  auto("MA1", "leagueErr", "A1", "season read error discarded"),
  auto("MA2", "seasonRolesErr", "A2", "official roles read error discarded"),
  auto("MA3", "teamsErr", "A3", "teams read error discarded"),
  auto("MA4", "gamesErr", "A4", "games read error discarded"),
  {
    id: "MA5", what: "bookings read error discarded (0129: official_bookings)", file: ENGINE,
    find: "  if (!busyRead.ok) return unreadable(\"the officials' other games\");\n",
    replace: "",
    expect: "A5",
  },
  auto("MA6", "availabilityErr", "A6", "availability read error discarded"),
  auto("MA7", "blackoutsErr", "A7", "blackouts read error discarded"),
  auto("MA8", "divAssignsErr", "A8", "division assignments read error discarded"),
];

runMutants({
  sim: "scripts/sim/umpire-reads-failclosed-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

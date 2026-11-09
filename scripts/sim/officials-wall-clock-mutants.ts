// Mutation pass for officials-wall-clock-sim.ts (2026-11-09). Each mutant puts
// back one piece of the old behaviour — a game time read as an instant in the
// HOST's zone — in the REAL source; the sim runs under UTC, Los Angeles and
// Kiritimati; the source is restored and verified byte-for-byte; and the
// mutant counts as killed only if the FIRST failing assertion is the one
// written for it. Every one of these passes under UTC alone, which is exactly
// how the original bug got through a UTC-pinned harness.
import { runMutants, type Mutant } from "./mutant-runner";

const ELIG = "src/lib/umpires/eligibility.ts";
const ENGINE = "src/lib/umpires/auto-assign.ts";
const CONFLICTS = "src/lib/umpires/conflicts.ts";
const SLOTS = "src/components/umpires/umpire-slots.tsx";
// Since 2026-11-09 auto-assign picks through blockReason (claim-rules.ts), so
// WC6/WC7 mutate the rule there and WC5 the engine's call into it.
const RULES = "src/lib/umpires/claim-rules.ts";

// The old reading, as an expression: the instant's host-zone wall time,
// rendered back into the stored "…Z" shape.
const HOST = (v: string) =>
  `new Date(new Date(${v}).getTime() - new Date(${v}).getTimezoneOffset() * 60000).toISOString()`;
const HOST_DATE = (v: string) => `new Date(${v}).toLocaleDateString("en-CA")`;

const MUTANTS: Mutant[] = [
  {
    id: "WC1", what: "availability minutes read from the host-zone instant", file: ELIG,
    find: "  const startMins = gameStartMinutes(scheduledAt);",
    replace: "  const startMins = new Date(scheduledAt).getHours() * 60 + new Date(scheduledAt).getMinutes();",
    expect: "H5",
  },
  {
    id: "WC2", what: "weekday read from the host-zone instant", file: ELIG,
    find: "  return DAY_CODES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];",
    replace: "  void y; void m; void d;\n  return DAY_CODES[new Date(scheduledAt).getDay()];",
    expect: "H1",
  },
  {
    id: "WC3", what: "game date read from the host-zone instant", file: ELIG,
    find: "  return wallClockDate(scheduledAt);\n}\n\n/** The Monday",
    replace: `  return ${HOST_DATE("scheduledAt")};\n}\n\n/** The Monday`,
    expect: "H3",
  },
  {
    id: "WC4", what: "week read from the host-zone instant", file: ELIG,
    find: "  return weekKeyFromIsoDate(scheduledAt);",
    replace: `  return weekKeyFromIsoDate(${HOST_DATE("scheduledAt")});`,
    expect: "H4",
  },
  {
    id: "WC5", what: "auto-assign checks availability on the host-zone time", file: ENGINE,
    find: "            start: g.scheduled_at,",
    replace: `            start: ${HOST("g.scheduled_at")},`,
    expect: "A1",
  },
  {
    id: "WC6", what: "auto-assign's blackout date from the host-zone instant", file: RULES,
    find: "  if (i.blackouts.includes(i.start.slice(0, 10))) return \"blackout\";",
    replace: `  if (i.blackouts.includes(${HOST_DATE("i.start")})) return "blackout";`,
    expect: "A5",
  },
  {
    id: "WC7", what: "auto-assign's weekly-cap week from the host-zone instant", file: RULES,
    find: "    const week = gameWeekKey(i.start);",
    replace: `    const week = gameWeekKey(${HOST_DATE("i.start")});`,
    expect: "A6",
  },
  {
    id: "WC8", what: "the manual blackout check queries the host-zone date", file: CONFLICTS,
    find: '    .eq("date", gameDateKey(scheduledAt))',
    replace: `    .eq("date", ${HOST_DATE("scheduledAt")})`,
    expect: "M2",
  },
  {
    id: "WC9", what: "the conflict sentence formats the host-zone time", file: CONFLICTS,
    find: "  return `${MONTHS_SHORT[m - 1]} ${d}, ${fmtGameTime(scheduled_at)}`;",
    replace: "  void m; void d; void fmtGameTime;\n  const x = new Date(scheduled_at);\n  return `${x.toLocaleDateString(\"en-US\", { month: \"short\", day: \"numeric\" })}, ${x.toLocaleTimeString(\"en-US\", { hour: \"numeric\", minute: \"2-digit\" })}`;",
    expect: "M3",
  },
  {
    id: "WC10", what: "the manual picker builds a Date from the game time", file: SLOTS,
    find: "  const gameDate = gameDateKey(game.scheduled_at);",
    replace: "  const gameDate = gameDateKey(new Date(game.scheduled_at).toISOString());",
    expect: "M4",
  },
];

runMutants({
  sim: "scripts/sim/officials-wall-clock-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

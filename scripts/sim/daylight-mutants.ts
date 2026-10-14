// Mutation pass for daylight-sim.ts. Each mutant is applied to the REAL module
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it. The leak mutants (a flag reaching a
// public reader) live in daylight-leaks-mutants.ts.
import { runMutants, type Mutant } from "./mutant-runner";

const FLAGS = "src/lib/daylight/flags.ts";
const SUNSET = "src/lib/sun/sunset.ts";

const MUTANTS: Mutant[] = [
  {
    id: "DL1", what: "lights ignored", file: FLAGS,
    find: "  if (game.venue.has_lights) return null;\n",
    replace: "",
    expect: "L1",
  },
  {
    id: "DL2", what: "DST ignored in sunset", file: SUNSET,
    find: "  let local = UT + city.utcOffset + (city.dst && isUsDst(t) ? 1 : 0);",
    replace: "  let local = UT + city.utcOffset;",
    expect: "T1",
  },
  {
    id: "DL3", what: "near window off by one (exactly 20 before is clear)", file: FLAGS,
    find: "  if (endMin >= sunsetMin - NEAR_SUNSET_MIN) return",
    replace: "  if (endMin > sunsetMin - NEAR_SUNSET_MIN) return",
    expect: "B1",
  },
  {
    id: "DL4", what: "after and near swapped", file: FLAGS,
    find: "  if (endMin > sunsetMin) return { kind: \"after\", minutes: endMin - sunsetMin, ...base };\n  if (endMin >= sunsetMin - NEAR_SUNSET_MIN) return { kind: \"near\", minutes: sunsetMin - endMin, ...base };",
    replace: "  if (endMin > sunsetMin) return { kind: \"near\", minutes: endMin - sunsetMin, ...base };\n  if (endMin >= sunsetMin - NEAR_SUNSET_MIN) return { kind: \"after\", minutes: sunsetMin - endMin, ...base };",
    expect: "K1",
  },
  {
    id: "DL5", what: "away interleague games flagged", file: FLAGS,
    find: "  if (game.isAway || game.venue === null) return null;",
    replace: "  if (game.venue === null) return null;",
    expect: "A1",
  },
  {
    id: "DL7", what: "rained-out games flagged", file: FLAGS,
    find: "new Set([\"scheduled\", \"pending_interleague\", \"reschedule_pending\"])",
    replace: "new Set([\"scheduled\", \"pending_interleague\", \"reschedule_pending\", \"cancelled\"])",
    expect: "R1",
  },
  {
    id: "DL8", what: "start-by ignores the near window", file: FLAGS,
    find: "  const latest = sunsetMin - NEAR_SUNSET_MIN - 1 - duration;",
    replace: "  const latest = sunsetMin - duration;",
    expect: "S1",
  },
  {
    id: "DL9", what: "an unknown stored city falls back to a default city", file: FLAGS,
    find: "  return city ? { kind: \"on\", city } : { kind: \"unknown_city\", key };",
    replace: "  return { kind: \"on\", city: city ?? cityByIdOrNull(\"ca-sacramento\")! };",
    expect: "C2",
  },
  {
    id: "DL10", what: "past games flagged", file: FLAGS,
    find: "  if (game.date < today) return null;\n",
    replace: "",
    expect: "P1",
  },
  {
    id: "DL11", what: "timezone mismatch not warned", file: FLAGS,
    find: "  if (!cityTz || cityTz === leagueTimezone) return null;",
    replace: "  if (!cityTz || cityTz !== \"\") return null;",
    expect: "Z1",
  },
  {
    id: "DL12", what: "duration parsed raw (a sixteenth policy)", file: FLAGS,
    find: "  const duration = durationFromSettings({ game_duration: game.rawDuration });",
    replace: "  const duration = Number(game.rawDuration ?? 90);",
    expect: "D1",
  },
  {
    id: "DL13", what: "ending exactly at sunset counted as After", file: FLAGS,
    find: "  if (endMin > sunsetMin) return { kind: \"after\"",
    replace: "  if (endMin >= sunsetMin) return { kind: \"after\"",
    expect: "B3",
  },
  {
    id: "DL14", what: "Lights tag shown while flags are off", file: FLAGS,
    find: "  const lit = state.kind === \"on\" && !isAway && venue?.has_lights === true;",
    replace: "  const lit = !isAway && venue?.has_lights === true;",
    expect: "G3",
  },
];

runMutants({
  sim: "scripts/sim/daylight-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// Mutation pass for sim:volunteer-slots. Applied to the REAL
// src/lib/volunteers/slots.ts, restored byte-for-byte, killed only if the
// FIRST failing assertion is the one written for it. Three host zones.
//
// Left out as EQUIVALENT: "per_team counts the away team on an interleague
// game" — games stores away_team_id NULL on every interleague game, so the
// mutant changes nothing reachable.
//
// MUTATION LOG
//   2026-11-08 run 1: 14/14 killed at their own assertion in all three zones
//   (sim green on its first run, 132 checks × 3 zones).
//   2026-11-08 run 2 (role lead offset added, 159 checks): VS7 and VS12 were STALE
//   (their target lines changed with the lead) — re-aimed; run 3: 16/16 killed at
//   their own assertion in all three zones.
import { runMutants, type Mutant } from "./mutant-runner";

const F = "src/lib/volunteers/slots.ts";

const MUTANTS: Mutant[] = [
  { id: "VS1", what: "per-game roles get spots on interleague games the partner hosts", file: F,
    find: "      if (game.interleagueOrgId && game.isAway) continue;\n", replace: "", expect: "VT1" },
  { id: "VS2", what: "reschedule_pending games carry no spots", file: F,
    find: "  if (status === \"reschedule_pending\") return \"may_move\";\n", replace: "  if (status === \"reschedule_pending\") return \"none\";\n", expect: "VT1" },
  { id: "VS3", what: "a rained-out game takes new claims", file: F,
    find: "  if (status === \"cancelled\") return \"rained_out\";\n", replace: "  if (status === \"cancelled\") return \"open\";\n", expect: "VT1" },
  { id: "VS4", what: "a claim is allowed at the exact start time", file: F,
    find: "  if (untilStart === null || untilStart <= 0) return \"past\";\n", replace: "  if (untilStart === null || untilStart < 0) return \"past\";\n", expect: "VT1" },
  { id: "VS5", what: "unlocked divisions take claims", file: F,
    find: "  if (!lockedDivisionIds.has(target.divisionId)) return \"unpublished\";\n", replace: "", expect: "VT1" },
  { id: "VS6", what: "a role with sign-ups off takes claims", file: F,
    find: "  if (!role.signupsOpen) return \"signups_closed\";\n", replace: "", expect: "VT1" },
  { id: "VS7", what: "the time check runs before the rained-out check", file: F,
    find: "  if (state === \"rained_out\") return \"rained_out\";\n  if (state === \"closed\") return \"closed\";\n  const start = spotStartWall(game.scheduledAt, leadOf(role));\n  const untilStart = start === null ? null : wallMinutesBetween(nowWall, start);\n  if (untilStart === null || untilStart <= 0) return \"past\";\n",
    replace: "  const start = spotStartWall(game.scheduledAt, leadOf(role));\n  const untilStart = start === null ? null : wallMinutesBetween(nowWall, start);\n  if (untilStart === null || untilStart <= 0) return \"past\";\n  if (state === \"rained_out\") return \"rained_out\";\n  if (state === \"closed\") return \"closed\";\n",
    expect: "VT1" },
  { id: "VS8", what: "a per-team spot set takes the home team's division", file: F,
    find: "      const div = teamDivision.get(teamId);\n", replace: "      const div = teamDivision.get(game.homeTeamId);\n", expect: "VT1" },
  { id: "VS9", what: "per-game roles ignore the divisions the admin picked", file: F,
    find: "      if (div && role.divisionIds.includes(div)) {\n        out.push({ roleId: role.id, forTeamId: null, divisionId: div, spots });",
    replace: "      if (div) {\n        out.push({ roleId: role.id, forTeamId: null, divisionId: div, spots });", expect: "VT1" },
  { id: "VS10", what: "exactly 24 hours ahead still allows a change", file: F,
    find: "  return m !== null && m > CHANGE_WINDOW_MIN;\n", replace: "  return m !== null && m >= CHANGE_WINDOW_MIN;\n", expect: "VC1" },
  { id: "VS11", what: "spot counts are not capped at 10", file: F,
    find: "    const spots = Math.min(Math.max(Math.trunc(role.spots), 0), MAX_SPOTS);\n", replace: "    const spots = Math.max(Math.trunc(role.spots), 0);\n", expect: "K1" },
  { id: "VS12", what: "a game's span ignores its division's duration", file: F,
    find: "durationMin: lead + durationFromSettings(divisionSettings) };", replace: "durationMin: lead + 90 };", expect: "O1" },
  { id: "VS13", what: "overlap ignores the date", file: F,
    find: "  return held.some((h) => h.date === next.date && spansOverlap(h, next));\n", replace: "  return held.some((h) => spansOverlap(h, next));\n", expect: "O3" },
  { id: "VS14", what: "the wall clock is formatted without the 24-hour cycle", file: F,
    find: "hour: \"2-digit\", minute: \"2-digit\", hourCycle: \"h23\",", replace: "hour: \"2-digit\", minute: \"2-digit\",", expect: "W1" },
  { id: "VS15", what: "the claim cutoff ignores the role's lead", file: F,
    find: "  const start = spotStartWall(game.scheduledAt, leadOf(role));\n", replace: "  const start = spotStartWall(game.scheduledAt, 0);\n", expect: "VT1" },
  { id: "VS16", what: "a lead is not capped at 120 minutes", file: F,
    find: "Math.min(Math.max(Math.trunc(leadMinutes), 0), MAX_LEAD_MIN) * 60000", replace: "Math.max(Math.trunc(leadMinutes), 0) * 60000", expect: "L2" },
];

runMutants({ sim: "scripts/sim/volunteer-slots-sim.ts", timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"], mutants: MUTANTS });

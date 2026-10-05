// Mutation pass for playoff-bracket-sim.ts — see mutant-runner.ts for the
// rules (applied to the REAL source, restored byte-for-byte, killed only if
// the FIRST failing assertion is the one written for it).
//
// RESULT (2026-10-05): 13/13 killed, each FIRST at its own assertion.
// HONEST NOTE from the first run: PM1 (naive pairing) first died at [A0], a
// literal transcription of standardSeedOrder's output, not at [A3], the
// structural "seeds 1 and 2 in opposite halves" property it was written to
// prove. Both detect it, but a transcription is not the property; the literal
// check was moved AFTER the structural loop (now [A8]) so a layout mutant dies
// at the property it breaks. PM2/PM3 (byes dropped / wrong bye parity) die at
// [A2] — "every team is in the bracket exactly once", the 50/70 defect — and
// PM4 (compacted-index advancement) at [B1] with the exact wrong write the
// live bracket would have made (the 4/5 winner into seed 1's HOME slot).
import { runMutants, type Mutant } from "./mutant-runner";

const PLAN = "src/lib/playoffs/bracket-plan.ts";
const ADV = "src/lib/playoffs/advancement.ts";
const EDIT = "src/lib/playoffs/edit-game.ts";

const MUTANTS: Mutant[] = [
  {
    id: "PM1", what: "naive pairing (1v8, 2v7, 3v6, 4v5) — seeds 1 and 2 in the same half", file: PLAN,
    find: "    for (const s of order) next.push(s, n + 1 - s);",
    replace: "    for (let i = 1; i <= n / 2; i++) next.push(i, n + 1 - i);",
    expect: "A3",
  },
  {
    id: "PM2", what: "bye teams not written into round 2 (the original defect)", file: PLAN,
    find: "      if (bye && roundCount > 1) place(1, Math.floor(p / 2), p % 2 === 0 ? \"home\" : \"away\", bye.team_id);",
    replace: "",
    expect: "A2",
  },
  {
    id: "PM3", what: "a bye team always takes the HOME slot regardless of parity", file: PLAN,
    find: "place(1, Math.floor(p / 2), p % 2 === 0 ? \"home\" : \"away\", bye.team_id);",
    replace: "place(1, Math.floor(p / 2), \"home\", bye.team_id);",
    expect: "A2",
  },
  {
    id: "PM4", what: "advancement by compacted list index (the original defect)", file: ADV,
    find: "  const p = game.game_number - singleElimFirstNumber(roundIdx, bracketSize);\n  if (p >= 0 && p < singleElimRoundSize(roundIdx, bracketSize)) return p;\n",
    replace: "",
    expect: "B1",
  },
  {
    id: "PM5", what: "advancement writes the wrong slot (parity flipped)", file: ADV,
    find: "    field: pos % 2 === 0 ? \"home_team_id\" : \"away_team_id\",",
    replace: "    field: pos % 2 === 0 ? \"away_team_id\" : \"home_team_id\",",
    expect: "B1",
  },
  {
    id: "PM6", what: "hardcoded 105-minute spacing restored", file: PLAN,
    find: "  const step = input.durationMin + input.bufferMin;",
    replace: "  const step = 105;",
    expect: "C1",
  },
  {
    id: "PM7", what: "window checks the START only (the regular generator's rule)", file: PLAN,
    find: "for (let t = winStart; t + input.durationMin <= winEnd; t += step) {",
    replace: "for (let t = winStart; t <= winEnd; t += step) {",
    expect: "C2",
  },
  {
    id: "PM8", what: "round-order rule removed — a later round may start before the earlier one ends", file: PLAN,
    find: "    if (prevRoundEnd) {\n      const earliest",
    replace: "    if (prevRoundEnd && false) {\n      const earliest",
    expect: "D7",
  },
  {
    id: "PM9", what: "wraparound restored — when slots run out, reuse them from the start", file: PLAN,
    find: "    const slot = slots[cursor] ?? null;\n    if (!slot) return null;\n    cursor++;",
    replace: "    const slot = slots.length ? slots[cursor % slots.length] : null;\n    if (!slot) return null;\n    cursor++;",
    expect: "E1",
  },
  {
    id: "PM10", what: "TBD warning dropped", file: PLAN,
    find: "  if (p.tbdCount > 0) {\n    const why",
    replace: "  if (p.tbdCount < 0) {\n    const why",
    expect: "E2",
  },
  {
    id: "PM11", what: "closed day reported as merely too short", file: PLAN,
    find: "        if (open.length === 0) {\n          days.push({ date: iso, day, kind: \"closed\"",
    replace: "        if (open.length < 0) {\n          days.push({ date: iso, day, kind: \"closed\"",
    expect: "F1",
  },
  {
    id: "PM12", what: "the Sunday orphan window is kept in the playoff defaults", file: PLAN,
    find: "  for (const d of days) {\n    const w = rawWin[d];",
    replace: "  for (const d of Object.keys(rawWin)) {\n    const w = rawWin[d];",
    expect: "G1",
  },
  {
    id: "PM13", what: "zero rows affected reads as success on the manual edit", file: EDIT,
    find: "  if (rowsAffected === 1) return null;\n  if (rowsAffected === 0) {",
    replace: "  if (rowsAffected <= 1) return null;\n  if (rowsAffected === 0) {",
    expect: "H1",
  },
];

runMutants({ sim: "scripts/sim/playoff-bracket-sim.ts", timezones: ["UTC"], mutants: MUTANTS });

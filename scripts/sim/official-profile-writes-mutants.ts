// Mutation pass for official-profile-writes-sim.ts (2026-11-09). Each mutant
// is applied to the REAL source, the sim runs, the source is restored and
// verified byte-for-byte, and the mutant counts as killed only if the FIRST
// failing assertion is the one written for it.
//
// PW1 is the original bug: the add panel is a <form> again, nested inside the
// edit modal's <form>.
import { runMutants, type Mutant } from "./mutant-runner";

const SECTIONS = "src/components/umpires/official-profile-sections.tsx";
const WRITES = "src/lib/umpires/profile-writes.ts";
const MODAL = "src/components/umpires/add-umpire-button.tsx";

const MUTANTS: Mutant[] = [
  {
    id: "PW1", what: "the add panel is a nested <form> again (the original bug)", file: SECTIONS,
    find: "  return (\n    <div\n      className={className}\n      onKeyDown={(e) => {",
    replace: "  return (\n    <form\n      className={className}\n      onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onSave(); }}\n      onKeyDown={(e) => {",
    expect: "N1",
  },
  {
    id: "PW2", what: "the Save button submits instead of clicking", file: SECTIONS,
    find: '        type="button"\n        onClick={onSave}',
    replace: '        type="submit"\n        onClick={onSave}',
    expect: "N2",
  },
  {
    id: "PW3", what: "the insert goes to the wrong official", file: WRITES,
    find: "      umpire_id: umpireId,\n      day_of_week: d.day,",
    replace: "      umpire_id: umpireId.slice(1),\n      day_of_week: d.day,",
    expect: "W1",
  },
  {
    id: "PW4", what: "an insert error is swallowed as success", file: WRITES,
    find: "  if (error) return { ok: false, message: word(error) };",
    replace: "  if (error) return { ok: true };",
    expect: "W2",
  },
  {
    id: "PW5", what: "a reply without the rows reads as saved", file: WRITES,
    find: "  if (!Array.isArray(data) || data.length !== rows.length) {",
    replace: "  if (data === undefined) {",
    expect: "W3",
  },
  {
    id: "PW6", what: "a short reply (fewer rows than sent) reads as saved", file: WRITES,
    find: "  if (!Array.isArray(data) || data.length !== rows.length) {",
    replace: "  if (!Array.isArray(data) || data.length === 0) {",
    expect: "W4",
  },
  {
    id: "PW7", what: "an invalid window is sent anyway", file: WRITES,
    find: "    const problem = windowDraftProblem(d);\n    if (problem) return { ok: false, message: problem };",
    replace: "    void windowDraftProblem;",
    expect: "W5",
  },
  {
    id: "PW8", what: "a duplicate blackout date shows the raw database error", file: WRITES,
    find: "      err.code === \"23505\" || /duplicate key|unique/i.test(err.message)",
    replace: "      false",
    expect: "B2",
  },
  {
    id: "PW9", what: "a touched window draft no longer refuses", file: WRITES,
    find: "  if (opts.windowDraftTouched) return UNADDED_WINDOW;",
    replace: "",
    expect: "D1",
  },
  {
    id: "PW10", what: "the add modal inserts its windows directly again", file: MODAL,
    find: "    const avail = await addAvailabilityWindows(supabase, newId, windows);",
    replace: "    await supabase.from(\"official_availability\").insert([] as never[]);\n    const avail = { ok: true as const } as { ok: true } | { ok: false; message: string };",
    expect: "S1",
  },
  {
    id: "PW11", what: "the add modal ignores an unadded draft", file: MODAL,
    find: "    if (unadded) {",
    replace: "    if (false && unadded) {",
    expect: "S2",
  },
];

runMutants({ sim: "scripts/sim/official-profile-writes-sim.ts", mutants: MUTANTS });

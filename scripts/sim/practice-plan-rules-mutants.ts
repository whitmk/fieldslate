// Mutation pass for practice-plan-rules-sim.ts. Each mutant is applied to the
// REAL source, the sim runs under three zones, the source is restored and
// verified byte-for-byte, and the mutant counts as killed only if the FIRST
// failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const LOAD = "src/lib/practice-plans/load.ts";
const PREFILL = "src/lib/practice-plans/prefill.ts";
const REQUEST = "src/lib/practice-plans/request.ts";
const WORDS = "src/lib/practice-plans/words.ts";
const LIST = "src/lib/practice-plans/list.ts";
const EDITOR = "src/lib/practice-plans/editor.ts";

const MUTANTS: Mutant[] = [
  {
    id: "RU1", what: "a version one past the current opens", file: LOAD,
    find: "version > PLAN_INPUT_VERSION) return null;",
    replace: "version > PLAN_INPUT_VERSION + 1) return null;",
    expect: "L2",
  },
  {
    id: "RU2", what: "the input check skipped when opening", file: LOAD,
    find: "  const problem = practicePlanInputProblem(input);",
    replace: "  const problem = null as PlanInputProblem | null;",
    expect: "L3",
  },
  {
    id: "RU3", what: "a season with no teams can be picked", file: PREFILL,
    find: "  const candidates = rows.filter((r) => withTeams.has(r.seasonId)).sort(seasonOrder);",
    replace: "  const candidates = rows.filter(() => true).sort(seasonOrder);",
    expect: "P1",
  },
  {
    id: "RU4", what: "undated seasons first", file: PREFILL,
    find: "    if (a.seasonStart === null) return 1;\n    if (b.seasonStart === null) return -1;",
    replace: "    if (a.seasonStart === null) return -1;\n    if (b.seasonStart === null) return 1;",
    expect: "P2",
  },
  {
    id: "RU5", what: "archived seasons skipped", file: PREFILL,
    find: "  const withTeams = new Set(rows.filter((r) => r.teamCount > 0).map((r) => r.seasonId));",
    replace: "  const withTeams = new Set(rows.filter((r) => r.teamCount > 0 && r.seasonArchivedAt === null).map((r) => r.seasonId));",
    expect: "P3",
  },
  {
    id: "RU6", what: "a start-date tie goes to the OLDEST created", file: PREFILL,
    find: "  const c = time(b.seasonCreatedAt) - time(a.seasonCreatedAt);",
    replace: "  const c = time(a.seasonCreatedAt) - time(b.seasonCreatedAt);",
    expect: "P4",
  },
  {
    id: "RU7", what: "a duplicated name hints the first match", file: PREFILL,
    find: "  if (matches.length !== 1) return null;",
    replace: "  if (matches.length === 0) return null;",
    expect: "H2",
  },
  {
    id: "RU8", what: "a new plan's team count not capped", file: PREFILL,
    find: "    const teams = Math.min(count, L.teams.max);",
    replace: "    const teams = d.teams;",
    expect: "N2",
  },
  {
    id: "RU12", what: "a new plan's long name not cut", file: PREFILL,
    find: "    const name = cut(d.name, L.divisionName.maxChars);",
    replace: "    const name = d.name;",
    expect: "N2b",
  },
  {
    id: "RU13", what: "the division cap retyped as 30 instead of read from INPUT_LIMITS", file: PREFILL,
    find: "  const kept = prefill.divisions.slice(0, L.divisions.max);",
    replace: "  const kept = prefill.divisions.slice(0, 30);",
    expect: "N2c",
  },
  {
    id: "RU9", what: "a lit division with no teams is named", file: REQUEST,
    find: "d.lit === true && divisionIsActive(d)",
    replace: "d.lit === true",
    expect: "T3",
  },
  {
    id: "RU10", what: "the lit line appears with nothing lit", file: WORDS,
    find: '  return names.length ? `On lit fields: ${names.join(", ")}.` : null;',
    replace: '  return `On lit fields: ${names.join(", ")}.`;',
    expect: "T2",
  },
  {
    id: "RU11", what: "the city request drops the lit line", file: REQUEST,
    find: "  return lit ? `${text}\\n\\n${lit}` : text;",
    replace: "  return text;",
    expect: "T4",
  },
  {
    id: "RU14", what: "a stale save answer not recognised", file: LIST,
    find: '  if (d && d.committed === false && d.status === "stale" && typeof d.updated_at === "string") {',
    replace: "  if (false) {",
    expect: "R2",
  },
  {
    id: "RU15", what: "the edited date taken in UTC, not the league's timezone", file: LIST,
    find: "  const day = todayInTimezone(timeZone, new Date(t));",
    replace: "  const day = new Date(t).toISOString().slice(0, 10);",
    expect: "R3",
  },
  {
    id: "RU16", what: "a committed reply without a plan id counts as done", file: LIST,
    find: '  if (!d || d.committed !== true || typeof d.id !== "string") return { ok: false, message: planErrorMessage("unknown") };',
    replace: '  if (!d || d.committed !== true) return { ok: false, message: planErrorMessage("unknown") };',
    expect: "R1",
  },
  {
    id: "RU17", what: "a plan_required refusal treated as a plain failure", file: EDITOR,
    find: '  if (planErrorKey(rawError) === "plan_required") return { state: { kind: "stopped" }, updatedAt: null };\n',
    replace: "",
    expect: "A1",
  },
  {
    id: "RU18", what: "a failed save retried on its own", file: EDITOR,
    find: '  return state.kind === "dirty" && invalidFields === 0;',
    replace: '  return (state.kind === "dirty" || state.kind === "failed") && invalidFields === 0;',
    expect: "A2",
  },
  {
    id: "RU19", what: "leaving warns only while dirty", file: EDITOR,
    find: '  return state.kind !== "clean" || invalidFields > 0;',
    replace: '  return state.kind === "dirty" || invalidFields > 0;',
    expect: "A3",
  },
  {
    id: "RU20", what: "a division added past the limit", file: EDITOR,
    find: "  if (!canAddDivision(input)) return { input, id: null };",
    replace: "",
    expect: "A4",
  },
  {
    id: "RU21", what: "a typed team count not capped", file: EDITOR,
    find: "  return n >= INPUT_LIMITS.teams.min && n <= INPUT_LIMITS.teams.max ? n : null;",
    replace: "  return n >= INPUT_LIMITS.teams.min ? n : null;",
    expect: "A6",
  },
  {
    id: "RU22", what: "an edit mid-save goes back to dirty (a second save can race the first)", file: EDITOR,
    find: '  return state.kind === "saving" || state.kind === "stale" || state.kind === "stopped" ? state : { kind: "dirty" };',
    replace: '  return state.kind === "stale" || state.kind === "stopped" ? state : { kind: "dirty" };',
    expect: "A8",
  },
  {
    id: "RU23", what: "an edit made during a save waits for the next keystroke", file: EDITOR,
    find: '  return next.kind === "clean" && editedDuringSave ? { kind: "dirty" } : next;',
    replace: "  return next;",
    expect: "A9",
  },
  {
    id: "RU24", what: "autosave ignores fields holding invalid text", file: EDITOR,
    find: '  return state.kind === "dirty" && invalidFields === 0;',
    replace: '  return state.kind === "dirty";',
    expect: "A10",
  },
];

runMutants({
  sim: "scripts/sim/practice-plan-rules-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

// Mutation pass for record-played-sim.ts. Each mutant is applied to the REAL
// source, the sim runs under three zones, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
//
// The database-side mutants (interleague, status, UTC today, season start,
// posted_at, ordinary edits exempted, EXECUTE on PUBLIC, plan) live in
// scripts/sim/record-game-played-sim.sql.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/schedule/record-played.ts";
const TODAY = "src/lib/utils/org-today.ts";
const MODAL = "src/components/schedule/record-played-modal.tsx";
const LIST = "src/components/schedule/schedule-list.tsx";
const OTHER_SURFACE = "src/components/schedule/use-schedule-reschedule.tsx";

const MUTANTS: Mutant[] = [
  {
    id: "RP1", what: "today computed in UTC, not the org's zone", file: TODAY,
    find: `new Intl.DateTimeFormat("en-CA", { timeZone, year`,
    replace: `new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year`,
    expect: "T1",
  },
  {
    id: "RP2", what: "past-only rule dropped from the entry-point check", file: LIB,
    find: `    isOnOrBeforeToday(game.scheduled_at, today)\n  );`,
    replace: `    (isOnOrBeforeToday(game.scheduled_at, today) || true)\n  );`,
    expect: "O3",
  },
  {
    id: "RP3", what: "a conflict disables Save", file: LIB,
    find: `return !!p.when && p.venueChosen && p.dateRefusal === null && !p.saving;`,
    replace: `return !!p.when && p.venueChosen && p.dateRefusal === null && !p.saving && (p.conflicts ?? []).length === 0;`,
    expect: "V1",
  },
  {
    id: "RP4", what: "interleague check dropped from the open-time refusal", file: LIB,
    find: `  if (game.interleague_org_id) return INTERLEAGUE_REFUSAL;\n`,
    replace: ``,
    expect: "R1",
  },
  {
    id: "RP5", what: "a future played date no longer refused", file: LIB,
    find: `  if (date > today) return "That date hasn't happened yet. Enter today or an earlier date.";\n`,
    replace: ``,
    expect: "D1",
  },
  {
    id: "RP6", what: "season-start rule dropped", file: LIB,
    find: "  if (date < seasonStart) return `That's before the season started (${fmtDay(seasonStart)}).`;\n",
    replace: ``,
    expect: "D3",
  },
  {
    id: "RP7", what: "official candidate time parsed in the host's zone", file: LIB,
    find: "    scheduled_at: `${p.when.isoString}+00:00`,",
    replace: "    scheduled_at: p.when.isoString,",
    expect: "C1",
  },
  {
    id: "RP8", what: "a reply without the game id treated as success", file: LIB,
    find: "  if (saved !== gameId) {",
    replace: "  if (saved !== gameId && data !== null) {",
    expect: "Z1",
  },
  {
    id: "RP9", what: "the router drops the Free upsell", file: LIB,
    find: `  if (!ctx.canRecord) return { kind: "upgrade" };\n`,
    replace: ``,
    expect: "W2",
  },
  {
    id: "RP10", what: "the modal's open-time guard removed", file: MODAL,
    find: "    const refused = recordPlayedRefusal(game);",
    replace: "    const refused = null as string | null;",
    expect: "S2",
  },
  {
    id: "RP11", what: "a second render site for the modal", file: OTHER_SURFACE,
    find: "  const modals = (\n    <>\n",
    replace: "  const modals = (\n    <>\n      {false && <RecordPlayedModal gameId=\"\" onClose={() => {}} onSaved={() => {}} />}\n",
    expect: "S1",
  },
  {
    id: "RP12", what: "the modal trusts the picker: no typed-date check", file: MODAL,
    find: "    ctx && validDate ? playedDateRefusal(validDate, ctx.today, ctx.seasonStart) : null;",
    replace: "    null as string | null;",
    expect: "S6",
  },
  {
    id: "RP13", what: "the date refusal no longer disables Save", file: MODAL,
    find: "!recordPlayedSaveEnabled({ when, venueChosen: !!venue, dateRefusal, saving, conflicts })",
    replace: "!recordPlayedSaveEnabled({ when, venueChosen: !!venue, dateRefusal: null, saving, conflicts })",
    expect: "S7",
  },
  {
    id: "RP14", what: "the menu shows the item on every game", file: LIST,
    find: "      {recordPlayedOffered && (",
    replace: "      {(true || recordPlayedOffered) && (",
    expect: "S8",
  },
];

runMutants({
  sim: "scripts/sim/record-played-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});

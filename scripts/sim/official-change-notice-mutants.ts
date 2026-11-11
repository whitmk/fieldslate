// Mutation pass for official-change-notice-sim.ts (0130 app side). Each
// mutant is applied to the REAL source, the sim runs under three zones, the
// source is restored and verified byte-for-byte, and the mutant counts as
// killed only if the FIRST failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const WORDS = "src/lib/umpires/change-notice.ts";
const MAIL = "src/lib/officials-signup/email-templates.ts";
const RUNNER = "src/lib/officials-signup/drain-runner.ts";
const PROBLEMS = "src/lib/outbound-email/problems.ts";
const NOTICE = "src/lib/umpires/notice-state.ts";

const MUTANTS: Mutant[] = [
  { id: "CN1", what: "back on and makeup set swapped", file: WORDS,
    find: "e.game.start.slice(0, 16) === e.was.start.slice(0, 16) ? \"back_on\" : \"makeup_set\"",
    replace: "e.game.start.slice(0, 16) === e.was.start.slice(0, 16) ? \"makeup_set\" : \"back_on\"", expect: "K1" },
  { id: "CN2", what: "a time read in the host's zone, not the stored wall clock", file: WORDS,
    find: "  return `${fmtGameDate(start)} · ${fmtGameTime(start)}`;",
    replace: "  return `${fmtGameDate(start)} · ${new Date(`${start}:00Z`).toLocaleTimeString(\"en-US\", { hour: \"numeric\", minute: \"2-digit\" })}`;",
    expect: "W1" },
  { id: "CN3", what: "the youth rained-out line speaks to the official", file: WORDS,
    find: "          ? `${v.name} is still assigned. If a makeup date is set, we'll email you.`",
    replace: "          ? \"You're still assigned. If a makeup date is set, we'll email you.\"", expect: "W2" },
  { id: "CN4", what: "a closing line on an email that only takes games away", file: WORDS,
    find: "  if (still.length === 0) return null;", replace: "", expect: "W4" },
  { id: "CN5", what: "an unknown problem key read as no problem", file: WORDS,
    find: "  return typeof v === \"string\" && (PROBLEMS as readonly string[]).includes(v) ? (v as MoveProblem) : undefined;",
    replace: "  return typeof v === \"string\" && (PROBLEMS as readonly string[]).includes(v) ? (v as MoveProblem) : null;",
    expect: "P1" },
  { id: "CN6", what: "an empty change list renders an email", file: MAIL,
    find: "      if (!name || !row.changes || row.changes.length === 0) return null;",
    replace: "      if (!name || !row.changes) return null;", expect: "R2" },
  { id: "CN7", what: "the coordinator's email loses its other-game detail", file: WORDS,
    find: "    c.problem === \"time_conflict\" && c.other", replace: "    false && c.other", expect: "R3" },
  { id: "CN8", what: "the coordinator's kind has no template listed", file: MAIL,
    find: "  \"game_changes\",\n  \"assignment_conflicts\",\n] as const;", replace: "  \"game_changes\",\n] as const;", expect: "T1" },
  { id: "CN9", what: "the drain parser drops the changes", file: RUNNER,
    find: "      changes: o.kind === \"game_changes\" ? parseChangeEntries(o.changes) : null,",
    replace: "      changes: null,", expect: "D1" },
  { id: "CN10", what: "no_email shown as a generic send failure", file: PROBLEMS,
    find: "    case \"no_email\":\n      return \"No email on file\";\n", replace: "", expect: "B1" },
  { id: "CN11", what: "the Officials page says nothing when the contact isn't confirmed", file: NOTICE,
    find: "  if (!s.contactConfirmed) return `${PAGE_OFF} Confirm an officials contact email in Settings to turn this on.`;\n",
    replace: "", expect: "N1" },
  { id: "CN12", what: "the official's email carries a link", file: MAIL,
    find: "        changesClosing(row.changes, v),\n      );",
    replace: "        changesClosing(row.changes, v),\n        { url: `${SITE_URL}/o/`, label: \"Open\" },\n      );", expect: "R1" },
  { id: "CN13", what: "the youth-email check shown on every youth official", file: NOTICE,
    find: "  return Number.isFinite(at) && at < PARENT_LABEL_FROM ? YOUTH_EMAIL_CHECK : null;",
    replace: "  return Number.isFinite(at) ? YOUTH_EMAIL_CHECK : null;", expect: "N2" },
];

runMutants({ sim: "scripts/sim/official-change-notice-sim.ts", timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"], mutants: MUTANTS });

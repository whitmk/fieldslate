// Mutation pass for auto-archive-sim.ts — one mutant per rule, each must fail
// FIRST at its own assertion (see mutant-runner.ts). Run under three host
// zones: the rule must not depend on the server's clock.
//
// MUTATION LOG (2026-10-19). First pass: 9/11 at their own tag. AA6 first
// deleted the games-unreadable line, which made the decision CRASH on null
// rather than fail open ([CRASH-D]) — rewritten to treat null as no games,
// the real fail-open shape, now caught by [U1]. AA10 died at [I1], not the
// [TZ1] it was first tagged with: the last-day season never reaches the
// decision (endDatePassed skips it first), so I1 is its true catcher.
// 2026-11-08: AA13–AA17 (0121 part 4, the volunteer hold). First pass: all
// five killed at their own tag, but AA8 had gone STALE (its line now returns
// NOTHING) — re-aimed; then 17/17 at their own assertion.
// AA18–AA21 (the hold banner and archive confirm): 21/21 at their own tag.
import { runMutants, type Mutant } from "./mutant-runner";

const DEC = "src/lib/seasons/archive-decision.ts";
const IO = "src/lib/seasons/auto-archive.ts";
const ED = "src/lib/seasons/end-date.ts";

const MUTANTS: Mutant[] = [
  {
    id: "AA1", what: "the end date's own day counts as passed", file: DEC,
    find: "return endDate !== null && endDate < today;",
    replace: "return endDate !== null && endDate <= today;",
    expect: "E1",
  },
  {
    id: "AA2", what: "regular-season games ignored (only playoff dates block)", file: DEC,
    find: "const next = [...ahead, ...playoffAhead].sort()[0];",
    replace: "const next = [...playoffAhead].sort()[0];",
    expect: "G1",
  },
  {
    id: "AA3", what: "a game TODAY no longer blocks", file: DEC,
    find: ".filter((d) => d >= today).sort();",
    replace: ".filter((d) => d > today).sort();",
    expect: "G2",
  },
  {
    id: "AA4", what: "undated playoff games count as finished", file: DEC,
    find: "  if (!g.scheduledDate) return false;",
    replace: "  if (!g.scheduledDate) return true;",
    expect: "P2",
  },
  {
    id: "AA5", what: "a dated playoff game counts as finished without a result", file: DEC,
    find: "  return g.status === \"completed\" || g.winnerId !== null || g.homeScore !== null || g.awayScore !== null;",
    replace: "  return true;",
    expect: "P3",
  },
  {
    id: "AA6", what: "unreadable games treated as none (fail open)", file: DEC,
    find: "  if (gameTimes === null) return { archive: false, reason: \"unreadable\", detail: \"the season's games couldn't be read\" };\n",
    replace: "  if (gameTimes === null) return decideAutoArchive({ ...input, gameTimes: [] });\n",
    expect: "U1",
  },
  {
    id: "AA7", what: "\"today\" from the server's UTC clock again", file: IO,
    find: "    today = todayInTimezone(tz, now);",
    replace: "    today = now.toISOString().slice(0, 10);",
    expect: "TZ1",
  },
  {
    id: "AA8", what: "an unreadable timezone falls back to Pacific", file: IO,
    find: "  if (profileError || typeof tz !== \"string\" || !tz) return NOTHING;",
    replace: "  if (false) return NOTHING;",
    expect: "I2",
  },
  {
    id: "AA9", what: "a failed games read becomes no games", file: IO,
    find: "    } catch {\n      gameTimes = null;\n    }",
    replace: "    } catch {\n      gameTimes = [];\n    }",
    expect: "I3",
  },
  {
    id: "AA10", what: "the caller archives without asking the decision", file: IO,
    find: "    if (!decision.archive) continue;",
    replace: "    void decision;",
    // TZ1 can't see it: the end-date pre-check (endDatePassed) already skips
    // the last-day season. I1 — a season with playoffs left stays active —
    // is the check that the helper obeys the decision.
    expect: "I1",
  },
  {
    id: "AA11", what: "the end-date editor lets a date before the start through", file: ED,
    find: "  if (startDate && DATE_RE.test(startDate) && newEnd < startDate) {",
    replace: "  if (false) {",
    expect: "ED1",
  },
  {
    id: "AA12", what: "not-needed playoff games (0114) still block archiving", file: "src/lib/seasons/archive-decision.ts",
    find: "input.playoffGames.filter((g) => g.status !== NOT_NEEDED)",
    replace: "input.playoffGames",
    expect: "N1",
  },
  {
    id: "AA13", what: "volunteer data ignored — the season archives and its sign-ups are wiped", file: DEC,
    find: "  if (input.volunteerData) {\n    return { archive: false, reason: \"volunteer_data\"",
    replace: "  if (false) {\n    return { archive: false, reason: \"volunteer_data\"",
    expect: "VD1",
  },
  {
    id: "AA14", what: "unreadable volunteer data treated as none (fail open)", file: DEC,
    find: "  if (input.volunteerData === null) {\n",
    replace: "  if (false) {\n",
    expect: "VD2",
  },
  {
    id: "AA15", what: "the volunteer hold checked FIRST, so the banner names seasons still running", file: DEC,
    find: "  if (today === null) return { archive: false, reason: \"unreadable\"",
    replace: "  if (input.volunteerData) return { archive: false, reason: \"volunteer_data\", detail: \"\" };\n  if (today === null) return { archive: false, reason: \"unreadable\"",
    expect: "VD3",
  },
  {
    id: "AA16", what: "the helper never passes the holds to the decision", file: IO,
    find: "    const volunteerData = holds === null ? null : holds.includes(season.id);",
    replace: "    const volunteerData = holds === null ? null : false;",
    expect: "VH1",
  },
  {
    id: "AA17", what: "a failed holds call becomes no holds", file: IO,
    find: "    if (!error && Array.isArray(reply) && reply.every((x: unknown) => typeof x === \"string\")) holds = reply as string[];",
    replace: "    holds = Array.isArray(reply) ? (reply as string[]) : [];",
    expect: "VH2",
  },
  {
    id: "AA18", what: "the season page's read-only check archives the season", file: IO,
    find: "    if (!write) continue;\n",
    replace: "",
    expect: "VH3",
  },
  {
    id: "AA19", what: "the confirm button never says it deletes sign-ups", file: "src/lib/seasons/volunteer-hold.ts",
    find: "  return state === \"has\" ? \"Archive and delete sign-ups\" : \"Archive season\";",
    replace: "  return state === \"has\" ? \"Archive season\" : \"Archive season\";",
    expect: "B1",
  },
  {
    id: "AA20", what: "a failed sign-up check reads as no sign-ups", file: "src/lib/seasons/volunteer-hold.ts",
    find: "  if (reply.error || !Array.isArray(reply.data) || !reply.data.every((x) => typeof x === \"string\")) return \"unknown\";",
    replace: "  if (reply.error || !Array.isArray(reply.data) || !reply.data.every((x) => typeof x === \"string\")) return \"none\";",
    expect: "B2",
  },
  {
    id: "AA21", what: "the confirm can archive before the sign-up check answers", file: "src/components/seasons/archive-modals.tsx",
    find: "          disabled={busy || signups === \"checking\"}",
    replace: "          disabled={busy}",
    expect: "B3",
  },
];

runMutants({
  sim: "scripts/sim/auto-archive-sim.ts",
  mutants: MUTANTS,
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
});

// Mutation pass for public-bracket-sim.ts. Each mutant is applied to the REAL
// source, the sim runs, the source is restored and verified byte-for-byte,
// and the mutant counts as killed only if the FIRST failing assertion is the
// one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const VIEW = "src/lib/public-bracket/view.ts";
const SHARE = "src/lib/public-bracket/share.ts";
const READ = "src/lib/public-bracket/read.ts";
const CLIENT = "src/components/public-bracket/public-bracket-client.tsx";

const MUTANTS: Mutant[] = [
  {
    id: "PB1", what: "toRows keeps a score the bracket hides (second lock gone)", file: VIEW,
    find: "    home_score: b.show_scores ? g.home_score : null,",
    replace: "    home_score: g.home_score,",
    expect: "V",
  },
  {
    id: "PB2", what: "the card copies a link for an unlocked division", file: SHARE,
    find: "  if (i.divisionLocked !== true) {",
    replace: "  if (i.divisionLocked === false && false) {",
    expect: "S",
  },
  {
    id: "PB3", what: "double elimination becomes shareable", file: SHARE,
    find: '  return format !== "double_elimination";',
    replace: "  return format.length > 0;",
    expect: "S",
  },
  {
    id: "PB4", what: "an unreadable link reads as \"off\"", file: SHARE,
    find: '  if (i.link === "unreadable") {',
    replace: '  if (i.link === "unreadable" && false) {',
    expect: "S",
  },
  {
    id: "PB5", what: "the reader parse accepts an answer it doesn't know", file: READ,
    find: '  if (typeof status !== "string" || !ANSWERS.has(status)) {',
    replace: '  if (typeof status !== "string") {',
    expect: "R",
  },
  {
    id: "PB6", what: "a malformed division id reaches the database", file: READ,
    find: '  if (!DIVISION_ID_RE.test(divisionId)) return { status: "unavailable" };',
    replace: "",
    expect: "R",
  },
  {
    id: "PB7", what: "the data route caches a failed read", file: "src/app/s/[token]/bracket/[division]/data/route.ts",
    find: '  const init = dataResponseInit(result.status === "error" ? "error" : "answer");',
    replace: '  const init = dataResponseInit("answer");',
    expect: "D",
  },
  {
    id: "PB8", what: "the page shows the admin's \"No date yet\"", file: CLIENT,
    find: "                tree={PUBLIC_TREE}\n                group={PUBLIC_GROUP}\n                undatedText={UNDATED_PUBLIC}",
    replace: "                tree={PUBLIC_TREE}\n                group={PUBLIC_GROUP}",
    expect: "P",
  },
  {
    id: "PB9", what: "the page's cards keep the admin height (an empty action row)", file: CLIENT,
    find: "                tree={PUBLIC_TREE}\n",
    replace: "",
    expect: "P",
  },
  {
    id: "PB10", what: "the page imports the two-stage admin card", file: CLIENT,
    find: 'import { BracketTree, ColumnView, ListGameRow, seriesListInfo } from "@/components/playoffs/bracket-pieces";',
    replace: 'import { BracketTree, ColumnView, ListGameRow, seriesListInfo } from "@/components/playoffs/bracket-pieces";\nimport { TwoStageCard as _T } from "@/components/playoffs/two-stage-card";\nvoid _T;',
    expect: "F",
  },
  {
    id: "PB11", what: "a public file names the round-robin records", file: VIEW,
    find: "export const SEEDING_PENDING =",
    replace: "export const RECORDS_NOTE = \"roundRobinRecords\";\nexport const SEEDING_PENDING =",
    expect: "F",
  },
  {
    id: "PB12", what: "the schedule links double elimination's rows", file: "src/lib/public-schedule/view.ts",
    find: "      bracketDivisionId: formatShareable(p.format) ? p.division_id : null,",
    replace: "      bracketDivisionId: p.division_id,",
    expect: "L",
  },
  {
    id: "PB14", what: "the not-needed games of a series aren't rebuilt (a 2–0 best of 3 reads best of 2)", file: VIEW,
    find: "    if (g.series_game !== 1 || g.series_length <= 1) continue;",
    replace: "    if (g.series_game !== 1 || g.series_length <= 1 || true) continue;",
    expect: "V",
  },
  {
    id: "PB15", what: "the page draws a card for a rebuilt not-needed game", file: CLIENT,
    find: "                undatedText={UNDATED_PUBLIC}\n                hideNotNeeded\n",
    replace: "                undatedText={UNDATED_PUBLIC}\n",
    expect: "P",
  },
  {
    id: "PB13", what: "an uncommitted scores reply reads as saved", file: SHARE,
    find: "  if (r.committed !== true || r.show_scores !== asked) return { ok: false };",
    replace: "  if (r.show_scores !== asked) return { ok: false };",
    expect: "S",
  },
];

runMutants({
  sim: "scripts/sim/public-bracket-sim.ts",
  timezones: ["UTC"],
  mutants: MUTANTS,
});

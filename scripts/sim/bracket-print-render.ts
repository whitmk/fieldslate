// Writes the printable bracket for every fixture to HTML files — the exact
// documents the export modal prints (printDocument + buildBracketPrintHtml).
// Open one in Safari and File → Print to check WebKit; or print to PDF with
// headless Chrome for a Chromium proof.
//
//   npx tsx scripts/sim/bracket-print-render.ts <out-dir>
//
// It only reads the fixtures and writes files. It never connects to anything.
import { mkdirSync, writeFileSync } from "node:fs";
import { buildBracketPrintHtml, printDocument } from "../../src/lib/playoffs/bracket-print";
import { doubleElim, playedFour, roundRobin, seriesMockup, seriesSixteen, singleElim } from "./bracket-print-fixtures";

const out = process.argv[2];
if (!out) {
  console.error("usage: npx tsx scripts/sim/bracket-print-render.ts <out-dir>");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

/** The played 4-team fixture plus game 2 won by its AWAY team, so the proof
 *  shows a winner in each row colour (bold + trophy, never a row tint). */
function playedWithAwayWinner() {
  const g = playedFour();
  const g2 = g.find((x) => x.game_number === 2)!;
  g2.status = "completed"; g2.home_score = 1; g2.away_score = 4; g2.winner_id = g2.away_team_id;
  const f = g.find((x) => x.game_number === 3)!;
  f.away_team_id = g2.away_team_id; f.away_team_name = g2.away_team_name;
  return g;
}

const cases: [string, ReturnType<typeof singleElim>, string][] = [
  ["majors-11", singleElim(11, 5), "single_elimination"],
  ["12-team", singleElim(12, 6), "single_elimination"],
  ["8-team", singleElim(8, 4), "single_elimination"],
  ["4-team-played", playedWithAwayWinner(), "single_elimination"],
  ["16-team", singleElim(16, 8), "single_elimination"],
  ["32-team", singleElim(32, 8), "single_elimination"],
  ["round-robin-6", roundRobin(6), "round_robin"],
  ["double-elim-8", doubleElim(8), "double_elimination"],
  // Playoff series (0114): the approved mockup's bracket, and the tallest
  // card (best of 7) in a 16-team tree.
  ["series-majors-6", seriesMockup(), "single_elimination"],
  ["series-16", seriesSixteen(), "single_elimination"],
];
for (const [name, games, format] of cases) {
  const body = buildBracketPrintHtml(games, format, "Santa Rosa Example League", "Majors", "October 13, 2026");
  writeFileSync(`${out}/${name}.html`, printDocument(body, `${name} Playoff Bracket`, "landscape"));
}
console.log(`wrote ${cases.length} files to ${out}`);

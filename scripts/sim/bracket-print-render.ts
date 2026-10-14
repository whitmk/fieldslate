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
import { doubleElim, roundRobin, singleElim } from "./bracket-print-fixtures";

const out = process.argv[2];
if (!out) {
  console.error("usage: npx tsx scripts/sim/bracket-print-render.ts <out-dir>");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const cases: [string, ReturnType<typeof singleElim>, string][] = [
  ["majors-11", singleElim(11, 5), "single_elimination"],
  ["12-team", singleElim(12, 6), "single_elimination"],
  ["8-team", singleElim(8, 4), "single_elimination"],
  ["16-team", singleElim(16, 8), "single_elimination"],
  ["32-team", singleElim(32, 8), "single_elimination"],
  ["round-robin-6", roundRobin(6), "round_robin"],
  ["double-elim-8", doubleElim(8), "double_elimination"],
];
for (const [name, games, format] of cases) {
  const body = buildBracketPrintHtml(games, format, "Santa Rosa Example League", "Majors", "October 13, 2026");
  writeFileSync(`${out}/${name}.html`, printDocument(body, `${name} Playoff Bracket`, "landscape"));
}
console.log(`wrote ${cases.length} files to ${out}`);

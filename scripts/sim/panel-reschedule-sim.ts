// Harness for the division panel's "Reschedule a game" action.
//
// PART H — the reschedule modal's header variant
// (src/components/divisions/reschedule-modal-header.tsx).
// The header was lifted verbatim out of RainoutRescheduleModal and given a
// `variant` so a plain move doesn't wear a rain cloud. Every existing caller
// omits the prop, so the DEFAULT render must be byte-identical to the markup
// recorded before the variant existed
// (scripts/sim/fixtures/reschedule-modal-header-golden.html). If [H1] fails,
// an existing caller's header changed — fix the component, never re-record.
//
// JSX: the repo's tsconfig uses `jsx: preserve` (Next compiles it), so tsx
// falls back to the classic runtime and needs a global React. The component is
// therefore imported dynamically after that global is set.
//
// ── MUTATION LOG (2026-09-25) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   HM1  default variant flipped to "move"          → [H1]
//   HM2  "move" still renders the rain cloud          → [H3]
// RESULT: 2/2 killed, each at its own assertion.

import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function partH() {
  const { RescheduleModalHeader } = await import(
    "@/components/divisions/reschedule-modal-header"
  );
  const golden = readFileSync(
    join(__dirname, "fixtures", "reschedule-modal-header-golden.html"),
    "utf8",
  ).trimEnd();
  const base = { homeTeamName: "Mets", awayTeamName: "Cubs & Co", onClose: () => {} };
  const render = (variant?: "rainout" | "move") =>
    renderToStaticMarkup(
      React.createElement(RescheduleModalHeader, variant ? { ...base, variant } : base),
    );

  const dflt = render();
  ok(dflt === golden, "[H1] default header byte-identical to the pre-variant golden");
  ok(render("rainout") === golden, "[H2] explicit rainout byte-identical to the golden");
  const move = render("move");
  ok(
    move.includes("lucide-calendar-clock") && !move.includes("lucide-cloud-rain"),
    "[H3] move variant shows no rain cloud",
  );
  const stripIcon = (html: string) =>
    html.replace(/<svg[^>]*class="lucide lucide-(cloud-rain|calendar-clock)[\s\S]*?<\/svg>/, "<ICON/>");
  ok(
    stripIcon(move) === stripIcon(golden),
    "[H4] move variant differs from rainout in the icon ONLY",
  );
}

async function main() {
  console.log("\npanel-reschedule sim");
  await partH();
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

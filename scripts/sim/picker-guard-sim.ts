// Harness for the reschedule picker's OWN interleague/status guard
// (src/lib/schedule/picker-guard.ts) and its two call sites in
// rainout-reschedule-modal.tsx / manual-move-form.tsx.
//
// WHAT IT PINS
// - G1  an interleague game is refused at open, naming the partner and the
//       action to use instead (makeup wording when rained out)
// - G2  an ordinary game of the variant's status is allowed at open
// - G3  a wrong-status ordinary game is refused (rainout on a scheduled game;
//       move on a cancelled/completed game) — the status-rewrite backstop
// - G4  an unreadable game is refused (fail closed)
// - G5  the save scope carries BOTH conditions for both variants
// - G6  a zero-row save is an ERROR, never success
// - S1  the picker asks pickerOpenRefusal BEFORE any other read
// - S2  both saves put the conditions INSIDE the UPDATE and check the rows
// ANTI-VACUITY: an interleague game and an ordinary game each reached the
// open-guard in the run; a zero-row and a one-row save each evaluated.
//
// ── MUTATION LOG (2026-09-28) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   PG1  pickerOpenRefusal ignores interleague (guard removed at open)   → [G1]
//   PG2  picker's handleConfirm drops `.is("interleague_org_id", null)`
//        (guard at open but NOT at save)                                 → [S2]
//   PG3  saveOutcome returns null for zero rows (a silent no-op)         → [G6]
//   PG4  pickerOpenRefusal skips the status check (completed → picker)  → [G3]
// RESULT: 4/4 killed, each FIRST at its own assertion.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectedStatusFor,
  pickerOpenRefusal,
  saveOutcome,
  saveScope,
} from "@/lib/schedule/picker-guard";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const counters = { interleagueReachedGuard: 0, ordinaryReachedGuard: 0, zeroRowSave: 0, oneRowSave: 0 };
const org = { name: "Westside LL" };

function main() {
  console.log("\npicker-guard sim");

  // G1 — interleague refused, either variant, with the right action named.
  const ilSched = pickerOpenRefusal({ status: "scheduled", interleague_org_id: "io", interleague_org: org }, "move");
  const ilCanc = pickerOpenRefusal({ status: "cancelled", interleague_org_id: "io", interleague_org: org }, "rainout");
  counters.interleagueReachedGuard += 2;
  ok(
    !!ilSched && ilSched.includes("Westside LL") && ilSched.includes("Request reschedule") &&
      !!ilCanc && ilCanc.includes("Propose makeup time"),
    "[G1] an interleague game is refused at open, naming the partner and the request to use",
    `${ilSched} | ${ilCanc}`,
  );
  ok(
    !!pickerOpenRefusal({ status: "scheduled", interleague_org_id: "io", interleague_org: null }, "rainout"),
    "[G1b] …even when the status also mismatches and the org name is missing",
  );

  // G2 — ordinary game of the right status allowed.
  const okMove = pickerOpenRefusal({ status: "scheduled", interleague_org_id: null }, "move");
  const okRain = pickerOpenRefusal({ status: "cancelled", interleague_org_id: null }, "rainout");
  counters.ordinaryReachedGuard += 2;
  ok(okMove === null && okRain === null, "[G2] an ordinary game of the variant's status opens", `${okMove} | ${okRain}`);

  // G3 — wrong status refused (the status-rewrite backstop).
  const r1 = pickerOpenRefusal({ status: "completed", interleague_org_id: null }, "move");
  const r2 = pickerOpenRefusal({ status: "cancelled", interleague_org_id: null }, "move");
  const r3 = pickerOpenRefusal({ status: "scheduled", interleague_org_id: null }, "rainout");
  ok(
    !!r1 && r1.includes("completed") && !!r2 && r2.includes("rained out") && !!r3 && r3.includes("nothing to recover"),
    "[G3] a wrong-status ordinary game is refused (completed/rained-out on move, scheduled on rainout)",
    `${r1} | ${r2} | ${r3}`,
  );

  // G4 — unreadable → refused.
  ok(!!pickerOpenRefusal(null, "move") && !!pickerOpenRefusal(null, "rainout"), "[G4] an unreadable game is refused (fail closed)");

  // G5 — save scope.
  ok(
    saveScope("move").interleagueOrgIdIsNull === true && saveScope("move").status === "scheduled" &&
      saveScope("rainout").interleagueOrgIdIsNull === true && saveScope("rainout").status === "cancelled" &&
      expectedStatusFor("move") === "scheduled" && expectedStatusFor("rainout") === "cancelled",
    "[G5] the save scope carries the interleague AND status conditions for both variants",
  );

  // G6 — zero rows is an error.
  const zero = saveOutcome(0, "move");
  const one = saveOutcome(1, "move");
  counters.zeroRowSave++;
  counters.oneRowSave++;
  ok(!!zero && zero.startsWith("Nothing was saved") && zero.includes("interleague"), "[G6] a zero-row save is an ERROR that says nothing was saved", String(zero));
  ok(one === null && saveOutcome(1, "rainout") === null, "[G6b] a one-row save succeeds");
  ok(!!saveOutcome(0, "rainout")?.includes("rained out"), "[G6c] the rainout variant's zero-row error names the expected status");

  // S1/S2 — source wiring.
  const root = join(__dirname, "..", "..", "src", "components", "divisions");
  const picker = readFileSync(join(root, "rainout-reschedule-modal.tsx"), "utf8");
  const manual = readFileSync(join(root, "manual-move-form.tsx"), "utf8");
  const guardAt = picker.indexOf("pickerOpenRefusal(");
  const firstDivisionRead = picker.indexOf('.from("divisions")');
  ok(guardAt > 0 && firstDivisionRead > guardAt, "[S1] the picker asks pickerOpenRefusal before its first division read");
  const savePattern = /\.eq\("id", gameId\)\s*\.is\("interleague_org_id", null\)\s*\.eq\("status", scope\.status\)\s*\.select\("id"\)/;
  ok(
    savePattern.test(picker) && picker.includes("saveOutcome((saved ?? []).length, variant)"),
    "[S2] the picker's save carries both conditions INSIDE the UPDATE and checks the rows",
  );
  ok(
    savePattern.test(manual) && manual.includes('saveOutcome((saved ?? []).length, "move")'),
    "[S2b] the manual form's save does the same",
  );
  ok(
    picker.includes("guardRefusal ? (") && picker.includes("!guardRefusal && ("),
    "[S3] a refused open renders the refusal and hides the manual footer",
  );

  for (const [name, n] of Object.entries(counters)) ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  console.log("  counters:", JSON.stringify(counters));
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}
main();
